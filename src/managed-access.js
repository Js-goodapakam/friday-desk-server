async function managedAccess(db, propertyId) {
  if (db.file && process.env.FRIDAY_LOCAL_DEV === '1') return null;
  try {
    const { rows } = await db.query(
      `SELECT case when subscription_expires_at <= now() then 'suspended' else status end as status,
              plan, modules FROM engagestay_managed_workspace WHERE property_id = $1`,
      [propertyId]
    );
    return rows[0] || null;
  } catch (error) {
    // Allow the existing deployment to run before the integration migration.
    if (error.code === '42P01' && process.env.ENGAGE_MANAGED_ACCESS_REQUIRED !== '1') return null;
    throw error;
  }
}

module.exports = { managedAccess };
