function minor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value * 100);
  return Number.isSafeInteger(rounded) && Math.abs(value - rounded / 100) < 1e-8 ? rounded : null;
}

function settleInvoice(state, operation, actorId, now) {
  const { id, invoiceId, amount, reference } = operation || {};
  const credit = minor(amount);
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) ||
      typeof invoiceId !== 'string' || !credit || typeof reference !== 'string' ||
      !reference.trim() || reference.length > 100) return { status: 400, error: 'Enter a valid payment amount and reference.' };
  const entries = state.payments || [];
  const prior = entries.find(entry => entry.id === id);
  if (prior) {
    return prior.invoiceId === invoiceId && prior.amount === amount && prior.reference === reference.trim()
      ? { replay: true } : { status: 409, error: 'Payment key was used for a different payment.' };
  }
  if (entries.some(entry => entry.invoiceId === invoiceId && entry.reference === reference.trim())) {
    return { status: 409, error: 'This payment reference is already recorded for the invoice.' };
  }
  const invoice = (state.invoices || []).find(row => row.id === invoiceId && row.status !== 'Cancelled');
  const reservation = invoice && (state.reservations || []).find(row => row.id === invoice.reservationId);
  if (!invoice || !reservation) return { status: 404, error: 'Invoice or reservation is unavailable.' };
  if (reservation.status === 'Cancelled') return { status: 409, error: 'Review cancelled reservations before recording payments.' };
  if (state.invoices.filter(row => row.reservationId === reservation.id && row.status !== 'Cancelled').length !== 1) {
    return { status: 409, error: 'Resolve multiple active invoices for this reservation before recording payment.' };
  }
  const total = minor(invoice.total);
  const paid = minor(invoice.paid);
  const reservationPaid = minor(reservation.paid ?? 0);
  if (total === null || paid === null || reservationPaid === null || paid !== reservationPaid || credit > total - paid) {
    return { status: 409, error: 'Payment exceeds the balance or receipts require reconciliation.' };
  }
  const nextPaid = (paid + credit) / 100;
  const balance = (total - paid - credit) / 100;
  return {
    invoices: state.invoices.map(row => row.id === invoiceId
      ? { ...row, paid: nextPaid, balance, status: balance ? 'Partially Paid' : 'Paid' } : row),
    reservations: state.reservations.map(row => row.id === reservation.id ? { ...row, paid: nextPaid } : row),
    payments: [...entries, { id, invoiceId, reservationId: reservation.id, amount, reference: reference.trim(),
      type: 'Payment', status: 'Recorded', method: 'Manual', paidAt: now, actorId }],
  };
}

module.exports = { settleInvoice };
