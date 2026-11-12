const { createHash, timingSafeEqual } = require('node:crypto');
const { provisionManagedWorkspace } = require('./provision-managed-workspace');
const { planModules } = require('./live-workspace');

const digest = value => createHash('sha256').update(value).digest();
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function managedRoutes(db) {
  return async function manageWorkspace(req, res) {
    const secret = process.env.ENGAGE_OWNER_SERVICE_TOKEN;
    const supplied = req.get('authorization') || '';
    if (!secret || secret.length < 32 || !timingSafeEqual(digest(supplied), digest('Bearer ' + secret))) {
      return res.status(401).json({ error: 'Service authentication required.' });
    }
    const id = req.params.customerId;
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid customer ID.' });
    }
    const { action, name, city, adminName, email, password, plan, modules, entitlements } = req.body || {};
    if (['approve', 'configure'].includes(action) &&
      (!validText(plan, 80) || !Object.hasOwn(planModules, plan) ||
        !Array.isArray(modules) || new Set(modules).size !== modules.length ||
        !modules.every(module => planModules[plan].includes(module)))) {
      return res.status(400).json({ error: 'Invalid plan or modules.' });
    }
    try {
      if (action === 'approve') {
        if (![name, city, adminName].every(value => validText(value, 100)) ||
          !validText(email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
          !validText(password, 256) || password.length < 16) {
          return res.status(400).json({ error: 'Invalid workspace or administrator details.' });
        }
        return res.json(await provisionManagedWorkspace(db, {
          id, name: name.trim(), city: city.trim(), adminName: adminName.trim(),
          email, password, plan, modules
        }));
      }
      let result;
      if (action === 'configure') {
        result = await db.query(
          'UPDATE engagestay_managed_workspace SET plan=$2, modules=$3, updated_at=now() WHERE customer_id=$1 RETURNING property_id,status,plan,modules',
          [id, plan, modules]
        );
      } else if (action === 'suspend' || action === 'reactivate') {
        result = await db.query(
          'UPDATE engagestay_managed_workspace SET status=$2, updated_at=now() WHERE customer_id=$1 RETURNING property_id,status,plan,modules',
          [id, action === 'suspend' ? 'suspended' : 'active']
        );
      } else if (action === 'sync_entitlements') {
        if (!entitlements || typeof entitlements !== 'object' || Array.isArray(entitlements)) {
          return res.status(400).json({ error: 'Invalid entitlement payload.' });
        }
        result = await db.query(
          `UPDATE engagestay_workspace_state s
             SET state = jsonb_set(s.state, '{ownerEntitlements}', $2::jsonb, true), version = version + 1
            FROM engagestay_managed_workspace m
           WHERE m.property_id = s.property_id AND m.customer_id = $1
           RETURNING m.property_id,m.status,m.plan,m.modules`,
          [id, JSON.stringify(entitlements)]
        );
      } else {
        return res.status(400).json({ error: 'Unknown lifecycle action.' });
      }
      if (!result.rows.length) return res.status(404).json({ error: 'Workspace not found.' });
      return res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'An account or workspace already exists.' });
      return res.status(503).json({ error: 'Workspace management is unavailable.' });
    }
  };
}

module.exports = { managedRoutes };
