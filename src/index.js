import {web,sessionKey} from './web.js';
import {processWebhookLogs} from './webhook-logs.js';
import {processCourseLogs} from './course-wheel.js';
import {courseReminder} from './courses.js';
import {queueRewards} from './rewards.js';
import {Events} from 'discord.js';
import {environment} from './config.js';
import {database} from './db.js';
import {service} from './service.js';
import {makeClient,bot,card} from './bot.js';
import {remindNicknames} from './nickname-reminders.js';
const env=environment(),db=database(env.databaseUrl);await db.init();
const client=makeClient(),svc=service(db,client,env),discord=bot(db,client,svc,env);
const queueCourses=courseReminder(db);
let initialized=false,working=false,stopping=false,lastMaintenance=0,lastCoursePresence=0,lastNicknameReminder=0;
 env.sessionSecret=await sessionKey(db);
 const httpServer=web(db,svc,discord,env,()=>initialized&&client.isReady()).listen(env.port,'0.0.0.0',()=>console.log('Panel BurgerShot gotowy.'));
const timer=setInterval(async()=>{if(!initialized||!client.isReady()||working)return;working=true;try{const queued=await queueCourses();if(queued)await discord.deliveries();if(Date.now()-lastMaintenance>=15000){lastMaintenance=Date.now();await processWebhookLogs(db,svc);await processCourseLogs(db,svc);await svc.tickLeaves();await queueRewards(db);await discord.deliveries();}if(Date.now()-lastCoursePresence>=600000){lastCoursePresence=Date.now();await svc.refreshCoursePresence();}if(Date.now()-lastNicknameReminder>=21600000){lastNicknameReminder=Date.now();await remindNicknames(db,client,card);}}catch(e){console.error('Zadania cykliczne',e.code||e.name);}finally{working=false;}},1000);
async function shutdown(code=0){if(stopping)return;stopping=true;clearInterval(timer);httpServer.close();client.destroy();await db.pool.end();process.exit(code);}
client.once(Events.ClientReady,async()=>{try{const reset=await svc.resetCoursesOnRelease();if(reset.ran)console.log(`Wyzerowano kursy dla ${reset.count} osób po aktualizacji zasad.`);await discord.syncCommands();await discord.panel();await svc.refreshCoursePresence();await remindNicknames(db,client,card);lastCoursePresence=Date.now();lastNicknameReminder=Date.now();initialized=true;console.log('BurgerShot gotowy — komendy zsynchronizowane.');}catch(e){console.error('Uruchomienie',e.code||e.name);await shutdown(1);}});
client.on(Events.Error,e=>console.error('Discord',e.code||e.name));
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
await client.login(env.token).catch(async e=>{console.error('Logowanie',e.code||e.name);await shutdown(1);});

