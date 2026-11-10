const { managedAccess } = require('./managed-access');
const { planModules } = require('./live-workspace');

function moduleAccess(db) {
  return async (req, res, next) => {
    try {
      const propertyPath = /^\/properties\/([1-9]\d*)(?:\/|$)/.exec(req.path);
      const id = propertyPath ? Number(propertyPath[1]) : req.user.propertyId;
      const workspace = await managedAccess(db, id);
      if (!workspace) return next();
      if (workspace.status !== 'active') {
        return res.status(403).json({ error: 'This workspace is suspended.' });
      }
      const modules = Object.hasOwn(planModules, workspace.plan) ? planModules[workspace.plan] : [];
      const hasModule = key => modules.includes(key) && workspace.modules.includes(key);
      req.managedWorkspace = workspace;
      const allowed =
        (req.method === 'GET' && /^(?:\/properties(?:\/[1-9]\d*)?|\/property)\/?$/.test(req.path)) ||
        (/^\/properties\/[1-9]\d*\/workspace\/?$/.test(req.path) && ['GET', 'PUT'].includes(req.method)) ||
        (req.method === 'GET' && /^\/call-logs\/[1-9]\d*\/recording\/?$/.test(req.path) && hasModule('communications')) ||
        (/^\/owner\/?$/.test(req.path) && (
          (req.method === 'GET' && ['ADMIN', 'MANAGER'].includes(req.user.role)) ||
          (req.method === 'PUT' && req.user.role === 'ADMIN')
        )) ||
        (req.method === 'POST' && /^\/properties\/[1-9]\d*\/revenue\/?$/.test(req.path) && hasModule('inventory')) ||
        (req.user.role === 'ADMIN' && (
          (req.method === 'POST' && /^\/owner\/staff\/?$/.test(req.path)) ||
          (['PUT', 'DELETE'].includes(req.method) && /^\/owner\/staff\/[1-9]\d*\/?$/.test(req.path))
        ));
      if (allowed) return next();
      return res.status(403).json({ error: 'This API is unavailable for your workspace plan.' });
    } catch {
      return res.status(503).json({ error: 'Unable to verify workspace access.' });
    }
  };
}

module.exports = { moduleAccess };
