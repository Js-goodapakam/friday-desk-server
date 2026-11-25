const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const { managedAccess } = require('./managed-access');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, encoded) {
  try {
    const [salt, hash] = encoded.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieToken = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('friday_session='))?.slice(15) || '';
const bearerToken = req => {
  const value = req.get?.('authorization') || req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || '';
};

function supabaseAuthConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const hosted = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
  const disposable = process.env.NODE_ENV === 'test' && process.env.ENGAGE_LOCAL_SUPABASE_ACCEPTANCE === '1' &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(url);
  return (hosted || disposable) && key ? { url, key } : null;
}

function createAuth(db, options = {}) {
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const origin = options.origin || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const failures = new Map();
  const dummy = hashPassword(randomBytes(32).toString('hex'));
  const cookie = (res, token, seconds) => res.setHeader('Set-Cookie', `friday_session=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  const safeUser = row => ({id:row.id,name:row.name,email:row.email,role:row.role,propertyId:row.propertyId});
  const issueSession = async (res, user, remember = false) => {
    const access = await managedAccess(db, user.propertyId);
    if (access?.status === 'suspended') return res.status(403).json({error:'This workspace is suspended.'});
    const token = randomBytes(32).toString('hex');
    const seconds = remember === true ? 604800 : 28800;
    await db.query('INSERT INTO friday_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)',[digest(token),user.id,new Date(Date.now()+seconds*1000)]);
    cookie(res,token,seconds);
    return res.json({user:safeUser(user)});
  };
  const unavailable = (res,error,operation) => {
    const rawCode=typeof error?.code==='string'?error.code:'';
    const code=/^[A-Z0-9_]{2,32}$/.test(rawCode)?rawCode:'UNKNOWN';
    const reason=code==='42P01'?'missing_table':code==='42703'?'missing_column':code==='28P01'?'database_credentials':code==='3D000'?'database_not_found':['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','EHOSTUNREACH'].includes(code)?'database_connection':'database_operation';
    // Never log exception messages, SQL, connection strings, credentials or request bodies.
    console.error(JSON.stringify({event:'friday_auth_unavailable',operation,code,reason}));
    return res.status(503).json({error:'Authentication is unavailable. Ask your administrator to configure the server and provision your account.'});
  };
  const checkOrigin = (req,res,next) => {
    const localOrigin = !secure && ['http://localhost:5173','http://127.0.0.1:5173',...(process.env.FRIDAY_LOCAL_DEV === '1' ? ['http://localhost:5174','http://127.0.0.1:5174'] : [])].includes(req.headers.origin);
    if (req.headers.origin && req.headers.origin !== origin && !localOrigin) return res.status(403).json({error:'Request origin is not allowed.'});
    next();
  };
  const login = async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    const {email,password,remember} = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || password.length < 1 || password.length > 256 || email.length > 254) return res.status(400).json({error:'Enter your email and password.'});
    const key = `${req.ip}:${email.trim().toLowerCase()}`;
    const now = Date.now();
    const count = failures.get(key);
    if (count && count.until > now && count.attempts >= 5) return res.status(429).json({error:'Too many unsuccessful attempts. Try again in 15 minutes.'});
    try {
      const result = await db.query('SELECT u.*, c.password_hash FROM "user" u JOIN friday_credentials c ON c.user_id=u.id WHERE LOWER(u.email)=$1 LIMIT 1',[email.trim().toLowerCase()]);
      const user = result.rows[0];
      const valid = verifyPassword(password,user?.password_hash || dummy);
      if (!user || !valid || !user.isActive) {
        failures.set(key,{attempts:(count?.until > now ? count.attempts : 0)+1,until:now+900000});
        if (failures.size>10000) for (const [k,v] of failures) if (v.until<now) failures.delete(k);
        return res.status(401).json({error:'Incorrect email or password.'});
      }
      failures.delete(key);
      return issueSession(res,user,remember);
    } catch(error) { unavailable(res,error,'login'); }
  };
  // The browser proves identity to Supabase; this server then verifies the
  // access token with Supabase and resolves the immutable auth user ID. Email
  // is deliberately not used as the link key.
  const supabaseSessionFromToken = async (req,res,token) => {
    res.setHeader('Cache-Control','no-store');
    const config = supabaseAuthConfig();
    if (!config) return res.status(503).json({error:'Supabase authentication is not configured.'});
    if (!token || token.length > 8192) return res.status(401).json({error:'A Supabase access token is required.'});
    try {
      const verified = await fetch(config.url + '/auth/v1/user', { headers: { apikey: config.key, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
      if (!verified.ok) return res.status(401).json({error:'Your sign-in token is invalid or expired.'});
      const identity = await verified.json();
      if (!identity?.id || !identity.email_confirmed_at) return res.status(403).json({error:'Verify your email before accessing Engage Stay.'});
      const result = await db.query(
        `SELECT u.* FROM friday_auth_identity i JOIN "user" u ON u.id=i.user_id
          WHERE i.auth_user_id=$1 AND u."isActive"=true AND u."propertyId"=i.property_id LIMIT 1`,
        [identity.id]
      );
      const user = result.rows[0];
      if (!user) return res.status(403).json({error:'Your account is awaiting Owner approval or has not been provisioned.'});
      return issueSession(res,user,req.body?.remember === true);
    } catch(error) { return unavailable(res,error,'supabase_session'); }
  };
  const supabaseSession = (req,res) => supabaseSessionFromToken(req,res,bearerToken(req));
  const supabaseLogin = async (req,res) => {
    const { email, password } = req.body || {};
    const config = supabaseAuthConfig();
    if (!config) return res.status(503).json({error:'Supabase authentication is not configured.'});
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || password.length > 256) return res.status(400).json({error:'Enter your email and password.'});
    try {
      const signedIn = await fetch(config.url + '/auth/v1/token?grant_type=password', { method:'POST', headers:{apikey:config.key,'Content-Type':'application/json'}, body:JSON.stringify({email:email.trim().toLowerCase(),password}), signal:AbortSignal.timeout(8000) });
      if (!signedIn.ok) return res.status(401).json({error:'Incorrect email or password.'});
      const payload = await signedIn.json();
      if (typeof payload?.access_token !== 'string') return res.status(401).json({error:'Incorrect email or password.'});
      return supabaseSessionFromToken(req,res,payload.access_token);
    } catch(error) { return unavailable(res,error,'supabase_login'); }
  };
  const requireSession = async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    const token = cookieToken(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({error:'Sign in to continue.'});
    try {
      const result=await db.query('SELECT u.* FROM friday_sessions s JOIN "user" u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u."isActive"=true',[digest(token)]);
      if (!result.rows[0]) return res.status(401).json({error:'Your session has expired. Sign in again.'});
      const user = result.rows[0];
      const access = await managedAccess(db, user.propertyId);
      if (access?.status === 'suspended') {
        return res.status(403).json({error:'This workspace is suspended.'});
      }
      req.user=safeUser(user); next();
    } catch(error) { unavailable(res,error,'session'); }
  };
  const logout = async (req,res) => {
    try { await db.query('DELETE FROM friday_sessions WHERE token_hash=$1',[digest(cookieToken(req))]); cookie(res,'',0); res.json({success:true}); }
    catch(error) { unavailable(res,error,'logout'); }
  };
  return {login,supabaseLogin,supabaseSession,requireSession,logout,checkOrigin};
}
module.exports={createAuth,hashPassword,verifyPassword};
