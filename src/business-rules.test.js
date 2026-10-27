const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('./demo-data'),{validateBusiness}=require('./business-rules'),{validateTransitions}=require('./reservation-transitions'),{normalizeLabels}=require('./sample-labels');
test('converted enquiries link to the same guest; losses require reasons',()=>{
 const s=model.generateHotel(0,100),r=s.reservations[0];s.enquiries=[{id:'E1',guestId:r.guestId,arrival:r.arrival,departure:r.departure,rooms:1,expectedValue:100,status:'Converted',reservationId:r.id}];assert.doesNotThrow(()=>validateBusiness(s));s.enquiries[0].guestId=s.guests[1].id;assert.throws(()=>validateBusiness(s),/Converted/);s.enquiries[0].status='Lost';assert.throws(()=>validateBusiness(s),/reason/);
});
test('group parents validate dates and cannot share child reservations',()=>{
 const s=model.generateHotel(0,100),r=s.reservations[0],group={id:'G1',name:'Company meeting',organizer:'Organizer',arrival:r.arrival,departure:r.departure,deposit:0,status:'Confirmed',reservationIds:[r.id]};s.groups=[group];assert.doesNotThrow(()=>validateBusiness(s));s.groups.push({...group,id:'G2'});assert.throws(()=>validateBusiness(s),/one group/);
});
test('unconfigured communication records cannot claim delivery',()=>{
 const s=model.generateHotel(0,100);s.communications=[{id:'C1',guestId:s.guests[0].id,subject:'Arrival',body:'Welcome',channel:'Email',status:'Sent'}];assert.throws(()=>validateBusiness(s),/honest delivery/);s.communications[0].status='Draft';assert.doesNotThrow(()=>validateBusiness(s));
});
test('checkout requires settlement and changes housekeeping separately',()=>{
 const before=model.generateHotel(0,100),next=structuredClone(before);next.reservations[0].status='Checked Out';next.reservations[0].balance=1;assert.throws(()=>validateTransitions(before,next),/settled/);next.reservations[0].balance=0;validateTransitions(before,next);assert.equal(next.rooms[0].housekeepingStatus,'Dirty');assert.equal(next.rooms[0].status,'Available');
});
test('display labels retain internal identifiers and replace visible legacy labels',()=>{
 const out=normalizeLabels({demo:{seed:model.SEED,disclaimer:'DEMO — NOT AFFILIATED WITH TAJ'},name:'Demo staff',number:'DEMO-001'});assert.equal(out.demo.seed,model.SEED);assert.doesNotMatch(out.name,/demo/i);assert.equal(out.number,'SAMPLE-001');
});
