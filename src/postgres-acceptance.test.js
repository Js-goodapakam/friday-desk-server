const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');
const { assertIsolatedTestDatabase } = require('../scripts/assert-isolated-test-db');
const model = require('./demo-data');
const store = require('./demo-store');
const { validateTransitions } = require('./reservation-transitions');
const { managedRoutes } = require('./managed-routes');
const { managedAccess } = require('./managed-access');

const url = process.env.ENGAGE_TEST_DATABASE_URL;
const skip = !url;
let pool;
let originalNodeEnv;

function database() {
  return {
    query: (...args) => pool.query(...args),
    withTransaction: async callback => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function clone(value) { return structuredClone(value); }

function addReservation(state, id, room, arrival, departure) {
  const roomRecord = state.rooms.find(item => item.number === room);
  const type = state.roomTypes.find(item => item.id === roomRecord.roomTypeId);
  const ratePlan = state.ratePlans[0];
  const guest = state.guests.at(-1);
  const reservation = {
    id,
    guestId: guest.id,
    room,
    roomTypeId: type.id,
    ratePlanId: ratePlan.id,
    rate: type.baseRate + ratePlan.supplement,
    arrival,
    departure,
    status: 'Confirmed',
    bookingDate: model.START,
    source: 'Direct Booking Engine',
    externalReference: `SYNTHETIC-${id}`,
    adults: 1,
    children: 0,
    expectedIn: state.property.checkIn,
    expectedOut: state.property.checkOut,
    actualCheckIn: null,
    actualCheckOut: null,
    earlyCheckIn: false,
    lateCheckOut: false,
    specialRequests: '',
    statusHistory: [{ at: `${model.START}T00:00:00Z`, status: 'Confirmed', by: 'PostgreSQL acceptance test' }],
    demo: true,
    paid: 0,
  };
  state.reservations.push(reservation);
  state.folios.push({
    id: `${id}-FOLIO`, reservationId: id, guestId: guest.id,
    charges: [{ description: 'Room nights', quantity: 1, rate: reservation.rate, kind: 'Room' }],
    discount: 0, currency: 'INR', simulated: true,
  });
  return reservation;
}

function availableRoom(state, arrival, departure, excluded = new Set()) {
  return state.rooms.find(room => !excluded.has(room.number)
    && !state.roomBlocks.some(block => block.room === room.number && block.arrival < departure && arrival < block.departure)
    && !state.reservations.some(reservation => model.active(reservation)
      && reservation.room === room.number && reservation.arrival < departure && arrival < reservation.departure));
}

async function resetReservationWorkspace() {
  const state = store.validate(model.generateHotel(0, 1001));
  await pool.query('UPDATE property SET code=$1, name=$2 WHERE id=1001', [state.property.code, state.property.name]);
  await pool.query('UPDATE friday_demo_workspace SET seed=$1, state_json=$2, version=1 WHERE property_id=1001', [model.SEED, JSON.stringify(state)]);
  await store.project(pool, 1001, state);
  return state;
}

test.before(async () => {
  if (skip) return;
  assertIsolatedTestDatabase();
  pool = new pg.Pool({ connectionString: url });
  originalNodeEnv = process.env.NODE_ENV;
  // The demo-store production guard permits writes only to an explicitly seeded
  // workspace. This process is already pinned to the disposable DB by the guard.
  process.env.NODE_ENV = 'production';
  await pool.query('TRUNCATE friday_demo_workspace, friday_property_access, "user", property CASCADE');
  await pool.query("INSERT INTO property(id,name,code) VALUES (1001,'Synthetic Alpha',$1),(1002,'Synthetic Beta','beta')", [model.hotels[0][0]]);
  await pool.query("INSERT INTO \"user\"(id,\"propertyId\",name,email,role) VALUES (2001,1001,'Alpha User','alpha@example.test','ADMIN'),(2002,1002,'Beta User','beta@example.test','ADMIN')");
  await pool.query('INSERT INTO friday_property_access(user_id,property_id) VALUES (2001,1001),(2002,1002)');
  await pool.query("INSERT INTO friday_demo_workspace(property_id,seed,state_json,version) VALUES (1001,$1,$2,1)", [model.SEED, JSON.stringify(store.validate(model.generateHotel(0, 1001)))]);
});

test.after(async () => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (pool) await pool.end();
});

test('PostgreSQL: subscription receiver persists revisions, expiry and tenant binding', { skip }, async () => {
  const customerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const secret = require('node:crypto').randomUUID();
  const prior = process.env.ENGAGE_OWNER_SERVICE_TOKEN;
  process.env.ENGAGE_OWNER_SERVICE_TOKEN = secret;
  await pool.query("INSERT INTO engagestay_managed_workspace(property_id,customer_id,status,plan) VALUES(1002,$1,'suspended','basic')", [customerId]);
  const handler = managedRoutes(database());
  const send = async (revision, overrides = {}) => {
    let code = 200;
    return handler({ get: () => 'Bearer ' + secret, params: { customerId }, body: {
      action: 'sync_subscription', productCode: 'engage_stay', tenantId, revision, plan: 'premium',
      subscriptionStatus: 'ACTIVE', expiresAt: '2099-01-01T00:00:00Z', ...overrides,
    } }, { status(value) { code = value; return this; }, json(body) { return { code, body }; } });
  };
  try {
    assert.equal((await send('10')).body.outcome, 'applied');
    assert.equal((await send('10')).body.outcome, 'duplicate');
    assert.equal((await send('9')).body.outcome, 'stale');
    assert.equal((await send('11', { tenantId: customerId })).code, 409);
    assert.equal((await managedAccess(database(), 1002)).status, 'active');
    await send('11', { expiresAt: '2000-01-01T00:00:00Z' });
    assert.equal((await managedAccess(database(), 1002)).status, 'suspended');
    await send('12');
    assert.equal((await managedAccess(database(), 1002)).status, 'active');
    await send('13', { subscriptionStatus: 'SUSPENDED' });
    assert.equal((await managedAccess(database(), 1002)).status, 'suspended');
  } finally {
    await pool.query('DELETE FROM engagestay_managed_workspace WHERE customer_id=$1', [customerId]);
    if (prior === undefined) delete process.env.ENGAGE_OWNER_SERVICE_TOKEN;
    else process.env.ENGAGE_OWNER_SERVICE_TOKEN = prior;
  }
});

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
  await resetReservationWorkspace();
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
    const version = (await first.query('SELECT version FROM friday_demo_workspace WHERE property_id=$1', [1001])).rows[0].version;
    const updated = await first.query('UPDATE friday_demo_workspace SET version=version+1 WHERE property_id=$1 AND version=$2', [1001, version]);
    assert.equal(updated.rowCount, 1);
    await first.query('COMMIT');
    const stale = await pool.query('UPDATE friday_demo_workspace SET version=version+1 WHERE property_id=$1 AND version=$2', [1001, version]);
    assert.equal(stale.rowCount, 0);
  } finally {
    await first.query('ROLLBACK').catch(() => {});
    await second.query('ROLLBACK').catch(() => {});
    first.release(); second.release();
  }
});

test('PostgreSQL: reservation creation, reassignment, payment, check-in and checkout persist atomically', { skip }, async () => {
  await resetReservationWorkspace();
  const db = database();
  const arrival = model.START;
  const departure = model.day(2);
  let current = await store.read(db, 1001);
  const firstRoom = availableRoom(current.state, arrival, departure);
  assert.ok(firstRoom, 'synthetic fixture must contain a clean allocatable room');
  current.state.rooms.find(room => room.number === firstRoom.number).housekeepingStatus = 'Clean';
  addReservation(current.state, 'PG-LIFECYCLE', firstRoom.number, arrival, departure);
  let saved = await store.save(db, 1001, current.state, current.version, 2001);
  assert.equal(saved.version, 2);

  current = await store.read(db, 1001);
  const secondRoom = availableRoom(current.state, arrival, departure, new Set([firstRoom.number]));
  assert.ok(secondRoom, 'synthetic fixture must contain a second allocatable room');
  const moved = current.state.reservations.find(reservation => reservation.id === 'PG-LIFECYCLE');
  moved.room = secondRoom.number;
  moved.roomTypeId = secondRoom.roomTypeId;
  moved.rate = current.state.roomTypes.find(type => type.id === secondRoom.roomTypeId).baseRate;
  current.state.rooms.find(room => room.number === secondRoom.number).housekeepingStatus = 'Clean';
  saved = await store.save(db, 1001, current.state, current.version, 2001);
  assert.equal((await pool.query("SELECT room_number FROM friday_demo_reservation WHERE property_id=1001 AND id='PG-LIFECYCLE'")).rows[0].room_number, secondRoom.number);

  current = await store.read(db, 1001);
  const beforeCheckIn = clone(current.state);
  const checkingIn = current.state.reservations.find(reservation => reservation.id === 'PG-LIFECYCLE');
  checkingIn.status = 'Checked In';
  validateTransitions(beforeCheckIn, current.state);
  saved = await store.save(db, 1001, current.state, current.version, 2001);

  current = await store.read(db, 1001);
  const paymentReservation = current.state.reservations.find(reservation => reservation.id === 'PG-LIFECYCLE');
  const paymentFolio = current.state.folios.find(folio => folio.reservationId === 'PG-LIFECYCLE');
  store.validate(current.state);
  current.state.payments.push({
    id: 'PG-LIFECYCLE-PAYMENT', reservationId: paymentReservation.id, amount: paymentFolio.balance,
    type: 'Payment', method: 'Synthetic UPI', status: 'Simulated', reference: 'SYNTHETIC-PAYMENT',
    paidAt: `${model.START}T08:00:00Z`, simulated: true,
  });
  store.validate(current.state);
  saved = await store.save(db, 1001, current.state, current.version, 2001);

  current = await store.read(db, 1001);
  const beforeCheckout = clone(current.state);
  const checkingOut = current.state.reservations.find(reservation => reservation.id === 'PG-LIFECYCLE');
  assert.equal(checkingOut.balance, 0);
  checkingOut.status = 'Checked Out';
  validateTransitions(beforeCheckout, current.state);
  saved = await store.save(db, 1001, current.state, current.version, 2001);
  const persisted = await store.read(db, 1001);
  const checkedOut = persisted.state.reservations.find(reservation => reservation.id === 'PG-LIFECYCLE');
  assert.equal(checkedOut.status, 'Checked Out');
  assert.equal(checkedOut.balance, 0);
  assert.equal(persisted.state.rooms.find(room => room.number === secondRoom.number).housekeepingStatus, 'Dirty');
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM friday_demo_record WHERE property_id=1001 AND kind='payments' AND reservation_id='PG-LIFECYCLE'", [])).rows[0].count, 1);
});

test('PostgreSQL: cancellation restores inventory and conflicts roll back without partial reservation rows', { skip }, async () => {
  await resetReservationWorkspace();
  const db = database();
  const arrival = '2026-12-20';
  const departure = '2026-12-22';
  let current = await store.read(db, 1001);
  const room = availableRoom(current.state, arrival, departure);
  assert.ok(room);
  const type = current.state.roomTypes.find(item => item.id === room.roomTypeId);
  const beforeInventory = current.state.dailyInventory.find(item => item.type === type.name && item.date === arrival).available;
  addReservation(current.state, 'PG-CANCEL', room.number, arrival, departure);
  await store.save(db, 1001, current.state, current.version, 2001);
  current = await store.read(db, 1001);
  assert.equal(current.state.dailyInventory.find(item => item.type === type.name && item.date === arrival).available, beforeInventory - 1);
  current.state.reservations.find(reservation => reservation.id === 'PG-CANCEL').status = 'Cancelled';
  await store.save(db, 1001, current.state, current.version, 2001);
  current = await store.read(db, 1001);
  assert.equal(current.state.dailyInventory.find(item => item.type === type.name && item.date === arrival).available, beforeInventory);

  const conflicting = clone(current.state);
  const existing = conflicting.reservations.find(reservation => reservation.id === 'PG-CANCEL');
  existing.status = 'Confirmed';
  addReservation(conflicting, 'PG-CONFLICT', existing.room, existing.arrival, existing.departure);
  const versionBeforeConflict = current.version;
  await assert.rejects(store.save(db, 1001, conflicting, versionBeforeConflict, 2001), /Overlapping room allocations/);
  const conflictRows = await pool.query("SELECT id FROM friday_demo_reservation WHERE property_id=1001 AND id='PG-CONFLICT'");
  assert.equal(conflictRows.rowCount, 0);
  assert.equal((await store.read(db, 1001)).version, versionBeforeConflict);
});

test('PostgreSQL: simultaneous conflicting allocations commit once and cross-property queries remain empty', { skip }, async () => {
  await resetReservationWorkspace();
  const db = database();
  const arrival = '2026-12-24';
  const departure = '2026-12-26';
  const first = await store.read(db, 1001);
  const second = await store.read(db, 1001);
  const room = availableRoom(first.state, arrival, departure);
  assert.ok(room);
  addReservation(first.state, 'PG-CONCURRENT-A', room.number, arrival, departure);
  addReservation(second.state, 'PG-CONCURRENT-B', room.number, arrival, departure);
  const results = await Promise.allSettled([
    store.save(db, 1001, first.state, first.version, 2001),
    store.save(db, 1001, second.state, second.version, 2001),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const stored = await pool.query("SELECT id FROM friday_demo_reservation WHERE property_id=1001 AND id IN ('PG-CONCURRENT-A','PG-CONCURRENT-B')");
  assert.equal(stored.rowCount, 1);
  const crossProperty = await pool.query("SELECT id FROM friday_demo_reservation WHERE property_id=1002 AND id IN ('PG-CONCURRENT-A','PG-CONCURRENT-B')");
  assert.equal(crossProperty.rowCount, 0);
});
