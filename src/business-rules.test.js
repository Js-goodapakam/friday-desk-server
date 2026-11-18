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
test('room allocation, check-in and check-out retain safe reservation lifecycle rules',()=>{
 const before=model.generateHotel(0,100),next=structuredClone(before);
 const reservation=next.reservations.find(r=>r.status==='Confirmed'&&r.arrival<=next.demo.referenceDate&&r.departure>next.demo.referenceDate);
 assert.ok(reservation,'fixture must include an eligible arrival');
 const room=next.rooms.find(item=>item.number===reservation.room);
 room.housekeepingStatus='Dirty';reservation.status='Checked In';
 assert.throws(()=>validateTransitions(before,next),/clean or inspected/);
 room.housekeepingStatus='Clean';assert.doesNotThrow(()=>validateTransitions(before,next));assert.equal(room.status,'Occupied');
 const checkedIn=structuredClone(next);checkedIn.reservations.find(r=>r.id===reservation.id).status='Checked Out';checkedIn.reservations.find(r=>r.id===reservation.id).balance=0;
 assert.doesNotThrow(()=>validateTransitions(next,checkedIn));assert.equal(checkedIn.rooms.find(item=>item.number===reservation.room).status,'Available');assert.equal(checkedIn.rooms.find(item=>item.number===reservation.room).housekeepingStatus,'Dirty');
});
test('two conflicting reservation payloads cannot both pass allocation validation',()=>{
 const baseline=model.generateHotel(0,100),first=structuredClone(baseline),second=structuredClone(baseline);
 const source=baseline.reservations.find(r=>['Confirmed','Modified'].includes(r.status));
 assert.ok(source);
 const candidate=(state,id)=>({ ...structuredClone(source),id,guestId:state.guests.at(-1).id,status:'Confirmed',arrival:source.arrival,departure:source.departure,room:source.room,roomTypeId:source.roomTypeId });
 first.reservations.push(candidate(first,'CONCURRENT-A'));
 second.reservations.push(candidate(second,'CONCURRENT-B'));
 assert.throws(()=>require('./demo-store').validate(first),/Overlapping room allocations/);
 assert.throws(()=>require('./demo-store').validate(second),/Overlapping room allocations/);
});
test('display labels retain internal identifiers and replace visible legacy labels',()=>{
 const out=normalizeLabels({demo:{seed:model.SEED,disclaimer:'DEMO — NOT AFFILIATED WITH TAJ'},name:'Demo staff',number:'DEMO-001'});assert.equal(out.demo.seed,model.SEED);assert.doesNotMatch(out.name,/demo/i);assert.equal(out.number,'SAMPLE-001');
});
