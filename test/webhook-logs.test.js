import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {parseWebhookLog,webhookNotice,ingestWebhookLog,sourceChannel,matchEmployee,processWebhookLogs} from '../src/webhook-logs.js';
const title='BURGERSHOT - Zmiana stopnia';
test('rozpoznaje cztery formaty i odróżnia awans od degradacji',()=>{
 const promotion=parseWebhookLog(title,'**Abdul Grushinski** zmienił(a) stopień pracownika **Harry Correa** z **Pracownik** na **Starszy Pracownik**.');
 assert.equal(promotion.kind,'awans');assert.equal(promotion.person,'Harry Correa');assert.match(webhookNotice(promotion).body,/Wyrobienie normy awansowej/);
 const demotion=parseWebhookLog(title,'Sonic Savage zmienił(a) stopień pracownika Harry Correa\nz Starszy Pracownik na Pracownik.');
 assert.equal(demotion.kind,'degrad');assert.match(webhookNotice(demotion).body,/Brak wyrobionej normy/);
 const leave=parseWebhookLog('BURGERSHOT - Urlop pracownika','Ashe Moore wysłał(a) na urlop pracownika Basile Savage (bezterminowo).');assert.equal(leave.person,'Basile Savage');assert.equal(webhookNotice(leave).channel,'1502336468016828567');
 const dismissal=parseWebhookLog('BURGERSHOT - Zwolnienie\nPracownika','David Alfonso zwolnił(a) gracza Oscar Koby z firmy Burgershot\nIdentifier: `char1:1163815030274396301`');assert.equal(dismissal.person,'Oscar Koby');assert.ok(!webhookNotice(dismissal).body.includes('char1'));
 assert.equal(parseWebhookLog(title,'A zmienił(a) stopień pracownika B z Szef na Nieznany.'),null);
 assert.equal(parseWebhookLog(title,'A zmienił(a) stopień pracownika B z Pracownik na Pracownik.'),null);
});
test('tylko webhook na źródle; trwała deduplikacja i brak zmian kadrowych',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 const db={transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
 const m={id:'123',guildId:'guild',channelId:sourceChannel,webhookId:'webhook',embeds:[{title,description:'A zmienił(a) stopień pracownika B z Pracownik na Starszy Pracownik.'}]};
 assert.equal(await ingestWebhookLog(db,{...m,webhookId:null},'guild'),false);assert.equal(await ingestWebhookLog(db,{...m,channelId:'other'},'guild'),false);
 assert.equal(await ingestWebhookLog(db,m,'guild'),true);assert.equal(await ingestWebhookLog(db,m,'guild'),false);
 assert.equal((await pg.query('SELECT * FROM notifications')).rows.length,0);assert.equal((await pg.query('SELECT status FROM imported_webhook_logs')).rows[0].status,'pending');
 for(const table of ['employees','logs','leaves'])assert.equal((await pg.query('SELECT * FROM '+table)).rows.length,0);
});

test('zdjęcie urlopu i jednoznaczne nazwisko',()=>{
 const e=parseWebhookLog('BURGERSHOT - Zdjęcie urlopu','**Sonic Savage** zdjął(ęła) urlop pracownikowi **Abdul Grushinski**.');
 assert.equal(e.kind,'zdejmijurlop');assert.equal(e.person,'Abdul Grushinski');assert.equal(webhookNotice(e,'123').channel,'1502336468016828567');assert.ok(webhookNotice(e,'123').body.includes('<@123>'));
 const m={id:'1',displayName:'[P] Abdul Grushinski [urlop]',user:{bot:false}};
 assert.equal(matchEmployee(e.person,new Map([['1',m]]),[]),'1');
 assert.throws(()=>matchEmployee(e.person,new Map([['1',m],['2',{...m,id:'2'}]]),[]),/Kilka/);
 assert.throws(()=>matchEmployee('Abdul Inny',new Map([['1',m]]),[]),/Nie znaleziono/);
});

test('kolejka wykonuje raz, oznacza osobę i zatrzymuje niejednoznaczne logi',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(await readFile(new URL('../src/schema.sql',import.meta.url),'utf8'));
 const db={q:(s,p)=>pg.query(s,p),lock:async(k,fn)=>fn(),transaction:fn=>pg.transaction(tx=>fn({query:(s,p)=>tx.query(s,p)}))};
 const m={id:'567',guildId:'guild',channelId:sourceChannel,webhookId:'hook',embeds:[{title,description:'Sonic Savage zmienił(a) stopień pracownika Jan Kowalski z Pracownik na Starszy Pracownik.'}]};
 const members=new Map([['123',{id:'123',displayName:'Jan Kowalski',user:{bot:false}}]]);let calls=0;
 const svc={guild:async()=>({members:{fetch:async()=>members}}),applyWebhook:async()=>{calls++;}};
 await ingestWebhookLog(db,m,'guild');await processWebhookLogs(db,svc);await processWebhookLogs(db,svc);
 assert.equal(calls,1);let rows=(await pg.query('SELECT * FROM notifications')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,'123');assert.notEqual(rows[0].channel_id,sourceChannel);
 members.set('456',{id:'456',displayName:'Jan Kowalski',user:{bot:false}});
 await ingestWebhookLog(db,{...m,id:'568'},'guild');await processWebhookLogs(db,svc);assert.equal(calls,1);
 assert.equal((await pg.query("SELECT status FROM imported_webhook_logs WHERE message_id='568'")).rows[0].status,'failed');
});
