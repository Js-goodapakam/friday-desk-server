const {test}=require('node:test'),assert=require('node:assert/strict'),{catalogue}=require('./access-catalogue');
const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){}});
test('matrix review cannot be exposed by a production flag',()=>{
 const previous={local:process.env.FRIDAY_LOCAL_DEV,review:process.env.FRIDAY_ENTERPRISE_REVIEW};
 try{delete process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_ENTERPRISE_REVIEW='1';const res=response();catalogue({user:{id:1,role:'ADMIN'}},res);assert.equal(res.code,404);}finally{for(const [key,value]of [['FRIDAY_LOCAL_DEV',previous.local],['FRIDAY_ENTERPRISE_REVIEW',previous.review]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('local catalogue is administrator-only and labelled as review',()=>{
 const previous={local:process.env.FRIDAY_LOCAL_DEV,review:process.env.FRIDAY_ENTERPRISE_REVIEW};
 try{process.env.FRIDAY_LOCAL_DEV='1';process.env.FRIDAY_ENTERPRISE_REVIEW='1';const denied=response();catalogue({user:{id:2,role:'FRONT_DESK'}},denied);assert.equal(denied.code,403);const res=response();catalogue({user:{id:1,role:'ADMIN'}},res);assert.equal(res.body.features.length,311);assert.equal(res.body.mode,'specification_review');}finally{for(const [key,value]of [['FRIDAY_LOCAL_DEV',previous.local],['FRIDAY_ENTERPRISE_REVIEW',previous.review]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
