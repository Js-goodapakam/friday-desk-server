const {test}=require('node:test'),assert=require('node:assert/strict');
const {ownerRoutes}=require('./owner-routes');
const response=()=>({code:200,status(c){this.code=c;return this;},json(body){this.body=body;return this;}});
test('owner administration denies non-managers before reading data',async()=>{
 const old=process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_LOCAL_DEV='1';try{const db={file:'friday-development.sqlite',query(){throw Error('must not read');}},res=response();await ownerRoutes(db).get({user:{role:'HOUSEKEEPING'}},res);assert.equal(res.code,403);}finally{if(old===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=old;}
});
test('managers cannot create login accounts',async()=>{
 const old=process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_LOCAL_DEV='1';try{const res=response();await ownerRoutes({file:'friday-development.sqlite'}).staff({user:{role:'MANAGER'},body:{}},res);assert.equal(res.code,403);}finally{if(old===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=old;}
});
