const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownerRoutes } = require('./owner-routes');
const { propertyRoutes } = require('./properties');

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('supported PMS roles cannot create properties except ADMIN', async () => {
  const routes = propertyRoutes({ query: async () => { throw Error('authorization must reject before database access'); } });
  for (const role of ['MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'REVENUE', 'FINANCE', 'RESERVATIONS']) {
    const res = response();
    await routes.create({ user: { id: 1, propertyId: 1001, role }, body: { name: 'Synthetic', city: 'Test' } }, res);
    assert.equal(res.statusCode, 403, role);
  }
});

test('only ADMIN can mutate staff; manager may only read approved owner surfaces', async () => {
  const previous = process.env.FRIDAY_LOCAL_DEV;
  process.env.FRIDAY_LOCAL_DEV = '1';
  try {
    const api = ownerRoutes({ file: 'friday-development.sqlite', query: async () => { throw Error('denied before data access'); } });
    for (const role of ['MANAGER', 'FRONT_DESK', 'HOUSEKEEPING', 'REVENUE', 'FINANCE', 'RESERVATIONS']) {
      const res = response();
      await api.editStaff({ user: { id: 1, propertyId: 1001, role }, params: { id: '2' }, body: {} }, res);
      assert.equal(res.statusCode, 403, role);
    }
  } finally { if (previous === undefined) delete process.env.FRIDAY_LOCAL_DEV; else process.env.FRIDAY_LOCAL_DEV = previous; }
});
