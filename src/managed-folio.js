const dayMs = 86400000;
const cap = 10000000000;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const reject = (status, error) => ({ status, error });
const cents = value => Math.round(Number(value) * 100);

function totals(entries) {
  let charges = 0, paid = 0;
  for (const entry of entries) {
    if (['room', 'charge', 'adjust'].includes(entry.kind)) charges += entry.amount;
    if (['opening', 'payment', 'refund'].includes(entry.kind)) paid += entry.amount;
  }
  return { charges, paid, balance: charges - paid };
}

function applyFolio(state, command, actor, at) {
  const { id, reservationId, kind, amount, reference } = command || {};
  if (!uuid.test(id || '') || typeof reservationId !== 'string' ||
      !['open','charge','adjust','payment','refund','issue'].includes(kind) ||
      typeof reference !== 'string' || !reference.trim() || reference.length > 100 ||
      (!['open','issue'].includes(kind) && (!Number.isSafeInteger(amount) || amount < 1 || amount > cap))) {
    return reject(400, 'Enter a valid folio operation, amount and reference.');
  }
  const ledger = state.folioLedger || [];
  const prior = ledger.find(row => row.id === id);
  if (prior) return prior.reservationId === reservationId && prior.action === kind &&
    prior.requestAmount === amount && prior.reference === reference.trim()
    ? { replay: true } : reject(409, 'Operation key belongs to another entry.');
  const stay = (state.reservations || []).find(row => row.id === reservationId);
  if (!stay) return reject(404, 'Reservation unavailable.');
  if (kind === 'refund' && actor.role !== 'ADMIN') return reject(403, 'Administrator permission is required for refunds.');
  if (['Cancelled','No Show'].includes(stay.status) && !['adjust','refund'].includes(kind)) {
    return reject(409, 'Cancelled or no-show stays only accept corrections and eligible refunds.');
  }
  const entries = ledger.filter(row => row.reservationId === reservationId);
  if ((kind === 'open') === Boolean(entries.length)) return reject(409, entries.length ? 'Folio already opened.' : 'Open the folio first.');
  if (entries.some(row => row.action === kind && row.reference === reference.trim())) return reject(409, 'Reference already recorded.');
  const invoices = state.invoices || [];
  const activeInvoice = invoices.find(row => row.reservationId === reservationId && row.status !== 'Cancelled');
  const entry = { id, reservationId, action: kind, kind, amount, requestAmount: amount, reference: reference.trim(), actorId: actor.id, at };
  if (kind === 'open') {
    if (activeInvoice) return reject(409, 'Existing invoices remain in the legacy settlement workflow.');
    const room = ((Date.parse(stay.departure) - Date.parse(stay.arrival)) / dayMs) * cents(stay.rate);
    const opening = cents(stay.paid ?? 0);
    if (!Number.isSafeInteger(room) || room < 0 || room > cap || !Number.isSafeInteger(opening) || opening < 0 || opening > room) {
      return reject(409, 'Review the reservation rate, dates and recorded receipts before opening.');
    }
    return { folioLedger: [...ledger, { ...entry, kind:'room', amount:room },
      ...(opening ? [{ id:id+':opening', reservationId, kind:'opening', amount:opening, at, actorId:actor.id, reference:'Reservation receipts at opening' }] : [])] };
  }
  const { charges, paid, balance } = totals(entries);
  if (kind === 'payment' && (activeInvoice || amount > balance)) return reject(409, 'Payment exceeds the folio balance or must be allocated through its invoice.');
  if (kind === 'adjust' && amount > charges) return reject(409, 'Credit adjustment exceeds charges.');
  if (kind === 'refund' && (amount > paid || amount > -balance)) return reject(409, 'Refund requires sufficient receipts and a folio credit.');
  if (kind === 'charge' && charges + amount > cap) return reject(400, 'Folio charge limit exceeded.');
  if (kind === 'issue') {
    if (activeInvoice || charges <= 0 || balance < 0) return reject(409, 'An invoice already exists or folio totals require review.');
    const settings = state.invoiceSettings || {};
    const number = Number.isSafeInteger(settings.nextNumber) && settings.nextNumber > 0 ? settings.nextNumber : 1;
    const invoice = { id, number: (settings.prefix || 'INV')+'-'+String(number).padStart(6,'0'), reservationId,
      guestId: stay.guestId, arrival:stay.arrival, departure:stay.departure, room:stay.room,
      items: entries.filter(row=>['room','charge','adjust'].includes(row.kind)).map(row=>({
        id:row.id, description:row.reference, quantity:1, rate:row.amount/100, amount:row.amount/100,
      })), subtotal:charges/100, total:charges/100, taxRate:0, taxAmount:0, discount:0, paid:paid/100, balance:balance/100,
      status:balance===0?'Paid':paid?'Partially Paid':'Issued', createdAt:at, issueDate:at.slice(0,10), dueDate:at.slice(0,10), folio:true };
    return { invoices:[invoice,...invoices], invoiceSettings:{...settings,nextNumber:number+1}, folioLedger:[...ledger,{...entry,amount:0}] };
  }
  const signed = ['adjust','refund'].includes(kind) ? -amount : amount;
  return { folioLedger:[...ledger,{...entry,amount:signed}],
    ...(['payment','refund'].includes(kind) ? { reservations:state.reservations.map(row=>row.id===reservationId?{...row,paid:(paid+signed)/100}:row) } : {}) };
}

module.exports = { applyFolio, totals };
