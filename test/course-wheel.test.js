import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {parseCourseLog,matchCourseEmployee,courseAccountId,courseEventKey,ingestCourseLog,recoverCourseLogsSince} from '../src/course-wheel.js';
import {sourceChannel} from '../src/webhook-logs.js';

test('odczytuje dokładny log ukończenia kursu ze screena i dopasowuje nazwę w nawiasie',()=>{
 const event=parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #4 dla burgershot.');
 assert.deepEqual(event,{player:'Buleczka72 [Markos Valentierra]',courseNumber:4});
 assert.deepEqual(parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #1 dla burgershot.'),{player:'Buleczka72 [Markos Valentierra]',courseNumber:1});
 assert.equal(matchCourseEmployee(event.player,[{user_id:'123',username:'buleczka72',ic_name:'Markos Valentierra'}]),'123');
 assert.equal(matchCourseEmployee('Dawidowe [David Alfonso]',[{id:'456',displayName:'[P] David Alfonso [urlop]',user:{username:'dawidowe',bot:false}}]),'456');
 assert.equal(courseAccountId('Pandaaaa [Ashe Moore]'),'920043294711504976');
 assert.equal(courseEventKey(event,'2026-10-05T19:18:00.000Z'),courseEventKey(event,'2026-10-05T19:19:00.000Z'));
 assert.notEqual(courseEventKey(event,'2026-10-05T19:18:00.000Z'),courseEventKey(event,'2026-10-05T19:20:00.000Z'));
 assert.equal(matchCourseEmployee('Buleczka72 [Markos Valentierra]',[
  {id:'457',displayName:'[P] Markos Valentierra [urlop]',user:{username:'buleczka72',bot:false}},
  {id:'458',displayName:'[S] Markos Valentierra [szkolenie]',user:{username:'innaosoba',bot:false}}
 ]),'457');
 assert.equal(parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #3 dla burgershot.'),null);
 assert.equal(parseCourseLog('BURGERSHOT Zakończenie Kursu','Nieprawidłowa wiadomość'),null);
});

test('zapisuje każdy odrębny log #4, także gdy BurgerShot wysyła go jako aplikacja',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 const db={transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}) )};
 const message={guildId:'guild',channelId:sourceChannel,webhookId:null,applicationId:'burgershot-app',embeds:[{title:'BURGERSHOT Zakończenie Kursu',description:'Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #4 dla burgershot.'}]};
 assert.equal(await ingestCourseLog(db,{...message,id:'course-one',createdTimestamp:1000},'guild'),true);
 assert.equal(await ingestCourseLog(db,{...message,id:'course-two',createdTimestamp:2000},'guild'),true);
 assert.equal(await ingestCourseLog(db,{...message,id:'course-one',createdTimestamp:1000},'guild'),false);
 assert.equal((await pg.query('SELECT count(*)::int AS count FROM imported_courses')).rows[0].count,2);
});

test('odzyskuje wyłącznie Kurs #4 z historii od wskazanej godziny',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 const db={q:(s,p)=>pg.query(s,p),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
 const course=(id,time,number)=>({id,guildId:'guild',channelId:sourceChannel,webhookId:'hook',createdTimestamp:time,embeds:[{title:'BURGERSHOT Zakończenie Kursu',description:`Gracz A [Adam Kowalski] zakończył Kurs #${number} dla burgershot.`}]});
 const messages=new Map([['new',course('new',2000,4)],['first',course('first',1500,1)],['old',course('old',500,4)]]);
 const client={channels:{fetch:async()=>({messages:{fetch:async()=>messages}})}};
 assert.equal(await recoverCourseLogsSince(db,client,'guild',new Date(1000)),1);
 assert.equal((await pg.query('SELECT count(*)::int AS count FROM imported_courses')).rows[0].count,1);
 assert.equal(await recoverCourseLogsSince(db,client,'guild',new Date(1000)),0);
});

