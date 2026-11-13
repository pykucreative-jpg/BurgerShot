import test from 'node:test';
import assert from 'node:assert/strict';
import {setRemaining,canRecordDelivery,canDriveDelivery,canManageMedicList,isFridgeRecipient,fridgeRecipient} from '../src/medic-sets.js';

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

test('wybrana osoba może zarządzać listą medyków bez rangi Zarząd',()=>{
 assert.equal(canManageMedicList('550689776458792963'),true);
 assert.equal(canManageMedicList('inna-osoba'),false);
});

test('lodówka jest prawidłowym odbiorcą dostawy medycznej',()=>{
 assert.equal(fridgeRecipient,'Lodówka');assert.equal(isFridgeRecipient('Lodówka'),true);assert.equal(isFridgeRecipient('Lodowka'),true);assert.equal(isFridgeRecipient('Jan Kowalski'),false);
});

