import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {dailyDeliveryRoster,deliveryRosterDay,deliveryRosterPeople,markDailyDeliveryRosterDelivered} from '../src/delivery-roster.js';

const makeDb=async()=>{
 const pg=new PGlite();
 await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 return {pg,db:{q:(sql,params)=>pg.query(sql,params),lock:(_,work)=>work(),transaction:work=>pg.transaction(tx=>work({query:(sql,params)=>tx.query(sql,params)}))}};
};
const atTen=day=>new Date(`${day}T09:00:00Z`);

test('losowanie rusza o 10:00 czasu polskiego latem i zimą',()=>{
 assert.equal(deliveryRosterDay(new Date('2026-11-22T08:59:59Z')),null);
 assert.equal(deliveryRosterDay(new Date('2026-11-22T09:00:00Z')),'2026-11-22');
 assert.equal(deliveryRosterDay(new Date('2026-07-22T07:59:59Z')),null);
 assert.equal(deliveryRosterDay(new Date('2026-07-22T08:00:00Z')),'2026-07-22');
});

test('każda osoba dostaje jeden przydział przed pierwszym powtórzeniem',async t=>{
 const {pg,db}=await makeDb();t.after(()=>pg.close());
 const draws=[];
 for(let offset=0;offset<12;offset++){
  const day=new Date(Date.UTC(2026,10,22+offset)).toISOString().slice(0,10);
  draws.push(await dailyDeliveryRoster(db,atTen(day),()=>0.37));
 }
 const selected=draws.flatMap(draw=>[draw.fridge,draw.deliveries]);
 assert.equal(new Set(selected).size,deliveryRosterPeople.length);
 assert.deepEqual([...new Set(selected)].sort(),[...deliveryRosterPeople].sort());
 const counts=(await pg.query('SELECT person,assignments FROM delivery_roster_progress ORDER BY person')).rows;
 assert.ok(counts.every(row=>Number(row.assignments)===1));
 const next=await dailyDeliveryRoster(db,atTen('2026-12-04'),()=>0.37);
 const previousDay=new Set([draws.at(-1).fridge,draws.at(-1).deliveries]);
 assert.equal(previousDay.has(next.fridge),false);
 assert.equal(previousDay.has(next.deliveries),false);
});

test('ten sam dzień zachowuje parę, a po wysłaniu nie tworzy drugiej wiadomości',async t=>{
 const {pg,db}=await makeDb();t.after(()=>pg.close());
 const first=await dailyDeliveryRoster(db,atTen('2026-11-22'),()=>0.2);
 assert.deepEqual(await dailyDeliveryRoster(db,atTen('2026-11-22'),()=>0.9),first);
 await markDailyDeliveryRosterDelivered(db,first.day);
 assert.equal(await dailyDeliveryRoster(db,atTen('2026-11-22'),()=>0.9),null);
});

