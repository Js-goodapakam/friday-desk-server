// Managed PMS workspace state stores rooms and reservations as JSONB arrays.
// Match the existing sample inventory semantics: Confirmed, Checked In and
// Modified stays occupy the room for [arrival, departure), excluding checkout.
const activeStatuses = new Set(['Confirmed', 'Checked In', 'Modified']);
const validDay = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const overlaps = (a, b) => a.arrival < b.departure && b.arrival < a.departure;

function validateReservationAllocations(state) {
  const rooms = state.rooms ?? [], reservations = state.reservations ?? [], blocks = state.roomBlocks ?? [];
  if (!Array.isArray(rooms) || !Array.isArray(reservations) || !Array.isArray(blocks)) {
    throw Error('Invalid room, reservation or room block records.');
  }
  const roomNumbers = new Set();
  for (const room of rooms) {
    if (room?.number === undefined || room?.number === null || roomNumbers.has(String(room.number))) {
      throw Error('Duplicate or invalid room number.');
    }
    roomNumbers.add(String(room.number));
  }
  const reservationIds = new Set(), occupied = new Map();
  for (const reservation of reservations) {
    if (reservation?.id === undefined || reservation?.id === null || reservationIds.has(String(reservation.id))) {
      throw Error('Duplicate reservation identifier.');
    }
    reservationIds.add(String(reservation.id));
    if (!activeStatuses.has(reservation.status)) continue;
    const room = String(reservation.room ?? '');
    if (!roomNumbers.has(room)) throw Error('Reservation references an unavailable room.');
    if (!validDay(reservation.arrival) || !validDay(reservation.departure) || reservation.arrival >= reservation.departure) {
      throw Error('Invalid reservation stay dates.');
    }
    const previous = occupied.get(room) || [];
    if (previous.some(other => overlaps(reservation, other))) throw Error('Overlapping room allocations.');
    if (blocks.some(block => String(block.room) === room &&
        validDay(block.arrival) && validDay(block.departure) && overlaps(reservation, block))) {
      throw Error('Room blocked for maintenance or inventory.');
    }
    previous.push(reservation);
    occupied.set(room, previous);
  }
  return state;
}
module.exports = { validateReservationAllocations, overlaps, activeStatuses };
