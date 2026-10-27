const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');

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

function createAuth(db, options = {}) {
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const origin = options.origin || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const failures = new Map();
  const dummy = hashPassword(randomBytes(32).toString('hex'));
  const cookie = (res, token, seconds) => res.setHeader('Set-Cookie', `friday_session=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
  const safeUser = row => ({id:row.id,name:row.name,email:row.email,role:row.role,propertyId:row.propertyId});
  const unavailable = res => res.status(503).json({error:'Authentication is unavailable. Ask your administrator to configure the server and provision your account.'});
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
      const token = randomBytes(32).toString('hex');
      const seconds = remember === true ? 604800 : 28800;
      await db.query('INSERT INTO friday_sessions (token_hash,user_id,expires_at) VALUES ($1,$2,$3)',[digest(token),user.id,new Date(now+seconds*1000)]);
      cookie(res,token,seconds);
      res.json({user:safeUser(user)});
    } catch { unavailable(res); }
  };
  const requireSession = async (req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    const token = cookieToken(req);
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({error:'Sign in to continue.'});
    try {
      const result=await db.query('SELECT u.* FROM friday_sessions s JOIN "user" u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u."isActive"=true',[digest(token)]);
      if (!result.rows[0]) return res.status(401).json({error:'Your session has expired. Sign in again.'});
      req.user=safeUser(result.rows[0]); next();
    } catch { unavailable(res); }
  };
  const logout = async (req,res) => {
    try { await db.query('DELETE FROM friday_sessions WHERE token_hash=$1',[digest(cookieToken(req))]); cookie(res,'',0); res.json({success:true}); }
    catch { unavailable(res); }
  };
  return {login,requireSession,logout,checkOrigin};
}
module.exports={createAuth,hashPassword,verifyPassword};
