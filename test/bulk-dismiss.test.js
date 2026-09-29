import test from 'node:test';
import assert from 'node:assert/strict';
import {bulkDismiss,dismissalTargets} from '../src/bulk-dismiss.js';
import {commands} from '../src/bot.js';
const a='111111111111111111',b='222222222222222222';
test('oznaczenia i ID, deduplikacja, odrzucenie niepełnej listy',()=>{
 assert.deepEqual(dismissalTargets(`<@${a}>, <@!${b}>; ${a}`),[a,b]);
 for(const bad of ['@Sonic',`<@&${a}>`,`${a} ktoś`,Array.from({length:21},(_,i)=>String(100000000000000000n+BigInt(i))).join(' ')])assert.throws(()=>dismissalTargets(bad));
 const cmd=commands().find(c=>c.name==='zwolnij');assert.equal(cmd.options[0].name,'osoby');assert.equal(cmd.options[0].type,3);
});
test('błąd jednej osoby nie zatrzymuje pozostałych, osobne klucze operacji',async()=>{
 const calls=[];const svc={authorize:async()=>{},run:async args=>{calls.push(args);if(args.targetId===a)throw {code:10007};}};
 const result=await bulkDismiss(svc,{people:`${a} ${b} ${a}`,reason:'Czystki',actorId:'actor',channelId:'channel',requestId:'req'});
 assert.equal(calls.length,2);assert.equal(result[0].ok,false);assert.equal(result[1].ok,true);assert.deepEqual(calls.map(c=>c.requestId),[`req:${a}`,`req:${b}`]);assert.ok(calls.every(c=>c.reason==='Czystki'));
 calls.length=0;await assert.rejects(()=>bulkDismiss(svc,{people:`${a} invalid`,reason:'Czystki'}));assert.equal(calls.length,0);
 svc.authorize=async()=>{throw new Error('Brak dostępu');};await assert.rejects(()=>bulkDismiss(svc,{people:a,reason:'Czystki'}));assert.equal(calls.length,0);
});
