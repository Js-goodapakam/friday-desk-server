const {test}=require('node:test'),assert=require('node:assert/strict');
const {ownerRoutes}=require('./owner-routes');
const response=()=>({code:200,status(c){this.code=c;return this;},json(body){this.body=body;return this;}});
test('owner administration denies non-managers before reading data',async()=>{
 const old=process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_LOCAL_DEV='1';try{const db={file:'friday-development.sqlite',query(){throw Error('must not read');}},res=response();await ownerRoutes(db).get({user:{role:'HOUSEKEEPING'}},res);assert.equal(res.code,403);}finally{if(old===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=old;}
});
test('managers cannot create login accounts',async()=>{
 const old=process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_LOCAL_DEV='1';try{const res=response();await ownerRoutes({file:'friday-development.sqlite'}).staff({user:{role:'MANAGER'},body:{}},res);assert.equal(res.code,403);}finally{if(old===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=old;}
});
test('production owner read uses quoted identifiers and tolerates unapplied optional tables without DDL',async()=>{
 const oldLocal=process.env.FRIDAY_LOCAL_DEV,oldEnv=process.env.NODE_ENV;delete process.env.FRIDAY_LOCAL_DEV;process.env.NODE_ENV='production';const calls=[];
 const db={async query(sql){calls.push(sql);if(/CREATE|ALTER|INSERT|UPDATE|DELETE/.test(sql))throw Error('read must not write');if(sql==='SELECT * FROM property')return {rows:[]};if(sql.includes('FROM "user"'))return {rows:[{id:1,propertyId:3,name:'Owner',email:'owner@example.test',role:'ADMIN',isActive:true}]};const e=Error('missing optional table');e.code='42P01';throw e;}};
 try{const res=response();await ownerRoutes(db).get({user:{id:1,role:'ADMIN',propertyId:3}},res);assert.equal(res.code,200);assert.equal(res.body.settings.organizationName,'Taj Hospitality Workspace');assert.equal(res.body.users.length,1);assert.ok(calls.some(sql=>sql.includes('"propertyId"')&&sql.includes('"isActive"')));assert.ok(!calls.some(sql=>/CREATE|ALTER/.test(sql)));}finally{if(oldLocal===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=oldLocal;if(oldEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldEnv;}
});
