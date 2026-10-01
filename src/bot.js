import {ingestWebhookLog} from './webhook-logs.js';
import {previewRewards} from './rewards.js';
import {badges} from './badges.js';
import {tablet} from './tablet.js';
import {bulkDismiss} from './bulk-dismiss.js';
import {Client,GatewayIntentBits,Events,SlashCommandBuilder,EmbedBuilder,MessageFlags,escapeMarkdown,ActionRowBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {config,labels} from './config.js';
import {UserError,parseLeaveDate,formatDate} from './domain.js';
export const makeClient=()=>new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:{parse:[]}});
export function card(result){const e=new EmbedBuilder().setColor(0xD62D2D).setTitle(result.title||'🍔 BurgerShot').setFooter({text:'🍔 BurgerShot'});if(result.description)e.setDescription(result.description.slice(0,4000));if(result.fields)e.addFields(Object.entries(result.fields).map(([name,value])=>({name,value:String(value||'—').slice(0,1024),inline:false})));return e;}
export function commands(hidden=false){
 const base=(name)=>new SlashCommandBuilder().setName(name).setDescription(labels[name]).setDMPermission(false).addUserOption(o=>o.setName('osoba').setDescription('Pracownik').setRequired(true));
 return [new SlashCommandBuilder().setName('komenda').setDescription('Widoczność komend kadrowych — U/P').setDMPermission(false).addStringOption(o=>o.setName('tryb').setDescription('U — ukryj, P — pokaż').setRequired(true).addChoices({name:'U — ukryj',value:'U'},{name:'P — pokaż',value:'P'})),new SlashCommandBuilder().setName('nagrody').setDescription('💰 Podgląd nagród przed niedzielnym zestawieniem').setDMPermission(false).addIntegerOption(o=>o.setName('strona').setDescription('Strona listy nagród').setMinValue(1)),new SlashCommandBuilder().setName('zwolnij').setDescription('📋 Zwolnij jedną lub wiele osób').setDMPermission(false).addStringOption(o=>o.setName('osoby').setDescription('Oznaczenia @osób lub ID oddzielone spacją — maks. 20').setMaxLength(1000).setRequired(true)).addStringOption(o=>o.setName('powod').setDescription('Wspólny powód zwolnienia').setMaxLength(1000).setRequired(true)),base('zatrudnij').addStringOption(o=>o.setName('imie_i_nazwisko_ic').setDescription('Opcjonalnie — bez podania zachowamy pseudonim').setMaxLength(32)),...['plus','minus','awans','degrad','zdejmijurlop'].map(name=>base(name).addStringOption(o=>o.setName('powod').setDescription('Powód').setMaxLength(1000).setRequired(true))),base('urlop').addStringOption(o=>o.setName('do_kiedy').setDescription('DD.MM — bieżący rok, do końca dnia').setRequired(true))].map(c=>c.toJSON()).filter(c=>!hidden||!['awans','degrad','urlop','zdejmijurlop','zwolnij'].includes(c.name));
}
export function bot(db,client,svc,env){
 client.on(Events.MessageCreate,m=>ingestWebhookLog(db,m,env.guildId).catch(err=>console.error('Import logu webhooka',err.code||err.name)));
 client.on(Events.MessageUpdate,(_,m)=>{if(!m.partial)ingestWebhookLog(db,m,env.guildId).catch(err=>console.error('Import aktualizacji webhooka',err.code||err.name));});
 const destination=(kind,fallback,required=false)=>{const id=config.actionChannels[kind];if(!id&&required)throw new UserError('Kanał dla tego działania nie jest jeszcze skonfigurowany.');return id||fallback;};
 const publish=async(kind,payload,fallback,required=false)=>{const channel=await client.channels.fetch(destination(kind,fallback,required));await channel.send({...payload,allowedMentions:{parse:[]}});};
 const badgeGenerator=badges(db,client,svc,card);
 const staffTablet=tablet(db,svc,card,publish,destination);
 async function deliveries(){
    const logs=(await db.q("SELECT * FROM logs WHERE delivered=false AND status!='pending' ORDER BY id LIMIT 25")).rows;
    for(const l of logs) {
      try {
        const ch=await client.channels.fetch(config.logs);
        const result=l.details;
        await ch.send({embeds:[card({title:labels[l.category]||'📋 Historia',fields:{'🍔 Osoba':l.target_id?`<@${l.target_id}> · ${escapeMarkdown(l.target_name||'')}`:escapeMarkdown(l.target_name||'—'),'👤 Wykonano przez':`<@${l.actor_id}> · ${escapeMarkdown(l.actor_name)}`,'💬 Powód':escapeMarkdown(l.reason||'—'),'📋 Wynik':l.status==='success'?'Wykonano':l.status==='noop'?'Bez zmian':result.error||'Nie ukończono','🍟 Szczegóły':result.fields?.['🍟 Stanowisko'] || result.description || result.steps?.join(' · ') || '—','🕒 Data':formatDate(l.created_at)}})]});
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

 client.on(Events.InteractionCreate,async i=>{
  if(i.customId?.startsWith('rewards:settle:')){
   if(!i.inGuild()||i.guildId!==env.guildId)return;
   try{
    await svc.authorize(i.user.id);await i.deferUpdate();
    const cutoff=i.customId.slice('rewards:settle:'.length);
    const settled=await db.q('UPDATE reward_reports SET settled_at=now(),settled_by=$2 WHERE cutoff=$1 AND settled_at IS NULL RETURNING cutoff',[cutoff,i.user.id]);
    if(!settled.rowCount){await i.editReply({components:[]});return;}
    const embed=EmbedBuilder.from(i.message.embeds[0]).setFooter({text:'🍔 BurgerShot • Rozliczono przez '+i.user.username});
    await i.editReply({embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('rewards:done').setLabel('✅ Rozliczono').setStyle(ButtonStyle.Secondary).setDisabled(true))]});
   }catch(err){if(!i.deferred)await i.reply({flags:MessageFlags.Ephemeral,content:err instanceof UserError?err.message:'Nie udało się rozliczyć zestawienia.'}).catch(()=>{});else console.error('Rozliczenie nagród',err.code||err.name);}
   return;
  }
  if(i.customId==='badges:generate'){if(!i.inGuild()||i.guildId!==env.guildId)return;await badgeGenerator.handle(i);return;}
  if(i.customId?.startsWith('tablet:')){if(!i.inGuild()||i.guildId!==env.guildId)return;await staffTablet.handle(i);return;}
  if(!i.isChatInputCommand())return;
  try{
   if(!i.inGuild()||i.guildId!==env.guildId)throw new UserError('Użyj komendy na serwerze BurgerShot.');
   await i.deferReply({flags:MessageFlags.Ephemeral});await svc.authorize(i.user.id);
   if(i.commandName==='komenda'){
    const mode=i.options.getString('tryb',true);
    if(!['U','P'].includes(mode))throw new UserError('Wybierz U albo P.');
    await db.lock('command-visibility',async()=>{
     await (await svc.guild()).commands.set(commands(mode==='U'));
     await db.q("INSERT INTO bot_settings(key,value) VALUES('commands_hidden',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[mode==='U'?'true':'false']);
    });
    await i.editReply({embeds:[card({title:mode==='U'?'🙈 Komendy ukryte':'👀 Komendy widoczne',description:'/awans, /degrad, /urlop, /zdejmijurlop i /zwolnij. Zmiana dotyczy listy komend na całym serwerze. Discord może potrzebować chwili na odświeżenie.'})]});return;
   }
   if(i.commandName==='nagrody'){await i.editReply({embeds:[card(await previewRewards(db,i.options.getInteger('strona')||1))],allowedMentions:{parse:[]}});return;}
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
 });return {commands,syncCommands:async()=>{const hidden=(await db.q("SELECT value FROM bot_settings WHERE key='commands_hidden'")).rows[0]?.value==='true';await (await svc.guild()).commands.set(commands(hidden));},deliveries,panel:async()=>{await staffTablet.panel(client);await badgeGenerator.panel();}};
}
