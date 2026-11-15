const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signupRoutes } = require('./signup-intake');

const keys = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'CLIENT_ORIGIN', 'OWNER_CONTROL_PLANE_ORIGIN',
  'ENGAGE_OWNER_SERVICE_TOKEN', 'ENGAGE_SIGNUP_ACCEPT_AUTO_CONFIRM'
];
function res() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
}
const request = () => ({
  ip: 'qa-local',
  body: { businessName: 'Test Hospitality', email: 'signup-test@example.com',
    password: 'strong-local-test-only', mobile: '+919876543210' },
  get() { return null; },
});
const token = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('.');
const upstreamUser = {
  id: 'f11ec9ee-f157-4f61-8f93-dced9ddf383a',
  email: 'signup-test@example.com',
  email_confirmed_at: '2026-11-15T18:00:00Z',
  user_metadata: { engage_stay_signup: true, organization_name: 'Test Hospitality', phone: '+919876543210' },
};
test('official Supabase auto-confirm mode delivers verified signups to Owner only when enabled', async () => {
  const env = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const oldFetch = global.fetch;
  try {
    Object.assign(process.env, {
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: 'local-test-key', CLIENT_ORIGIN: 'https://app.example.com',
      OWNER_CONTROL_PLANE_ORIGIN: 'https://owner.example.com',
      ENGAGE_OWNER_SERVICE_TOKEN: 'z'.repeat(48),
      ENGAGE_SIGNUP_ACCEPT_AUTO_CONFIRM: 'true',
    });
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const calls = [];
    global.fetch = async (url) => {
      const path = String(url);
      calls.push(path);
      if (path.includes('/auth/v1/signup')) return { ok: true, json: async () => ({ access_token: token, user: upstreamUser }) };
      if (path.endsWith('/auth/v1/user')) return { ok: true, json: async () => upstreamUser };
      if (path.includes('/api/integrations/engagestay/signup')) return { ok: true, status: 201 };
      throw new Error('Unexpected upstream');
    };
    const reply = res();
    await signupRoutes.start(request(), reply);
    assert.equal(reply.statusCode, 202);
    assert.equal(reply.body.status, 'PENDING_REVIEW');
    assert.equal(calls.length, 3);
    assert.ok(calls.some(path => path.includes('/auth/v1/user')));
    assert.ok(calls.some(path => path.includes('/api/integrations/engagestay/signup')));
    process.env.ENGAGE_SIGNUP_ACCEPT_AUTO_CONFIRM = 'false';
    const blocked = res();
    await signupRoutes.start(request(), blocked);
    assert.equal(blocked.statusCode, 503);
    assert.equal(calls.length, 4);
  } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
