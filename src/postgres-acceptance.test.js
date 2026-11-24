const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');
const { assertIsolatedTestDatabase } = require('../scripts/assert-isolated-test-db');

const url = process.env.ENGAGE_TEST_DATABASE_URL;
const skip = !url;
let pool;

test.before(async () => {
  if (skip) return;
  assertIsolatedTestDatabase();
  pool = new pg.Pool({ connectionString: url });
  await pool.query('TRUNCATE friday_demo_workspace, friday_property_access, "user", property CASCADE');
  await pool.query("INSERT INTO property(id,name,code) VALUES (1001,'Synthetic Alpha','alpha'),(1002,'Synthetic Beta','beta')");
  await pool.query("INSERT INTO \"user\"(id,\"propertyId\",name,email,role) VALUES (2001,1001,'Alpha User','alpha@example.test','ADMIN'),(2002,1002,'Beta User','beta@example.test','ADMIN')");
  await pool.query('INSERT INTO friday_property_access(user_id,property_id) VALUES (2001,1001),(2002,1002)');
  await pool.query("INSERT INTO friday_demo_workspace(property_id,seed,state_json,version) VALUES (1001,'synthetic','{}',1)");
});

test.after(async () => { if (pool) await pool.end(); });

test('PostgreSQL: property access joins cannot return another property', { skip }, async () => {
  const result = await pool.query(`SELECT p.id FROM friday_property_access a JOIN property p ON p.id=a.property_id WHERE a.user_id=$1`, [2001]);
  assert.deepEqual(result.rows.map(row => row.id), [1001]);
});

test('PostgreSQL: tenant-owned workspace is isolated by property key', { skip }, async () => {
  const result = await pool.query('SELECT property_id FROM friday_demo_workspace WHERE property_id=$1', [1002]);
  assert.equal(result.rowCount, 0);
});

test('PostgreSQL: immutable identity mapping and suspended workspaces deny cross-tenant use', { skip }, async () => {
  const identity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await pool.query('INSERT INTO auth.users(id) VALUES($1)', [identity]);
  await pool.query('INSERT INTO friday_auth_identity(auth_user_id,user_id,property_id) VALUES($1,$2,$3)', [identity, 2001, 1001]);
  await pool.query("INSERT INTO engagestay_managed_workspace(property_id,customer_id,status,plan,modules) VALUES(1001,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active','Basic',ARRAY['reservations'])");
  const active = await pool.query(`SELECT u.id, u."propertyId" FROM friday_auth_identity i JOIN "user" u ON u.id=i.user_id JOIN engagestay_managed_workspace w ON w.property_id=i.property_id WHERE i.auth_user_id=$1 AND u."isActive"=true AND w.status='active'`, [identity]);
  assert.deepEqual(active.rows, [{ id: 2001, propertyId: 1001 }]);
  await pool.query("UPDATE engagestay_managed_workspace SET status='suspended' WHERE property_id=1001");
  const suspended = await pool.query(`SELECT u.id FROM friday_auth_identity i JOIN "user" u ON u.id=i.user_id JOIN engagestay_managed_workspace w ON w.property_id=i.property_id WHERE i.auth_user_id=$1 AND u."isActive"=true AND w.status='active'`, [identity]);
  assert.equal(suspended.rowCount, 0);
  const crossTenant = await pool.query('SELECT property_id FROM friday_auth_identity WHERE auth_user_id=$1 AND property_id=$2', [identity, 1002]);
  assert.equal(crossTenant.rowCount, 0);
});

test('PostgreSQL: disabled identities cannot be selected for an authenticated session', { skip }, async () => {
  await pool.query('UPDATE "user" SET "isActive"=false WHERE id=2001');
  const result = await pool.query('SELECT id FROM "user" WHERE id=$1 AND "isActive"=true', [2001]);
  assert.equal(result.rowCount, 0);
  await pool.query('UPDATE "user" SET "isActive"=true WHERE id=2001');
});

test('PostgreSQL: row locking and compare-and-swap permit one reservation allocation', { skip }, async () => {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await first.query('SELECT version FROM friday_demo_workspace WHERE property_id=$1 FOR UPDATE', [1001]);
    await second.query('BEGIN');
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(
      second.query('SELECT version FROM friday_demo_workspace WHERE property_id=$1 FOR UPDATE', [1001]),
      (error) => error && error.code === '55P03',
    );
    await second.query('ROLLBACK');
    const updated = await first.query('UPDATE friday_demo_workspace SET version=version+1 WHERE property_id=$1 AND version=$2', [1001, 1]);
    assert.equal(updated.rowCount, 1);
    await first.query('COMMIT');
    const stale = await pool.query('UPDATE friday_demo_workspace SET version=version+1 WHERE property_id=$1 AND version=$2', [1001, 1]);
    assert.equal(stale.rowCount, 0);
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release(); second.release();
  }
});
