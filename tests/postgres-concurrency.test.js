const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
const { assertIsolatedTestDatabase, verifyIsolatedPostgresConnection } = require('../scripts/assert-isolated-test-db');
const { withPgTransaction } = require('../src/pg-transaction');
const { workspaceHandler } = require('../src/live-workspace');

assertIsolatedTestDatabase(); // No connection before the fail-closed guard.
const pool = new Pool({
  connectionString: process.env.ENGAGE_TEST_DATABASE_URL,
  ssl: false, max: 26, connectionTimeoutMillis: 10000
});
const handler = workspaceHandler({ withTransaction: callback => withPgTransaction(pool, callback) });
const stay = { arrival: '2027-01-05', departure: '2027-01-08' };

before(async () => {
  const identity = await verifyIsolatedPostgresConnection(pool);
  const schema = await pool.query(
    "SELECT to_regclass('public.engagestay_managed_workspace') AS managed, " +
    "to_regclass('public.engagestay_workspace_state') AS workspace"
  );
  assert.ok(schema.rows[0].managed && schema.rows[0].workspace, 'real managed workspace schema must be migrated');
  console.log('PostgreSQL test identity: ' + JSON.stringify(identity));
});
after(async () => { await pool.end(); });

function reservation(id, room, guestId = 'G-1', dates = stay) {
  return { id, room, guestId, arrival: dates.arrival, departure: dates.departure, status: 'Confirmed' };
}
async function fixture(roomCount = 1) {
  const code = 'CI-' + randomUUID();
  const result = await pool.query(
    'INSERT INTO "property" (name,code,city) VALUES ($1,$2,$3) RETURNING id',
    ['Synthetic Test Hotel', code, 'Test City']
  );
  const id = result.rows[0].id;
  const state = {
    rooms: Array.from({ length: roomCount }, (_, i) => ({ number: String(101 + i), roomTypeId: 'CI-RT', status: 'Available' })),
    guests: Array.from({ length: 40 }, (_, i) => ({ id: 'G-' + (i + 1), name: 'Synthetic Guest ' + (i + 1) })),
    reservations: []
  };
  await pool.query(
    "INSERT INTO engagestay_managed_workspace (property_id,customer_id,status,plan,modules) " +
    "VALUES ($1,$2,'active','basic',ARRAY['operations'])",
    [id, randomUUID()]
  );
  await pool.query(
    'INSERT INTO engagestay_workspace_state (property_id,state) VALUES ($1,$2::jsonb)',
    [id, JSON.stringify(state)]
  );
  return id;
}

async function request(id, method, body) {
  const req = {
    params: { id: String(id) }, method, body,
    user: { id: 1, propertyId: id, role: 'ADMIN' }
  };
  const res = {
    code: 200, body: undefined,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler(req, res, () => { throw Error('Managed workspace handler unexpectedly fell through.'); });
  assert.notEqual(res.body, undefined);
  return { status: res.code, body: res.body };
}
async function get(id) {
  const result = await request(id, 'GET');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function put(id, snapshot, nextState) {
  return request(id, 'PUT', { version: snapshot.version, state: nextState });
}
function withBooking(snapshot, nextReservation) {
  return { ...structuredClone(snapshot.state), reservations: [...snapshot.state.reservations, nextReservation] };
}
async function persisted(id) {
  const result = await pool.query(
    'SELECT state, version FROM engagestay_workspace_state WHERE property_id=$1', [id]
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}
function assertInventoryConsistent(state) {
  const byRoomAndDay = new Set();
  const ids = new Set();
  for (const booking of state.reservations) {
    assert.ok(!ids.has(booking.id), 'duplicate reservation ID: ' + booking.id);
    ids.add(booking.id);
    if (!['Confirmed', 'Checked In', 'Modified'].includes(booking.status)) continue;
    assert.ok(state.rooms.some(room => String(room.number) === String(booking.room)), 'room must exist');
    for (let day = Date.parse(booking.arrival); day < Date.parse(booking.departure); day += 86400000) {
      const key = String(booking.room) + '|' + new Date(day).toISOString().slice(0, 10);
      assert.ok(!byRoomAndDay.has(key), 'double-booked room-night: ' + key);
      byRoomAndDay.add(key);
    }
  }
}

test('1. two simultaneous bookings of one room accept only one', async () => {
  const id = await fixture();
  const snapshot = await get(id);
  const results = await Promise.all([
    put(id, snapshot, withBooking(snapshot, reservation('R-A', '101'))),
    put(id, snapshot, withBooking(snapshot, reservation('R-B', '101')))
  ]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const row = await persisted(id);
  assert.equal(row.version, 2);
  assert.equal(row.state.reservations.length, 1);
  assertInventoryConsistent(row.state);
});

test('2. simultaneous requests cannot exceed limited physical inventory', async () => {
  const id = await fixture(3);
  const results = await Promise.all(Array.from({ length: 14 }, async (_, index) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const snapshot = await get(id);
      const available = snapshot.state.rooms.find(room => !snapshot.state.reservations.some(
        r => r.room === room.number && ['Confirmed', 'Checked In', 'Modified'].includes(r.status) &&
          r.arrival < stay.departure && stay.arrival < r.departure
      ));
      if (!available) return 'inventory-full';
      const next = withBooking(snapshot, reservation('BULK-' + index, available.number, 'G-' + (index + 1)));
      const saved = await put(id, snapshot, next);
      if (saved.status === 200) return 'accepted';
      assert.equal(saved.status, 409, JSON.stringify(saved.body));
    }
    throw Error('Concurrency retry budget exhausted');
  }));
  assert.equal(results.filter(x => x === 'accepted').length, 3);
  assert.equal(results.filter(x => x === 'inventory-full').length, 11);
  const row = await persisted(id);
  assert.equal(row.version, 4);
  assert.equal(row.state.reservations.length, 3);
  assertInventoryConsistent(row.state);
});

test('3. FOR UPDATE blocks a concurrent save until PostgreSQL row lock releases', async () => {
  const id = await fixture();
  const snapshot = await get(id);
  const blocker = await pool.connect();
  let lockHeld = false;
  let pending;
  try {
    await blocker.query('BEGIN');
    lockHeld = true;
    await blocker.query(
      'SELECT version FROM engagestay_workspace_state WHERE property_id=$1 FOR UPDATE', [id]
    );
    let resolved = false;
    pending = put(id, snapshot, withBooking(snapshot, reservation('LOCKED', '101')))
      .finally(() => { resolved = true; });
    let waiting = 0;
    for (let i = 0; i < 50; i++) {
      const check = await pool.query(
        "SELECT count(*)::integer AS waiting FROM pg_stat_activity " +
        "WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' " +
        "AND query LIKE '%engagestay_managed_workspace%'"
      );
      waiting = check.rows[0].waiting;
      if (waiting > 0) break;
      await delay(40);
    }
    assert.ok(waiting > 0, 'live PostgreSQL session should wait on the locked workspace row');
    assert.equal(resolved, false, 'request must not finish before lock release');
    assert.equal((await persisted(id)).version, 1, 'uncommitted concurrent update must not appear');
    await blocker.query('COMMIT');
    lockHeld = false;
    assert.equal((await pending).status, 200);
    assert.equal((await persisted(id)).version, 2);
  } finally {
    if (lockHeld) await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) await pending.catch(() => {});
  }
});

test('4. two concurrent workspace-version updates cannot both commit', async () => {
  const id = await fixture();
  const snapshot = await get(id);
  const changed = value => {
    const next = structuredClone(snapshot.state);
    next.guests[0].name = value;
    return next;
  };
  const results = await Promise.all([
    put(id, snapshot, changed('Synthetic Update Alpha')),
    put(id, snapshot, changed('Synthetic Update Beta'))
  ]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const row = await persisted(id);
  assert.equal(row.version, 2);
  assert.ok(['Synthetic Update Alpha', 'Synthetic Update Beta'].includes(row.state.guests[0].name));
});

test('5. fresh workspace version still rejects overlapping reservations', async () => {
  const id = await fixture();
  const first = await get(id);
  assert.equal((await put(id, first, withBooking(first, reservation('FIRST', '101')))).status, 200);
  const fresh = await get(id);
  const conflicting = await put(id, fresh, withBooking(fresh, reservation('CONFLICT', '101')));
  assert.equal(conflicting.status, 409);
  assert.match(conflicting.body.error, /Overlapping room allocations/);
  const row = await persisted(id);
  assert.equal(row.version, 2);
  assert.deepEqual(row.state.reservations.map(r => r.id), ['FIRST']);
});

test('6. database error rolls back an earlier mutation in the same transaction', async () => {
  const id = await fixture();
  const beforeRow = await persisted(id);
  await assert.rejects(
    withPgTransaction(pool, async client => {
      await client.query(
        'UPDATE engagestay_workspace_state SET version=version+1 WHERE property_id=$1', [id]
      );
      await client.query(
        'UPDATE engagestay_workspace_state SET state=NULL WHERE property_id=$1', [id]
      );
    }),
    error => error.code === '23502'
  );
  const row = await persisted(id);
  assert.equal(row.version, beforeRow.version);
  assert.deepEqual(row.state, beforeRow.state);
  const snapshot = await get(id);
  assert.equal((await put(id, snapshot, withBooking(snapshot, reservation('AFTER-ROLLBACK', '101')))).status, 200);
});

test('7. final room-night inventory stays consistent across competing requests', async () => {
  const id = await fixture(1);
  const early = await get(id);
  assert.equal((await put(id, early, withBooking(early, reservation('EARLY', '101', 'G-1',
    { arrival: '2027-01-05', departure: '2027-01-07' })))).status, 200);
  const adjacent = await get(id);
  assert.equal((await put(id, adjacent, withBooking(adjacent, reservation('ADJACENT', '101', 'G-2',
    { arrival: '2027-01-07', departure: '2027-01-09' })))).status, 200);
  const latest = await get(id);
  const results = await Promise.all([
    put(id, latest, withBooking(latest, reservation('OVERLAP-1', '101', 'G-3',
      { arrival: '2027-01-06', departure: '2027-01-08' }))),
    put(id, latest, withBooking(latest, reservation('OVERLAP-2', '101', 'G-4',
      { arrival: '2027-01-07', departure: '2027-01-08' })))
  ]);
  assert.deepEqual(results.map(x => x.status), [409, 409]);
  const row = await persisted(id);
  assert.equal(row.version, 3);
  assert.equal(row.state.reservations.length, 2);
  assertInventoryConsistent(row.state);
});

test('8. repeated concurrent submissions never insert duplicate booking records', async () => {
  const id = await fixture();
  const snapshot = await get(id);
  const submitted = withBooking(snapshot, reservation('SAME-BOOKING-ID', '101'));
  const results = await Promise.all(
    Array.from({ length: 20 }, () => put(id, snapshot, structuredClone(submitted)))
  );
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 19);
  const fresh = await get(id);
  const duplicate = await put(id, fresh, withBooking(fresh, reservation('SAME-BOOKING-ID', '101')));
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /Duplicate reservation identifier/);
  const row = await persisted(id);
  assert.equal(row.version, 2);
  assert.deepEqual(row.state.reservations.map(r => r.id), ['SAME-BOOKING-ID']);
  assertInventoryConsistent(row.state);
});
