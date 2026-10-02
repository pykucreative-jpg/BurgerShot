import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiploma} from '../src/diplomas.js';
test('dyplom awansu tworzy obraz PNG',async()=>{
 const image=await createDiploma({name:'Sonic Savage',rank:'Menadżer',issuedAt:new Date('2026-10-03T12:00:00Z')});
 assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.ok(image.length>10000);
});

