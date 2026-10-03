import test from 'node:test';
import assert from 'node:assert/strict';
import {tablet} from '../src/tablet.js';
import {card} from '../src/bot.js';
const owner='111111111111111111',target='222222222222222222';
function setup(){
 const calls=[];
 const svc={authorize:async()=>{},member:async()=>({user:{bot:false},displayName:'Jan'}),employee:async()=>({rank:'Rekrut',plus_count:2,minus_count:0}),run:async args=>{calls.push(args);return {art:'plus',title:'Dobra robota'};}};
 const published=[];const panel=tablet({q:async()=>({rows:[]})},svc,card,async(...args)=>{published.push(args[1]);},()=> '333333333333333333');
 const interaction=id=>({customId:id,user:{id:owner},values:[target],channelId:'channel',id:'request',fields:{getTextInputValue:()=> 'Powód'},isUserSelectMenu:()=>true,isButton:()=>true,isModalSubmit:()=>true,isFromMessage:()=>true,deferReply:async function(){this.deferred=true;},deferUpdate:async function(){this.deferred=true;this.updated=true;},editReply:async function(p){this.result=p;},reply:async function(p){this.error=p;},showModal:async function(p){this.modal=p;}});
 return {panel,svc,calls,published,interaction};
}
test('stały wybór pracownika otwiera prywatny widok; akcja aktualizuje tę samą wiadomość',async()=>{
 const {panel,calls,published,interaction}=setup();const pick=interaction('tablet:pick');await panel.handle(pick);assert.equal(pick.result.components.length,4);assert.match(pick.result.embeds[0].data.fields[0].value,/Jan/);
 const button=interaction(`tablet:action:${owner}:${target}:plus`);await panel.handle(button);assert.ok(button.modal);
 const submit=interaction(`tablet:submit:${owner}:${target}:plus`);await panel.handle(submit);assert.equal(submit.updated,true);assert.equal(calls.length,1);assert.equal(calls[0].targetId,target);assert.equal(calls[0].channelId,'333333333333333333');assert.equal(published[0].art,'plus');assert.match(submit.result.embeds[0].data.description,/Wiadomość wysłana/);
});
test('panel odrzuca obcego właściciela i odebraną rangę kadry',async()=>{
 const {panel,svc,calls,interaction}=setup();const foreign=interaction(`tablet:submit:999999999999999999:${target}:zwolnij`);await panel.handle(foreign);assert.ok(foreign.error);assert.equal(calls.length,0);
 svc.authorize=async()=>{throw new Error('denied');};const submit=interaction(`tablet:submit:${owner}:${target}:zwolnij`);await panel.handle(submit);assert.ok(submit.error);assert.equal(calls.length,0);
});

test('restart edytuje zapisany panel zamiast wysyłać duplikat',async()=>{
 let saved,sends=0,edits=0;
 const db={lock:async(k,fn)=>fn(),q:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows:saved?[saved]:[]};saved={channel_id:args[0],message_id:args[1]};return {rows:[]};}};
 const client={channels:{fetch:async()=>({id:'1502336969605251102',send:async()=>{sends++;return {id:'message'};},messages:{fetch:async()=>({edit:async()=>{edits++;}})}})}};
 const p=tablet(db,{},card,()=>{},()=>{});await p.panel(client);await p.panel(client);assert.equal(sends,1);assert.equal(edits,1);
});

test('wyszukiwanie: formularz, wiele wyników i ID, bez wykonywania działań',async()=>{
 const {panel,svc,calls,interaction}=setup();
 const open=interaction('tablet:open');await panel.handle(open);assert.equal(open.result.components[0].components[0].data.label,'🔎 Wyszukaj');
 const search=interaction('tablet:search:'+owner);await panel.handle(search);assert.ok(search.modal);
 svc.guild=async()=>({members:{search:async()=>new Map([[target,{id:target,displayName:'Jan',user:{username:'jan',bot:false}}],['333333333333333333',{id:'333333333333333333',displayName:'Jan Drugi',user:{username:'jan2',bot:false}}]])}});
 const find=interaction('tablet:find:'+owner);find.fields.getTextInputValue=()=> 'Jan';await panel.handle(find);assert.equal(find.result.components[0].components[0].options.length,2);
 const exact=interaction('tablet:find:'+owner);exact.fields.getTextInputValue=()=>target;await panel.handle(exact);assert.match(exact.result.embeds[0].data.fields[0].value,/Jan/);assert.equal(calls.length,0);
});

