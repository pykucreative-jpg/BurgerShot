import {DateTime} from 'luxon';
import {config} from './config.js';

const rewardQuery=(cutoff=false,onlyNew=false)=>`SELECT l.id,l.target_id,l.created_at,'plus' AS kind,NULL::text AS prize,
  coalesce(e.ic_name,l.target_name,l.target_id) AS name FROM logs l
  LEFT JOIN reported_rewards r ON r.log_id=l.id
  LEFT JOIN employees e ON e.user_id=l.target_id
  WHERE l.category='plus' AND l.status='success' AND (l.details->>'before')::int>=4
    AND (l.details->>'after')::int=0 AND (r.log_id IS NULL OR r.paid_at IS NULL)
    ${onlyNew?'AND r.log_id IS NULL':''} ${cutoff?'AND l.created_at<=$1':''}
  UNION ALL
  SELECT l.id,l.target_id,l.created_at,'wheel' AS kind,l.details->>'prize' AS prize,
  coalesce(e.ic_name,l.target_name,l.target_id) AS name FROM logs l
  LEFT JOIN reported_rewards r ON r.log_id=l.id
  LEFT JOIN employees e ON e.user_id=l.target_id
  WHERE l.category='kolo' AND l.status='success' AND coalesce(l.details->>'prize','')<>''
    AND (r.log_id IS NULL OR r.paid_at IS NULL)
    ${onlyNew?'AND r.log_id IS NULL':''} ${cutoff?'AND l.created_at<=$1':''}
  ORDER BY created_at,id`;

async function pendingRewards(db,cutoff,onlyNew=false){
  const query=rewardQuery(Boolean(cutoff),onlyNew);
  const result=typeof db.q==='function'?await db.q(query,cutoff?[cutoff]:[]):await db.query(query,cutoff?[cutoff]:[]);
  return result.rows;
}

function rewardText(item){return item.kind==='wheel'?`🎡 <@${item.target_id}> — **${item.prize}**`:`⭐ <@${item.target_id}> — **Nagroda za 5/5**`;}
function entry(item){return {...item,text:rewardText(item)};}

function summary(rows){
  const plus=rows.filter(row=>row.kind==='plus').length,wheel=rows.filter(row=>row.kind==='wheel').length;
  return `5/5: **${plus}** · Koło: **${wheel}** · Razem: **${plus+wheel}**`;
}

export async function previewRewards(db,page=1){
  const rows=await pendingRewards(db),listEntries=rows.map(entry),pages=Math.max(1,Math.ceil(listEntries.length/40));
  page=Math.max(1,Math.min(page,pages));
  const list=listEntries.slice((page-1)*40,page*40).map((item,index)=>`${(page-1)*40+index+1}. ${item.text}`).join('\n');
  return {title:'💰 BurgerShot • Podgląd nagród',description:rows.length?`**${summary(rows)}**\n\n${list}\n\nStrona **${page}/${pages}**. Kolejna: /nagrody strona:${Math.min(page+1,pages)}\nNagrody wypłaca Zarząd w niedzielę. Lista obejmuje nagrody za 5/5 oraz nagrody wylosowane na kole.`:'Brak nagród oczekujących na rozliczenie.'};
}

export async function rewardReport(db,cutoff,page=0){
  const sql=`SELECT l.id,l.target_id,l.created_at,'plus' AS kind,NULL::text AS prize,coalesce(e.ic_name,l.target_name,l.target_id) AS name
      FROM reported_rewards r JOIN logs l ON l.id=r.log_id LEFT JOIN employees e ON e.user_id=l.target_id
      WHERE r.cutoff=$1 AND r.paid_at IS NULL AND l.category='plus'
      UNION ALL
      SELECT l.id,l.target_id,l.created_at,'wheel' AS kind,l.details->>'prize' AS prize,coalesce(e.ic_name,l.target_name,l.target_id) AS name
      FROM reported_rewards r JOIN logs l ON l.id=r.log_id LEFT JOIN employees e ON e.user_id=l.target_id
      WHERE r.cutoff=$1 AND r.paid_at IS NULL AND l.category='kolo'
      ORDER BY created_at,id`;
  const result=typeof db.q==='function'?await db.q(sql,[cutoff]):await db.query(sql,[cutoff]);
  const rows=result.rows,entries=rows.map(entry),pages=Math.max(1,Math.ceil(entries.length/25));
  page=Math.max(0,Math.min(Number(page)||0,pages-1));
  const current=entries.slice(page*25,page*25+25);
  const list=current.map((item,index)=>`${page*25+index+1}. ${item.text}`).join('\n');
  return {entries:current,page,pages,total:entries.length,description:entries.length?`**Pozostało: ${summary(rows)}**\n\n${list}\n\nWybierz z listy nagrodę po jej wypłacie. Rozliczona zostanie wyłącznie wybrana pozycja.`:'✅ Wszystkie nagrody z tego zestawienia zostały wypłacone.'};
}

export async function payReward(db,{cutoff,logId,actorId}){
  return db.transaction(async tx=>{
    const paid=await tx.query('UPDATE reported_rewards SET paid_at=now(),paid_by=$3 WHERE cutoff=$1 AND log_id=$2 AND paid_at IS NULL RETURNING log_id',[cutoff,logId,actorId]);
    if(!paid.rows.length)return {paid:false,complete:false};
    const left=await tx.query('SELECT count(*)::int AS count FROM reported_rewards WHERE cutoff=$1 AND paid_at IS NULL',[cutoff]);
    const complete=left.rows[0].count===0;
    if(complete)await tx.query('UPDATE reward_reports SET settled_at=now(),settled_by=$2 WHERE cutoff=$1 AND settled_at IS NULL',[cutoff,actorId]);
    return {paid:true,complete};
  });
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
    const listEntries=rows.map(entry),date=DateTime.fromJSDate(cutoff,{zone:'Europe/Warsaw'}).toFormat('dd.MM.yyyy');
    for(const row of rows)await tx.query('INSERT INTO reported_rewards(log_id,cutoff) VALUES($1,$2)',[row.id,cutoff]);
    for(let i=0;i<listEntries.length;i+=25) {
      const body=`**${summary(rows)}**\n\n${listEntries.slice(i,i+25).map((item,index)=>`${i+index+1}. ${item.text}`).join('\n')}\n\nWybierz nagrodę po jej wypłacie. Każde kliknięcie rozlicza wyłącznie jedną pozycję.`;
      await tx.query('INSERT INTO notifications(channel_id,title,body,role_id,reward_cutoff,reward_page) VALUES($1,$2,$3,$4,$5,$6)',[config.logs,`💰 BurgerShot • Nagrody • ${date}`,body,i===0?config.staff:null,cutoff.toISOString(),i/25]);
    }
  }));
}

