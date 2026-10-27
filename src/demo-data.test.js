const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('./demo-data'),store=require('./demo-store');
test('five deterministic properties meet all core record counts',()=>{
 const states=model.hotels.map((_,i)=>store.validate(model.generateHotel(i,i+100)));
 for(const [key,n]of Object.entries({rooms:500,roomTypes:20,guests:200,reservations:250,ratePlans:20,dailyInventory:7300,folios:250,housekeeping:500}))assert.equal(states.reduce((sum,state)=>sum+state[key].length,0),n,key);
 assert.equal(model.day(364),'2027-10-25');
 for(const state of states){assert.ok(state.dailyInventory.every(row=>row.available>=0&&row.available<=row.sellable));assert.ok(state.guests.every(g=>g.email.endsWith('@example.test')&&/^LOCAL-PHONE-\d{4}$/.test(g.phone)&&!g.idNumber));assert.ok(state.channelManager.channels.every(c=>c.simulated&&!c.connected));assert.deepEqual(store.validate(structuredClone(state)).metrics,state.metrics);}
});
test('folio charges, demonstration taxes, receipts and refunds reconcile',()=>{
 const state=store.validate(model.generateHotel(0,100));
 for(const folio of state.folios){const reservation=state.reservations.find(r=>r.id===folio.reservationId);assert.equal(folio.total,reservation.totalAmount);assert.equal(folio.paid,reservation.paid);assert.ok(Math.abs(folio.total-folio.paid-folio.balance)<.01);}
 assert.equal(state.metrics.cashCollected,state.payments.reduce((sum,p)=>sum+(p.type==='Refund'?-p.amount:p.amount),0));
 assert.ok(state.reservations.some(r=>r.status==='Cancelled'&&r.totalAmount===0&&r.paid===0));
});
test('foreign links, overlap, blocked rooms and overselling fail validation',()=>{
 const fresh=()=>model.generateHotel(0,100);
 let state=fresh();state.reservations[0].guestId='missing';assert.throws(()=>store.validate(state),/guest/);
 state=fresh();state.reservations[1].room=state.reservations[0].room;assert.throws(()=>store.validate(state),/Overlapping/);
 state=fresh();state.reservations[1].room=state.rooms.at(-1).number;assert.throws(()=>store.validate(state),/blocked/);
 state=fresh();state.inventoryOverrides['Luxury Room|2026-10-26']={sellable:0};assert.throws(()=>store.validate(state),/Inventory below/);
 state=fresh();state.inventoryOverrides['Luxury Room|2026-10-26']={sellable:999};assert.throws(()=>store.validate(state),/Invalid rate/);
});
test('demonstration tax rules remain configurable and stop-sell removes sellable availability',()=>{
 const state=model.generateHotel(1,101),old=state.folios[0].total;state.folios[0].taxRate=15;state.inventoryOverrides['Superior Room|2026-10-26']={stopSell:true};store.validate(state);assert.ok(state.folios[0].total>old);assert.equal(state.dailyInventory.find(i=>i.type==='Superior Room'&&i.date===model.START).available,0);
});
test('unsafe live channel flags and invalid tax values are rejected',()=>{
 const state=model.generateHotel(0,100);state.channelManager.channels[0].connected=true;assert.throws(()=>store.validate(state),/simulated/);state.channelManager.channels[0].connected=false;state.invoiceSettings.taxRate=NaN;assert.throws(()=>store.validate(state),/tax/);
});
