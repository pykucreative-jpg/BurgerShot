import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketName,transcriptHtml} from '../src/bingo.js';

test('nazwa ticketu Bingo używa imienia i nazwiska pracownika',()=>{
 assert.equal(ticketName('Markos Valentierra'),'bingo-markos-valentierra');
 assert.equal(ticketName('[P] Łukasz Żółć'),'bingo-lukasz-zolc');
});

test('archiwum Bingo zapisuje treść i odnośniki do załączników',()=>{
 const html=transcriptHtml({user_name:'Markos Valentierra',channel_name:'bingo-markos'},[{author:{displayName:'Markos'},createdTimestamp:Date.now(),content:'Zadanie <#4>',attachments:new Map([['x',{name:'dowod.mp4',url:'https://cdn.example/dowod.mp4'}]])}]);
 assert.match(html,/Zadanie &lt;#4&gt;/);assert.match(html,/dowod\.mp4/);assert.match(html,/https:\/\/cdn\.example\/dowod\.mp4/);
});

