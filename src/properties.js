const { randomBytes } = require('node:crypto');

async function canAccess(db, user, id) {
  if(process.env.FRIDAY_LOCAL_DEV==='1'&&db.file){const property=(await db.query('SELECT code FROM property WHERE id=$1',[id])).rows[0];if(!property||!require('./demo-data').hotels.some(h=>h[0]===property.code))return false;}
  if (Number(user.propertyId) === Number(id)) return true;
  try {
    const result = await db.query('SELECT property_id FROM friday_property_access WHERE user_id=$1 AND property_id=$2',[user.id,id]);
    return result.rows.length > 0;
  } catch(error) { if (error.code==='42P01') return false; throw error; }
}

function propertyRoutes(db) {
  return {
    list: async(req,res)=>{
      try {
        const primary=await db.query('SELECT * FROM "property" WHERE id=$1',[req.user.homePropertyId || req.user.propertyId]);
        let additional=[];
        try { additional=(await db.query('SELECT p.* FROM "property" p JOIN friday_property_access a ON a.property_id=p.id WHERE a.user_id=$1 ORDER BY p.name',[req.user.id])).rows; }
        catch(error){if(error.code!=='42P01')throw error;}
        let properties=[...new Map([...primary.rows,...additional].map(p=>[p.id,p])).values()];
        if(process.env.FRIDAY_LOCAL_DEV==='1')properties=properties.filter(p=>require('./demo-data').hotels.some(h=>h[0]===p.code));
        for(const p of properties){const found=await require("./demo-store").read(db,p.id).catch(()=>null);if(found)Object.assign(p,require("./demo-store").stats(found.state));}
        res.json({properties});
      }catch{res.status(503).json({error:'Unable to load your properties. Please try again.'});}
    },
    select: async(req,res)=>{
      try {
        const id=Number(req.params.id);
        if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid property.'});
        if(!await canAccess(db,{...req.user,propertyId:req.user.homePropertyId || req.user.propertyId},id))return res.status(403).json({error:'You do not have access to this property.'});
        const result=await db.query('SELECT * FROM "property" WHERE id=$1',[id]);
        if(!result.rows[0])return res.status(404).json({error:'Property not found.'});
        const property=result.rows[0];const found=await require("./demo-store").read(db,id).catch(()=>null);if(found)Object.assign(property,require("./demo-store").stats(found.state));
        res.json({property});
      }catch{res.status(503).json({error:'Unable to open this property.'});}
    },
    create: async(req,res)=>{
      if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});
      const {name,city,state,country,timezone}=req.body || {};
      if(typeof name!=='string'||name.trim().length<2||name.length>120||typeof city!=='string'||!city.trim()||city.length>100)return res.status(400).json({error:'Enter a property name and city.'});
      if([state,country,timezone].some(v=>v!==undefined&&(typeof v!=='string'||v.length>100)))return res.status(400).json({error:'Invalid property details.'});
      try {new Intl.DateTimeFormat('en',{timeZone:timezone || 'Asia/Kolkata'});}catch{return res.status(400).json({error:'Choose a valid timezone.'});}
      try {
        const property=await db.withTransaction(async client=>{
          const result=await client.query('INSERT INTO "property" (name,code,city,state,country,timezone,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *',[name.trim(),`FR-${randomBytes(6).toString('hex').toUpperCase()}`,city.trim(),state?.trim() || null,country?.trim() || 'India',timezone || 'Asia/Kolkata']);
          const property=result.rows[0];
          await client.query('INSERT INTO friday_property_access (user_id,property_id) VALUES ($1,$2)',[req.user.id,property.id]);
          return property;
        });
        res.status(201).json({property});
      }catch{res.status(503).json({error:'Property creation is unavailable. Check that the property access migration has been applied.'});}
    },
    scope: async(req,res,next)=>{
      req.user.homePropertyId=req.user.propertyId;
      const selected=req.headers['x-friday-property-id'];
      if(!selected)return next();
      const id=Number(selected);
      if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid property context.'});
      try {
        if(!await canAccess(db,req.user,id))return res.status(403).json({error:'You do not have access to this property.'});
        req.user.propertyId=id;next();
      }catch{res.status(503).json({error:'Unable to verify property access.'});}
    }
  };
}
module.exports={propertyRoutes,canAccess};
