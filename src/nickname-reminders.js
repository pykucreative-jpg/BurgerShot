import {config} from './config.js';

const namePart="[\\p{L}][\\p{L}\\p{M}'’-]*";
const nicknamePattern=new RegExp(`^${namePart}(?:\\s+${namePart})+(?:\\s+\\[urlop\\])?$`,'u');

export const validStaffNickname=nickname=>nicknamePattern.test(String(nickname||'').trim());

export async function remindNicknames(db,client,card){
 const guild=await client.guilds.fetch(config.guildId);
 let members;try{members=await guild.members.fetch();}catch{members=guild.members.cache;}
 let sent=0;
 for(const member of members.values()){
  if(member.user.bot||!member.roles.cache.has(config.employee)||validStaffNickname(member.nickname))continue;
  const allowed=await db.q(`INSERT INTO nickname_reminders(user_id,last_reminded_at) VALUES($1,now())
   ON CONFLICT(user_id) DO UPDATE SET last_reminded_at=now()
   WHERE nickname_reminders.last_reminded_at<now()-interval '24 hours' RETURNING user_id`,[member.id]);
  if(!allowed.rowCount)continue;
  try{
   await member.user.send({embeds:[card({title:'✏️ Uzupełnij pseudonim',description:'Masz rangę **Firma DC**, ale Twój pseudonim na serwerze nie ma formatu imienia i nazwiska.\n\nUstaw go na przykład: **Imię Nazwisko**.\nNa urlopie dopisek **[urlop]** jest poprawny.'})]});
   sent++;
  }catch(err){console.error('Nie wysłano przypomnienia o nicku',member.id,err.code||err.name);}
 }
 return sent;
}

