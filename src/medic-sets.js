import {DateTime} from 'luxon';
import {config} from './config.js';
import {UserError,text} from './domain.js';

const dailyWindow=()=>{const start=DateTime.now().setZone('Europe/Warsaw').startOf('day');return [start.toUTC().toJSDate(),start.plus({days:1}).toUTC().toJSDate()];};
const cleanName=value=>text(value,80).replace(/\s+/g,' ').trim();
export const setRemaining=issued=>Math.max(0,5-Number(issued||0));
export const canRecordDelivery=member=>Boolean(member?.roles?.cache?.has(config.staff)||member?.roles?.cache?.has(config.employee));
const initialMedics=['Alejandro Restrepo','Charlotte Lyons','Cioppini Bartieu','Damon Alfonso','George Hyattmore','Gorgio Wilson','Haruto Takanama','Ivy Mendez','Jack Kimono','Jessica Valentino','Kevin Maverick','Kim Frost','Leon Vidal','Lucas Valentino','Madison Black','Madison Hyattmore','Martino Skurwisinio','Michael Frost','Owen Evans','Paulo Martini','Rosalie Vitalyi','Santiago Mendez','Shyshko Yad','Theodor Rossi','Tony Kimono','Vivienne Castillo'];

export function medicSets(db,client,svc,card){
 async function importInitialMedics(){
  await db.lock('medic-list-import-2026-10-11',()=>db.transaction(async tx=>{
   const marker=await tx.query("INSERT INTO bot_settings(key,value) VALUES('medic_list_import_2026_10_11','done') ON CONFLICT(key) DO NOTHING RETURNING key");
   if(!marker.rows.length)return;
   for(const fullName of initialMedics)await tx.query('INSERT INTO medics(full_name) VALUES($1) ON CONFLICT(full_name) DO NOTHING',[fullName]);
  }));
 }
 async function rows(query=''){
  const [start,end]=dailyWindow();
  return (await db.q(`SELECT m.id,m.full_name,COALESCE(SUM(i.quantity),0)::int AS issued
   FROM medics m LEFT JOIN medic_set_issues i ON i.medic_id=m.id AND i.issued_at >= $1 AND i.issued_at < $2
   WHERE lower(m.full_name) LIKE lower($3) GROUP BY m.id,m.full_name ORDER BY lower(m.full_name),m.full_name`,[start,end,`%${query.trim()}%`])).rows;
 }
 const panelPayload=async()=>{
  const all=await rows();
  const issued=all.reduce((total,medic)=>total+Number(medic.issued),0);
  const atLimit=all.filter(medic=>Number(medic.issued)>=5).length;
  const lines=all.slice(0,80).map((medic,index)=>{
   const full=Number(medic.issued)>=5;
   return `${full?'🔴':'🟢'} **${String(index+1).padStart(2,'0')}. ${medic.full_name}**  ·  \`${medic.issued} / 5\``;
  });
  if(all.length>80)lines.push(`… oraz ${all.length-80} kolejnych osób.`);
  const summary=`👥 **${all.length} medyków**  ·  🍟 **${issued} zestawów dzisiaj**  ·  🔴 **${atLimit} limitów wykorzystanych**`;
  return {embeds:[card({title:'🍔 BURGERSHOT • LISTA MEDYKÓW',description:lines.length?`${summary}\n\n${lines.join('\n')}\n\n🟢 dostępny limit  ·  🔴 limit 5 / 5\nLimit odnawia się codziennie o północy.`:'Brak osób na liście. Zarząd może dodać pierwszą osobę komendą `/lista`.'})]};
 };
 async function panel(){
  await importInitialMedics();
  const channel=await client.channels.fetch(config.medicListChannel),payload=await panelPayload();
  await db.lock('medic-list-panel',async()=>{
   const saved=(await db.q("SELECT message_id,channel_id FROM bot_panels WHERE name='medic-list' ")).rows[0];
   if(saved&&saved.channel_id===channel.id){try{const message=await channel.messages.fetch(saved.message_id);await message.edit(payload);return;}catch(err){if(err.code!==10008)throw err;}}
   const message=await channel.send(payload);
   await db.q("INSERT INTO bot_panels(name,channel_id,message_id) VALUES('medic-list',$1,$2) ON CONFLICT(name) DO UPDATE SET channel_id=$1,message_id=$2",[channel.id,message.id]);
  });
 }
 async function manage(actorId,action,name,newName){
  await svc.authorize(actorId);
  if(action==='pokaz'){await panel();return {message:'Lista medyków została odświeżona.'};}
  const fullName=cleanName(name);
  if(action==='dodaj'){
   const inserted=await db.q('INSERT INTO medics(full_name) VALUES($1) ON CONFLICT(full_name) DO NOTHING RETURNING id',[fullName]);
   if(!inserted.rows.length)throw new UserError('Ta osoba jest już na liście medyków.');
   await panel();return {message:`Dodano do listy: **${fullName}**.`};
  }
  if(action==='usun'){
   const removed=await db.q('DELETE FROM medics WHERE full_name=$1 RETURNING id',[fullName]);
   if(!removed.rows.length)throw new UserError('Nie znaleziono tej osoby na liście medyków.');
   await panel();return {message:`Usunięto z listy: **${fullName}**.`};
  }
  if(action==='edytuj'){
   const replacement=cleanName(newName);
   if(replacement===fullName)throw new UserError('Podaj inne imię i nazwisko.');
   const exists=(await db.q('SELECT id FROM medics WHERE full_name=$1',[replacement])).rows[0];
   if(exists)throw new UserError('Ta osoba jest już na liście medyków.');
   const changed=await db.q('UPDATE medics SET full_name=$2 WHERE full_name=$1 RETURNING id',[fullName,replacement]);
   if(!changed.rows.length)throw new UserError('Nie znaleziono tej osoby na liście medyków.');
   await panel();return {message:`Zmieniono osobę: **${fullName}** → **${replacement}**.`};
  }
  throw new UserError('Wybierz: dodaj, edytuj, usuń albo pokaż.');
 }
 async function issue(actorId,name,quantity){
  const member=await svc.member(actorId);
  if(!member.roles.cache.has(config.employee))throw new UserError('Zestawy może wydawać wyłącznie osoba z rangą Firma DC.');
  const fullName=cleanName(name),amount=Number(quantity);
  if(!Number.isInteger(amount)||amount<1||amount>5)throw new UserError('Podaj liczbę zestawów od 1 do 5.');
  const medic=(await db.q('SELECT id,full_name FROM medics WHERE full_name=$1',[fullName])).rows[0];
  if(!medic)throw new UserError('Wybierz osobę z listy medyków.');
  const [start,end]=dailyWindow();
  const result=await db.lock(`medic-sets:${medic.id}:${start.toISOString()}`,async()=>db.transaction(async tx=>{
   const used=(await tx.query('SELECT COALESCE(SUM(quantity),0)::int AS total FROM medic_set_issues WHERE medic_id=$1 AND issued_at >= $2 AND issued_at < $3',[medic.id,start,end])).rows[0].total;
   if(Number(used)+amount>5)throw new UserError(`${medic.full_name} ma już ${used} / 5 zestawów dzisiaj. Można wydać maksymalnie ${setRemaining(used)}.`);
   await tx.query('INSERT INTO medic_set_issues(medic_id,issued_by,issued_by_name,quantity) VALUES($1,$2,$3,$4)',[medic.id,member.id,member.displayName,amount]);
   return {medic,amount,total:Number(used)+amount,issuer:member.displayName};
  }));
  await panel();return result;
 }
 async function delivery(actorId,driverId,helperIds,name,requestId){
  const actor=await svc.member(actorId);
  if(!canRecordDelivery(actor))throw new UserError('Dostawy może wpisywać wyłącznie Zarząd albo osoba z rangą Firma DC.');
  const uniqueHelpers=[...new Set(helperIds.filter(Boolean))];
  const [driver,...helpers]=await Promise.all([svc.member(driverId),...uniqueHelpers.map(id=>svc.member(id))]);
  if(!driver.roles.cache.has(config.staff))throw new UserError('Osoba dostarczająca musi mieć rangę Zarząd.');
  const trackedHelpers=helpers.filter(helper=>helper.manageable);
  if(trackedHelpers.some(helper=>!helper.roles.cache.has(config.employee)))throw new UserError('Każda osoba pomagająca, której bot może nadać rangę, musi mieć rangę Firma DC.');
  const medic=(await db.q('SELECT id,full_name FROM medics WHERE full_name=$1',[cleanName(name)])).rows[0];
  if(!medic)throw new UserError('Wybierz osobę z listy medyków.');
  const progress=await Promise.all(trackedHelpers.map(helper=>svc.recordDelivery(helper.id,requestId)));
  return {driver,helpers,medic,progress,mentionsOnly:helpers.filter(helper=>!helper.manageable).map(helper=>helper.id)};
 }
 async function autocomplete(i){
  const query=i.options.getFocused().trim();
  const options=(await rows(query)).slice(0,25).map(medic=>({name:`${medic.full_name} — ${medic.issued}/5 dzisiaj`.slice(0,100),value:medic.full_name}));
  await i.respond(options);
 }
 return {panel,manage,issue,delivery,autocomplete};
}

