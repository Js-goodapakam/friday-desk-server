function isWorkspaceWrite(req){return req.method==='PUT'&&/^\/api\/properties\/[1-9]\d*\/workspace\/?$/.test(req.path);}
function createParsers(express,local=false){
 const standard=express.json({limit:local?'12mb':'256kb'});
 return {
  general(req,res,next){if(isWorkspaceWrite(req))return next();return standard(req,res,next);},
  workspace:express.json({limit:local?'12mb':'4mb'}),
  errors(error,_req,res,next){if(error.type==='entity.too.large')return res.status(413).json({error:'Workspace save is too large. Reduce attached images and try again.'});if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON request.'});return next(error);}
 };
}
module.exports={createParsers,isWorkspaceWrite};
