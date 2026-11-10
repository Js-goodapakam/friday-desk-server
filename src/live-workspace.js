const { isDeepStrictEqual } = require('node:util');
const { canAccess } = require('./properties');

const planModules = {
  basic: ['operations'],
  premium: ['operations', 'finance', 'inventory'],
  enterprise: ['operations', 'finance', 'inventory', 'communications'],
};
const sections = {
  operations: ['rooms', 'guests', 'reservations', 'requests', 'tasks', 'housekeeping'],
  finance: ['folios', 'payments', 'invoices', 'invoiceSettings'],
  inventory: ['ratePlans', 'inventoryOverrides', 'inventoryAudit', 'revenueManagement'],
  communications: ['communications', 'callActivities'],
};

function workspaceHandler(db) {
  return async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid property.' });
    try {
      const outcome = await db.withTransaction(async client => {
        const { rows: [workspace] } = await client.query(
          `SELECT m.status, m.plan, m.modules, s.state, s.version, p.name
             FROM engagestay_managed_workspace m
             JOIN engagestay_workspace_state s ON s.property_id = m.property_id
             JOIN property p ON p.id = m.property_id
            WHERE m.property_id = $1 FOR UPDATE OF m, s`,
          [id]
        );
        if (!workspace) return null;
        if (workspace.status !== 'active' || !await canAccess(client, req.user, id) ||
            !['ADMIN', 'MANAGER'].includes(req.user.role)) {
          return { code: 403, body: { error: 'Workspace access denied.' } };
        }
        const modules = (Object.hasOwn(planModules, workspace.plan) ? planModules[workspace.plan] : [])
          .filter(module => workspace.modules.includes(module));
        const keys = new Set(modules.flatMap(module => sections[module]));
        const visible = Object.fromEntries(Object.entries(workspace.state).filter(([key]) => keys.has(key)));
        const property = { id, name: workspace.name };
        if (req.method === 'POST') {
          if (!modules.includes('inventory')) return { code: 403, body: { error: 'Inventory access denied.' } };
          const { action, config, from, to, version } = req.body || {};
          if (!['preview', 'save', 'apply'].includes(action)) {
            return { code: 400, body: { error: 'Invalid revenue action.' } };
          }
          const engine = require('./revenue-engine');
          const state = { rooms: [], reservations: [], ratePlans: [], ...visible };
          let rows, next;
          try {
            engine.validateConfig(config, state);
            if (action === 'preview') rows = engine.preview(state, config, from, to);
            else if (version === workspace.version) {
              next = action === 'save' ? { ...state, revenueManagement: config } :
                engine.apply(state, config, from, to, req.user.id);
            }
          } catch {
            return { code: 400, body: { error: 'Invalid revenue configuration or dates.' } };
          }
          if (action === 'preview') return { body: { rows, version: workspace.version } };
          if (!next) return { code: 409, body: { error: 'Reload the workspace before saving.' } };
          const inventory = Object.fromEntries(sections.inventory.filter(key => Object.hasOwn(next, key)).map(key => [key, next[key]]));
          await client.query('UPDATE engagestay_workspace_state SET state=$2, version=version+1 WHERE property_id=$1',
            [id, JSON.stringify({ ...workspace.state, ...inventory })]);
          return { body: { version: version + 1 } };
        }
        if (req.method === 'GET') {
          return { body: { state: { ...visible, property }, version: workspace.version, managed: true, modules } };
        }
        const { state, version } = req.body || {};
        if (version !== workspace.version) return { code: 409, body: { error: 'Reload the workspace before saving.' } };
        if (!state || typeof state !== 'object' || Number(state.property?.id) !== id) {
          return { code: 400, body: { error: 'Invalid workspace state.' } };
        }
        const supported = new Set(['property', ...Object.values(sections).flat()]);
        if (Object.keys(state).some(key => !supported.has(key))) {
          return { code: 400, body: { error: 'This workspace section is not supported.' } };
        }
        for (const key of Object.values(sections).flat()) {
          if (!Object.hasOwn(state, key)) continue;
          if (!keys.has(key)) {
            const baseline = key === 'inventoryOverrides' || key === 'invoiceSettings' ? {} : [];
            if (!isDeepStrictEqual(state[key], baseline)) return { code: 403, body: { error: 'Module access denied.' } };
            continue;
          }
          const objectField = ['inventoryOverrides', 'invoiceSettings', 'revenueManagement'].includes(key);
          if (objectField ? !state[key] || typeof state[key] !== 'object' || Array.isArray(state[key]) : !Array.isArray(state[key])) {
            return { code: 400, body: { error: 'Invalid workspace section.' } };
          }
          visible[key] = state[key];
        }
        await client.query(
          'UPDATE engagestay_workspace_state SET state=$2, version=version+1 WHERE property_id=$1',
          [id, JSON.stringify({ ...workspace.state, ...visible })]
        );
        return { body: { state: { ...visible, property }, version: version + 1, managed: true, modules } };
      });
      if (!outcome) return next();
      return res.status(outcome.code || 200).json(outcome.body);
    } catch (error) {
      if (error.code === '42P01' && process.env.ENGAGE_MANAGED_ACCESS_REQUIRED !== '1') return next();
      return res.status(503).json({ error: 'Workspace storage is unavailable.' });
    }
  };
}

module.exports = { workspaceHandler, planModules };
