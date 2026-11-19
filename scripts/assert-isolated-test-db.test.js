const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolatedTestDatabase, verifyIsolatedPostgresConnection } = require('./assert-isolated-test-db');
const good = {
  GITHUB_ACTIONS: 'true', CI: 'true', NODE_ENV: 'test',
  ENGAGE_TEST_DATABASE_ID: 'engage-stay-test-github-actions',
  ENGAGE_TEST_DATABASE_URL: 'postgresql://engage_test:ci_password@127.0.0.1:5432/engage_stay_test?sslmode=disable',
};
test('requires an explicitly named test connection and GitHub Actions context', () => {
  assert.throws(() => assertIsolatedTestDatabase({}), /explicitly named/);
  assert.throws(() => assertIsolatedTestDatabase({ ...good, GITHUB_ACTIONS: 'false' }), /restricted to GitHub Actions/);
  assert.throws(() => assertIsolatedTestDatabase({ ...good, ENGAGE_TEST_DATABASE_ID: 'staging' }), /begin with engage-stay-test/);
});
test('rejects production, preview, Supabase, nonlocal and forged endpoints', () => {
  for (const host of ['db.trypyepdjmfjzofggduk.supabase.co', 'db.wfugoojpmpqwjwbkxxrn.supabase.co', 'preview.example.test', 'localhost', '10.0.0.10']) {
    const env = { ...good, ENGAGE_TEST_DATABASE_URL: good.ENGAGE_TEST_DATABASE_URL.replace('127.0.0.1', host) };
    assert.throws(() => assertIsolatedTestDatabase(env), /localhost service/);
  }
  assert.throws(() => assertIsolatedTestDatabase({ ...good, ENGAGE_TEST_DATABASE_URL: good.ENGAGE_TEST_DATABASE_URL.replace('/engage_stay_test', '/postgres') }), /database name/);
  assert.throws(() => assertIsolatedTestDatabase({ ...good, ENGAGE_TEST_DATABASE_URL: good.ENGAGE_TEST_DATABASE_URL.replace('engage_test:', 'postgres:') }), /database name or account/);
  assert.throws(() => assertIsolatedTestDatabase({ ...good, ENGAGE_TEST_DATABASE_URL: good.ENGAGE_TEST_DATABASE_URL + '&host=db.example.test' }), /connection parameters/);
});
test('does not use or fall back to application database variables', () => {
  assert.throws(() => assertIsolatedTestDatabase({ ...good, DATABASE_URL: 'postgres://production.invalid/postgres' }), /forbidden/);
  assert.throws(() => assertIsolatedTestDatabase({ ...good, ENGAGE_TEST_DATABASE_URL: undefined, DATABASE_URL: good.ENGAGE_TEST_DATABASE_URL }), /explicitly named/);
});
test('accepts the exact declared disposable Actions endpoint', () => {
  assert.deepEqual(assertIsolatedTestDatabase(good), { host: '127.0.0.1', database: 'engage_stay_test', account: 'engage_test', id: good.ENGAGE_TEST_DATABASE_ID });
});
test('checks identity returned by the actual connected PostgreSQL server', async () => {
  const mock = row => ({ query: async () => ({ rowCount: 1, rows: [row] }) });
  const identity = { database: 'engage_stay_test', account: 'engage_test', version_number: 160011, server_address: '172.17.0.2' };
  assert.equal((await verifyIsolatedPostgresConnection(mock(identity), good)).database, 'engage_stay_test');
  await assert.rejects(verifyIsolatedPostgresConnection(mock({ ...identity, database: 'postgres' }), good), /Actual PostgreSQL server identity/);
  await assert.rejects(verifyIsolatedPostgresConnection(mock({ ...identity, version_number: 170000 }), good), /Actual PostgreSQL server identity/);
});
