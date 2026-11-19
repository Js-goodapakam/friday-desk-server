const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertIsolatedTestDatabase, verifyIsolatedPostgresConnection } = require('./assert-isolated-test-db');

async function main() {
  assertIsolatedTestDatabase(); // Before any PostgreSQL client is constructed.
  const pool = new Pool({ connectionString: process.env.ENGAGE_TEST_DATABASE_URL, ssl: false, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const identity = await verifyIsolatedPostgresConnection(client);
      await client.query('BEGIN');
      try {
        for (const name of ['sql/ci-isolated-property-schema.sql', 'sql/managed-workspace.sql']) {
          await client.query(fs.readFileSync(path.resolve(__dirname, '..', name), 'utf8'));
        }
        const schema = await client.query(
          "SELECT to_regclass('public.property') AS property, " +
          "to_regclass('public.engagestay_managed_workspace') AS managed, " +
          "to_regclass('public.engagestay_workspace_state') AS workspace"
        );
        if (Object.values(schema.rows[0]).some(value => value === null)) {
          throw Error('Required managed workspace schema is incomplete.');
        }
        await client.query('COMMIT');
        console.log('Applied real sql/managed-workspace.sql in disposable PostgreSQL ' + identity.version_number);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { client.release(); }
  } finally { await pool.end(); }
}
if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { main };
