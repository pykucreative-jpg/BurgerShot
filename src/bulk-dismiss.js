import {UserError,text} from './domain.js';
export function dismissalTargets(value){
 const tokens=text(value,1000).split(/[\s,;]+/).filter(Boolean);
 const ids=tokens.map(token=>{
  const match=/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(token);
  if(!match)throw new UserError('Wpisz oznaczenia osób lub ich ID, oddzielone spacją. Nie podawaj ról ani samych nazw.');
  return match[1]||match[2];
 });
 const unique=[...new Set(ids)];
 if(unique.length>20)throw new UserError('Jednorazowo można zwolnić maksymalnie 20 osób.');
 return unique;
}
export async function bulkDismiss(svc,{people,reason,actorId,channelId,requestId}){
 const ids=dismissalTargets(people);reason=text(reason);
 await svc.authorize(actorId);
 const results=[];
 for(const targetId of ids){
  try{await svc.run({kind:'zwolnij',targetId,reason,actorId,channelId,requestId:`${requestId}:${targetId}`});results.push({id:targetId,ok:true});}
  catch(err){results.push({id:targetId,ok:false,error:err instanceof UserError?err.message:err.code===10007?'Osoba nie należy do serwera.':'Nie udało się ukończyć. Sprawdź logi i uprawnienia bota.'});}
 }
 return results;
}
