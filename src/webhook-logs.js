import {escapeMarkdown} from 'discord.js';
import {config} from './config.js';
export const sourceChannel='1530621541325340682';
const ranks=['Rekrut','Nowicjusz','Pracownik','Starszy Pracownik','Specjalista','Doświadczony Specjalista','Kierownik Zmiany','Kierownik','Menadżer','Szef'];
const clean=s=>String(s||'').replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim();
const rankIndex=s=>ranks.findIndex(r=>r.toLocaleLowerCase('pl')===s.toLocaleLowerCase('pl'));
export function parseWebhookLog(title,description){
 title=clean(title);const body=clean(description);
 let m;
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
export function webhookNotice(event){
 const person=escapeMarkdown(event.person),actor=escapeMarkdown(event.actor);
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
  const inserted=await tx.query('INSERT INTO imported_webhook_logs(message_id,webhook_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',[message.id,message.webhookId]);
  if(!inserted.rows.length)return false;
  await tx.query('INSERT INTO notifications(channel_id,title,body) VALUES($1,$2,$3)',[notice.channel,notice.title,notice.body]);
  return true;
 });
}
