import test from 'node:test';
import assert from 'node:assert/strict';
import {DateTime} from 'luxon';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {mechanicDeliveries,mechanicLimitState,mechanicWeekWindow,mechanicWeeklyLimit} from '../src/mechanic-deliveries.js';
import {config} from '../src/config.js';

test('limit mechanika wynosi 210 i nie blokuje nadwyżki',()=>{
 assert.equal(mechanicWeeklyLimit,210);
 assert.deepEqual(mechanicLimitState(180),{delivered:180,remaining:30,over:0});
 assert.deepEqual(mechanicLimitState(225),{delivered:225,remaining:0,over:15});
});

test('tydzień mechanika resetuje się w niedzielę o 16:00 czasu polskiego',()=>{
 const before=mechanicWeekWindow(new Date('2026-11-01T14:59:00.000Z'));
 const after=mechanicWeekWindow(new Date('2026-11-01T15:00:00.000Z'));
 assert.equal(DateTime.fromJSDate(before.start).setZone('Europe/Warsaw').toISO(),'2026-10-25T16:00:00.000+01:00');
 assert.equal(DateTime.fromJSDate(after.start).setZone('Europe/Warsaw').toISO(),'2026-11-01T16:00:00.000+01:00');
});

test('dostawa mechanika sumuje ilość tygodnia i nalicza postęp każdej osobie',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 const db={q:(sql,params=[])=>pg.query(sql,params),lock:async(_key,fn)=>fn()};
 const member=id=>({id,roles:{cache:{has:role=>role===config.employee}}});
 const calls=[];
 const svc={member:async id=>member(id),recordDelivery:async(id,requestId)=>{calls.push([id,requestId]);return {userId:id,bonus:false,duplicate:false};}};
 const mechanic=mechanicDeliveries(db,svc);
 const first=await mechanic.record({actorId:'actor',delivererIds:['one','two'],quantity:200,recipient:'Alex Smith',requestId:'mechanic-1'});
 assert.deepEqual(calls,[['one','mechanic-1'],['two','mechanic-1']]);assert.equal(first.delivered,200);assert.equal(first.remaining,10);assert.equal(first.over,0);
 const second=await mechanic.record({actorId:'actor',delivererIds:['one'],quantity:25,proofUrl:'https://example.test/id.png',requestId:'mechanic-2'});
 assert.equal(second.delivered,225);assert.equal(second.remaining,0);assert.equal(second.over,15);
});

