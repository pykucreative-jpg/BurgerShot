import test from 'node:test';
import assert from 'node:assert/strict';
import {badgeFor,badgeRanks,badges} from '../src/badges.js';
import {config} from '../src/config.js';
import {card} from '../src/bot.js';
const member=(ids,name='[S.P] Sonic Savage [urlop]')=>({displayName:name,roles:{cache:new Map(ids.map(id=>[id,{}]))}});
test('wszystkie stanowiska i najwyższa posiadana ranga, pierwsze imię',()=>{
 assert.equal(badgeRanks.length,10);
 for(const r of badgeRanks){const result=badgeFor(member([config.employee,r.id]));assert.equal(result.name,'Sonic');assert.equal(result.nickname,`/zmiennick [${r.code}] Sonic`);assert.ok(result.description.endsWith(`${r.color} [${r.label}]`));}
 assert.equal(badgeFor(member([config.employee,...badgeRanks.map(r=>r.id)])).rank,'Szef');
});
test('brak Firma Dc, brak stanowiska i niedozwolony tekst nie generują plakietki',()=>{
 assert.throws(()=>badgeFor(member([badgeRanks[0].id])),/Firma Dc/);
 assert.throws(()=>badgeFor(member([config.employee])),/stanowiska/);
 for(const name of ['[urlop]','```','~r~Sonic'])assert.throws(()=>badgeFor(member([config.employee,badgeRanks[0].id],name)));
});
test('generator ma jeden panel i prywatny wynik dla osoby klikającej',async()=>{
 let saved,sends=0,edits=0,requested;
 const db={lock:async(k,f)=>f(),q:async(s,p)=>{if(s.startsWith('SELECT'))return {rows:saved?[saved]:[]};saved={channel_id:p[0],message_id:p[1]};return {rows:[]};}};
 const client={channels:{fetch:async()=>({id:'1292911416516415592',send:async()=>{sends++;return {id:'panel'};},messages:{fetch:async()=>({edit:async()=>{edits++;}})}})}};
 const svc={member:async id=>{requested=id;return member([config.employee,badgeRanks[3].id]);}};
 const generator=badges(db,client,svc,card);await generator.panel();await generator.panel();assert.equal(sends,1);assert.equal(edits,1);
 const i={user:{id:'self'},deferReply:async p=>{assert.equal(p.flags,64);},editReply:async p=>{assert.match(p.embeds[0].data.fields[1].value,/\[S.P\] Sonic/);}};
 await generator.handle(i);assert.equal(requested,'self');
});

test('Pracownik Tygodnia dostaje dodatkowy opis, zachowując swoją rangę i nick',()=>{
 const ids=[config.employee,badgeRanks[3].id];const normal=badgeFor(member(ids));assert.equal(normal.weekly,null);
 const weekly=badgeFor(member([...ids,'1536106262859616347']));assert.equal(weekly.rank,normal.rank);assert.equal(weekly.nickname,normal.nickname);assert.equal(weekly.description,normal.description);assert.match(weekly.weekly,/~HC_179~ \[Pracownik Tygodnia\]/);assert.match(weekly.weekly,/\[Sonic\]/);
});
