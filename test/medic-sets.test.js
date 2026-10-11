import test from 'node:test';
import assert from 'node:assert/strict';
import {setRemaining} from '../src/medic-sets.js';

test('limit zestawów medyka wynosi maksymalnie pięć dziennie',()=>{
 assert.equal(setRemaining(0),5);assert.equal(setRemaining(2),3);assert.equal(setRemaining(5),0);assert.equal(setRemaining(9),0);
});

