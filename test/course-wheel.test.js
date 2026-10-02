import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCourseLog,matchCourseEmployee} from '../src/course-wheel.js';

test('odczytuje dokładny log ukończenia kursu ze screena i dopasowuje nazwę w nawiasie',()=>{
 const event=parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #4 dla burgershot.');
 assert.deepEqual(event,{player:'Buleczka72 [Markos Valentierra]',courseNumber:4});
 assert.equal(matchCourseEmployee(event.player,[{user_id:'123',username:'buleczka72',ic_name:'Markos Valentierra'}]),'123');
 assert.equal(parseCourseLog('BURGERSHOT Zakończenie Kursu','Nieprawidłowa wiadomość'),null);
});
