import {DateTime} from 'luxon';
import {config} from './config.js';
import {UserError,text} from './domain.js';

export const mechanicWeeklyLimit=210;

export function mechanicWeekWindow(now=new Date()){
 const local=DateTime.fromJSDate(now,{zone:'Europe/Warsaw'});
 let start=local.startOf('day').minus({days:local.weekday%7}).set({hour:16});
 if(local<start)start=start.minus({weeks:1});
 return {start:start.toUTC().toJSDate(),end:start.plus({weeks:1}).toUTC().toJSDate()};
}

export const mechanicLimitState=total=>{
 const delivered=Number(total||0),over=Math.max(0,delivered-mechanicWeeklyLimit);
 return {delivered,remaining:Math.max(0,mechanicWeeklyLimit-delivered),over};
};

const hasFirmaDc=member=>member?.roles?.cache?.has(config.employee);
const cleanRecipient=value=>value?text(value,100).replace(/\s+/g,' ').trim():null;

export function mechanicDeliveries(db,svc){
 async function record({actorId,delivererIds,quantity,recipient,proofUrl,requestId}){
  const actor=await svc.member(actorId);
  if(!hasFirmaDc(actor))throw new UserError('Komenda /mechanik jest dostępna wyłącznie dla osób z rangą Firma DC.');
  const people=[...new Set(delivererIds.filter(Boolean))];
  if(!people.length||people.length>3)throw new UserError('Wskaż od 1 do 3 osób dostarczających.');
  const amount=Number(quantity);
  if(!Number.isInteger(amount)||amount<1||amount>10000)throw new UserError('Podaj poprawną liczbę dostarczonych części.');
  const receiver=cleanRecipient(recipient);
  if(!receiver&&!proofUrl)throw new UserError('Podaj odbiorcę albo dołącz zdjęcie dowodu osobistego.');
  const {start,end}=mechanicWeekWindow();
  return db.lock(`mechanik:${start.toISOString()}`,async()=>{
   const existing=(await db.q('SELECT quantity FROM mechanic_deliveries WHERE request_id=$1',[requestId])).rows[0];
   if(existing){
    const total=(await db.q('SELECT COALESCE(SUM(quantity),0)::int AS total FROM mechanic_deliveries WHERE created_at >= $1 AND created_at < $2',[start,end])).rows[0].total;
    return {...mechanicLimitState(total),amount:Number(existing.quantity),deliverers:[],progress:[],duplicate:true};
   }
   const deliverers=await Promise.all(people.map(id=>svc.member(id)));
   if(deliverers.some(member=>!hasFirmaDc(member)))throw new UserError('Każda osoba dostarczająca musi mieć rangę Firma DC.');
   const progress=await Promise.all(deliverers.map(member=>svc.recordDelivery(member.id,requestId)));
   await db.q('INSERT INTO mechanic_deliveries(request_id,delivered_by,created_by,recipient,proof_url,quantity) VALUES($1,$2,$3,$4,$5,$6)',[requestId,JSON.stringify(deliverers.map(member=>member.id)),actor.id,receiver,proofUrl||null,amount]);
   const total=(await db.q('SELECT COALESCE(SUM(quantity),0)::int AS total FROM mechanic_deliveries WHERE created_at >= $1 AND created_at < $2',[start,end])).rows[0].total;
   return {...mechanicLimitState(total),amount,deliverers,progress,recipient:receiver,duplicate:false};
  });
 }
 return {record};
}

