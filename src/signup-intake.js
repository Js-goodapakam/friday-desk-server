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
      // Do not expose Supabase's account-existence diagnostics.
      if (response.status === 429) return sendError(res, 429, 'Too many requests. Please try again later.');
      return sendError(res, 502, 'Unable to send an email confirmation. Please try again or contact support.');
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
    const ownerRequest = await fetch(new URL('/api/integrations/engagestay/signup', config.ownerOrigin), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + config.ownerToken,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
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
      console.error(JSON.stringify({ event: 'engagestay_signup_owner_delivery_failed', status: ownerRequest.status }));
      return sendError(res, 502, 'Your email is confirmed, but your onboarding request could not be submitted. Please retry.');
    }
    return res.status(202).json({ accepted: true, status: 'PENDING_REVIEW' });
  } catch {
    return sendError(res, 503, 'Registration could not be completed right now. Please retry.');
  }
}

module.exports = { signupRoutes: { start, complete } };
