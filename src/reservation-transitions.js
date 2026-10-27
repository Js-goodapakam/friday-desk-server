function validateTransitions(previous,state){
 const today=state.demo.referenceDate;
 for(const r of state.reservations){const old=previous.reservations.find(o=>o.id===r.id);if(!old||old.status===r.status)continue;
  if(old.status==='Checked Out'&&r.status!=='Checked Out')throw Error('A checked-out reservation cannot be reopened.');
  if(r.status==='Checked In'){
   if(!['Confirmed','Modified'].includes(old.status)||r.arrival>today||r.departure<=today)throw Error('Only an eligible confirmed stay can check in.');
   const room=state.rooms.find(room=>room.number===r.room);if(!room||!['Clean','Inspected'].includes(room.housekeepingStatus))throw Error('Room must be clean or inspected before check-in.');
   room.status='Occupied';
  }
  if(r.status==='Checked Out'){
   if(old.status!=='Checked In'||r.balance>0)throw Error('Only a fully settled in-house reservation can check out.');
   const room=state.rooms.find(room=>room.number===r.room);if(room){room.status='Available';room.housekeepingStatus='Dirty';}
   state.housekeeping=state.housekeeping.map(h=>h.room===r.room?{...h,status:'Dirty',occupancy:'Vacant',completedAt:null}:h);
  }
  if(old.status==='Checked In'&&['Cancelled','No Show','Pending'].includes(r.status))throw Error('An in-house stay must be checked out before cancellation or no-show.');
  if(r.status==='Cancelled'&&state.operationalSettings?.['Allow reservation cancellation']===false)throw Error('Reservation cancellation is disabled for this property.');
  if(r.status==='No Show'&&r.arrival>today)throw Error('A future arrival cannot be marked no-show.');
 }
 return state;
}
module.exports={validateTransitions};
