import {escapeMarkdown} from 'discord.js';
import {config} from './config.js';
import {sourceChannel,normalizedName} from './webhook-logs.js';

const clean=value=>String(value||'').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim();
export function parseCourseLog(title,description){
 const heading=clean(title),body=clean(description);
 if(!/^BURGERSHOT\s+Zakończenie Kursu$/i.test(heading))return null;
 const match=/^Gracz\s+(.+?)\s+zakończył\s+Kurs\s+#(\d+)\s+dla\s+burgershot\.?$/i.exec(body);
 return match&&Number(match[2])===4?{player:match[1],courseNumber:4}:null;
}
const canonical=value=>normalizedName(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const memberId=person=>person.user_id||person.id;
const memberNames=person=>[person.ic_name,person.displayName,person.nickname,person.username,person.user?.username,person.user?.globalName].filter(Boolean).map(canonical);
export function matchCourseEmployee(player,employees){
 const bracket=[...String(player).matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1];
 if(!bracket)throw new Error('Wpis kursu nie zawiera nazwy w nawiasie kwadratowym.');
 const wanted=canonical(bracket),full=wanted.split(' ').filter(Boolean);
 const usable=employees.filter(person=>!person.bot&&!person.user?.bot);
 let found=usable.filter(person=>memberNames(person).includes(wanted));
 if(found.length!==1&&full.length>=2)found=usable.filter(person=>memberNames(person).some(name=>name.includes(wanted)||wanted.includes(name)));
 if(found.length!==1)throw new Error(found.length?'Kilka osób pasuje do wpisu kursu.':'Nie znaleziono osoby o tym pseudonimie na serwerze Discord.');
 return memberId(found[0]);
}
export async function ingestCourseLog(db,message,guildId){
 if(message.guildId!==guildId||message.channelId!==sourceChannel||!message.webhookId)return false;
 const events=(message.embeds||[]).map(embed=>parseCourseLog(embed.title,embed.description)).filter(Boolean);
 if(events.length!==1)return false;
 return db.transaction(async tx=>Boolean((await tx.query("INSERT INTO imported_courses(message_id,webhook_id,event,status) VALUES($1,$2,$3,'pending') ON CONFLICT DO NOTHING RETURNING message_id",[message.id,message.webhookId,JSON.stringify(events[0])])).rows.length));
}
export async function processCourseLogs(db,svc){
 const pending=(await db.q("SELECT * FROM imported_courses WHERE status='pending' ORDER BY created_at,message_id LIMIT 25")).rows;
 for(const item of pending){
  await db.lock(`course:${item.message_id}`,async()=>{
   const current=(await db.q('SELECT status FROM imported_courses WHERE message_id=$1',[item.message_id])).rows[0];
   if(!current||current.status!=='pending')return;
   try{
    const targetId=await svc.courseMemberByName(item.event.player);
    await svc.recordCourse({targetId,messageId:item.message_id,playerName:item.event.player,courseNumber:item.event.courseNumber});
    await db.q("UPDATE imported_courses SET status='done' WHERE message_id=$1",[item.message_id]);
   }catch(err){
    await db.transaction(async tx=>{
     await tx.query('INSERT INTO notifications(channel_id,title,body) VALUES($1,$2,$3)',[config.logs,'⚠️ Nie zapisano kursu',`${escapeMarkdown(item.event.player)} · Kurs #4\n${escapeMarkdown(err.message)}\nSprawdź pseudonim tej osoby na Discordzie.`]);
     await tx.query("UPDATE imported_courses SET status='failed' WHERE message_id=$1",[item.message_id]);
    });
   }
  });
 }
}
