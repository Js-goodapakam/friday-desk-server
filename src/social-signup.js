const { randomBytes, timingSafeEqual } = require('node:crypto');
const config = { google: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'https://accounts.google.com/o/oauth2/v2/auth'], microsoft: ['MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'] };
const cookie = (res, value, age) => res.setHeader('Set-Cookie', `engage_social_state=${value}; Path=/api/auth/social; HttpOnly; SameSite=Lax; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
function socialSignupRoutes() {
  return { start(req, res) {
    const provider = config[req.params.provider]; const apiOrigin = process.env.PUBLIC_API_ORIGIN;
    if (!provider || !apiOrigin || !process.env[provider[0]] || !process.env[provider[1]]) return res.status(503).json({ error: 'This sign-in provider is not configured yet.' });
    const state = randomBytes(32).toString('hex'); cookie(res, state, 600);
    const callback = new URL(`/api/auth/social/${req.params.provider}/callback`, apiOrigin).toString();
    const url = new URL(provider[2]);
    url.search = new URLSearchParams({ client_id: process.env[provider[0]], redirect_uri: callback, response_type: 'code', scope: req.params.provider === 'google' ? 'openid email profile' : 'openid profile email User.Read', state, prompt: 'select_account' }).toString();
    return res.redirect(302, url.toString());
  }, async callback(req, res) {
    const supplied = String(req.query.state || ''); const expected = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('engage_social_state='))?.slice(20) || '';
    if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return res.status(400).send('Invalid social sign-in state. Please try again.');
    cookie(res, '', 0);
    const provider = config[req.params.provider], apiOrigin = process.env.PUBLIC_API_ORIGIN, clientOrigin = process.env.CLIENT_ORIGIN, code = String(req.query.code || '');
    if (!provider || !apiOrigin || !clientOrigin || !code || !process.env[provider[0]] || !process.env[provider[1]]) return res.status(503).send('Social sign-in provider setup is incomplete.');
    try {
      const redirectUri = new URL(`/api/auth/social/${req.params.provider}/callback`, apiOrigin).toString();
      const tokenEndpoint = req.params.provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env[provider[0]], client_secret: process.env[provider[1]], code, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(10000) });
      if (!tokenResponse.ok) throw Error('token');
      const { access_token: accessToken } = await tokenResponse.json();
      const profileResponse = req.params.provider === 'google' ? await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } }) : await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!profileResponse.ok) throw Error('profile');
      const profile = await profileResponse.json(), id = req.params.provider === 'google' ? profile.sub : profile.id, email = req.params.provider === 'google' ? profile.email : (profile.mail || profile.userPrincipalName), name = req.params.provider === 'google' ? profile.name : profile.displayName;
      if (!id || !email || (req.params.provider === 'google' && profile.email_verified !== true)) throw Error('identity');
      const ownerOrigin = process.env.OWNER_CONTROL_PLANE_ORIGIN, ownerToken = process.env.ENGAGE_OWNER_SERVICE_TOKEN;
      if (!ownerOrigin || !ownerToken || ownerToken.length < 32) throw Error('owner');
      const key = require('node:crypto').createHash('sha256').update(`engage_stay:${req.params.provider}:${id}`).digest('hex');
      const intake = await fetch(new URL('/api/integrations/engagestay/signup', ownerOrigin), { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ source: req.params.provider, externalUserId: String(id), email: String(email).toLowerCase(), displayName: name || undefined, requestedLifecycle: 'TRIAL' }), signal: AbortSignal.timeout(10000) });
      if (!intake.ok) throw Error('intake');
      return res.redirect(302, new URL('/?signup=received', clientOrigin).toString());
    } catch { return res.status(502).send('We could not verify this social sign-up. Please return to the application and try again.'); }
  }};
}
module.exports = { socialSignupRoutes };
