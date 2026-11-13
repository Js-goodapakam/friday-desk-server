const { createHash } = require('node:crypto');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+[1-9]\d{7,14}$/;
const recentRequests = new Map();

function settings() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const clientOrigin = (process.env.CLIENT_ORIGIN || '').replace(/\/$/, '');
  const ownerOrigin = process.env.OWNER_CONTROL_PLANE_ORIGIN || '';
  const ownerToken = process.env.ENGAGE_OWNER_SERVICE_TOKEN || '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key ||
      !/^https:\/\//.test(clientOrigin) || !/^https:\/\//.test(ownerOrigin) ||
      ownerToken.length < 32) return null;
  return { url, key, clientOrigin, ownerOrigin, ownerToken };
}

function sendError(res, status, error) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error });
}

async function start(req, res) {
  const config = settings();
  if (!config) return sendError(res, 503, 'Signup is not configured. Please contact Engagehubs support.');

  const { businessName, email, password, mobile } = req.body || {};
  const name = typeof businessName === 'string' ? businessName.trim() : '';
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const phone = typeof mobile === 'string' ? mobile.trim() : '';

  if (name.length < 2 || name.length > 160 || !emailPattern.test(address) ||
      address.length > 254 || typeof password !== 'string' ||
      password.length < 10 || password.length > 128 || !phonePattern.test(phone)) {
    return sendError(res, 400, 'Please provide a valid business name, email, phone number and password of at least 10 characters.');
  }

  const limiterKey = createHash('sha256').update(String(req.ip) + ':' + address).digest('hex');
  const now = Date.now();
  if ((recentRequests.get(limiterKey) || 0) > now - 60000) {
    return sendError(res, 429, 'A verification email was recently requested. Please check your inbox before trying again.');
  }

  try {
    const redirectTo = new URL('/?signup=verify', config.clientOrigin).toString();
    const response = await fetch(config.url + '/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectTo), {
      method: 'POST',
      headers: { apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: address,
        password,
        data: { engage_stay_signup: true, organization_name: name, phone },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      // Supabase GoTrue returns a machine-readable error code. Preserve only
      // a bounded, safe code in operational logs; never log identity, password,
      // email address, full upstream response, or any authorization headers.
      const failure = await response.json().catch(() => ({}));
      const rawCode = typeof failure.code === 'string' ? failure.code : '';
      const errorCode = /^[a-z][a-z0-9_]{0,79}$/.test(rawCode) ? rawCode : 'unknown';
      console.error(JSON.stringify({
        event: 'engagestay_email_signup_failed',
        status: response.status,
        code: errorCode,
      }));

      // Do not expose whether a particular email address has an account.
      if (errorCode === 'email_address_not_authorized') {
        return sendError(res, 503,
          'Engage Stay cannot send verification emails to customer addresses yet. The administrator must configure a custom SMTP provider in Supabase Authentication.');
      }
      if (response.status === 429 || errorCode === 'over_email_send_rate_limit') {
        return sendError(res, 429,
          'The verification-email sending limit has been reached. Try again later or ask your administrator to configure a custom SMTP provider.');
      }
      if (errorCode === 'email_provider_disabled' || errorCode === 'signup_disabled') {
        return sendError(res, 503,
          'Email registration is disabled in the authentication provider. Please contact the Engagehubs administrator.');
      }
      if (errorCode === 'email_address_invalid') {
        return sendError(res, 400, 'This email address cannot receive a verification email. Please use a valid email address.');
      }
      return sendError(res, 502,
        'Unable to send a verification email. Please contact Engagehubs support.');
    }

    const result = await response.json();
    // A hosted project must require email confirmation. Do not treat
    // auto-confirmed accounts as verified customer signups.
    if (result.access_token || result.session?.access_token || result.user?.email_confirmed_at) {
      return sendError(res, 503, 'Email confirmation must be enabled by the Engagehubs administrator before registration can continue.');
    }

    recentRequests.set(limiterKey, now);
    if (recentRequests.size > 10000) {
      for (const [key, value] of recentRequests) if (value < now - 60000) recentRequests.delete(key);
    }
    return res.status(202).json({ accepted: true, next: 'VERIFY_EMAIL' });
  } catch {
    return sendError(res, 503, 'The email confirmation service is temporarily unavailable.');
  }
}

async function complete(req, res) {
  const config = settings();
  if (!config) return sendError(res, 503, 'Registration processing is not configured.');

  const token = req.body?.accessToken;
  if (typeof token !== 'string' || token.length < 30 || token.length > 8192 ||
      !/^[A-Za-z0-9._-]+$/.test(token)) {
    return sendError(res, 400, 'A valid email confirmation is required.');
  }

  try {
    const verified = await fetch(config.url + '/auth/v1/user', {
      headers: { apikey: config.key, Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(10000),
    });
    if (!verified.ok) return sendError(res, 401, 'This confirmation link has expired or is invalid.');

    const user = await verified.json();
    const meta = user.user_metadata || {};
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    const name = typeof meta.organization_name === 'string' ? meta.organization_name.trim() : '';
    const phone = typeof meta.phone === 'string' ? meta.phone.trim() : '';
    if (!user.id || !user.email_confirmed_at || meta.engage_stay_signup !== true ||
        !emailPattern.test(email) || name.length < 2 || name.length > 160 || !phonePattern.test(phone)) {
      return sendError(res, 403, 'Registration requires a verified email and complete business details.');
    }

    const key = createHash('sha256').update('engage_stay:email:' + user.id).digest('hex');

    // Vercel's deployment protection sits in front of the Owner Tool API.
    // Forward the short-lived, platform-issued OIDC identity for Trusted
    // Sources verification. The Owner API still requires its independent
    // ENGAGE_OWNER_SERVICE_TOKEN in Authorization.
    const oidcToken = req.get('x-vercel-oidc-token');
    const ownerHeaders = {
      Authorization: 'Bearer ' + config.ownerToken,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    };
    if (process.env.VERCEL === '1' && oidcToken) {
      ownerHeaders['x-vercel-trusted-oidc-idp-token'] = oidcToken;
    }

    const ownerRequest = await fetch(new URL('/api/integrations/engagestay/signup', config.ownerOrigin), {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        source: 'email',
        externalUserId: String(user.id),
        email,
        organizationName: name,
        phone,
        requestedLifecycle: 'TRIAL',
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!ownerRequest.ok) {
      // Identify the rejection layer without recording customer data or tokens.
      // Vercel deployment protection rejects before the Owner API can answer;
      // the Owner application returns JSON with SERVICE_AUTH_REQUIRED for a
      // mismatched service credential.
      const contentType = ownerRequest.headers.get('content-type') || '';
      let upstreamCode = '';
      if (contentType.includes('application/json')) {
        const upstreamBody = await ownerRequest.json().catch(() => ({}));
        const code = upstreamBody?.error;
        if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/.test(code)) upstreamCode = code;
      }
      console.error(JSON.stringify({
        event: 'engagestay_signup_owner_delivery_failed',
        status: ownerRequest.status,
        layer: upstreamCode === 'SERVICE_AUTH_REQUIRED' ? 'service_token' :
          contentType.includes('text/html') ? 'vercel_protection' : 'unknown',
        oidcPresented: Boolean(process.env.VERCEL === '1' && oidcToken),
      }));
      return sendError(res, 502, 'Your email is confirmed, but your onboarding request could not be submitted. Please retry.');
    }
    return res.status(202).json({ accepted: true, status: 'PENDING_REVIEW' });
  } catch {
    return sendError(res, 503, 'Registration could not be completed right now. Please retry.');
  }
}

module.exports = { signupRoutes: { start, complete } };
