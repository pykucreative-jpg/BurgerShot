// Isolated local visual preview. Never imported by the production entrypoint.
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import {web} from '../src/web.js';
const pg=new PGlite();await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));await pg.exec(await readFile(new URL('../node_modules/connect-pg-simple/table.sql',import.meta.url),'utf8'));
const q=async(s,p=[])=>{const r=await pg.query(s,p);return {...r,rowCount:r.affectedRows??r.rows.length};};
const db={q,pool:{query:q}};const people=['Alex Morgan','Jamie Rivera','Taylor Brooks','Casey Parker','Jordan Blake','Riley Cooper'];
for(let i=0;i<people.length;i++)await q("INSERT INTO employees(user_id,username,ic_name,rank,plus_count,minus_count,hired_by_name,hired_at) VALUES($1,$2,$3,$4,$5,$6,'Zarząd',now()-interval '10 days')",['22222222222222222'+i,people[i].toLowerCase().replace(' ','.'),people[i],['Kierownik zmiany','Doświadczony Specjalista','Starszy pracownik','Pracownik','Nowicjusz','Rekrut'][i],i%5,i%2]);
for(let i=0;i<12;i++)await q("INSERT INTO logs(category,actor_id,actor_name,target_id,target_name,reason,status,created_at) VALUES($1,'111111111111111111','Alex Morgan',$2,$3,$4,'success',now()-($5||' hours')::interval)",[['plus','awans','degrad','urlop'][i%4],'22222222222222222'+i%6,people[i%6],['Pomoc podczas wieczornej zmiany','Wyrobienie normy awansowej','Brak wyrobionej normy','Zatwierdzony odpoczynek'][i%4],String(i*7)]);
const secret=randomBytes(64).toString('hex'),sid=randomBytes(24).toString('hex');
await q("INSERT INTO session(sid,sess,expire) VALUES($1,$2,now()+interval '8 hours')",[sid,JSON.stringify({cookie:{maxAge:28800000,httpOnly:true,secure:false,sameSite:'lax'},user:{id:'111111111111111111',name:'Alex Morgan · DEMO'},csrf:'preview-only'})]);
const cookie='s:'+sid+'.'+createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'');
const app=express();app.get('/demo',(req,res)=>{res.cookie('bs.sid',cookie,{httpOnly:true,sameSite:'lax'});res.redirect('/');});
app.use(web(db,{authorize:async()=>{},run:async()=>{throw Error('preview read only');}},{setVisibility:async()=>{throw Error('preview read only');}},{sessionSecret:secret,production:false,publicUrl:'http://127.0.0.1:3100',clientId:'demo',guildId:'1292911416248111247'},()=>true));
app.listen(3100,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:3100/demo — isolated sample data'));
