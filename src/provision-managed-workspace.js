const { randomBytes } = require('node:crypto');
const { hashPassword } = require('./auth');

// The caller supplies a validated, stable customer UUID. All provisioning
// records commit together so a retry cannot leave a partial workspace.
async function provisionManagedWorkspace(db, customer) {
  const { id, name, city, email, adminName, password, plan, modules } = customer;
  return db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
    const existing = await client.query(
      'SELECT property_id, status, plan, modules FROM engagestay_managed_workspace WHERE customer_id = $1',
      [id]
    );
    if (existing.rows.length) return existing.rows[0];

    const property = await client.query(
      `INSERT INTO "property" (name, code, city, country, timezone, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'India', 'Asia/Kolkata', NOW(), NOW()) RETURNING id`,
      [name, 'ES-' + randomBytes(8).toString('hex'), city]
    );
    const propertyId = property.rows[0].id;
    const admin = await client.query(
      `INSERT INTO "user" ("propertyId", name, email, role, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ADMIN', true, NOW(), NOW()) RETURNING id`,
      [propertyId, adminName, email.trim().toLowerCase()]
    );
    await client.query(
      'INSERT INTO friday_credentials (user_id, password_hash) VALUES ($1, $2)',
      [admin.rows[0].id, hashPassword(password)]
    );
    const workspace = await client.query(
      `INSERT INTO engagestay_managed_workspace (property_id, customer_id, status, plan, modules)
       VALUES ($1, $2, 'active', $3, $4) RETURNING property_id, status, plan, modules`,
      [propertyId, id, plan, modules]
    );
    await client.query('INSERT INTO engagestay_workspace_state (property_id) VALUES ($1)', [propertyId]);
    return workspace.rows[0];
  });
}

module.exports = { provisionManagedWorkspace };
