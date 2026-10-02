import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import {rateLimit} from 'express-rate-limit';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {config,labels} from './config.js';
import {UserError,parseLeaveDate} from './domain.js';
const nonce=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const page=v=>Math.max(0,Math.min(10000,parseInt(v,10)||0));
const search=v=>'%'+String(v||'').slice(0,100)+'%';
const matches=(person,query)=>!query||[person.ic_name,person.username,person.user_id,person.hired_by_name].join(' ').toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl'));
export async function sessionKey(db){
 await db.q("INSERT INTO bot_settings(key,value) VALUES('web_session_key',$1) ON CONFLICT DO NOTHING",[randomBytes(64).toString('hex')]);
 return (await db.q("SELECT value FROM bot_settings WHERE key='web_session_key'")).rows[0].value;
}
export function web(db,svc,discord,env,ready){
 const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https://cdn.discordapp.com'],connectSrc:["'self'"],formAction:["'self'"],upgradeInsecureRequests:env.production?[]:null}}}));
 app.use(express.json({limit:'16kb'}));
 app.get('/healthz',(req,res)=>res.status(ready()?200:503).json({ready:ready()}));
 const Store=connectPg(session);
 app.use(session({store:new Store({pool:db.pool,createTableIfMissing:true,pruneSessionInterval:false}),name:'bs.sid',secret:env.sessionSecret,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:env.production,sameSite:'lax',maxAge:8*3600000}}));
 app.use(['/api','/auth'],(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const authLimit=rateLimit({windowMs:900000,limit:30,legacyHeaders:false,standardHeaders:'draft-8'});
 const save=req=>new Promise((ok,no)=>req.session.save(e=>e?no(e):ok()));
 app.get('/auth/discord',authLimit,async(req,res)=>{
  if(!env.clientSecret||!env.publicUrl)return res.redirect('/?error=setup');
  req.session.oauthState=nonce();req.session.oauthStarted=Date.now();await save(req);
  res.redirect('https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:env.clientId,redirect_uri:env.publicUrl+'/auth/callback',response_type:'code',scope:'identify',state:req.session.oauthState}));
 });
 app.get('/auth/callback',authLimit,async(req,res)=>{
  const valid=equal(req.query.state,req.session.oauthState)&&Date.now()-req.session.oauthStarted<600000;
  delete req.session.oauthState;delete req.session.oauthStarted;await save(req);
  if(!valid||typeof req.query.code!=='string')return res.redirect('/?error=login');
  try{
   const response=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.clientId,client_secret:env.clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:env.publicUrl+'/auth/callback'}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('oauth');const token=await response.json();
   const profile=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
   if(!profile.ok)throw new Error('profile');const user=await profile.json();await svc.authorize(user.id);
   await new Promise((ok,no)=>req.session.regenerate(e=>e?no(e):ok()));
   req.session.user={id:user.id,name:user.global_name||user.username,avatar_url:user.avatar?`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`:null};req.session.csrf=nonce();await save(req);res.redirect('/');
  }catch{res.redirect('/?error=access');}
 });
 app.use('/api',rateLimit({windowMs:60000,limit:120,legacyHeaders:false,standardHeaders:'draft-8'}),async(req,res,next)=>{
  if(!req.session.user)return res.status(401).json({error:'Zaloguj się przez Discord.'});
  try{await svc.authorize(req.session.user.id);}catch{return res.status(403).json({error:'Brak dostępu do panelu. Wymagana aktualna ranga zarządu.'});}
  if(!['GET','HEAD'].includes(req.method)&&(!equal(req.get('X-CSRF-Token'),req.session.csrf)||req.get('Origin')!==env.publicUrl))return res.status(403).json({error:'Odśwież stronę i ponów działanie.'});
  next();
 });
 app.get('/api/me',(req,res)=>res.json({user:req.session.user,csrf:req.session.csrf,labels,ranks:config.ranks,guildId:env.guildId}));
 app.post('/api/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('bs.sid');res.json({ok:true});}));
 app.get('/api/overview',async(req,res)=>{
  const results=await Promise.all([
   db.q("SELECT count(*)::int AS count FROM employees WHERE status='active'"),
   db.q("SELECT count(*)::int AS count FROM leaves WHERE status IN ('active','starting','scheduled')"),
   db.q("SELECT count(*)::int AS count FROM logs WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'"),
   db.q("SELECT count(*)::int AS count FROM logs l LEFT JOIN reported_rewards r ON r.log_id=l.id LEFT JOIN reward_reports rr ON rr.cutoff=r.cutoff WHERE ((l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4 AND (l.details->>'after')::int=0) OR (l.category='kolo' AND l.status='success' AND coalesce(l.details->>'prize','')<>'')) AND rr.settled_at IS NULL"),
   db.q('SELECT * FROM logs ORDER BY created_at DESC,id DESC LIMIT 8'),
   db.q("SELECT to_char(d,'DD.MM') AS day,count(l.id)::int AS count FROM generate_series((now() AT TIME ZONE 'Europe/Warsaw')::date-6,(now() AT TIME ZONE 'Europe/Warsaw')::date,interval '1 day') d LEFT JOIN logs l ON (l.created_at AT TIME ZONE 'Europe/Warsaw')::date=d::date GROUP BY d ORDER BY d"),
   svc.companyMembers?svc.companyMembers().catch(()=>null):Promise.resolve(null)
  ]);res.json({employees:results[6]?.length??results[0].rows[0].count,leaves:results[1].rows[0].count,activityCount:results[2].rows[0].count,rewards:results[3].rows[0].count,activity:results[4].rows,chart:results[5].rows,ready:ready()});
 });
 app.get('/api/employees',async(req,res)=>{
  const dismissed=req.query.status==='dismissed';
  if(dismissed||!svc.companyMembers){
   const r=await db.q(`SELECT e.*,l.ends_at,l.status AS leave_status FROM employees e LEFT JOIN leaves l ON l.user_id=e.user_id AND l.status IN ('active','scheduled','starting','ending') WHERE e.status=$1 AND concat_ws(' ',e.ic_name,e.username,e.user_id,e.hired_by_name) ILIKE $2 ORDER BY e.ic_name,e.user_id LIMIT 31 OFFSET $3`,[dismissed?'dismissed':'active',search(req.query.q),page(req.query.page)*30]);return res.json({items:r.rows.slice(0,30),more:r.rows.length>30,source:'history'});
  }
  const [live,stored,leaves,courses]=await Promise.all([svc.companyMembers(),db.q("SELECT * FROM employees WHERE status='active'"),db.q("SELECT user_id,ends_at,status AS leave_status FROM leaves WHERE status IN ('active','scheduled','starting','ending')"),db.q('SELECT user_id,courses_completed,spins_available FROM course_progress')]);
  const byId=new Map(stored.rows.map(e=>[e.user_id,e])),leaveById=new Map(leaves.rows.map(l=>[l.user_id,l])),courseById=new Map(courses.rows.map(c=>[c.user_id,c]));
  const all=live.map(m=>({...m,...byId.get(m.user_id),...m,status:'active',...(leaveById.get(m.user_id)||{}),...(courseById.get(m.user_id)||{courses_completed:0,spins_available:0})})).filter(m=>matches(m,String(req.query.q||'').slice(0,100)));
  const offset=page(req.query.page)*30;res.json({items:all.slice(offset,offset+30),more:all.length>offset+30,source:'discord',total:all.length});
 });
 app.get('/api/employees/:id',async(req,res)=>{
  let employee=(await db.q('SELECT * FROM employees WHERE user_id=$1',[req.params.id])).rows[0];
  if(svc.companyMembers){const live=(await svc.companyMembers()).find(m=>m.user_id===req.params.id);if(live)employee={...live,...employee,...live,status:'active'};}
  if(!employee)return res.status(404).json({error:'Nie znaleziono pracownika.'});
  const [logs,leave,courses]=await Promise.all([db.q('SELECT * FROM logs WHERE target_id=$1 ORDER BY created_at DESC LIMIT 25',[req.params.id]),db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('active','scheduled','starting','ending')",[req.params.id]),db.q('SELECT * FROM course_progress WHERE user_id=$1',[req.params.id])]);res.json({employee,logs:logs.rows,leave:leave.rows[0],courses:courses.rows[0]||{courses_completed:0,spins_available:0,spins_used:0}});
 });
 app.get('/api/logs',async(req,res)=>{
  const r=await db.q("SELECT * FROM logs WHERE ($1='' OR category=$1) AND concat_ws(' ',actor_id,actor_name,target_id,target_name,reason) ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET $3",[Object.hasOwn(labels,req.query.category||'')?req.query.category:'',search(req.query.q),page(req.query.page)*30]);res.json({items:r.rows.slice(0,30),more:r.rows.length>30});
 });
 app.get('/api/leaves',async(req,res)=>{
  const r=await db.q("SELECT * FROM leaves WHERE ($1='all' OR status IN ('active','scheduled','starting','ending')) AND ic_name ILIKE $2 ORDER BY created_at DESC LIMIT 31 OFFSET $3",[req.query.status==='all'?'all':'active',search(req.query.q),page(req.query.page)*30]);res.json({items:r.rows.slice(0,30),more:r.rows.length>30});
 });
 app.get('/api/rewards',async(req,res)=>{
  const items=(await db.q("SELECT l.target_id,coalesce(e.ic_name,max(l.target_name)) AS name,count(*)::int AS count,'plus' AS kind,NULL::text AS prize,min(l.created_at) AS created_at FROM logs l LEFT JOIN employees e ON e.user_id=l.target_id LEFT JOIN reported_rewards r ON r.log_id=l.id LEFT JOIN reward_reports rr ON rr.cutoff=r.cutoff WHERE l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4 AND (l.details->>'after')::int=0 AND rr.settled_at IS NULL GROUP BY l.target_id,e.ic_name UNION ALL SELECT l.target_id,coalesce(e.ic_name,l.target_name) AS name,1::int AS count,'wheel' AS kind,l.details->>'prize' AS prize,l.created_at FROM logs l LEFT JOIN employees e ON e.user_id=l.target_id LEFT JOIN reported_rewards r ON r.log_id=l.id LEFT JOIN reward_reports rr ON rr.cutoff=r.cutoff WHERE l.category='kolo' AND l.status='success' AND coalesce(l.details->>'prize','')<>'' AND rr.settled_at IS NULL ORDER BY created_at" )).rows;
  res.json({items});
 });
 app.get('/api/settings',async(req,res)=>res.json({hidden:(await db.q("SELECT value FROM bot_settings WHERE key='commands_hidden'")).rows[0]?.value==='true',ready:ready(),channels:{...config.actionChannels,urlop:'1502336468016828567',logs:config.logs},staff:config.staff}));
 app.post('/api/settings/commands',async(req,res)=>{if(typeof req.body.hidden!=='boolean')throw new UserError('Wybierz widoczność.');await discord.setVisibility(req.body.hidden);res.json({ok:true});});
 app.post('/api/actions',rateLimit({windowMs:60000,limit:20}),async(req,res)=>{
  const {kind,targetId,reason,icName,endsAt,requestId}=req.body;
  if(!Object.hasOwn(labels,kind)||!/^\d{17,20}$/.test(targetId||'')||! /^[a-f0-9-]{36}$/i.test(requestId||''))throw new UserError('Wybierz poprawne działanie i osobę.');
  const channelId=config.actionChannels[kind]||(['urlop','zdejmijurlop'].includes(kind)?'1502336468016828567':config.logs);
  const result=await svc.run({kind,actorId:req.session.user.id,targetId,reason,icName,endsAt:kind==='urlop'?parseLeaveDate(endsAt,{end:true}):undefined,channelId,requestId:'web:'+requestId});
  await svc.notify(channelId,targetId,result.title,[result.description,...Object.entries(result.fields||{}).map(([k,v])=>`**${k}:** ${v}`)].filter(Boolean).join('\n'));
  res.json({ok:true,title:result.title});
 });
 app.use('/api',(req,res)=>res.status(404).json({error:'Nie znaleziono.'}));
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
 app.use((err,req,res,next)=>{console.error('Panel WWW',err.code||err.name);res.status(err instanceof UserError?400:500).json({error:err instanceof UserError?err.message:'Nie udało się wykonać operacji. Sprawdź historię przed ponowieniem.'});});
 return app;
}
