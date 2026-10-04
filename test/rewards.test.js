import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {rewardCutoff,queueRewards,previewRewards,rewardReport,payReward} from '../src/rewards.js';
test('niedziela 20:00 czasu polskiego, również zmiana czasu',()=>{
  assert.equal(rewardCutoff(new Date('2026-10-04T17:59:00Z')).toISOString(),'2026-09-27T18:00:00.000Z');
  assert.equal(rewardCutoff(new Date('2026-10-04T18:00:00Z')).toISOString(),'2026-10-04T18:00:00.000Z');
  assert.equal(rewardCutoff(new Date('2026-10-25T19:00:00Z')).toISOString(),'2026-10-25T19:00:00.000Z');
});
test('nagrody przetrwają reset, restart nie powiela raportu, następny tydzień obejmuje nowe cykle',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
  const db={q:(s,p)=>pg.query(s,p),lock:async(k,fn)=>fn(),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
  const add=async(date,status='success')=>pg.query(`INSERT INTO logs(category,actor_id,actor_name,target_id,details,status,created_at) VALUES('plus','1','Zarząd','123','{"before":4,"after":0}',$1,$2)`,[status,date]);
  const wheel=async(date)=>pg.query(`INSERT INTO logs(category,actor_id,actor_name,target_id,details,status,created_at) VALUES('kolo','1','Zarząd','456','{"prize":"📷 Aparat"}','success',$1)`,[date]);
  await add('2026-10-01T10:00:00Z');await add('2026-10-02T10:00:00Z');await add('2026-10-02T11:00:00Z','failed');await wheel('2026-10-03T10:00:00Z');
  const preview=await previewRewards(db);assert.match(preview.description,/Nagroda za 5\/5/);assert.match(preview.description,/Aparat/);assert.equal((await pg.query('SELECT * FROM reported_rewards')).rows.length,0);
  await queueRewards(db,new Date('2026-10-04T17:59:00Z'));assert.equal((await pg.query('SELECT * FROM notifications')).rows.length,0);
  await queueRewards(db,new Date('2026-10-04T18:00:00Z'));await queueRewards(db,new Date('2026-10-05T10:00:00Z'));
  let rows=(await pg.query('SELECT * FROM notifications')).rows;assert.equal(rows.length,1);assert.match((await previewRewards(db)).description,/Nagroda za 5\/5/);assert.match((await previewRewards(db)).description,/Aparat/);assert.equal(rows[0].role_id,'1295044894825381950');assert.equal(rows[0].channel_id,'1554530259481665656');assert.match(rows[0].body,/Wybierz nagrodę/);assert.equal(rows[0].reward_page,0);
  const cutoff='2026-10-04T18:00:00.000Z',report=await rewardReport(db,cutoff);assert.equal(report.entries.length,3);
  const one=await payReward(db,{cutoff,logId:report.entries[0].id,actorId:'1'});assert.deepEqual(one,{paid:true,complete:false});
  assert.equal((await rewardReport(db,cutoff)).entries.length,2);assert.equal((await pg.query('SELECT settled_at FROM reward_reports WHERE cutoff=$1',[cutoff])).rows[0].settled_at,null);
  await add('2026-10-05T12:00:00Z');assert.match((await previewRewards(db)).description,/Nagroda za 5\/5/);
  for(const item of (await rewardReport(db,cutoff)).entries)await payReward(db,{cutoff,logId:item.id,actorId:'1'});
  assert.notEqual((await pg.query('SELECT settled_at FROM reward_reports WHERE cutoff=$1',[cutoff])).rows[0].settled_at,null);
  await queueRewards(db,new Date('2026-10-12T10:00:00Z'));
  rows=(await pg.query('SELECT * FROM notifications ORDER BY id')).rows;assert.equal(rows.length,2);assert.match(rows[1].body,/Nagroda za 5\/5/);assert.equal((await pg.query('SELECT * FROM reported_rewards')).rows.length,4);
});

