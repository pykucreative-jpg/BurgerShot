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
export function matchCourseEmployee(player,employees){
 const bracket=[...String(player).matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1];
 if(!bracket)throw new Error('Wpis kursu nie zawiera nazwy w nawiasie kwadratowym.');
 const wanted=normalizedName(bracket);
 const found=employees.filter(person=>!person.bot&&normalizedName(person.ic_name)===wanted);
 if(found.length!==1)throw new Error(found.length?'Kilka osób pasuje do wpisu kursu.':'Nie znaleziono osoby z rangą Firma DC dla wpisu kursu.');
 return found[0].user_id;
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
    const people=await svc.companyMembers();
    const targetId=matchCourseEmployee(item.event.player,people);
    await svc.recordCourse({targetId,messageId:item.message_id,playerName:item.event.player,courseNumber:item.event.courseNumber});
    await db.q("UPDATE imported_courses SET status='done' WHERE message_id=$1",[item.message_id]);
   }catch(err){
    await db.transaction(async tx=>{
     await tx.query('INSERT INTO notifications(channel_id,title,body) VALUES($1,$2,$3)',[config.logs,'⚠️ Nie zapisano kursu',`${escapeMarkdown(item.event.player)} · Kurs #4\n${escapeMarkdown(err.message)}\nSprawdź pseudonim oraz rangę Firma DC.`]);
     await tx.query("UPDATE imported_courses SET status='failed' WHERE message_id=$1",[item.message_id]);
    });
   }
  });
 }
}
