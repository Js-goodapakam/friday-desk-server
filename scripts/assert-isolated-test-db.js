// Fail closed: this target is exclusively the disposable PostgreSQL 16
// service bound to localhost by .github/workflows/isolated-postgres-tests.yml.
function assertIsolatedTestDatabase(env = process.env) {
  const target = env.ENGAGE_TEST_DATABASE_URL;
  const declared = env.ENGAGE_TEST_DATABASE_ID;
  if (!target || !declared) {
    throw Error('An explicitly named ENGAGE_TEST_DATABASE_URL and ENGAGE_TEST_DATABASE_ID are required.');
  }
  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true' || env.NODE_ENV !== 'test') {
    throw Error('Isolated PostgreSQL tests are restricted to GitHub Actions test jobs.');
  }
  if (!/^engage-stay-test(?:-|$)/.test(declared)) {
    throw Error('ENGAGE_TEST_DATABASE_ID must begin with engage-stay-test.');
  }
  if (env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_URL_NON_POOLING || env.FRIDAY_PRODUCTION_DATABASE_URL) {
    throw Error('Application or production database variables are forbidden in the isolated job.');
  }
  let url;
  try { url = new URL(target); } catch { throw Error('ENGAGE_TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('Only PostgreSQL URLs are allowed.');
  // Strict localhost binding excludes every Supabase production, preview,
  // pooler, branch, external host, and DNS alias by construction.
  if (url.hostname !== '127.0.0.1' || url.port !== '5432') {
    throw Error('Only the temporary GitHub Actions PostgreSQL localhost service is allowed.');
  }
  if (url.pathname !== '/engage_stay_test' || decodeURIComponent(url.username) !== 'engage_test') {
    throw Error('Unexpected disposable PostgreSQL database name or account.');
  }
  if (url.searchParams.get('sslmode') !== 'disable' ||
      [...url.searchParams.keys()].some(key => key !== 'sslmode')) {
    throw Error('Unexpected connection parameters for disposable PostgreSQL.');
  }
  if (!url.password) throw Error('A dedicated test account password is required.');
  return { host: url.hostname, database: 'engage_stay_test', account: 'engage_test', id: declared };
}

async function verifyIsolatedPostgresConnection(client, env = process.env) {
  const expected = assertIsolatedTestDatabase(env);
  const result = await client.query(
    "SELECT current_database() AS database, current_user AS account, " +
    "current_setting('server_version_num')::integer AS version_number, " +
    "inet_server_addr()::text AS server_address"
  );
  const actual = result.rows[0];
  if (result.rowCount !== 1 || actual.database !== expected.database ||
      actual.account !== expected.account ||
      Number(actual.version_number) < 160000 || Number(actual.version_number) >= 170000 ||
      !actual.server_address) {
    throw Error('Actual PostgreSQL server identity or version is not the expected isolated PostgreSQL 16 database.');
  }
  return { database: actual.database, account: actual.account, version_number: Number(actual.version_number) };
}

async function main() {
  assertIsolatedTestDatabase();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.ENGAGE_TEST_DATABASE_URL, ssl: false, max: 2 });
  try {
    const identity = await verifyIsolatedPostgresConnection(pool);
    console.log('Verified disposable PostgreSQL identity: ' + JSON.stringify(identity));
  } finally { await pool.end(); }
}
if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { assertIsolatedTestDatabase, verifyIsolatedPostgresConnection };
