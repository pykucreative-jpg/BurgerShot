import {escapeMarkdown} from 'discord.js';
import {config} from './config.js';
export const sourceChannel='1530621541325340682';
const ranks=['Rekrut','Nowicjusz','Pracownik','Starszy Pracownik','Specjalista','Doświadczony Specjalista','Kierownik Zmiany','Kierownik','Menadżer','Szef'];
const clean=s=>String(s||'').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim();
const rankIndex=s=>ranks.findIndex(r=>r.toLocaleLowerCase('pl')===s.toLocaleLowerCase('pl'));
export const webhookRanks=config.ranks.concat([{id:'1292911416306569307',name:'Kierownik'},{id:'1391129116199358545',name:'Menadżer'},{id:'1292911416323342399',name:'Szef'}]);
export const normalizedName=s=>clean(s).replace(/\[[^\]]*\]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pl');
export function matchEmployee(name,members,employees){
 const wanted=normalizedName(name);
 if(wanted.split(' ').length<2)throw new Error('Brak pełnego imienia i nazwiska.');
 const ids=new Set(employees.filter(e=>normalizedName(e.ic_name)===wanted).map(e=>e.user_id));
 const matches=[...members.values()].filter(m=>!m.user.bot&&(normalizedName(m.displayName)===wanted||ids.has(m.id)));
 if(matches.length!==1)throw new Error(matches.length?'Kilka osób ma takie imię i nazwisko.':'Nie znaleziono pracownika po pełnym imieniu i nazwisku.');
 return matches[0].id;
}
export function parseWebhookLog(title,description){
 title=clean(title);const body=clean(description);
 let m;
 if(/^BURGERSHOT\s*-\s*Zdjęcie urlopu$/i.test(title)){
  m=/^(.+?) zdjął\(ęła\) urlop pracownikowi (.+?)\.?$/i.exec(body);
  if(m)return {kind:'zdejmijurlop',actor:m[1],person:m[2]};
 }
 if(/^BURGERSHOT\s*-\s*Zmiana stopnia$/i.test(title)){
  m=/^(.+?) zmienił\(a\) stopień pracownika (.+?) z (.+?) na (.+?)\.?$/i.exec(body);
  if(!m)return null;
  const before=rankIndex(m[3]),after=rankIndex(m[4]);
  if(before<0||after<0||before===after)return null;
  return {kind:after>before?'awans':'degrad',actor:m[1],person:m[2],before:ranks[before],after:ranks[after]};
 }
 if(/^BURGERSHOT\s*-\s*Urlop pracownika$/i.test(title)){
  m=/^(.+?) wysłał\(a\) na urlop pracownika (.+?) \(bezterminowo\)\.?$/i.exec(body);
  if(m)return {kind:'urlop',actor:m[1],person:m[2]};
 }
 if(/^BURGERSHOT\s*-\s*Zwolnienie Pracownika$/i.test(title)){
  m=/^(.+?) zwolnił\(a\) gracza (.+?) z firmy Burgershot\.?\s*(?:Identifier:.*)?$/i.exec(body);
  if(m)return {kind:'zwolnij',actor:m[1],person:m[2]};
 }
 return null;
}
export function webhookNotice(event,targetId){
 const person=targetId?`<@${targetId}> (${escapeMarkdown(event.person)})`:escapeMarkdown(event.person),actor=escapeMarkdown(event.actor);
 if(event.kind==='zdejmijurlop')return {channel:'1502336468016828567',title:'☀️ Witamy z powrotem!',body:`👤 **Pracownik:** ${person}\n🌴 Urlop został zakończony. Zapraszamy do pracy! 🍔\n👤 **Urlop zakończył(a):** ${actor}`};
 if(event.kind==='urlop')return {channel:'1502336468016828567',title:'🌴 Urlop pracownika',body:`👤 **Pracownik:** ${person}\n📅 **Do kiedy:** Bezterminowo\n👤 **Urlopu udzielił(a):** ${actor}`};
 const titles={awans:'📈 Awans pracownika',degrad:'📉 Degradacja pracownika',zwolnij:'📋 Zakończenie współpracy'};
 const who={awans:'Awansował(a)',degrad:'Zdegradował(a)',zwolnij:'Zwolnił(a)'};
 const reason=event.kind==='awans'?'Wyrobienie normy awansowej':'Brak wyrobionej normy';
 return {channel:config.actionChannels[event.kind],title:titles[event.kind],body:`👤 **Pracownik:** ${person}\n${event.before?`🍟 **Stanowisko:** ${event.before} → ${event.after}\n`:''}💬 **Powód:** ${reason}\n👤 **${who[event.kind]}:** ${actor}`};
}
export async function ingestWebhookLog(db,message,guildId){
 if(message.guildId!==guildId||message.channelId!==sourceChannel||!message.webhookId)return false;
 const events=(message.embeds||[]).map(e=>parseWebhookLog(e.title,e.description)).filter(Boolean);
 // Ambiguous or unrecognized logs must never become invented personnel announcements.
 if(events.length!==1)return false;
 const notice=webhookNotice(events[0]);
 if(!notice.channel||notice.channel===sourceChannel)throw new Error('Invalid webhook destination');
 return db.transaction(async tx=>{
  const inserted=await tx.query("INSERT INTO imported_webhook_logs(message_id,webhook_id,event,status) VALUES($1,$2,$3,'pending') ON CONFLICT DO NOTHING RETURNING message_id",[message.id,message.webhookId,JSON.stringify(events[0])]);
  if(!inserted.rows.length)return false;
  return true;
 });
}
const memberSnapshots=new WeakMap();
async function membersForImport(svc){
 const previous=memberSnapshots.get(svc);
 // Discord updates this live cache on member/role/nickname events.
 if(previous&&Date.now()-previous.at<60000)return previous.guild.members.cache||previous.members;
 const guild=await svc.guild(),members=await guild.members.fetch();
 memberSnapshots.set(svc,{guild,members,at:Date.now()});
 return guild.members.cache||members;
}
export async function processWebhookLogs(db,svc){
 const pending=(await db.q("SELECT * FROM imported_webhook_logs WHERE status='pending' ORDER BY created_at,message_id LIMIT 25")).rows;
 for(const item of pending){
  // Preserve event order while Discord asks us to wait.
  if(item.retry_at&&new Date(item.retry_at)>new Date())break;
  let postponed=false;
  await db.lock(`webhook:${item.message_id}`,async()=>{
  if((await db.q('SELECT status FROM imported_webhook_logs WHERE message_id=$1',[item.message_id])).rows[0].status!=='pending')return;
  try{
   const existing=(await db.q('SELECT status,target_id FROM logs WHERE request_id=$1',[`webhook:${item.message_id}`])).rows[0];
   let targetId;
   if(existing){
    if(!['success','noop'].includes(existing.status))throw new Error('Działanie było przerwane lub nieudane. Sprawdź historię przed ręcznym ponowieniem.');
    targetId=existing.target_id;
   }else{
    let members;
    try{members=await membersForImport(svc);}catch(err){
     if(/rate.?limit|timed? ?out|timeout/i.test(String(err.message))){
      await db.q("UPDATE imported_webhook_logs SET retry_at=now()+interval '65 seconds' WHERE message_id=$1",[item.message_id]);
      postponed=true;return;
     }
     throw err;
    }
    targetId=matchEmployee(item.event.person,members,(await db.q("SELECT user_id,ic_name FROM employees WHERE status='active'")).rows);
    await svc.applyWebhook(item.event,targetId,item.message_id);
   }
   const notice=webhookNotice(item.event,targetId);
   await db.transaction(async tx=>{
    await tx.query('INSERT INTO notifications(channel_id,user_id,title,body) VALUES($1,$2,$3,$4)',[notice.channel,targetId,notice.title,notice.body]);
    await tx.query("UPDATE imported_webhook_logs SET status='done' WHERE message_id=$1",[item.message_id]);
   });
  }catch(err){
   await db.transaction(async tx=>{
    await tx.query('INSERT INTO notifications(channel_id,title,body) VALUES($1,$2,$3)',[config.logs,'⚠️ Nie wykonano automatycznego działania',`${escapeMarkdown(item.event.person)} — ${escapeMarkdown(item.event.kind)}\n${escapeMarkdown(err.message)}\nSprawdź pracownika i historię operacji.`]);
    await tx.query("UPDATE imported_webhook_logs SET status='failed' WHERE message_id=$1",[item.message_id]);
   });
  }
 });
  if(postponed)break;
 }
}
