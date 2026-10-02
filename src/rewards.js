import {DateTime} from 'luxon';
import {config} from './config.js';

const rewardQuery=(cutoff=false,onlyNew=false)=>`SELECT l.id,l.target_id,l.created_at,'plus' AS kind,NULL::text AS prize FROM logs l
  LEFT JOIN reported_rewards r ON r.log_id=l.id
  LEFT JOIN reward_reports report ON report.cutoff=r.cutoff
  WHERE l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4
    AND (l.details->>'after')::int=0 AND report.settled_at IS NULL ${onlyNew?'AND r.log_id IS NULL':''} ${cutoff?'AND l.created_at<=$1':''}
  UNION ALL
  SELECT l.id,l.target_id,l.created_at,'wheel' AS kind,l.details->>'prize' AS prize FROM logs l
  LEFT JOIN reported_rewards r ON r.log_id=l.id
  LEFT JOIN reward_reports report ON report.cutoff=r.cutoff
  WHERE l.category='kolo' AND l.status='success' AND coalesce(l.details->>'prize','')<>''
    AND report.settled_at IS NULL ${onlyNew?'AND r.log_id IS NULL':''} ${cutoff?'AND l.created_at<=$1':''}
  ORDER BY created_at,id`;

async function pendingRewards(db,cutoff,onlyNew=false){
  const query=rewardQuery(Boolean(cutoff),onlyNew);
  const result=typeof db.q==='function'?await db.q(query,cutoff?[cutoff]:[]):await db.query(query,cutoff?[cutoff]:[]);
  return result.rows;
}

function entries(rows){
  const plus=new Map(),wheel=[];
  for(const item of rows){
    if(item.kind==='wheel')wheel.push({created_at:item.created_at,text:`🎡 <@${item.target_id}> — **${item.prize}**`});
    else {
      const current=plus.get(item.target_id)||{created_at:item.created_at,count:0};
      current.count++;if(new Date(item.created_at)<new Date(current.created_at))current.created_at=item.created_at;
      plus.set(item.target_id,current);
    }
  }
  return [...plus.entries()].map(([id,item])=>({created_at:item.created_at,text:`⭐ <@${id}> — **${item.count} × nagroda za 5/5**`})).concat(wheel).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
}

function summary(rows){
  const plus=rows.filter(row=>row.kind==='plus').length,wheel=rows.filter(row=>row.kind==='wheel').length;
  return `5/5: **${plus}** · Koło: **${wheel}** · Razem: **${plus+wheel}**`;
}

export async function previewRewards(db,page=1){
  const rows=await pendingRewards(db);
  const listEntries=entries(rows),pages=Math.max(1,Math.ceil(listEntries.length/40));page=Math.max(1,Math.min(page,pages));
  const list=listEntries.slice((page-1)*40,page*40).map((entry,index)=>`${(page-1)*40+index+1}. ${entry.text}`).join('\n');
  return {title:'💰 BurgerShot • Podgląd nagród',description:rows.length?`**${summary(rows)}**\n\n${list}\n\nStrona **${page}/${pages}**. Kolejna: /nagrody strona:${Math.min(page+1,pages)}\nNagrody wypłaca Zarząd w niedzielę. Lista obejmuje nagrody za 5/5 oraz nagrody wylosowane na kole. Przycisk Rozliczono zamyka wyłącznie to zestawienie.`:'Brak nagród oczekujących na rozliczenie.'};
}

export function rewardCutoff(now=new Date()) {
  const local=DateTime.fromJSDate(now,{zone:'Europe/Warsaw'});
  let sunday=local.startOf('week').plus({days:6}).set({hour:20});
  if(sunday>local)sunday=sunday.minus({weeks:1});
  return sunday.toJSDate();
}

// Queue the report and record its entries atomically; Discord delivery retries independently.
export async function queueRewards(db,now=new Date()) {
  const cutoff=rewardCutoff(now);
  return db.lock('weekly-rewards',()=>db.transaction(async tx=>{
    const inserted=await tx.query('INSERT INTO reward_reports(cutoff) VALUES($1) ON CONFLICT DO NOTHING RETURNING cutoff',[cutoff]);
    if(!inserted.rows.length)return;
    const rows=await pendingRewards(tx,cutoff,true);
    if(!rows.length)return;
    const listEntries=entries(rows),date=DateTime.fromJSDate(cutoff,{zone:'Europe/Warsaw'}).toFormat('dd.MM.yyyy');
    for(let i=0;i<listEntries.length;i+=40) {
      const body=`**${summary(rows)}**\n\n${listEntries.slice(i,i+40).map((entry,index)=>`${i+index+1}. ${entry.text}`).join('\n')}\n\nNagrody wypłaca Zarząd w niedzielę. Po wypłacie lub wydaniu nagród zarząd może oznaczyć to zestawienie przyciskiem Rozliczono.`;
      await tx.query('INSERT INTO notifications(channel_id,title,body,role_id,reward_cutoff) VALUES($1,$2,$3,$4,$5)',[config.logs,`💰 BurgerShot • Nagrody • ${date}`,body,i===0?config.staff:null,cutoff.toISOString()]);
    }
    for(const row of rows)await tx.query('INSERT INTO reported_rewards(log_id,cutoff) VALUES($1,$2)',[row.id,cutoff]);
  }));
}
