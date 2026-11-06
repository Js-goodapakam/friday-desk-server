const {modules,features,roles}=require('./access-matrix');
function catalogue(req,res){
 // Local review only: definitions are not claims about effective staff access.
 if(process.env.FRIDAY_LOCAL_DEV!=='1'||process.env.FRIDAY_ENTERPRISE_REVIEW!=='1')return res.status(404).json({error:'Not available.'});
 if(!req.user?.id)return res.status(401).json({error:'Sign in to continue.'});
 if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator review required.'});
 res.setHeader('Cache-Control','no-store');
 return res.json({version:1,mode:'specification_review',modules,features,roles:roles.map(([key,name])=>({key,name})),notice:'Approved matrix. Effective access rollout is pending.',restrictedPolicy:'deny_until_scoped_policy'});
}
module.exports={catalogue};
