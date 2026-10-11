import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,MessageFlags,PermissionFlagsBits} from 'discord.js';
import {config} from './config.js';
import {UserError} from './domain.js';

const ticketName=name=>`bingo-${String(name||'pracownik').replace(/\[[^\]]*\]/g,'').toLocaleLowerCase('pl').replace(/ł/g,'l').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'pracownik'}`;
const access=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks];

export function bingo(db,client,svc,card){
 const panelPayload={embeds:[card({title:'🎱 BURGERSHOT • BINGO',description:'━━━━━━━━━━━━━━━━━━━━\n\nMasz wykonane zadanie z Bingo? Otwórz prywatne zgłoszenie i wyślij klip albo zdjęcie z numerem zadania.\n\nTicket widzi wyłącznie osoba zgłaszająca oraz Zarząd. Możesz mieć tylko jedno otwarte zgłoszenie.\n\n━━━━━━━━━━━━━━━━━━━━'})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bingo:open').setLabel('🎱 Otwórz zgłoszenie Bingo').setStyle(ButtonStyle.Primary))]};
 async function panel(){
  const channel=await client.channels.fetch(config.bingoPanelChannel);
  await db.lock('bingo-panel',async()=>{
   const saved=(await db.q("SELECT message_id,channel_id FROM bot_panels WHERE name='bingo' ")).rows[0];
   if(saved&&saved.channel_id===channel.id){try{const message=await channel.messages.fetch(saved.message_id);await message.edit(panelPayload);return;}catch(err){if(err.code!==10008)throw err;}}
   const message=await channel.send(panelPayload);
   await db.q("INSERT INTO bot_panels(name,channel_id,message_id) VALUES('bingo',$1,$2) ON CONFLICT(name) DO UPDATE SET channel_id=$1,message_id=$2",[channel.id,message.id]);
  });
 }
 async function open(i){
  const member=await svc.member(i.user.id);
  if(!member.roles.cache.has(config.employee))throw new UserError('Zgłoszenie Bingo jest dostępne dla pracowników z rangą Firma DC.');
  return db.lock(`bingo:${i.user.id}`,async()=>{
   const existing=(await db.q("SELECT channel_id FROM bingo_tickets WHERE user_id=$1 AND status='open'",[i.user.id])).rows[0];
   if(existing){
    try{const channel=await client.channels.fetch(existing.channel_id);return {existing:true,channel};}
    catch{await db.q("UPDATE bingo_tickets SET status='closed',closed_at=now() WHERE user_id=$1 AND status='open'",[i.user.id]);}
   }
   const guild=await svc.guild();
   const channel=await guild.channels.create({name:ticketName(member.displayName),topic:`BurgerShot Bingo · zgłoszenie ${i.user.id}`,type:ChannelType.GuildText,parent:config.bingoCategory,permissionOverwrites:[
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
    {id:client.user.id,allow:access},
    {id:i.user.id,allow:access},
    {id:config.staff,allow:access}
   ]});
   await channel.send({embeds:[card({title:'🎱 ZGŁOSZENIE BINGO',description:`👤 **Pracownik:** <@${i.user.id}>\n\nWyślij klip lub screen z wykonanym zadaniem. W wiadomości podaj **numer zadania Bingo**.\n\nZgłoszenie sprawdzi Zarząd. Ticket może zamknąć wyłącznie Zarząd.`})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('bingo:close').setLabel('🔒 Zarząd: zamknij').setStyle(ButtonStyle.Danger))],allowedMentions:{users:[i.user.id],parse:[]}});
   await db.q("INSERT INTO bingo_tickets(user_id,channel_id,status) VALUES($1,$2,'open')",[i.user.id,channel.id]);
   return {existing:false,channel};
  });
 }
 async function close(i){
  await svc.authorize(i.user.id);
  const ticket=(await db.q("SELECT user_id FROM bingo_tickets WHERE channel_id=$1 AND status='open'",[i.channelId])).rows[0];
  if(!ticket)throw new UserError('Ten ticket jest już zamknięty albo nie należy do Bingo.');
  await db.q("UPDATE bingo_tickets SET status='closed',closed_at=now(),closed_by=$2 WHERE channel_id=$1",[i.channelId,i.user.id]);
  await i.channel.permissionOverwrites.edit(ticket.user_id,{SendMessages:false,AttachFiles:false});
  await i.update({embeds:[card({title:'🔒 TICKET BINGO ZAMKNIĘTY',description:`Zamknął(a): <@${i.user.id}>\n\nHistoria zgłoszenia pozostała dostępna dla pracownika oraz Zarządu.`})],components:[],allowedMentions:{users:[i.user.id],parse:[]}});
 }
 async function handle(i){
  if(!i.customId?.startsWith('bingo:'))return false;
  try{
   if(i.customId==='bingo:open'){
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const result=await open(i);
    await i.editReply(result.existing?`Masz już otwarty ticket: <#${result.channel.id}>`:`Gotowe — Twój prywatny ticket: <#${result.channel.id}>`);
   }else if(i.customId==='bingo:close')await close(i);
   else throw new UserError('Nieznana akcja Bingo.');
  }catch(err){
   const message=err instanceof UserError?err.message:[50001,50013].includes(err.code)?'Bot nie może utworzyć kanału w kategorii Bingo. Nadaj mu tam: Wyświetlanie kanału oraz Zarządzanie kanałami.':'Nie udało się obsłużyć zgłoszenia Bingo. Sprawdź logi bota.';
   if(i.deferred)await i.editReply(message).catch(()=>{});else await i.reply({flags:MessageFlags.Ephemeral,content:message}).catch(()=>{});
  }
  return true;
 }
 return {panel,handle};
}

export {ticketName};

