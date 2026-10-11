import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketName} from '../src/bingo.js';

test('nazwa ticketu Bingo używa imienia i nazwiska pracownika',()=>{
 assert.equal(ticketName('Markos Valentierra'),'bingo-markos-valentierra');
 assert.equal(ticketName('[P] Łukasz Żółć'),'bingo-lukasz-zolc');
});

