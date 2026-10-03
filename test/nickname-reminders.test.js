import test from 'node:test';
import assert from 'node:assert/strict';
import {validStaffNickname} from '../src/nickname-reminders.js';

test('przypomnienie akceptuje imię i nazwisko oraz dopisek urlopu',()=>{
 assert.equal(validStaffNickname('Sonic Savage'),true);
 assert.equal(validStaffNickname('Anna Maria Kowalska [urlop]'),true);
 assert.equal(validStaffNickname('Sonic'),false);
 assert.equal(validStaffNickname('[P] Sonic Savage'),false);
 assert.equal(validStaffNickname(''),false);
});

