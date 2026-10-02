import {ActionRowBuilder,UserSelectMenuBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags,escapeMarkdown} from 'discord.js';
import {config,labels} from './config.js';
import {UserError,formatDate} from './domain.js';

const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const actions=['plus','minus','awans','degrad','zwolnij'];
export function tablet(db,svc,card,publish,destination){
 async function view(owner,target,status=''){
  const fields={};let available=false;
  if(target){
   try{
    const m=await svc.member(target);available=!m.user.bot;
    if(!available)throw new UserError('Wybierz pracownika, nie bota.');
    const e=await svc.employee(m);
    const [leave,courses]=await Promise.all([db.q("SELECT ends_at FROM leaves WHERE user_id=$1 AND status IN ('active','scheduled','starting','ending') ORDER BY id DESC LIMIT 1",[target]),db.q('SELECT courses_completed,spins_available FROM course_progress WHERE user_id=$1',[target])]);
    const progress=courses?.rows?.[0]||{courses_completed:0,spins_available:0};
    fields['👤 Pracownik']=`<@${target}> · ${escapeMarkdown(m.displayName)}`;
    fields['🍟 Stanowisko']=e.rank||'Brak stanowiska';
    fields['⭐ Plusy']=`${e.plus_count}/5`;fields['⚠️ Minusy']=`${e.minus_count}/2`;
    fields['📚 Kursy']=`${progress.courses_completed} / 20 do kolejnego losowania`;
    fields['🎡 Koło']=`${progress.spins_available} dostępne losowania`;
    fields['🌴 Urlop']=leave.rows[0]?(leave.rows[0].ends_at?`Do ${formatDate(leave.rows[0].ends_at)}`:'Bezterminowo'):'Nie';
   }catch(err){if(err.code!==10007)throw err;fields['👤 Pracownik']=`<@${target}> — poza serwerem`;}
  }
  const components=[row(new ButtonBuilder().setCustomId(`tablet:search:${owner}`).setLabel('🔎 Wyszukaj').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`tablet:refresh:${owner}:${target||''}`).setLabel('🔄 Odśwież').setStyle(ButtonStyle.Secondary))];
  if(available){
   const buttons=actions.map(kind=>new ButtonBuilder().setCustomId(`tablet:action:${owner}:${target}:${kind}`).setLabel(labels[kind]).setStyle(kind==='zwolnij'?ButtonStyle.Danger:ButtonStyle.Secondary));
   components.push(row(...buttons.slice(0,2)),row(...buttons.slice(2,4)),row(buttons[4]));
  }
  return {embeds:[card({title:'🍔 BURGERSHOT • TABLET ZARZĄDU',description:['━━━━━━━━━━━━━━━━━━━━',status,target?'Wybierz działanie poniżej.':'🔎 Wyszukaj pracownika po nazwie, pseudonimie lub ID.'].filter(Boolean).join('\n\n'),fields})],components};
 }
 async function handle(i){
  const opening=i.customId==='tablet:open'||i.customId==='tablet:pick';
  if(!opening&&!i.customId?.startsWith('tablet:'))return false;
  let target;
  try{
   if(opening){await i.deferReply({flags:MessageFlags.Ephemeral});await svc.authorize(i.user.id);target=i.customId==='tablet:pick'?i.values[0]:undefined;await i.editReply(await view(i.user.id,target));return true;}
   const [,action,owner,id,kind]=i.customId.split(':');target=id;
   if(owner!==i.user.id)throw new UserError('Otwórz własny panel ze stałego panelu.');
   await svc.authorize(i.user.id);
   if(action==='search'&&i.isButton()){
    await i.showModal(new ModalBuilder().setCustomId(`tablet:find:${owner}`).setTitle('🔎 Wyszukaj pracownika').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('Nazwa, pseudonim lub ID osoby').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))));
   }else if(action==='find'&&i.isModalSubmit()){
    if(!i.isFromMessage())throw new UserError('Otwórz ponownie stały panel.');
    await i.deferUpdate();const query=i.fields.getTextInputValue('query').trim();
    if(!query)throw new UserError('Wpisz nazwę, pseudonim lub ID.');
    const idMatch=/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(query);
    if(idMatch){await i.editReply(await view(owner,idMatch[1]||idMatch[2]));}
    else {
     const guild=await svc.guild();const matches=await guild.members.search({query,limit:25});
     const members=[...matches.values()].filter(m=>!m.user.bot);
     if(members.length===1)await i.editReply(await view(owner,members[0].id));
     else {const payload=await view(owner,undefined,members.length?'Wybierz właściwą osobę z wyników. Jeśli jej brakuje, wpisz dokładniejszą nazwę lub ID.':'Nie znaleziono osoby. Spróbuj innej nazwy lub ID.');
      if(members.length)payload.components.unshift(row(new StringSelectMenuBuilder().setCustomId(`tablet:result:${owner}`).setPlaceholder('Wyniki wyszukiwania').addOptions(members.map(m=>({label:m.displayName.slice(0,100),description:(m.user.username+' • '+m.id).slice(0,100),value:m.id})))));
      await i.editReply(payload);
     }
    }
   }else if(action==='refresh'&&i.isButton()){await i.deferUpdate();await i.editReply(await view(owner,target));
   }else if((action==='select'&&i.isUserSelectMenu())||(action==='result'&&i.isStringSelectMenu())){
    await i.deferUpdate();target=i.values[0];await i.editReply(await view(owner,target));
   }else if(action==='action'&&i.isButton()&&actions.includes(kind)){
    const m=await svc.member(target);if(m.user.bot)throw new UserError('Wybierz pracownika, nie bota.');
    const input=new TextInputBuilder().setCustomId('value').setLabel('Powód').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
    await i.showModal(new ModalBuilder().setCustomId(`tablet:submit:${owner}:${target}:${kind}`).setTitle(labels[kind]).addComponents(row(input)));
   }else if(action==='submit'&&i.isModalSubmit()&&actions.includes(kind)){
    if(!i.isFromMessage())throw new UserError('Otwórz ponownie stały panel.');
    await i.deferUpdate();const value=i.fields.getTextInputValue('value');
    const channelId=destination(kind,i.channelId,true);
    const result=await svc.run({kind,actorId:owner,targetId:target,channelId,requestId:i.id,reason:value});
    let status=`✅ ${result.title}`;
    try{await publish(kind,{embeds:[card(result)]},i.channelId,true);status+=`\nWiadomość wysłana na <#${channelId}>.`;}
    catch{status+='\n⚠️ Działanie zapisano, ale wysyłka na kanał nie powiodła się. Sprawdź logi; nie ponawiaj działania.';}
    try{await i.editReply(await view(owner,target,status));}
    catch{await i.editReply({embeds:[card({title:'🍔 Tablet zarządu',description:status+'\nWybierz ponownie pracownika.'})],components:(await view(owner)).components});}
   }else throw new UserError('Otwórz ponownie stały panel.');
  }catch(err){
   const description=err instanceof UserError?err.message:err.code===10007?'Osoba nie należy już do serwera.':'Nie udało się ukończyć działania. Sprawdź logi przed ponowieniem.';
   if(i.deferred){await i.editReply({embeds:[card({title:'🍔 Tablet zarządu',description})]}).catch(()=>{});}
   else await i.reply({flags:MessageFlags.Ephemeral,embeds:[card({title:'🍔 Tablet zarządu',description})]}).catch(()=>{});
  }
  return true;
 }
 async function panel(client){
  if(!config.tabletChannel)return;
  const channel=await client.channels.fetch(config.tabletChannel);
  const payload={embeds:[card({title:'🍔 BURGERSHOT',description:'**TABLET ZARZĄDU**\n━━━━━━━━━━━━━━━━━━━━\n\n👤 **Pracownicy** · ⭐ **Oceny** · 📈 **Stanowiska**\n\nOtwórz tablet, wyszukaj pracownika i wybierz działanie.\nTwój ekran obsługi jest prywatny — widzisz go tylko Ty.\n\n━━━━━━━━━━━━━━━━━━━━'})],components:[row(new ButtonBuilder().setCustomId('tablet:open').setLabel('📱 Otwórz tablet').setStyle(ButtonStyle.Primary))]};
  await db.lock('tablet-panel',async()=>{
   const saved=(await db.q("SELECT message_id,channel_id FROM bot_panels WHERE name='tablet'")).rows[0];
   if(saved&&saved.channel_id===channel.id){
    try{const m=await channel.messages.fetch(saved.message_id);await m.edit(payload);return;}catch(err){if(err.code!==10008)throw err;}
   }
   const m=await channel.send(payload);
   await db.q("INSERT INTO bot_panels(name,channel_id,message_id) VALUES('tablet',$1,$2) ON CONFLICT(name) DO UPDATE SET channel_id=$1,message_id=$2",[channel.id,m.id]);
  });
 }
 return {handle,view,panel};
}
