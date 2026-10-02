import {ActionRowBuilder,ButtonBuilder,ButtonStyle,MessageFlags,escapeMarkdown} from 'discord.js';
import {config} from './config.js';
import {UserError} from './domain.js';
const channelId='1292911416516415592';
const badgeMeta={
 '1524197367325134878':['R','~c~','REKRUT'],
 '1292911416264622202':['N','~HC_177~','NOWICJUSZ'],
 '1519069368602988817':['P','~o~','PRACOWNIK'],
 '1292911416285728789':['S.P','~y~','STARSZY PRACOWNIK'],
 '1292911416285728790':['S','~HC_15~','SPECJALISTA'],
 '1519067835769294858':['D.S','~y~','DOS SPECJALISTA'],
 '1292911416285728792':['K.Z','~b~','KIEROWNIK ZMIANY'],
 '1292911416306569307':['K','~p~','KIEROWNIK'],
 '1391129116199358545':['M','~HC_171~','MENADŻER'],
 '1292911416323342398':['Z.S','~HC_172~','ZASTĘPCA SZEFA'],
 '1292911416323342399':['SZEF','~HC_172~','SZEFOWA']
};
export const badgeRanks=config.ranks.map(rank=>({id:rank.id,name:rank.name,code:badgeMeta[rank.id][0],color:badgeMeta[rank.id][1],label:badgeMeta[rank.id][2]}));
export function badgeFor(member){
 if(!member.roles.cache.has(config.employee))throw new UserError('Generator jest dostępny dla pracowników z rangą Firma Dc.');
 const rank=[...badgeRanks].reverse().find(r=>member.roles.cache.has(r.id));
 if(!rank)throw new UserError('Nie znaleziono skonfigurowanego stanowiska. Skontaktuj się z zarządem.');
 const clean=member.displayName.replace(/\[[^\]]*\]/g,' ').trim();
 const first=clean.split(/\s+/)[0];
 if(!first||! /^[\p{L}][\p{L}\p{M}'’-]*$/u.test(first))throw new UserError('Ustaw pseudonim z imieniem na początku, np. Sonic Savage.');
 const brand=rank.code==='R'?'Burger Shot':'BURGER SHOT';
 return {weekly:member.roles.cache.has('1536106262859616347')?`/opis ~p~ 🍔 ~r~BURGER SHOT~r~ 🍔 ~n~ ~s~ [${first}] ~n~ ~HC_179~ [Pracownik Tygodnia]`:null,name:first,rank:rank.name,description:`/opis ~p~ 🍔 ~r~${brand}~r~ 🍔 ~n~ ~s~ [${first}] ~n~ ${rank.color} [${rank.label}]`,nickname:`/zmiennick [${rank.code}] ${first}`};
}
export function badges(db,client,svc,card){
 async function handle(i){
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
   const result=badgeFor(await svc.member(i.user.id));
   await i.editReply({embeds:[card({title:'🪪 Twoja plakietka • BurgerShot',description:`👤 **Imię:** ${escapeMarkdown(result.name)}\n🍟 **Stanowisko:** ${result.rank}`,fields:{...(result.weekly?{'🏆 Pracownik Tygodnia — dodatkowa plakietka':'Masz dodatkową plakietkę do założenia!\n```text\n'+result.weekly+'\n```'}:{}),'📋 Opis plakietki — skopiuj do gry':'```text\n'+result.description+'\n```','✏️ Zmiana nicku — skopiuj do gry':'```text\n'+result.nickname+'\n```'}})],allowedMentions:{parse:[]}});
  }catch(err){await i.editReply({embeds:[card({title:'🪪 Generator plakietek',description:err instanceof UserError?err.message:'Nie udało się pobrać stanowiska. Spróbuj ponownie.'})]});}
 }
 async function panel(){
  const channel=await client.channels.fetch(channelId);
  const payload={embeds:[card({title:'🍔 BURGERSHOT • GENERATOR PLAKIETEK',description:'🪪 **Twoja plakietka w jednym kliknięciu**\n\nBot sprawdzi Twoje stanowisko i pobierze pierwsze imię z pseudonimu. Otrzymasz **opis plakietki** oraz **komendę zmiany nicku** do skopiowania do gry.\n\n🔒 Dla pracowników z rangą **Firma Dc**. Wynik zobaczysz tylko Ty.'})],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('badges:generate').setLabel('🪪 Wygeneruj moją plakietkę').setStyle(ButtonStyle.Primary))]};
  await db.lock('badges-panel',async()=>{
   const saved=(await db.q("SELECT message_id,channel_id FROM bot_panels WHERE name='badges'")).rows[0];
   if(saved?.channel_id===channel.id){try{await (await channel.messages.fetch(saved.message_id)).edit(payload);return;}catch(err){if(err.code!==10008)throw err;}}
   const m=await channel.send(payload);
   await db.q("INSERT INTO bot_panels(name,channel_id,message_id) VALUES('badges',$1,$2) ON CONFLICT(name) DO UPDATE SET channel_id=$1,message_id=$2",[channel.id,m.id]);
  });
 }
 return {handle,panel};
}

