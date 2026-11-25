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
    const { action, name, city, adminName, email, password, authUserId, plan, modules, entitlements } = req.body || {};
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
          (authUserId ? !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(authUserId) : (!validText(password, 256) || password.length < 16))) {
          return res.status(400).json({ error: 'Invalid workspace or administrator details.' });
        }
        return res.json(await provisionManagedWorkspace(db, {
          id, name: name.trim(), city: city.trim(), adminName: adminName.trim(),
          email, password: authUserId ? undefined : password, authUserId, plan, modules
        }));
      }
      let result;
      if (action === 'subscription_revision') {
        if (req.body.productCode !== 'engage_stay' ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(req.body.tenantId))) {
          return res.status(400).json({ error: 'Invalid subscription scope.' });
        }
        const { rows: [workspace] } = await db.query(
          'SELECT owner_tenant_id, subscription_revision::text AS revision FROM engagestay_managed_workspace WHERE customer_id=$1', [id]);
        if (!workspace) return res.status(404).json({ error: 'Workspace not found.' });
        if (workspace.owner_tenant_id !== req.body.tenantId) return res.status(409).json({ error: 'Workspace assignment rejected.' });
        return res.json({ revision: workspace.revision });
      } else if (action === 'sync_subscription') {
        const { tenantId, revision, productCode, subscriptionStatus, expiresAt } = req.body;
        if (productCode !== 'engage_stay' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(tenantId)) ||
            typeof revision !== 'string' || !/^[1-9][0-9]{0,17}$/.test(revision) ||
            !Object.hasOwn(planModules, plan) || (expiresAt !== null && (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))))) {
          return res.status(400).json({ error: 'Invalid subscription snapshot.' });
        }
        const active = ['ACTIVE','TRIAL'].includes(subscriptionStatus) && expiresAt !== null;
        const outcome = await db.withTransaction(async client => {
          const { rows: [workspace] } = await client.query(
            'SELECT owner_tenant_id, subscription_revision FROM engagestay_managed_workspace WHERE customer_id=$1 FOR UPDATE', [id]);
          if (!workspace) return { code: 404 };
          if (workspace.owner_tenant_id && workspace.owner_tenant_id !== tenantId) return { code: 409 };
          if (workspace.subscription_revision !== null && BigInt(workspace.subscription_revision) >= BigInt(revision)) {
            return { code: 200, outcome: String(workspace.subscription_revision) === revision ? 'duplicate' : 'stale' };
          }
          await client.query(`UPDATE engagestay_managed_workspace SET owner_tenant_id=$2, subscription_revision=$3,
            subscription_expires_at=$4, status=$5, plan=$6, modules=$7, updated_at=now() WHERE customer_id=$1`,
          [id, tenantId, revision, expiresAt, active ? 'active' : 'suspended', plan, active ? planModules[plan] : []]);
          return { code: 200, outcome: 'applied' };
        });
        return res.status(outcome.code).json(outcome.outcome ? { revision, outcome: outcome.outcome } : { error: 'Workspace assignment rejected.' });
      } else if (action === 'configure') {
        result = await db.query(
          'UPDATE engagestay_managed_workspace SET plan=$2, modules=$3, updated_at=now() WHERE customer_id=$1 AND subscription_revision IS NULL RETURNING property_id,status,plan,modules',
          [id, plan, modules]
        );
      } else if (action === 'suspend' || action === 'reactivate') {
        result = await db.query(
          "UPDATE engagestay_managed_workspace SET status=$2, updated_at=now() WHERE customer_id=$1 AND (subscription_revision IS NULL OR $2='suspended') RETURNING property_id,status,plan,modules",
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
