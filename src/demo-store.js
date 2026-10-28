const model=require('./demo-data');
function assertLocal(db){if(process.env.FRIDAY_LOCAL_DEV!=='1'||process.env.NODE_ENV==='production'||!db.file?.endsWith('friday-development.sqlite'))throw Error('Sample data is restricted to the isolated local SQLite database.');}
async function assertWritableWorkspace(db,id){
 if(process.env.FRIDAY_LOCAL_DEV==='1'){assertLocal(db);return;}
 if(db.file||process.env.NODE_ENV!=='production')throw Error('Production sample workspace writes require the production database and runtime.');
 const found=await db.query('SELECT p.code,w.seed FROM property p JOIN friday_demo_workspace w ON w.property_id=p.id WHERE p.id=$1',[id]);
 if(!found.rows[0]||found.rows[0].seed!==model.SEED||!model.hotels.some(h=>h[0]===found.rows[0].code))throw Error('Only explicitly seeded Taj sample workspaces may be changed.');
}
async function schema(db){assertLocal(db);for(const sql of [
 'CREATE TABLE IF NOT EXISTS friday_demo_workspace(property_id INTEGER PRIMARY KEY REFERENCES property(id),seed TEXT NOT NULL,state_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)',
 'CREATE TABLE IF NOT EXISTS friday_demo_room_type(property_id INTEGER REFERENCES property(id),id TEXT,payload TEXT NOT NULL,PRIMARY KEY(property_id,id))',
 'CREATE TABLE IF NOT EXISTS friday_demo_room(property_id INTEGER,number TEXT,room_type_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(property_id,number),FOREIGN KEY(property_id,room_type_id) REFERENCES friday_demo_room_type(property_id,id))',
 'CREATE TABLE IF NOT EXISTS friday_demo_guest(property_id INTEGER REFERENCES property(id),id TEXT,payload TEXT NOT NULL,PRIMARY KEY(property_id,id))',
 'CREATE TABLE IF NOT EXISTS friday_demo_reservation(property_id INTEGER,id TEXT,guest_id TEXT,room_number TEXT,payload TEXT NOT NULL,PRIMARY KEY(property_id,id),FOREIGN KEY(property_id,guest_id) REFERENCES friday_demo_guest(property_id,id),FOREIGN KEY(property_id,room_number) REFERENCES friday_demo_room(property_id,number))',
 'CREATE TABLE IF NOT EXISTS friday_demo_record(property_id INTEGER REFERENCES property(id),kind TEXT,id TEXT,reservation_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(property_id,kind,id),FOREIGN KEY(property_id,reservation_id) REFERENCES friday_demo_reservation(property_id,id))',
 'CREATE TABLE IF NOT EXISTS friday_demo_user(user_id INTEGER PRIMARY KEY REFERENCES user(id),seed TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS friday_demo_audit(id INTEGER PRIMARY KEY,property_id INTEGER REFERENCES property(id),actor_id INTEGER,action TEXT,at TEXT,payload TEXT)'
 ])await db.query(sql);}
function validate(state){
 require('./business-rules').validateBusiness(state);
 if(!Number.isFinite(state.invoiceSettings?.taxRate)||state.invoiceSettings.taxRate<0||state.invoiceSettings.taxRate>50)throw Error('Invalid demonstration tax rate');
 const unique=(rows,key)=>{const ids=rows.map(r=>String(r[key]));if(new Set(ids).size!==ids.length)throw Error(`Duplicate ${key}`);};
 for(const [kind,key]of [['rooms','number'],['roomTypes','id'],['guests','id'],['reservations','id']]){if(!Array.isArray(state[kind]))throw Error('Missing '+kind);unique(state[kind],key);}
 const rooms=new Map(state.rooms.map(r=>[String(r.number),r])),types=new Set(state.roomTypes.map(t=>t.id)),guests=new Set(state.guests.map(g=>g.id));
 for(const room of state.rooms)if(!types.has(room.roomTypeId))throw Error('Room type missing');
 const bookings=new Map();
 for(const r of state.reservations){
  if(!['Confirmed','Checked In','Checked Out','Cancelled','No Show','Pending','Modified'].includes(r.status))throw Error('Unsupported reservation status');
  const assigned=rooms.get(String(r.room));if(assigned)r.roomTypeId=assigned.roomTypeId;
  const roomType=state.roomTypes.find(t=>t.id===r.roomTypeId);
  if(!Number.isInteger(r.adults)||r.adults<1||!Number.isInteger(r.children)||r.children<0||r.adults>(roomType?.maxAdults||0)||r.children>(roomType?.maxChildren??0))throw Error('Reservation exceeds the room category occupancy limits.');
  if(r.ratePlanId&&!state.ratePlans.some(p=>p.id===r.ratePlanId))throw Error('Rate plan missing.');
  if(!guests.has(r.guestId)||!rooms.has(String(r.room)))throw Error('Invalid guest or room link');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.arrival)||!/^\d{4}-\d{2}-\d{2}$/.test(r.departure)||r.arrival>=r.departure||!Number.isFinite(Date.parse(r.arrival))||!Number.isFinite(Date.parse(r.departure)))throw Error('Invalid stay dates');
  if(!Number.isFinite(r.rate)||r.rate<0)throw Error('Invalid rate');
  if(model.active(r))for(let d=r.arrival;d<r.departure;d=model.day(1,d)){const key=r.room+'|'+d;if(bookings.has(key))throw Error('Overlapping room allocations');if(state.roomBlocks.some(b=>b.room===r.room&&model.includesDay(b,d)))throw Error('Room blocked for maintenance or inventory');bookings.set(key,r.id);}
 }
 const cover=state.property?.cover;if(cover){if(!(/^(data:image\/(jpeg|png|webp);base64,|\/demo-hotels\/)/.test(cover.url||"") ))throw Error("Unsupported cover image source");for(const field of ["sourceUrl","licenseUrl"])if(cover[field]&&!/^https:\/\//.test(cover[field]))throw Error("Image attribution URLs must use HTTPS");}
 const ids=new Set(state.reservations.map(r=>r.id));
 for(const payment of state.payments){if(!ids.has(payment.reservationId)||payment.simulated!==true||!Number.isFinite(payment.amount)||payment.amount<0)throw Error('Invalid simulated payment');}
 for(const folio of state.folios){if(!ids.has(folio.reservationId)||!Number.isFinite(folio.discount)||folio.discount<0||(folio.taxRate!==undefined&&(!Number.isFinite(folio.taxRate)||folio.taxRate<0||folio.taxRate>50))||folio.charges.some(c=>!Number.isFinite(c.quantity)||!Number.isFinite(c.rate)||c.rate<0||c.quantity<0))throw Error('Invalid folio');}
 for(const channel of state.channelManager.channels)if(!channel.simulated||channel.connected!==false)throw Error('Demo channels must remain simulated');
 model.financials(state);model.inventory(state);
 if(state.folios.some(f=>!Number.isFinite(f.total)||f.total<0||f.paid<0||f.paid>f.total+.01))throw Error('Payments/refunds do not reconcile to folio totals');
 if(state.dailyInventory.some(i=>i.available<0))throw Error('Negative inventory');
 return state;
}
async function project(client,id,state){
 for(const table of ['friday_demo_record','friday_demo_reservation','friday_demo_room','friday_demo_guest','friday_demo_room_type'])await client.query(`DELETE FROM ${table} WHERE property_id=$1`,[id]);
 for(const row of state.roomTypes)await client.query('INSERT INTO friday_demo_room_type VALUES($1,$2,$3)',[id,row.id,JSON.stringify(row)]);
 for(const row of state.rooms)await client.query('INSERT INTO friday_demo_room VALUES($1,$2,$3,$4)',[id,row.number,row.roomTypeId,JSON.stringify(row)]);
 for(const row of state.guests)await client.query('INSERT INTO friday_demo_guest VALUES($1,$2,$3)',[id,row.id,JSON.stringify(row)]);
 for(const row of state.reservations)await client.query('INSERT INTO friday_demo_reservation VALUES($1,$2,$3,$4,$5)',[id,row.id,row.guestId,row.room,JSON.stringify(row)]);
 for(const kind of ['ratePlans','folios','payments','invoices','dailyInventory','housekeeping','requests','tasks','enquiries','groups','roomBlocks','roomChanges','communications'])for(const row of state[kind]||[])await client.query('INSERT INTO friday_demo_record VALUES($1,$2,$3,$4,$5)',[id,kind,row.id,row.reservationId||null,JSON.stringify(row)]);
 for(const [kind,rows]of [['channels',state.channelManager.channels],['syncEvents',state.channelManager.syncEvents]])for(const row of rows)await client.query('INSERT INTO friday_demo_record VALUES($1,$2,$3,NULL,$4)',[id,kind,row.id,JSON.stringify(row)]);
}
async function read(db,id){const found=await db.query('SELECT state_json,version FROM friday_demo_workspace WHERE property_id=$1',[id]);if(!found.rows[0])return null;return{state:require('./sample-labels').normalizeLabels(JSON.parse(found.rows[0].state_json)),version:found.rows[0].version};}
async function save(db,id,state,version,actor){await assertWritableWorkspace(db,id);validate(state);return db.withTransaction(async client=>{
 const current=(await client.query('SELECT version,state_json FROM friday_demo_workspace WHERE property_id=$1',[id])).rows[0];
 if(!current||current.version!==version){const error=Error('This workspace changed. Reload before saving again.');error.status=409;throw error;}
 state.property.id=id;state.demo={seed:model.SEED,referenceDate:model.START,disclaimer:'SAMPLE DATA — NOT AFFILIATED WITH TAJ. Operational records are fictional.'};
 await project(client,id,state);
 await client.query('UPDATE friday_demo_workspace SET state_json=$1,version=version+1 WHERE property_id=$2',[JSON.stringify(state),id]);
 await client.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[id,actor,'Workspace saved',JSON.stringify({version:version+1,changedSections:Object.keys(state).filter(key=>JSON.stringify(state[key])!==JSON.stringify(JSON.parse(current.state_json)[key]))})]);
 return{state,version:version+1};
 });}
function stats(state){
 const date=state.demo.referenceDate;
 return{...state.metrics,demo:true,status:'Active',disclaimer:'Sample data — not affiliated with Taj',cover:state.property.cover||null,
  currency:state.property.currency||'INR',
  maintenanceRooms:new Set(state.roomBlocks.filter(b=>b.kind==='Maintenance'&&model.includesDay(b,date)).map(b=>b.room)).size,
  openRequests:state.requests.filter(r=>r.status==='Open').length,
 };
}
module.exports={schema,assertLocal,assertWritableWorkspace,validate,project,read,save,stats};
