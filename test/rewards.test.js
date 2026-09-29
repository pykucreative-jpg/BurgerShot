import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {rewardCutoff,queueRewards} from '../src/rewards.js';
test('niedziela 20:00 czasu polskiego, również zmiana czasu',()=>{
  assert.equal(rewardCutoff(new Date('2026-10-04T17:59:00Z')).toISOString(),'2026-09-27T18:00:00.000Z');
  assert.equal(rewardCutoff(new Date('2026-10-04T18:00:00Z')).toISOString(),'2026-10-04T18:00:00.000Z');
  assert.equal(rewardCutoff(new Date('2026-10-25T19:00:00Z')).toISOString(),'2026-10-25T19:00:00.000Z');
});
test('nagrody przetrwają reset, restart nie powiela raportu, następny tydzień obejmuje nowe cykle',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
  const db={lock:async(k,fn)=>fn(),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
  const add=async(date,status='success')=>pg.query(`INSERT INTO logs(category,actor_id,actor_name,target_id,details,status,created_at) VALUES('plus','1','Zarząd','123','{"before":4,"after":0}',$1,$2)`,[status,date]);
  await add('2026-10-01T10:00:00Z');await add('2026-10-02T10:00:00Z');await add('2026-10-02T11:00:00Z','failed');
  await queueRewards(db,new Date('2026-10-04T17:59:00Z'));assert.equal((await pg.query('SELECT * FROM notifications')).rows.length,0);
  await queueRewards(db,new Date('2026-10-04T18:00:00Z'));await queueRewards(db,new Date('2026-10-05T10:00:00Z'));
  let rows=(await pg.query('SELECT * FROM notifications')).rows;assert.equal(rows.length,1);assert.match(rows[0].body,/2 × nagroda/);
  await add('2026-10-05T12:00:00Z');await queueRewards(db,new Date('2026-10-12T10:00:00Z'));
  rows=(await pg.query('SELECT * FROM notifications ORDER BY id')).rows;assert.equal(rows.length,2);assert.match(rows[1].body,/1 × nagroda/);assert.equal((await pg.query('SELECT * FROM reported_rewards')).rows.length,3);
});
