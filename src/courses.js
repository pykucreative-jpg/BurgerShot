import {DateTime} from 'luxon';

export function courseDay(now=new Date()) {
  const local=DateTime.fromJSDate(now,{zone:'Europe/Warsaw'});
  return local.hour>=20?local.toISODate():null;
}
export function courseReminder(db) {
  let checkedDay;
  return async(now=new Date())=>{
    const day=courseDay(now);
    if(!day||day===checkedDay)return false;
    const queued=await db.transaction(async tx=>{
      const inserted=await tx.query('INSERT INTO course_reminders(day) VALUES($1) ON CONFLICT DO NOTHING RETURNING day',[day]);
      if(!inserted.rows.length)return false;
      await tx.query('INSERT INTO notifications(channel_id,role_id,title,body) VALUES($1,$2,$3,$4)',[
        '1502335151324004457','1465037223350243390','🍔 BurgerShot • Kursy',
        'ZAPRASZAMY NA KURSY JEST NORMA DO WYROBIENIA'
      ]);
      return true;
    });
    checkedDay=day;
    return queued;
  };
}
