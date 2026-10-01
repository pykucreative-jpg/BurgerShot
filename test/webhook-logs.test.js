import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {parseWebhookLog,webhookNotice,ingestWebhookLog,sourceChannel} from '../src/webhook-logs.js';
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
 const rows=(await pg.query('SELECT * FROM notifications')).rows;assert.equal(rows.length,1);assert.equal(rows[0].channel_id,'1502335910220533830');assert.notEqual(rows[0].channel_id,sourceChannel);assert.equal(rows[0].user_id,null);assert.equal(rows[0].role_id,null);
 for(const table of ['employees','logs','leaves'])assert.equal((await pg.query('SELECT * FROM '+table)).rows.length,0);
});
