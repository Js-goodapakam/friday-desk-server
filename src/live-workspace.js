const { isDeepStrictEqual } = require('node:util');
const { canAccess } = require('./properties');
const { settleInvoice } = require('./invoice-settlement');
const { applyFolio, totals } = require('./managed-folio');

const planModules = {
  basic: ['operations'],
  premium: ['operations', 'finance', 'inventory'],
  enterprise: ['operations', 'finance', 'inventory', 'communications'],
};
const sections = {
  operations: ['rooms', 'guests', 'reservations', 'requests', 'tasks', 'housekeeping'],
  finance: ['folios', 'payments', 'invoices', 'invoiceSettings', 'folioLedger'],
  inventory: ['ratePlans', 'inventoryOverrides', 'inventoryAudit', 'revenueManagement'],
  communications: ['communications', 'callActivities'],
};

const occupiedStatuses = new Set(['Confirmed', 'Modified', 'Checked In']);

function isBookingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function reservationStateError(state) {
  const rooms = new Set((state.rooms || []).map(room => room?.number));
  const guests = new Set((state.guests || []).map(guest => guest?.id));
  const roomBookings = new Map();
  for (const booking of state.reservations || []) {
    if (!booking || typeof booking !== 'object') return { code: 400, body: { error: 'Invalid reservation.' } };
    if (!occupiedStatuses.has(booking.status)) continue;
    if (!booking.room || !booking.guestId || !rooms.has(booking.room) || !guests.has(booking.guestId) ||
        !isBookingDate(booking.arrival) || !isBookingDate(booking.departure) || booking.arrival >= booking.departure) {
      return { code: 400, body: { error: 'Active reservations require a valid room, guest and stay dates.' } };
    }
    if (!roomBookings.has(booking.room)) roomBookings.set(booking.room, []);
    roomBookings.get(booking.room).push(booking);
  }
  for (const bookings of roomBookings.values()) {
    bookings.sort((left, right) => left.arrival.localeCompare(right.arrival));
    for (let index = 1; index < bookings.length; index++) {
      if (bookings[index].arrival < bookings[index - 1].departure) {
        return { code: 409, body: { error: 'The room has an overlapping reservation.' } };
      }
    }
  }
  return null;
}

function workspaceHandler(db) {
  return async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid property.' });
    try {
      const outcome = await db.withTransaction(async client => {
        const { rows: [workspace] } = await client.query(
          `SELECT case when m.subscription_expires_at <= now() then 'suspended' else m.status end as status,
                  m.plan, m.modules, s.state, s.version, p.name
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
        const { state, version, invoicePayment, folioOperation } = req.body || {};
        if (folioOperation !== undefined) {
          if (!modules.includes('finance') || !modules.includes('operations')) return { code: 403, body: { error: 'Finance access denied.' } };
          const outcome = applyFolio(workspace.state,folioOperation,req.user,new Date().toISOString());
          if (outcome.replay) return { body: { state: { ...visible, property }, version: workspace.version, managed: true, modules } };
          if (version !== workspace.version) return { code: 409, body: { error: 'Reload the workspace before saving.' } };
          if (outcome.error) return { code: outcome.status, body: { error: outcome.error } };
          await client.query('UPDATE engagestay_workspace_state SET state=$2, version=version+1 WHERE property_id=$1',
            [id, JSON.stringify({ ...workspace.state, ...outcome })]);
          return { body: { state: { ...visible, ...outcome, property }, version: version + 1, managed: true, modules } };
        }
        if (invoicePayment !== undefined) {
          if (!modules.includes('finance') || !modules.includes('operations')) return { code: 403, body: { error: 'Finance access denied.' } };
          const outcome = settleInvoice(workspace.state, invoicePayment, req.user.id, new Date().toISOString());
          if (outcome.replay) return { body: { state: { ...visible, property }, version: workspace.version, managed: true, modules } };
          if (version !== workspace.version) return { code: 409, body: { error: 'Reload the workspace before saving.' } };
          if (outcome.error) return { code: outcome.status, body: { error: outcome.error } };
          const invoice=workspace.state.invoices.find(row=>row.id===invoicePayment.invoiceId);
          if (invoice.folio) {
            const ledger=workspace.state.folioLedger || [];
            if (ledger.some(row=>row.id===invoicePayment.id)) return {code:409,body:{error:'Payment key already belongs to a folio entry.'}};
            const current=totals(ledger.filter(row=>row.reservationId===invoice.reservationId));
            if (current.charges!==Math.round(invoice.total*100) || current.paid!==Math.round(invoice.paid*100)) {
              return { code:409, body:{ error:'This issued invoice differs from the adjusted folio. Review before collecting.' } };
            }
            outcome.folioLedger=[...ledger,{id:invoicePayment.id,kind:'payment',action:'invoice-payment',
              reservationId:invoice.reservationId,invoiceId:invoice.id,amount:Math.round(invoicePayment.amount*100),
              reference:invoicePayment.reference.trim(),actorId:req.user.id,at:new Date().toISOString()}];
          }
          await client.query('UPDATE engagestay_workspace_state SET state=$2, version=version+1 WHERE property_id=$1',
            [id, JSON.stringify({ ...workspace.state, ...outcome })]);
          return { body: { state: { ...visible, ...outcome, property }, version: version + 1, managed: true, modules } };
        }
        if (version !== workspace.version) return { code: 409, body: { error: 'Reload the workspace before saving.' } };
        if (!state || typeof state !== 'object' || Number(state.property?.id) !== id) {
          return { code: 400, body: { error: 'Invalid workspace state.' } };
        }
        if (Object.hasOwn(state,'folioLedger')) return { code:400, body:{ error:'Use folio operations to record ledger entries.' } };
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
        const folioStays = new Set((workspace.state.folioLedger || []).map(entry=>entry.reservationId));
        if (Object.hasOwn(state,'reservations') && (workspace.state.reservations || []).some(stay=>{
          if (!folioStays.has(stay.id)) return false;
          const next=visible.reservations?.find(row=>row?.id===stay.id);
          return !next || ['arrival','departure','rate','paid','guestId'].some(key=>next[key]!==stay[key]);
        })) return {code:409,body:{error:'Use folio operations for changes to billed stay amounts.'}};
        if (Object.hasOwn(state,'reservations') && visible.reservations?.some(stay=>
          stay?.status==='Checked Out' && folioStays.has(stay.id) &&
          workspace.state.reservations?.find(row=>row?.id===stay.id)?.status!=='Checked Out' &&
          totals(workspace.state.folioLedger.filter(row=>row.reservationId===stay.id)).balance>0
        )) return {code:409,body:{error:'Settle the folio balance before checkout.'}};
        if (Object.hasOwn(state,'invoices') && (workspace.state.invoices || []).filter(row=>row?.folio).some(invoice=>
          !isDeepStrictEqual(invoice,visible.invoices?.find(row=>row?.id===invoice.id))
        )) return {code:409,body:{error:'Issued folio invoices cannot be edited.'}};
        if (Object.hasOwn(state,'invoices') && visible.invoices?.some(row=>folioStays.has(row?.reservationId) &&
          !(workspace.state.invoices || []).some(invoice=>invoice.id===row.id)
        )) return {code:409,body:{error:'Issue this invoice from its folio.'}};
        const settled = (workspace.state.payments || []).filter(payment => payment.invoiceId);
        if (settled.some(payment =>
          (Object.hasOwn(state, 'payments') && !isDeepStrictEqual(payment, visible.payments?.find(row => row?.id === payment.id))) ||
          (Object.hasOwn(state, 'invoices') && !isDeepStrictEqual(workspace.state.invoices?.find(row => row?.id === payment.invoiceId), visible.invoices?.find(row => row?.id === payment.invoiceId))) ||
          (Object.hasOwn(state, 'reservations') && workspace.state.reservations?.find(row => row?.id === payment.reservationId)?.paid !== visible.reservations?.find(row => row?.id === payment.reservationId)?.paid)
        )) return { code: 409, body: { error: 'Recorded invoice payments require the finance workflow.' } };
        if (Object.hasOwn(state,'payments') && visible.payments?.some(payment=>payment?.invoiceId && !settled.some(row=>row.id===payment.id))) {
          return { code: 400, body: { error: 'Use invoice settlement to record invoice payments.' } };
        }
        if (['rooms', 'guests', 'reservations'].some(key => Object.hasOwn(state, key))) {
          const error = reservationStateError({ ...workspace.state, ...visible });
          if (error) return error;
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
