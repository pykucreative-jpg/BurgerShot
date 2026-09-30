import {DateTime} from 'luxon';
import {config} from './config.js';

export async function previewRewards(db,page=1){
  const {rows}=await db.q(`SELECT l.target_id,count(*)::int AS count FROM logs l
    LEFT JOIN reported_rewards r ON r.log_id=l.id
    LEFT JOIN reward_reports report ON report.cutoff=r.cutoff
    WHERE l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4
    AND (l.details->>'after')::int=0 AND report.settled_at IS NULL
    GROUP BY l.target_id ORDER BY min(l.created_at),l.target_id`);
  const pages=Math.max(1,Math.ceil(rows.length/40));page=Math.max(1,Math.min(page,pages));
  const total=rows.reduce((sum,r)=>sum+r.count,0);
  const list=rows.slice((page-1)*40,page*40).map((r,index)=>`${(page-1)*40+index+1}. <@${r.target_id}> — **${r.count} × nagroda za 5/5**`).join('\n');
  return {title:'💰 BurgerShot • Podgląd nagród',description:rows.length?`**Osoby: ${rows.length} • Nagrody: ${total}**\n\n${list}\n\nStrona **${page}/${pages}**. Kolejna: /nagrody strona:${Math.min(page+1,pages)}\nTo podgląd nagród oczekujących na rozliczenie. Nie potwierdza wypłaty i nie zmienia listy.`:'Brak nagród oczekujących na rozliczenie.'};
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
    const {rows}=await tx.query(`SELECT l.id,l.target_id FROM logs l
      LEFT JOIN reported_rewards r ON r.log_id=l.id
      WHERE l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4
      AND (l.details->>'after')::int=0 AND l.created_at<=$1 AND r.log_id IS NULL
      ORDER BY l.created_at,l.id`,[cutoff]);
    if(!rows.length)return;
    const counts=new Map();
    for(const r of rows)counts.set(r.target_id,(counts.get(r.target_id)||0)+1);
    const lines=[...counts].map(([id,count],i)=>`${i+1}. <@${id}> — ${count} × nagroda za 5/5`);
    const date=DateTime.fromJSDate(cutoff,{zone:'Europe/Warsaw'}).toFormat('dd.MM.yyyy');
    for(let i=0;i<lines.length;i+=40) {
      const body=`Nagrody do odebrania u zarządu za ukończone cykle plusów.\n\n${lines.slice(i,i+40).join('\n')}\n\nPo wypłacie zarząd może oznaczyć to zestawienie przyciskiem Rozliczono.`;
      await tx.query('INSERT INTO notifications(channel_id,title,body,role_id,reward_cutoff) VALUES($1,$2,$3,$4,$5)',[config.logs,`💰 BurgerShot • Nagrody • ${date}`,body,i===0?config.staff:null,cutoff.toISOString()]);
    }
    for(const r of rows)await tx.query('INSERT INTO reported_rewards(log_id,cutoff) VALUES($1,$2)',[r.id,cutoff]);
  }));
}
