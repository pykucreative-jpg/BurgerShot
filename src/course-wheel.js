import {escapeMarkdown} from 'discord.js';
import {config} from './config.js';
import {sourceChannel,normalizedName} from './webhook-logs.js';

const clean=value=>String(value||'').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim();
export function parseCourseLog(title,description){
 const heading=clean(title),body=clean(description);
 if(!/^BURGERSHOT\s+Zakończenie Kursu$/i.test(heading))return null;
 const match=/^Gracz\s+(.+?)\s+zakończył\s+Kurs\s+#(\d+)\s+dla\s+burgershot\.?$/i.exec(body);
 const courseNumber=Number(match?.[2]);
 return match&&(courseNumber===1||courseNumber===4)?{player:match[1],courseNumber}:null;
}
const canonical=value=>normalizedName(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export const courseEventKey=(event,at)=>{const date=new Date(at);const bucket=Number.isNaN(date.getTime())?String(at):Math.floor(date.getTime()/120000);return `${canonical(event.player)}|${event.courseNumber}|${bucket}`;};
export const courseAccountId=player=>{const bracket=[...String(player).matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1]||player;return config.courseAccounts?.[canonical(bracket)]||null;};
const memberId=person=>person.user_id||person.id;
const memberNames=person=>[person.ic_name,person.displayName,person.nickname,person.username,person.user?.username,person.user?.globalName].filter(Boolean).map(canonical);
const hasPhrase=(value,phrase)=>` ${value} `.includes(` ${phrase} `);
export function matchCourseEmployee(player,employees){
 const fixed=courseAccountId(player);if(fixed)return fixed;
 const bracket=[...String(player).matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1];
 if(!bracket)throw new Error('Wpis kursu nie zawiera nazwy w nawiasie kwadratowym.');
 const wanted=canonical(bracket),nick=canonical(String(player).split('[')[0]);
 const usable=employees.filter(person=>!person.bot&&!person.user?.bot);
 // Najpierw wybieramy pełne imię i nazwisko z nawiasu. Rangi, [urlop] i inne dopiski nie zmieniają tego dopasowania.
 const matches=usable.map(person=>{
  const names=memberNames(person),nameMatch=names.some(name=>hasPhrase(name,wanted));
  if(!nameMatch)return null;
  const exact=names.some(name=>name===wanted);
  const nickMatch=nick&&names.some(name=>name===nick);
  return {person,score:(exact?1000:500)+(nickMatch?100:0)};
 }).filter(Boolean).sort((a,b)=>b.score-a.score);
 if(!matches.length)throw new Error('Nie znaleziono osoby o tym imieniu i nazwisku na serwerze Discord.');
 if(matches.length>1&&matches[0].score===matches[1].score)throw new Error('Kilka osób ma to samo imię i nazwisko. Sprawdź pseudonim tej osoby na Discordzie.');
 return memberId(matches[0].person);
}
export async function ingestCourseLog(db,message,guildId){
 // BurgerShot may publish through either a webhook or an application bot.
 // Both are trusted only on the configured source channel.
 const sourceId=message.webhookId||message.applicationId||(message.author?.bot&&message.author?.id);
 if(message.guildId!==guildId||message.channelId!==sourceChannel||!sourceId)return false;
 const events=(message.embeds||[]).map(embed=>parseCourseLog(embed.title,embed.description)).filter(Boolean);
 if(events.length!==1)return false;
  const timestamp=message.embeds[0]?.timestamp||message.createdTimestamp||Date.now();
  const occurredAt=new Date(timestamp);
  const safeOccurredAt=Number.isNaN(occurredAt.getTime())?new Date(message.createdTimestamp||Date.now()):occurredAt;
  return db.transaction(async tx=>Boolean((await tx.query("INSERT INTO imported_courses(message_id,webhook_id,event,event_key,occurred_at,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(message_id) DO NOTHING RETURNING message_id",[message.id,String(sourceId),JSON.stringify(events[0]),courseEventKey(events[0],safeOccurredAt),safeOccurredAt]) ).rows.length));
}
export async function recoverCourseLogsSince(db,client,guildId,since){
 const startedAt=new Date(since),startedMs=startedAt.getTime();
 if(Number.isNaN(startedMs))throw new Error('Nieprawidłowy czas odzyskania kursów.');
 const marker=`course-recovery:${startedAt.toISOString()}`;
 if((await db.q('SELECT 1 FROM bot_settings WHERE key=$1',[marker])).rows.length)return 0;
 const channel=await client.channels.fetch(sourceChannel);
 if(!channel?.messages?.fetch)throw new Error('Kanał źródłowy kursów nie jest dostępny.');
 let before,inserted=0;
 for(let page=0;page<10;page++){
  const batch=await channel.messages.fetch({limit:100,...(before?{before}:{})});
  const messages=[...batch.values()];
  if(!messages.length)break;
  for(const message of messages){
   if(message.createdTimestamp<startedMs)continue;
   const event=(message.embeds||[]).map(embed=>parseCourseLog(embed.title,embed.description)).find(Boolean);
   if(event?.courseNumber===4&&await ingestCourseLog(db,message,guildId))inserted++;
  }
  const oldest=messages.reduce((value,message)=>!value||message.createdTimestamp<value.createdTimestamp?message:value,null);
  if(oldest.createdTimestamp<startedMs)break;
  before=oldest.id;
 }
 await db.q("INSERT INTO bot_settings(key,value) VALUES($1,'done') ON CONFLICT(key) DO NOTHING",[marker]);
 return inserted;
}
export async function retryFailedCoursesSinceReset(db){
 const reset=(await db.q("SELECT max(created_at) AS created_at FROM logs WHERE category='reset' AND status='success'")).rows[0]?.created_at;
 if(!reset)return 0;
 const retried=await db.q("UPDATE imported_courses SET status='pending',retry_count=retry_count+1 WHERE status='failed' AND retry_count=0 AND created_at >= $1 AND event->>'courseNumber'='4' RETURNING message_id",[reset]);
 return retried.rowCount;
}
export async function processCourseLogs(db,svc){
 const pending=(await db.q("SELECT * FROM imported_courses WHERE status='pending' ORDER BY created_at,message_id LIMIT 25")).rows;
 for(const item of pending){
  await db.lock(`course:${item.message_id}`,async()=>{
   const current=(await db.q('SELECT status FROM imported_courses WHERE message_id=$1',[item.message_id])).rows[0];
   if(!current||current.status!=='pending')return;
   try{
    const targetId=await svc.courseMemberByName(item.event.player);
    if(item.event.courseNumber===1) await svc.markActiveCourse({targetId,messageId:item.message_id,playerName:item.event.player});
    else await svc.recordCourse({targetId,messageId:item.message_id,playerName:item.event.player,courseNumber:item.event.courseNumber,occurredAt:item.occurred_at||item.created_at});
    await db.q("UPDATE imported_courses SET status='done' WHERE message_id=$1",[item.message_id]);
   }catch(err){
    if(item.event.courseNumber===1){await db.q("UPDATE imported_courses SET status='ignored' WHERE message_id=$1",[item.message_id]);return;}
    await db.transaction(async tx=>{
     await tx.query('INSERT INTO notifications(channel_id,title,body) VALUES($1,$2,$3)',[config.logs,'⚠️ Nie zapisano kursu',`${escapeMarkdown(item.event.player)} · Kurs #4\n${escapeMarkdown(err.message)}\nSprawdź pseudonim tej osoby na Discordzie.`]);
     await tx.query("UPDATE imported_courses SET status='failed' WHERE message_id=$1",[item.message_id]);
    });
   }
  });
 }
}

