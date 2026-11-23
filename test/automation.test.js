import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/config.js';

test('automatyczne przetwarzanie logów jest wyłączone',()=>{
 assert.equal(config.automatedLogActions,false);
 assert.equal(config.automatedDismissalLogs,true);
 assert.equal(config.automatedActivityLogs,true);
 assert.equal(config.dailyDeliveryRosterChannel,'1574443214318997646');
});

