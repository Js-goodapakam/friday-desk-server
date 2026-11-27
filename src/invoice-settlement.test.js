const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settleInvoice } = require('./invoice-settlement');

const key = '00000000-0000-4000-8000-000000000001';
const payment = { id: key, invoiceId: 'invoice', amount: 0.05, reference: 'Receipt 1' };
const state = {
  invoices: [{ id: 'invoice', reservationId: 'stay', total: 10.15, paid: 10, status: 'Partially Paid' }],
  reservations: [{ id: 'stay', paid: 10, status: 'Checked Out' }],
};
const record = (book, operation) => settleInvoice(book, operation, 1, '2026-11-27T00:00:00Z');

test('records partial receipts, then settles without rounding drift', () => {
  const partial = record(state, payment);
  assert.equal(partial.invoices[0].balance, 0.10);
  assert.equal(partial.reservations[0].paid, 10.05);
  assert.deepEqual(record(partial, payment), { replay: true });
  const full = record(partial, { ...payment, id: key.slice(0,-1)+'2', amount: 0.10, reference: 'Receipt 2' });
  assert.equal(full.invoices[0].status, 'Paid');
  assert.equal(full.invoices[0].balance, 0);
  assert.equal(full.payments.length, 2);
});

test('rejects invalid amounts, conflicting replays, excess receipts and cancelled stays', () => {
  assert.equal(record(state, { ...payment, amount: 0.001 }).status, 400);
  assert.equal(record(state, { ...payment, amount: 1 }).status, 409);
  assert.equal(record(record(state, payment), { ...payment, amount: 0.10 }).status, 409);
  assert.equal(record({ ...state, reservations: [{ ...state.reservations[0], status: 'Cancelled' }] }, payment).status, 409);
});
