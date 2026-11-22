import {DateTime} from 'luxon';

const zone='Europe/Warsaw';
const drawKey='daily-delivery-roster';

// Ashe Moore, Layla Cristallo, Bianka Moore i Sonic Savage są celowo pominięte.
export const deliveryRosterPeople=Object.freeze([
 'Raxon Moore','Ivan Morozov','Leo Stevens-Kennedy','Victoria Valentino',
 'Nicole Valentino','Goldi Bradley','Johny Pack','Niko Nevarez',
 'Ivo Carter','Karim Babahassan','David Copperfield','Jacob Mein',
 'Markos Valientierra','Alex Maddox','Gregory Moore-Carbonara','Mary Smith',
 'Johnny Power','Johnny Crisp','Xavier Moore','Harry Correa',
 'Marcus Shark','Sergio Benavidez','James Ramirez','Kim Irrsen'
]);

export const deliveryRosterDay=(now=new Date())=>{
 const local=DateTime.fromJSDate(now,{zone});
 return local.hour>=10?local.toISODate():null;
};

const shuffled=(items,random=Math.random)=>{
 const copy=[...items];
 for(let index=copy.length-1;index>0;index--){
  const swap=Math.floor(random()*(index+1));
  [copy[index],copy[swap]]=[copy[swap],copy[index]];
 }
 return copy;
};
const pickLeastAssigned=(rows,excluded,random)=>{
 const names=new Set(excluded);
 const available=rows.filter(row=>!names.has(row.person));
 const lowest=Math.min(...available.map(row=>Number(row.assignments)));
 return shuffled(available.filter(row=>Number(row.assignments)===lowest),random)[0].person;
};
const savedDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:DateTime.fromJSDate(new Date(value),{zone}).toISODate();

export async function dailyDeliveryRoster(db,now=new Date(),random=Math.random){
 const day=deliveryRosterDay(now);
 if(!day)return null;
 return db.lock(drawKey,()=>db.transaction(async tx=>{
  const existing=(await tx.query('SELECT day,fridge_name,deliveries_name,delivered FROM daily_delivery_draws WHERE day=$1',[day])).rows[0];
  if(existing)return existing.delivered?null:{day:savedDay(existing.day),fridge:existing.fridge_name,deliveries:existing.deliveries_name};
  for(const person of deliveryRosterPeople)await tx.query("INSERT INTO delivery_roster_progress(person,assignments) VALUES($1,0) ON CONFLICT(person) DO NOTHING",[person]);
  const rows=(await tx.query('SELECT person,assignments FROM delivery_roster_progress WHERE person = ANY($1::text[]) ORDER BY assignments,person',[deliveryRosterPeople])).rows;
  const previous=(await tx.query('SELECT fridge_name,deliveries_name FROM daily_delivery_draws ORDER BY day DESC LIMIT 1')).rows[0];
  const previousPeople=previous?[previous.fridge_name,previous.deliveries_name]:[];
  const fridge=pickLeastAssigned(rows,previousPeople,random);
  const deliveries=pickLeastAssigned(rows,[...previousPeople,fridge],random);
  await tx.query('INSERT INTO daily_delivery_draws(day,fridge_name,deliveries_name) VALUES($1,$2,$3)',[day,fridge,deliveries]);
  await tx.query('UPDATE delivery_roster_progress SET assignments=assignments+1,updated_at=now() WHERE person=ANY($1::text[])',[[fridge,deliveries]]);
  return {day,fridge,deliveries};
 }));
}

export const markDailyDeliveryRosterDelivered=(db,day)=>db.q('UPDATE daily_delivery_draws SET delivered=true WHERE day=$1',[day]);

