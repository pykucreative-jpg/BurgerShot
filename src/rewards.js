import {DateTime} from 'luxon';
import {config} from './config.js';

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
      const body=`Nagrody do odebrania u zarządu za ukończone cykle plusów.\n\n${lines.slice(i,i+40).join('\n')}\n\nZestawienie nowych nagród — nie jest potwierdzeniem wypłaty.`;
      await tx.query('INSERT INTO notifications(channel_id,title,body,role_id) VALUES($1,$2,$3,$4)',[config.logs,`💰 BurgerShot • Nagrody • ${date}`,body,i===0?config.staff:null]);
    }
    for(const r of rows)await tx.query('INSERT INTO reported_rewards(log_id,cutoff) VALUES($1,$2)',[r.id,cutoff]);
  }));
}
