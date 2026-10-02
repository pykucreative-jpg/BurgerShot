import {ingestWebhookLog,processWebhookLogs} from './webhook-logs.js';
import {ingestCourseLog,processCourseLogs} from './course-wheel.js';
import {previewRewards} from './rewards.js';
import {badges} from './badges.js';
import {tablet} from './tablet.js';
import {bulkDismiss} from './bulk-dismiss.js';
import {Client,GatewayIntentBits,Events,SlashCommandBuilder,EmbedBuilder,MessageFlags,escapeMarkdown,ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {config,labels} from './config.js';
import {UserError,parseLeaveDate,formatDate} from './domain.js';
export const makeClient=()=>new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:{parse:[]}});
const brandAvatar='https://raw.githubusercontent.com/pykucreative-jpg/BurgerShot/main/public/discord-avatar.jpg';
export function card(result){const e=new EmbedBuilder().setColor(result.color||0xFF3B30).setAuthor({name:'BURGER SHOT • STAFF OFFICE'}).setTitle(result.title||'🍔 BurgerShot').setThumbnail(brandAvatar).setFooter({text:'🍔 BurgerShot'});if(result.description)e.setDescription(result.description.slice(0,4000));if(result.fields)e.addFields(Object.entries(result.fields).map(([name,value])=>({name,value:String(value||'—').slice(0,1024),inline:false})));return e;}
export function commands(hidden=false){
 const base=(name)=>new SlashCommandBuilder().setName(name).setDescription(labels[name]).setDMPermission(false).addUserOption(o=>o.setName('osoba').setDescription('Pracownik').setRequired(true));
 return [new SlashCommandBuilder().setName('komenda').setDescription('Widoczność komend kadrowych — U/P').setDMPermission(false).addStringOption(o=>o.setName('tryb').setDescription('U — ukryj, P — pokaż').setRequired(true).addChoices({name:'U — ukryj',value:'U'},{name:'P — pokaż',value:'P'})),new SlashCommandBuilder().setName('kolo').setDescription('🎡 Losowanie nagrody za kursy').setDMPermission(false),new SlashCommandBuilder().setName('reset').setDescription('↺ Wyzeruj kursy i losowania wszystkich osób').setDMPermission(false),new SlashCommandBuilder().setName('nagrody').setDescription('💰 Podgląd nagród przed niedzielnym zestawieniem').setDMPermission(false).addIntegerOption(o=>o.setName('strona').setDescription('Strona listy nagród').setMinValue(1)),new SlashCommandBuilder().setName('zwolnij').setDescription('📋 Zwolnij jedną lub wiele osób').setDMPermission(false).addStringOption(o=>o.setName('osoby').setDescription('Oznaczenia @osób lub ID oddzielone spacją — maks. 20').setMaxLength(1000).setRequired(true)).addStringOption(o=>o.setName('powod').setDescription('Wspólny powód zwolnienia').setMaxLength(1000).setRequired(true)),base('zatrudnij').addStringOption(o=>o.setName('imie_i_nazwisko_ic').setDescription('Opcjonalnie — bez podania zachowamy pseudonim').setMaxLength(32)),...['plus','minus','awans','degrad','zdejmijurlop'].map(name=>base(name).addStringOption(o=>o.setName('powod').setDescription('Powód').setMaxLength(1000).setRequired(true))),base('urlop').addStringOption(o=>o.setName('do_kiedy').setDescription('DD.MM — bieżący rok, do końca dnia').setRequired(true))].map(c=>c.toJSON()).filter(c=>!hidden||!['awans','degrad','urlop','zdejmijurlop','zwolnij'].includes(c.name));
}
export function bot(db,client,svc,env){
 let processingIncoming=false,incomingAgain=false;
 const processIncoming=async()=>{
  if(processingIncoming){incomingAgain=true;return;}
  processingIncoming=true;
  try{do{
   incomingAgain=false;
   await processWebhookLogs(db,svc);
   await processCourseLogs(db,svc);
   await svc.refreshCoursePresence();
   await deliveries();
  }while(incomingAgain);}finally{processingIncoming=false;}
 };
 const ingestIncoming=async message=>{
  const [personnel,course]=await Promise.all([ingestWebhookLog(db,message,env.guildId),ingestCourseLog(db,message,env.guildId)]);
  if(personnel||course)await processIncoming();
 };
 client.on(Events.MessageCreate,m=>{ingestIncoming(m).catch(err=>console.error('Obsługa nowego logu',err.code||err.name));});
 client.on(Events.MessageUpdate,(_,m)=>{if(!m.partial)ingestIncoming(m).catch(err=>console.error('Obsługa aktualizacji logu',err.code||err.name));});
 const destination=(kind,fallback,required=false)=>{const id=config.actionChannels[kind];if(!id&&required)throw new UserError('Kanał dla tego działania nie jest jeszcze skonfigurowany.');return id||fallback;};
 const publish=async(kind,payload,fallback,required=false)=>{const channel=await client.channels.fetch(destination(kind,fallback,required));await channel.send({...payload,allowedMentions:{parse:[]}});};
 const badgeGenerator=badges(db,client,svc,card);
 const staffTablet=tablet(db,svc,card,publish,destination);
 async function setVisibility(hidden){
  await db.lock('command-visibility',async()=>{
   await (await svc.guild()).commands.set(commands(hidden));
   await db.q("INSERT INTO bot_settings(key,value) VALUES('commands_hidden',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[hidden?'true':'false']);
  });
 }
 async function deliveries(){
    const logs=(await db.q("SELECT * FROM logs WHERE delivered=false AND status!='pending' ORDER BY id LIMIT 25")).rows;
    for(const l of logs) {
      try {
        const ch=await client.channels.fetch(config.logs);
        const result=l.details;
         const subject=l.target_id?`👤 <@${l.target_id}> · ${escapeMarkdown(l.target_name||'')}`:'👥 Wszyscy pracownicy';
         const detail=result.fields?.['🍟 Stanowisko']||result.fields?.['✨ Plusy']||result.fields?.['📋 Minusy']||result.description||result.steps?.join(' · ')||'';
         const outcome=l.status==='success'?'✅ Wykonano':l.status==='noop'?'ℹ️ Bez zmian':`⚠️ ${result.error||'Nie ukończono'}`;
         const actor=l.actor_name?.startsWith('Automatycznie')?'🤖 Automatycznie':`👤 <@${l.actor_id}>`;
         const description=[subject,l.reason&&`💬 ${escapeMarkdown(l.reason)}`,detail&&`↳ ${escapeMarkdown(detail)}`,`${outcome} · ${actor} · ${formatDate(l.created_at)}`].filter(Boolean).join('\n');
         await ch.send({embeds:[card({title:labels[l.category]||'📋 Historia',description})]});
        await db.q('UPDATE logs SET delivered=true WHERE id=$1',[l.id]);
      } catch(err) { console.error('Nie wysłano logu',l.id,err.code||err.name); break; }
    }
    const pending=(await db.q('SELECT * FROM notifications WHERE delivered=false ORDER BY id LIMIT 25')).rows;
    for(const n of pending) {
      try {
        const channel=await client.channels.fetch(n.channel_id);
        await channel.send({content:[n.role_id?`<@&${n.role_id}>`:null,n.user_id?`<@${n.user_id}>`:null].filter(Boolean).join(' ')||undefined,allowedMentions:{roles:n.role_id?[n.role_id]:[],users:n.user_id?[n.user_id]:[],parse:[]},embeds:[card({title:n.title,description:n.body})],components:n.reward_cutoff?[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rewards:settle:'+n.reward_cutoff).setLabel('✅ Rozliczono').setStyle(ButtonStyle.Success))]:[]});
        await db.q('UPDATE notifications SET delivered=true WHERE id=$1',[n.id]);
      } catch(err) {console.error('Nie wysłano powiadomienia',n.id,err.code||err.name);}
    }
  }

 async function coursePanel(){
  const channel=await client.channels.fetch(config.coursePanelChannel);
  const payload={embeds:[card({title:'🎡 BURGERSHOT • KURSY I NAGRODY',description:'━━━━━━━━━━━━━━━━━━━━\n\n🎟️ Co **20 kursów** otrzymujesz jedno losowanie.\n👔 Każda osoba korzysta z własnych, zdobytych losowań.\n💰 Nagrody wypłaca Zarząd **w niedzielę**.\n\nKliknij przycisk — każdą odpowiedź zobaczysz **wyłącznie Ty**.\n\n━━━━━━━━━━━━━━━━━━━━'})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('course:profile').setLabel('👤 Mój profil').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('course:status').setLabel('📚 Mój postęp').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('course:spin').setLabel('🎡 Zakręć kołem').setStyle(ButtonStyle.Primary))]};
  await db.lock('course-panel',async()=>{
   const saved=(await db.q("SELECT message_id,channel_id FROM bot_panels WHERE name='course-wheel'")).rows[0];
   if(saved&&saved.channel_id===channel.id){try{const message=await channel.messages.fetch(saved.message_id);await message.edit(payload);return;}catch(err){if(err.code!==10008)throw err;}}
   const message=await channel.send(payload);
   await db.q("INSERT INTO bot_panels(name,channel_id,message_id) VALUES('course-wheel',$1,$2) ON CONFLICT(name) DO UPDATE SET channel_id=$1,message_id=$2",[channel.id,message.id]);
  });
 }
 client.on(Events.InteractionCreate,async i=>{
  if(i.customId?.startsWith('rewards:settle:')){
   if(!i.inGuild()||i.guildId!==env.guildId)return;
   try{
    await svc.authorize(i.user.id);await i.deferUpdate();
    const cutoff=i.customId.slice('rewards:settle:'.length);
    const settled=await db.q('UPDATE reward_reports SET settled_at=now(),settled_by=$2 WHERE cutoff=$1 AND settled_at IS NULL RETURNING cutoff',[cutoff,i.user.id]);
    if(!settled.rowCount){await i.editReply({components:[]});return;}
    const embed=EmbedBuilder.from(i.message.embeds[0]).setThumbnail(brandAvatar).setFooter({text:'🍔 BurgerShot • Rozliczono przez '+i.user.username});
    await i.editReply({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rewards:done').setLabel('✅ Rozliczono').setStyle(ButtonStyle.Secondary).setDisabled(true))]});
   }catch(err){if(!i.deferred)await i.reply({flags:MessageFlags.Ephemeral,content:err instanceof UserError?err.message:'Nie udało się rozliczyć zestawienia.'}).catch(()=>{});else console.error('Rozliczenie nagród',err.code||err.name);}
   return;
  }
  if(i.customId==='badges:generate'){if(!i.inGuild()||i.guildId!==env.guildId)return;await badgeGenerator.handle(i);return;}
  if(i.customId?.startsWith('course:')){
   if(!i.inGuild()||i.guildId!==env.guildId)return;
   try{
    if(i.customId==='course:profile'){
     const result=await svc.personalProfile(i.user.id),e=result.employee,c=result.courses;
     const leave=result.leave?(result.leave.ends_at?`🌴 Do ${formatDate(result.leave.ends_at)}`:'🌴 Urlop bezterminowy'):'✅ Na zmianie';
     await i.reply({flags:MessageFlags.Ephemeral,embeds:[card({title:'👤 MÓJ PROFIL • BURGERSHOT',description:'Ten podgląd widzisz tylko Ty.',fields:{'🍟 Stanowisko':e.rank||'Nie ustawiono','⭐ Plusy / ⚠️ Minusy':`${e.plus_count}/5 • ${e.minus_count}/2`,'📚 Kursy #4':String(c.courses_completed),'🎡 Dostępne losowania':String(c.spins_available),'🌴 Status':leave,'👤 Zatrudnił(a)':e.hired_by_name||'Brak danych'}})]});
    }else if(i.customId==='course:status'){
     const result=await svc.courseStatus(i.user.id);
      await i.reply({flags:MessageFlags.Ephemeral,embeds:[card({title:'📚 MÓJ POSTĘP KURSÓW',description:'Ten podgląd widzisz tylko Ty.',fields:{'🚗 Zaliczone Kursy #4':String(result.courses),'🎡 Dostępne losowania':String(result.spins),'📈 Do kolejnego losowania':`${result.remaining} kursów`}})]});
    }else if(i.customId==='course:spin'){
     const result=await svc.spinWheel(i.user.id);
     await i.reply({flags:MessageFlags.Ephemeral,embeds:[card({title:'🎡 TWOJE KOŁO NAGRÓD',description:`Zakręcono kołem…\n\n🎁 **${result.prize}**\n\nNagrody wypłaca Zarząd w niedzielę. Ten wynik widzisz tylko Ty.`,fields:{'📚 Zaliczone Kursy #4':String(result.courses),'🎟️ Pozostałe losowania':String(result.spins)}})]});
    }
   }catch(err){await i.reply({flags:MessageFlags.Ephemeral,embeds:[card({title:'🎡 Panel kursów',description:err instanceof UserError?err.message:'Nie udało się sprawdzić konta. Spróbuj ponownie.'})]}).catch(()=>{});}
   return;
  }
  if(i.customId?.startsWith('tablet:')){if(!i.inGuild()||i.guildId!==env.guildId)return;await staffTablet.handle(i);return;}
  if(!i.isChatInputCommand())return;
  try{
   if(!i.inGuild()||i.guildId!==env.guildId)throw new UserError('Użyj komendy na serwerze BurgerShot.');
   if(i.commandName==='kolo'){
    const result=await svc.spinWheel(i.user.id);
     await i.reply({embeds:[card({title:'🎡 KOŁO NAGRÓD BURGERSHOT',description:`<@${i.user.id}> zakręca kołem…\n\n🎁 **${result.prize}**\n\nNagrody wypłaca Zarząd w niedzielę.`,fields:{'📚 Ukończone kursy':String(result.courses),'🎟️ Dostępne losowania':String(result.spins),'🍔 Status':result.staff?'Zarząd':'Firma DC'}})],allowedMentions:{users:[i.user.id],parse:[]}});return;
   }
   await i.deferReply({flags:MessageFlags.Ephemeral});await svc.authorize(i.user.id);
   if(i.commandName==='komenda'){
    const mode=i.options.getString('tryb',true);
    if(!['U','P'].includes(mode))throw new UserError('Wybierz U albo P.');
    await setVisibility(mode==='U');
    await i.editReply({embeds:[card({title:mode==='U'?'🙈 Komendy ukryte':'👀 Komendy widoczne',description:'/awans, /degrad, /urlop, /zdejmijurlop i /zwolnij. Zmiana dotyczy listy komend na całym serwerze. Discord może potrzebować chwili na odświeżenie.'})]});return;
   }
   if(i.commandName==='nagrody'){await i.editReply({embeds:[card(await previewRewards(db,i.options.getInteger('strona')||1))],allowedMentions:{parse:[]}});return;}
    if(i.commandName==='reset'){const result=await svc.resetCourses(i.user.id);await i.editReply({embeds:[card({title:'↺ Kursy wyzerowane',description:`Wyzerowano kursy oraz dostępne losowania dla **${result.count}** osób. Historia wylosowanych nagród zostaje zachowana.`})]});return;}
   if(!Object.hasOwn(labels,i.commandName))throw new UserError('Nieznana komenda.');
   if(i.commandName==='zwolnij'){
    const reason=i.options.getString('powod',true);
    const results=await bulkDismiss(svc,{people:i.options.getString('osoby',true),reason,actorId:i.user.id,channelId:destination(i.commandName,i.channelId),requestId:i.id});
    const lines=results.map(r=>r.ok?'✅ <@'+r.id+'> — zwolniono':'❌ <@'+r.id+'> — '+escapeMarkdown(r.error.slice(0,100)));
    const payload={embeds:[card({title:'📋 Podsumowanie zwolnień',description:lines.join('\n'),fields:{'💬 Powód':reason,'👤 Wykonał(a)':'<@'+i.user.id+'>','📊 Wynik':results.filter(r=>r.ok).length+' / '+results.length+' zwolnionych'}})],allowedMentions:{parse:[]}};
    try{await publish(i.commandName,payload,i.channelId);await i.deleteReply().catch(err=>console.error('Usunięcie potwierdzenia',err.code||err.name));}catch{await i.editReply(payload);}return;
   }
   const target=i.options.getUser('osoba',true);
   const result=await svc.run({kind:i.commandName,actorId:i.user.id,targetId:target.id,reason:i.options.getString('powod')||'',channelId:i.channelId,requestId:i.id,icName:i.options.getString('imie_i_nazwisko_ic'),endsAt:i.commandName==='urlop'?parseLeaveDate(i.options.getString('do_kiedy'),{end:true}):undefined});
   try{await publish(i.commandName,{embeds:[card(result)]},i.channelId);await i.deleteReply().catch(err=>console.error('Usunięcie potwierdzenia',err.code||err.name));}catch{await i.editReply({embeds:[card(result)],content:'Działanie zapisano, ale nie udało się wysłać wiadomości na kanał.'});}
  }catch(err){console.error('Obsługa komendy',err.code||err.name);const payload={embeds:[card({title:'🍔 Nie udało się wykonać działania',description:err instanceof UserError?err.message:'Sprawdź uprawnienia bota. Działanie może być częściowo wykonane — sprawdź logi.'})]};try{if(i.deferred||i.replied)await i.editReply(payload);else await i.reply({...payload,flags:MessageFlags.Ephemeral});}catch{}}
 });return {commands,setVisibility,syncCommands:async()=>{const hidden=(await db.q("SELECT value FROM bot_settings WHERE key='commands_hidden'")).rows[0]?.value==='true';await (await svc.guild()).commands.set(commands(hidden));},deliveries,panel:async()=>{await staffTablet.panel(client);await badgeGenerator.panel();await coursePanel();}};
}

