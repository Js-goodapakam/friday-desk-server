const { createHash } = require('node:crypto');

const productionRefs = new Set(['wfugoojpmpqwjwbkxxrn', 'trypyepdjmfjzofggduk']);
const fingerprint = value => createHash('sha256').update(value).digest('hex');

function databaseIdentity(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const ref = /(?:db\.|pooler\.supabase\.com.*?)([a-z0-9]{20})/i.exec(host)?.[1] ||
    host.split('.').find(part => /^[a-z0-9]{20}$/.test(part)) || '';
  return { host, ref };
}

function assertIsolatedTestDatabase(env = process.env) {
  const target = env.ENGAGE_TEST_DATABASE_URL;
  const declared = env.ENGAGE_TEST_DATABASE_ID;
  if (!target || !declared) throw Error('An explicitly named ENGAGE_TEST_DATABASE_URL and ENGAGE_TEST_DATABASE_ID are required.');
  let identity;
  try { identity = databaseIdentity(target); } catch { throw Error('ENGAGE_TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!/^engage(?:-|_)stay(?:-|_)test/i.test(declared)) throw Error('ENGAGE_TEST_DATABASE_ID must identify a dedicated Engage Stay test database.');
  if (productionRefs.has(identity.ref) || /(^|[-.])production($|[-.])/i.test(identity.host)) throw Error('Production database targets are forbidden.');
  const normal = [env.DATABASE_URL, env.POSTGRES_URL, env.POSTGRES_URL_NON_POOLING].filter(Boolean);
  if (normal.some(value => fingerprint(value) === fingerprint(target))) throw Error('The isolated test database must not equal an application database connection.');
  return identity;
}

if (require.main === module) {
  assertIsolatedTestDatabase();
  process.stdout.write('Isolated test database guard passed.\n');
}

module.exports = { assertIsolatedTestDatabase, databaseIdentity };
