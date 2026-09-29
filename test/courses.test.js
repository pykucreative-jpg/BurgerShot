import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {courseDay,courseReminder} from '../src/courses.js';
test('kursy o 20:00 czasu polskiego latem i zimą',()=>{
  assert.equal(courseDay(new Date('2026-09-29T17:59:59Z')),null);
  assert.equal(courseDay(new Date('2026-09-29T18:00:00Z')),'2026-09-29');
  assert.equal(courseDay(new Date('2026-12-01T18:59:59Z')),null);
  assert.equal(courseDay(new Date('2026-12-01T19:00:00Z')),'2026-12-01');
});
test('jeden wpis na dzień, poprawny ping, restart i kolejny dzień',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
  const db={transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
  const run=courseReminder(db);
  assert.equal(await run(new Date('2026-09-29T17:59:59Z')),false);
  assert.equal(await run(new Date('2026-09-29T18:00:00Z')),true);
  assert.equal(await courseReminder(db)(new Date('2026-09-29T19:00:00Z')),false);
  const row=(await pg.query('SELECT * FROM notifications')).rows[0];
  assert.equal(row.channel_id,'1502335151324004457');assert.equal(row.role_id,'1465037223350243390');
  assert.equal(row.body,'ZAPRASZAMY NA KURSY JEST NORMA DO WYROBIENIA');
  assert.equal(await run(new Date('2026-09-30T18:00:00Z')),true);
  assert.equal((await pg.query('SELECT * FROM notifications')).rows.length,2);
});
