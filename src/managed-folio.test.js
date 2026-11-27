const {test} = require('node:test');
const assert = require('node:assert/strict');
const {applyFolio,totals} = require('./managed-folio');

test('folio records room, service, receipts and an immutable invoice snapshot', () => {
  let state={reservations:[{id:'stay',status:'Confirmed',arrival:'2026-01-01',departure:'2026-01-02',rate:100,paid:10}]};
  const operator={id:2,role:'ADMIN'};
  const add=(kind,amount,sequence,actor=operator)=>{
    const result=applyFolio(state,{id:'00000000-0000-4000-8000-00000000000'+sequence,
      reservationId:'stay',kind,reference:'Reference '+sequence,amount},actor,'2026-01-01T00:00:00Z');
    if(!result.error&&!result.replay)state={...state,...result};
    return result;
  };
  add('open',undefined,1);
  add('charge',2000,2);
  add('payment',1000,3);
  assert.deepEqual(totals(state.folioLedger),{charges:12000,paid:2000,balance:10000});
  assert.deepEqual(add('payment',1000,3),{replay:true});
  assert.equal(add('payment',1001,3).status,409);
  assert.equal(add('payment',10001,4).status,409);
  const invoice=add('issue',undefined,4).invoices[0];
  assert.equal(invoice.balance,100);
  assert.equal(add('payment',100,5).status,409);
  add('adjust',11000,5);
  assert.equal(add('refund',1000,6,{id:3,role:'MANAGER'}).status,403);
  assert.equal(add('refund',1001,6).status,409);
  add('refund',1000,6);
  assert.deepEqual(totals(state.folioLedger),{charges:1000,paid:1000,balance:0});
  assert.deepEqual(state.invoices[0],invoice);
});
