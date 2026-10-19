import test from 'node:test';
import assert from 'node:assert/strict';
import {setRemaining,canRecordDelivery,canDriveDelivery} from '../src/medic-sets.js';

test('limit zestawów medyka wynosi maksymalnie pięć dziennie',()=>{
 assert.equal(setRemaining(0),5);assert.equal(setRemaining(2),3);assert.equal(setRemaining(5),0);assert.equal(setRemaining(9),0);
});

test('dostawę może wpisać Zarząd lub Firma DC',()=>{
 const role=id=>({roles:{cache:{has:checked=>checked===id}}});
 assert.equal(canRecordDelivery(role('1295044894825381950')),true);
 assert.equal(canRecordDelivery(role('1465037223350243390')),true);
 assert.equal(canRecordDelivery(role('inna-ranga')),false);
});

test('pracownik Firma DC może być osobą dostarczającą',()=>{
 const firmDc={roles:{cache:{has:id=>id==='1465037223350243390'}}};
 assert.equal(canDriveDelivery(firmDc),true);
});

