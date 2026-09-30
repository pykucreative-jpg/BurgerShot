import {courseReminder} from './courses.js';
import {queueRewards} from './rewards.js';
import {Events} from 'discord.js';
import {environment} from './config.js';
import {database} from './db.js';
import {service} from './service.js';
import {makeClient,bot} from './bot.js';
const env=environment(),db=database(env.databaseUrl);await db.init();
const client=makeClient(),svc=service(db,client,env),discord=bot(db,client,svc,env);
const queueCourses=courseReminder(db);
let initialized=false,working=false,stopping=false,lastMaintenance=0;
const timer=setInterval(async()=>{if(!initialized||!client.isReady()||working)return;working=true;try{const queued=await queueCourses();if(queued)await discord.deliveries();if(Date.now()-lastMaintenance>=15000){lastMaintenance=Date.now();await svc.tickLeaves();await queueRewards(db);await discord.deliveries();}}catch(e){console.error('Zadania cykliczne',e.code||e.name);}finally{working=false;}},1000);
async function shutdown(code=0){if(stopping)return;stopping=true;clearInterval(timer);client.destroy();await db.pool.end();process.exit(code);}
client.once(Events.ClientReady,async()=>{try{await (await svc.guild()).commands.set(discord.commands());await discord.panel();initialized=true;console.log('BurgerShot gotowy — 8 komend.');}catch(e){console.error('Uruchomienie',e.code||e.name);await shutdown(1);}});
client.on(Events.Error,e=>console.error('Discord',e.code||e.name));
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
await client.login(env.token).catch(async e=>{console.error('Logowanie',e.code||e.name);await shutdown(1);});
