import {web,sessionKey} from './web.js';
import {processWebhookLogs} from './webhook-logs.js';
import {processCourseLogs} from './course-wheel.js';
import {courseReminder} from './courses.js';
import {queueRewards} from './rewards.js';
import {Events} from 'discord.js';
import {environment} from './config.js';
import {database} from './db.js';
import {service} from './service.js';
import {makeClient,bot} from './bot.js';
import {sendDiploma} from './diplomas.js';
const env=environment(),db=database(env.databaseUrl);await db.init();
const client=makeClient(),svc=service(db,client,env),discord=bot(db,client,svc,env);
const queueCourses=courseReminder(db);
let initialized=false,working=false,stopping=false,lastMaintenance=0,lastCoursePresence=0;
 env.sessionSecret=await sessionKey(db);
 const httpServer=web(db,svc,discord,env,()=>initialized&&client.isReady()).listen(env.port,'0.0.0.0',()=>console.log('Panel BurgerShot gotowy.'));
const timer=setInterval(async()=>{if(!initialized||!client.isReady()||working)return;working=true;try{const queued=await queueCourses();if(queued)await discord.deliveries();if(Date.now()-lastMaintenance>=15000){lastMaintenance=Date.now();await processWebhookLogs(db,svc);await processCourseLogs(db,svc);await svc.tickLeaves();await queueRewards(db);await discord.deliveries();}if(Date.now()-lastCoursePresence>=600000){lastCoursePresence=Date.now();await svc.refreshCoursePresence();}}catch(e){console.error('Zadania cykliczne',e.code||e.name);}finally{working=false;}},1000);
async function shutdown(code=0){if(stopping)return;stopping=true;clearInterval(timer);httpServer.close();client.destroy();await db.pool.end();process.exit(code);}
async function sendDiplomaPreview(){
 const key='diploma_preview_795755381744861184_sent';
 const created=await db.q("INSERT INTO bot_settings(key,value) VALUES($1,'pending') ON CONFLICT(key) DO NOTHING RETURNING key",[key]);
 if(!created.rowCount)return;
 try{const user=await client.users.fetch('795755381744861184');await sendDiploma(client,{userId:user.id,name:user.globalName||user.username,rank:'MENADŻER • WZÓR',issuedAt:new Date()});await db.q("UPDATE bot_settings SET value='sent' WHERE key=$1",[key]);}
 catch(err){await db.q('DELETE FROM bot_settings WHERE key=$1',[key]);console.error('Nie wysłano podglądu dyplomu',err.code||err.name);}
}
client.once(Events.ClientReady,async()=>{try{const reset=await svc.resetCoursesOnRelease();if(reset.ran)console.log(`Wyzerowano kursy dla ${reset.count} osób po aktualizacji zasad.`);await discord.syncCommands();await discord.panel();await svc.refreshCoursePresence();await sendDiplomaPreview();lastCoursePresence=Date.now();initialized=true;console.log('BurgerShot gotowy — komendy zsynchronizowane.');}catch(e){console.error('Uruchomienie',e.code||e.name);await shutdown(1);}});
client.on(Events.Error,e=>console.error('Discord',e.code||e.name));
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
await client.login(env.token).catch(async e=>{console.error('Logowanie',e.code||e.name);await shutdown(1);});

