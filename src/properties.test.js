const {test}=require('node:test');
const assert=require('node:assert/strict');
const {propertyRoutes,canAccess}=require('./properties');
const user={id:1,propertyId:10,role:'ADMIN'};
function response(){return{statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
test('assigned property and explicit memberships grant access; others do not',async()=>{
 const db={query:async(sql,args)=>({rows:args[1]===20?[{property_id:20}]:[]})};
 assert.equal(await canAccess(db,user,10),true);assert.equal(await canAccess(db,user,20),true);assert.equal(await canAccess(db,user,30),false);
});
test('property listing excludes duplicates and uses the authenticated user',async()=>{
 const db={query:async(sql,args)=>{if(sql.includes('JOIN')){assert.deepEqual(args,[1]);return{rows:[{id:10,name:'Hotel A'},{id:20,name:'Hotel B'}]};}assert.deepEqual(args,[10]);return{rows:[{id:10,name:'Hotel A'}]};}};
 const res=response();await propertyRoutes(db).list({user},res);assert.deepEqual(res.body.properties.map(p=>p.id),[10,20]);
});
test('unassigned property selection and context headers are rejected',async()=>{
 const routes=propertyRoutes({query:async()=>({rows:[]})});
 let res=response();await routes.select({user:{...user},params:{id:'99'}},res);assert.equal(res.statusCode,403);
 res=response();await routes.scope({user:{...user},headers:{'x-friday-property-id':'99'}},res,()=>assert.fail('unauthorized scope'));assert.equal(res.statusCode,403);
});
test('creating properties requires admin permission and valid details',async()=>{
 const routes=propertyRoutes({query:async()=>{throw Error('Should not query');}});
 let res=response();await routes.create({user:{...user,role:'FRONT_DESK'},body:{name:'Hotel',city:'City'}},res);assert.equal(res.statusCode,403);
 res=response();await routes.create({user,body:{name:'',city:''}},res);assert.equal(res.statusCode,400);
 res=response();await routes.create({user,body:{name:'Hotel',city:'City',timezone:'Invalid/Zone'}},res);assert.equal(res.statusCode,400);
});
