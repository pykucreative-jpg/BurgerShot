import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCourseLog,matchCourseEmployee} from '../src/course-wheel.js';

test('odczytuje dokładny log ukończenia kursu ze screena i dopasowuje nazwę w nawiasie',()=>{
 const event=parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #4 dla burgershot.');
 assert.deepEqual(event,{player:'Buleczka72 [Markos Valentierra]',courseNumber:4});
 assert.deepEqual(parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #1 dla burgershot.'),{player:'Buleczka72 [Markos Valentierra]',courseNumber:1});
 assert.equal(matchCourseEmployee(event.player,[{user_id:'123',username:'buleczka72',ic_name:'Markos Valentierra'}]),'123');
 assert.equal(matchCourseEmployee('Dawidowe [David Alfonso]',[{id:'456',displayName:'[P] David Alfonso [urlop]',user:{username:'dawidowe',bot:false}}]),'456');
 assert.equal(matchCourseEmployee('Buleczka72 [Markos Valentierra]',[
  {id:'457',displayName:'[P] Markos Valentierra [urlop]',user:{username:'buleczka72',bot:false}},
  {id:'458',displayName:'[S] Markos Valentierra [szkolenie]',user:{username:'innaosoba',bot:false}}
 ]),'457');
 assert.equal(parseCourseLog('BURGERSHOT Zakończenie Kursu','Gracz Buleczka72 [Markos Valentierra] zakończył Kurs #3 dla burgershot.'),null);
 assert.equal(parseCourseLog('BURGERSHOT Zakończenie Kursu','Nieprawidłowa wiadomość'),null);
});

