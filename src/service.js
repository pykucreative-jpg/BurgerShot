import { randomInt } from 'node:crypto';
import { config } from './config.js';
import {webhookRanks,webhookNotice} from './webhook-logs.js';
import {matchCourseEmployee} from './course-wheel.js';
import { UserError, text, nextPlus, highest, rankChange, leaveNickname, clearLeaveNickname, formatDate } from './domain.js';

export function service(db, client, env) {
  const wheelPrizes=['🔧 Naprawka · 10 000$', '📷 Aparat', '🔭 Obiektyw', '🎟️ Zdrapka'];
  const guild = () => client.guilds.fetch(env.guildId);
  let companyCache={at:0,items:[]};
  let courseMemberCache={at:0,members:new Map()};
  async function companyMembers() {
    if(Date.now()-companyCache.at<60000)return companyCache.items;
    const g=await guild();
    let members;
    try { members=await g.members.fetch(); }
    catch { members=g.members.cache; }
    const items=[...members.values()].filter(m=>!m.user.bot&&m.roles.cache.has(config.employee)).map(m=>{
      const ids=[...m.roles.cache.keys()];
      return {user_id:m.id,username:m.user.username,ic_name:m.displayName,rank:config.ranks[highest(config.ranks.map(r=>r.id),ids)-1]?.name||null,plus_count:highest(config.plus,ids),minus_count:highest(config.minus,ids)};
    }).sort((a,b)=>a.ic_name.localeCompare(b.ic_name,'pl'));
    companyCache={at:Date.now(),items};
    return items;
  }
  async function courseMemberByName(name) {
    const g=await guild();
    if(Date.now()-courseMemberCache.at>=60000){
      let members;
      try {members=await g.members.fetch();}
      catch {members=g.members.cache;}
      courseMemberCache={at:Date.now(),members:new Map(members)};
    }
    const bracket=[...String(name).matchAll(/\[([^\]]+)\]/g)].at(-1)?.[1]||name;
    try {
      const searched=await g.members.search({query:bracket,limit:100});
      for(const member of searched.values())courseMemberCache.members.set(member.id,member);
    } catch {}
    return matchCourseEmployee(name,[...courseMemberCache.members.values()]);
  }
  async function member(id) { return (await guild()).members.fetch({ user:id, force:true }); }
  async function authorize(id) {
    const m = await member(id);
    if (!m.roles.cache.has(config.staff)) throw new UserError('Ta funkcja jest dostępna tylko dla uprawnionej kadry.');
    return { id:m.id, name:m.displayName };
  }
  async function employee(m) {
    const ids = [...m.roles.cache.keys()];
    const rank = config.ranks[highest(config.ranks.map(r=>r.id), ids)-1]?.name || null;
    await db.q(`INSERT INTO employees(user_id,username,ic_name,rank,plus_count,minus_count)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET username=$2,rank=$4,plus_count=$5,minus_count=$6,updated_at=now()`,
    [m.id,m.user.username,m.displayName,rank,highest(config.plus,ids),highest(config.minus,ids)]);
    return (await db.q('SELECT user_id,username,ic_name,rank,plus_count,minus_count,status,hired_by,hired_by_name,hired_at FROM employees WHERE user_id=$1',[m.id])).rows[0];
  }
  async function recordCourse({targetId,messageId,playerName,courseNumber}) {
    return db.lock(`user:${targetId}`,async()=>{
      if(courseNumber!==4)throw new UserError('Zapisywany może być wyłącznie Kurs #4.');
      const m=await member(targetId);
      return db.transaction(async tx=>{
        const imported=await tx.query("INSERT INTO course_events(message_id,user_id,player_name,course_number) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING message_id",[messageId,targetId,playerName,courseNumber]);
        if(!imported.rows.length)return {duplicate:true};
        const progress=(await tx.query(`INSERT INTO course_progress(user_id,courses_completed,spins_available,last_course_at)
          VALUES($1,1,0,now()) ON CONFLICT(user_id) DO UPDATE SET
          courses_completed=course_progress.courses_completed+1,
          spins_available=course_progress.spins_available+CASE WHEN (course_progress.courses_completed+1)%20=0 THEN 1 ELSE 0 END,
          last_course_at=now(),updated_at=now() RETURNING *`,[targetId])).rows[0];
        const unlocked=progress.courses_completed%20===0;
        const remaining=20-(progress.courses_completed%20)||20;
        await tx.query(`INSERT INTO logs(request_id,category,actor_id,actor_name,target_id,target_name,reason,details,status,channel_id)
          VALUES($1,'kurs',$2,$3,$4,$5,$6,$7,'success',$8)`,[`course:${messageId}`,client.user.id,'Automatycznie · Kurs #4',targetId,m.displayName,'Pomyślnie dodano Kurs #4 do konta pracownika.',JSON.stringify({description:`✅ Dodano **Kurs #4**. Stan konta: **${progress.courses_completed} kursów**. Dostępne losowania: **${progress.spins_available}**. Do kolejnego losowania: **${remaining} kursów**.`}),config.logs]);
        return {courses:progress.courses_completed,spins:progress.spins_available,unlocked};
      });
    });
  }
  async function spinWheel(userId) {
    return db.lock(`wheel:${userId}`,async()=>{
      const m=await member(userId),staff=m.roles.cache.has(config.staff),employeeRole=m.roles.cache.has(config.employee);
      if(!staff&&!employeeRole)throw new UserError('Koło jest dostępne dla Zarządu oraz pracowników z rangą Firma DC.');
      const result=await db.transaction(async tx=>{
        let progress=(await tx.query('SELECT * FROM course_progress WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
        if(!progress)progress={courses_completed:0,spins_available:0,spins_used:0};
        if(progress.spins_available<1)throw new UserError(`Do następnego losowania potrzebujesz 20 kursów. Masz obecnie ${progress.courses_completed}/20.`);
        const prize=wheelPrizes[randomInt(wheelPrizes.length)];
        const spin=(await tx.query('INSERT INTO wheel_spins(user_id,prize) VALUES($1,$2) RETURNING id',[userId,prize])).rows[0];
        progress=(await tx.query('UPDATE course_progress SET spins_available=spins_available-1,spins_used=spins_used+1,updated_at=now() WHERE user_id=$1 RETURNING *',[userId])).rows[0];
        await tx.query(`INSERT INTO logs(request_id,category,actor_id,actor_name,target_id,target_name,reason,details,status,channel_id)
          VALUES($1,'kolo',$2,$3,$2,$3,$4,$5,'success',$6)`,[`wheel:${spin.id}`,m.id,m.displayName,'Nagroda za 20 ukończonych kursów',JSON.stringify({description:`🎁 **Wylosowana nagroda:** ${prize}`,prize,courses:progress.courses_completed}),config.logs]);
        return {prize,courses:progress.courses_completed,spins:progress.spins_available,staff};
      });
      return result;
    });
  }
  async function courseStatus(userId) {
    const m=await member(userId),staff=m.roles.cache.has(config.staff),employeeRole=m.roles.cache.has(config.employee);
    if(!staff&&!employeeRole)throw new UserError('Panel kursów jest dostępny dla Zarządu oraz pracowników z rangą Firma DC.');
    const progress=(await db.q('SELECT * FROM course_progress WHERE user_id=$1',[userId])).rows[0]||{courses_completed:0,spins_available:0,spins_used:0};
    return {courses:progress.courses_completed,spins:progress.spins_available,staff,remaining:20-(progress.courses_completed%20)||20};
  }
  async function resetCourses(actorId) {
    const actor=await authorize(actorId);
    return db.lock('course-progress-reset',async()=>db.transaction(async tx=>{
      const reset=await tx.query(`UPDATE course_progress SET courses_completed=0,spins_available=0,spins_used=0,last_course_at=NULL,updated_at=now()
        WHERE courses_completed<>0 OR spins_available<>0 OR spins_used<>0 RETURNING user_id`);
      await tx.query(`INSERT INTO logs(request_id,category,actor_id,actor_name,reason,details,status,channel_id)
        VALUES($1,'reset',$2,$3,$4,$5,'success',$6)`,[`course-reset:${Date.now()}`,actor.id,actor.name,'Wyzerowano liczniki kursów i dostępne losowania.',JSON.stringify({description:`↺ Wyzerowano kursy oraz niewykorzystane losowania dla **${reset.rowCount}** osób.`}),config.logs]);
      return {count:reset.rowCount};
    }));
  }
  async function resetCoursesOnRelease() {
    return db.lock('course-progress-release-reset',async()=>db.transaction(async tx=>{
      const marker=await tx.query("INSERT INTO bot_settings(key,value) VALUES('course_progress_reset_2026_10_02','done') ON CONFLICT(key) DO NOTHING RETURNING key");
      if(!marker.rowCount)return {ran:false,count:0};
      const reset=await tx.query(`UPDATE course_progress SET courses_completed=0,spins_available=0,spins_used=0,last_course_at=NULL,updated_at=now()
        WHERE courses_completed<>0 OR spins_available<>0 OR spins_used<>0 RETURNING user_id`);
      await tx.query(`INSERT INTO logs(request_id,category,actor_id,actor_name,reason,details,status,channel_id)
        VALUES('course-reset:2026-10-02','reset',$1,$2,$3,$4,'success',$5)`,[client.user.id,'Automatycznie · Aktualizacja koła','Wyzerowano wcześniejsze kursy i losowania po zmianie zasad.',JSON.stringify({description:`↺ Wyzerowano kursy oraz niewykorzystane losowania dla **${reset.rowCount}** osób.`}),config.logs]);
      return {ran:true,count:reset.rowCount};
    }));
  }
  async function checkRoles(m, ids) {
    if (!m.manageable) throw new UserError('Ranga bota musi być ponad rangami tej osoby. Nie można zmienić właściciela serwera.');
    const g=await guild(); await g.roles.fetch();
    for (const id of ids) if (!g.roles.cache.get(id)?.editable) throw new UserError(`Bot nie może zarządzać rangą ${id}. Sprawdź uprawnienia i hierarchię.`);
  }
  async function replaceRoles(m, family, selected, reason, steps=[]) {
    const old = family.filter(id=>m.roles.cache.has(id));
    await checkRoles(m,[...old,...(selected?[selected]:[])]);
    if (selected && !old.includes(selected)) {await m.roles.add(selected,reason);steps.push('Nadano nową rangę');}
    const remove=old.filter(id=>id!==selected);
    if (remove.length) {await m.roles.remove(remove,reason);steps.push('Zdjęto poprzednie rangi z tej kategorii');}
  }
  async function audit({ category, actor, target, reason='', channelId, requestId }, fn) {
    if (requestId) {
      const existing=(await db.q('SELECT id FROM logs WHERE request_id=$1',[requestId])).rows[0];
      if (existing) throw new UserError('To działanie zostało już obsłużone. Sprawdź historię.');
    }
    const log=(await db.q(`INSERT INTO logs(category,actor_id,actor_name,target_id,target_name,reason,channel_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[category,actor.id,actor.name,target?.id,target?.name,reason,channelId,requestId])).rows[0];
    const steps=[];
    try {
      const result=await fn(steps);
      await db.q('UPDATE logs SET status=$2,details=$3 WHERE id=$1',[log.id,result.noop?'noop':'success',JSON.stringify({...result,steps})]);
      return result;
    } catch (err) {
      const message = err instanceof UserError ? err.message : `Operacja nie została ukończona (kod ${String(err.code || 'błąd usługi')}). Sprawdź uprawnienia bota i logi.`;
      await db.q('UPDATE logs SET status=$2,details=$3 WHERE id=$1',[log.id,steps.length?'partial':'failed',JSON.stringify({error:message,steps})]);
      console.error('Operacja nieudana',log.id,err.code || err.name);
      throw new UserError(`${message}${steps.length ? ' Wykonano: '+steps.join(', ')+'.' : ''}`);
    }
  }
  async function dismiss(m, steps, reason) {
    if(!m.kickable) throw new UserError('Bot nie może usunąć tej osoby. Sprawdź hierarchię rang i uprawnienie Wyrzucanie członków.');
    const removable=m.roles.cache.filter(r=>r.id!==m.guild.id&&!r.managed).map(r=>r.id);
    await checkRoles(m,removable);
    if(removable.length) await m.roles.remove(removable,reason);
    steps.push('Odebrano rangi możliwe do zarządzania');
    await m.kick(reason); steps.push('Usunięto z serwera');
    await db.transaction(async tx=>{
      await tx.query("UPDATE employees SET status='dismissed',rank=NULL,plus_count=0,updated_at=now() WHERE user_id=$1",[m.id]);
      await tx.query("UPDATE leaves SET status='cancelled' WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id]);
    });
  }
  async function run({kind,actorId,targetId,reason='',channelId,requestId,icName,endsAt}) {
    return db.lock(`user:${targetId}`,async()=>{
      const actor=await authorize(actorId);
      const m=await member(targetId);
      if(m.user.bot) throw new UserError('Wybierz osobę, a nie bota.');
      if(!['zatrudnij','urlop'].includes(kind)) reason=text(reason);
      const e=await employee(m);
      return audit({category:kind,actor,target:{id:m.id,name:kind==='zatrudnij'?(icName?text(icName,32):m.displayName):e.ic_name},reason,channelId,requestId},async steps=>{
        const ids=[...m.roles.cache.keys()];
        if(kind==='zatrudnij') {
          const name=icName?text(icName,32):m.displayName;
          if(e.hired_at&&e.status==='active') throw new UserError('Ta osoba jest już zatrudniona. Użyj awansu lub degradacji.');
          await checkRoles(m,[config.employee,...config.ranks.filter(r=>ids.includes(r.id)).map(r=>r.id),config.ranks[0].id]);
          if(icName) {await m.setNickname(name,'BurgerShot: zatrudnienie'); steps.push('Ustawiono pseudonim');}
          await replaceRoles(m,config.ranks.map(r=>r.id),config.ranks[0].id,'BurgerShot: zatrudnienie',steps);
          await m.roles.add(config.employee); steps.push('Nadano rangi pracownicze');
          await db.q(`UPDATE employees SET ic_name=$2,hired_by=$3,hired_by_name=$4,hired_at=now(),rank=$5,status='active' WHERE user_id=$1`,[m.id,name,actor.id,actor.name,config.ranks[0].name]);
          return {title:'👤 Witamy w BurgerShot!',description:`<@${m.id}> dołącza do naszego zespołu. Miło Cię widzieć! 🍟`,fields:{'🍔 Imię i nazwisko IC':name,'🍔 Stanowisko':'Rekrut','👤 Przyjęcie zatwierdził(a)':`<@${actor.id}>`}};
        }
        if(kind==='plus') {
          const state=nextPlus(ids);
          await replaceRoles(m,config.plus,state.after?config.plus[state.after-1]:null,reason,steps); steps.push('Zaktualizowano rangi plusów');
          await db.q('UPDATE employees SET plus_count=$2 WHERE user_id=$1',[m.id,state.after]);
          return {title:state.reset?'🌟 Pięć plusów na koncie!':'🌟 Dobra robota!',description:`<@${m.id}>, dziękujemy za zaangażowanie! 🤍${state.reset?' Osiągnięto 5/5! 💰 Po nagrodę pieniężną zgłoś się do zarządu w niedzielę. Zapisano Cię na liście nagród. Licznik zaczyna nowy cykl od 0/5.':''}`,before:state.before,after:state.after,fields:{'💬 Powód':reason,'✨ Plusy':state.reset?'5/5 ✅ → nowy cykl 0/5':`${state.after}/5`,'👤 Przyznał(a)':`<@${actor.id}>`}};
        }
        if(kind==='minus') {
          const count=Math.min(2,highest(config.minus,ids)+1);
          if(count===2&&!m.kickable) throw new UserError('Drugi minus wymaga możliwości usunięcia tej osoby. Sprawdź rangę bota.');
          if(count===2) await checkRoles(m,m.roles.cache.filter(r=>r.id!==m.guild.id&&!r.managed).map(r=>r.id));
          await replaceRoles(m,config.minus,config.minus[count-1],reason,steps); steps.push('Nadano minus');
          await db.q('UPDATE employees SET minus_count=$2 WHERE user_id=$1',[m.id,count]);
          if(count===2) await dismiss(await member(m.id),steps,reason);
          return {title:count===2?'📋 Zakończenie współpracy':'⚠️ Ostrzeżenie pracownicze',description:count===2?`${e.ic_name} otrzymał(a) drugi minus. Odebrano rangi i usunięto osobę z serwera.`:`<@${m.id}> otrzymuje minus. Drugi minus oznacza zwolnienie i usunięcie z serwera.`,fields:{'💬 Powód':reason,'📋 Minusy':`${count}/2`,'👤 Wystawił(a)':`<@${actor.id}>`}};
        }
        if(['awans','degrad'].includes(kind)) {
          const change=rankChange(ids,kind==='awans'?1:-1);
          if(change.before===change.after) return {noop:true,title:'🍟 Stanowisko bez zmian',description:`<@${m.id}> ma już ${kind==='awans'?'najwyższe':'najniższe'} stanowisko. Rangi zarządu są nadawane ręcznie.`};
          const family=config.ranks.map(r=>r.id);
          if(kind==='degrad'&&config.ranks[change.before].id==='1292911416285728792')family.push(config.staff);
          await replaceRoles(m,family,config.ranks[change.after].id,reason,steps); steps.push('Zmieniono stanowisko');
          await db.q('UPDATE employees SET rank=$2 WHERE user_id=$1',[m.id,config.ranks[change.after].name]);
          return {title:kind==='awans'?'✨ Pora na kolejny krok!':'📋 Zmiana stanowiska',description:`<@${m.id}> ${kind==='awans'?'awansuje. Gratulujemy! 🍔':'przechodzi na niższe stanowisko.'}`,fields:{'🍟 Stanowisko':`${config.ranks[change.before].name} → ${config.ranks[change.after].name}`,'💬 Powód':reason,'👤 Decyzję podjął/podjęła':`<@${actor.id}>`}};
        }
        if(kind==='zwolnij') {
          await dismiss(m,steps,reason);
          return {title:'📋 Zakończenie współpracy',description:`${e.ic_name} został(a) zwolniony/a. Odebrano rangi i usunięto osobę z serwera.`,fields:{'💬 Powód':reason,'👤 Decyzję podjął/podjęła':`<@${actor.id}>`}};
        }
        if(kind==='urlop') {
          if(!endsAt||new Date(endsAt)<=new Date()) throw new UserError('Koniec urlopu musi wypadać w przyszłości.');
          if((await db.q("SELECT id FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id])).rowCount) throw new UserError('Ta osoba ma już urlop lub oczekujący wniosek.');
          const l=(await db.q(`INSERT INTO leaves(user_id,ic_name,starts_at,ends_at,status,channel_id,approved_by,approved_by_name) VALUES($1,$2,now(),$3,'scheduled',$4,$5,$6) RETURNING *`,[m.id,e.ic_name,endsAt,channelId,actor.id,actor.name])).rows[0];
          steps.push('Zapisano urlop'); await activate(l,m,steps);
          return {title:'🌴 Czas na odpoczynek!',description:`<@${m.id}>, Twój urlop został zatwierdzony. Odpocznij i wracaj z nową energią! ☀️`,fields:{'📅 Do kiedy':formatDate(endsAt),'👤 Zatwierdził(a)':`<@${actor.id}>`}};
        }
        if(kind==='zdejmijurlop') {
          const l=(await db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('active','scheduled','starting','ending')",[m.id])).rows[0];
          if(!l) return {noop:true,title:'🍟 Brak urlopu',description:`<@${m.id}> nie ma aktywnego ani zaplanowanego urlopu.`};
          await endLeave(l,m,steps);
          return {title:'🌸 Witamy z powrotem!',description:`<@${m.id}>, Twój urlop został zakończony ręcznie. Zapraszamy do pracy! 🍟`,fields:{'💬 Powód':reason,'👤 Urlop zakończył(a)':`<@${actor.id}>`}};
        }
        throw new UserError('Nieznana komenda.');
      });
    });
  }
  async function activate(l,m,steps=[]) {
    await checkRoles(m,[config.leave]);
    const nick=l.applied_nick || leaveNickname(m.displayName);
    if(l.status!=='starting') await db.q("UPDATE leaves SET status='starting',old_nick=$2,applied_nick=$3 WHERE id=$1",[l.id,m.nickname,nick]);
    await m.roles.add(config.leave,'BurgerShot: urlop'); steps.push('Nadano rangę urlopową');
    await m.setNickname(nick); steps.push('Ustawiono dopisek urlop');
    await db.q("UPDATE leaves SET status='active',error=NULL,retry_at=NULL WHERE id=$1",[l.id]);
  }
  async function endLeave(l,m,steps=[]) {
    await checkRoles(m,[config.leave]);
    await db.q("UPDATE leaves SET status='ending' WHERE id=$1",[l.id]);
    await m.roles.remove(config.leave); steps.push('Zdjęto rangę urlopową');
    if(m.nickname?.toLowerCase().includes('[urlop]')) {
      const nick=m.nickname===l.applied_nick?l.old_nick:clearLeaveNickname(m.nickname);
      await m.setNickname(nick); steps.push('Usunięto dopisek urlop');
    }
    await db.q("UPDATE leaves SET status='ended',error=NULL,retry_at=NULL WHERE id=$1",[l.id]);
  }
  async function notify(channel,user,title,body) { await db.q('INSERT INTO notifications(channel_id,user_id,title,body) VALUES($1,$2,$3,$4)',[channel,user,title,body]); }
  async function tickLeaves() {
    const due=(await db.q("SELECT * FROM leaves WHERE status IN ('scheduled','active','starting','ending') AND (retry_at IS NULL OR retry_at<=now()) AND (starts_at<=now() OR status='ending')")).rows;
    for(const candidate of due) await db.lock(`user:${candidate.user_id}`,async()=>{
      const l=(await db.q('SELECT * FROM leaves WHERE id=$1',[candidate.id])).rows[0];
      if(!['scheduled','active','starting','ending'].includes(l.status)) return;
      const ending=(l.ends_at!==null&&new Date(l.ends_at)<=new Date()) || l.status==='ending';
      if(l.status==='active'&&!ending) return;
      try {
        await audit({category:ending?'zdejmijurlop':'urlop',actor:{id:client.user.id,name:'Automatycznie'},target:{id:l.user_id,name:l.ic_name},reason:ending?'Upłynął termin urlopu':'Rozpoczęcie zaplanowanego urlopu',channelId:l.channel_id},async steps=>{
          let m;
          try { m=await member(l.user_id); } catch(err) {
            if(err.code!==10007) throw err;
            await db.q("UPDATE leaves SET status='cancelled',error='Osoba opuściła serwer' WHERE id=$1",[l.id]);
            return {title:'🌴 Urlop anulowany',description:'Osoba nie należy już do serwera.'};
          }
          if(ending) { await endLeave(l,m,steps); await notify(l.channel_id,l.user_id,'🍟 Twoja zmiana znów na Ciebie czeka!','Twój urlop dobiegł końca. Witamy z powrotem i zapraszamy do pracy! 🍔'); }
          else { await activate(l,m,steps); await notify(l.channel_id,l.user_id,'🌴 Czas na odpoczynek!',`Twój urlop właśnie się rozpoczął. Odpoczywaj do ${formatDate(l.ends_at)}!`); }
          return {title:ending?'☀️ Urlop zakończony automatycznie':'🌴 Urlop rozpoczęty',description:l.ic_name};
        });
      } catch(err) { await db.q("UPDATE leaves SET error=$2,retry_at=now()+interval '5 minutes' WHERE id=$1",[l.id,err.message]); }
    });
  }
  async function applyWebhook(event,targetId,messageId){
    return db.lock(`user:${targetId}`,async()=>{
      const m=await member(targetId);
      if(m.user.bot)throw new UserError('Nie można wykonać działania na bocie.');
      const e=await employee(m),channelId=webhookNotice(event).channel;
      const reason=event.kind==='awans'?'Wyrobienie normy awansowej':['degrad','zwolnij'].includes(event.kind)?'Brak wyrobionej normy':'Decyzja odczytana z logu serwera';
      return audit({category:event.kind,actor:{id:client.user.id,name:event.actor+' (log serwera)'},target:{id:m.id,name:event.person},reason,channelId,requestId:`webhook:${messageId}`},async steps=>{
        if(['awans','degrad'].includes(event.kind)){
          const rank=webhookRanks.find(r=>r.name.toLocaleLowerCase('pl')===event.after.toLocaleLowerCase('pl'));
          if(!rank)throw new UserError('Nieznane stanowisko docelowe.');
          const family=webhookRanks.map(r=>r.id);
          const fromShift=event.before?.toLocaleLowerCase('pl')==='kierownik zmiany'||m.roles.cache.has('1292911416285728792');
          if(event.kind==='degrad'&&fromShift&&family.indexOf(rank.id)<family.indexOf('1292911416285728792'))family.push(config.staff);
          await replaceRoles(m,family,rank.id,reason,steps);
          await db.q('UPDATE employees SET rank=$2 WHERE user_id=$1',[m.id,rank.name]);
        }else if(event.kind==='zwolnij')await dismiss(m,steps,reason);
        else if(event.kind==='urlop'){
          let l=(await db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id])).rows[0];
          if(l){await db.q("UPDATE leaves SET ends_at=NULL,starts_at=now(),status='scheduled',channel_id=$2 WHERE id=$1",[l.id,channelId]);l={...l,status:l.applied_nick?'starting':'scheduled',ends_at:null};}
          else l=(await db.q("INSERT INTO leaves(user_id,ic_name,starts_at,ends_at,status,channel_id,approved_by,approved_by_name) VALUES($1,$2,now(),NULL,'scheduled',$3,$4,$5) RETURNING *",[m.id,e.ic_name,channelId,client.user.id,event.actor])).rows[0];
          steps.push('Zapisano urlop bezterminowy');
          await activate(l,m,steps);
        }else if(event.kind==='zdejmijurlop'){
          const l=(await db.q("SELECT * FROM leaves WHERE user_id=$1 AND status IN ('pending','scheduled','active','starting','ending')",[m.id])).rows[0];
          if(l)await endLeave(l,m,steps);
          else{
            await checkRoles(m,[config.leave]);
            await m.roles.remove(config.leave);steps.push('Zdjęto rangę urlopową');
            if(m.nickname?.toLowerCase().includes('[urlop]')){await m.setNickname(clearLeaveNickname(m.nickname));steps.push('Usunięto dopisek urlop');}
          }
        }else throw new UserError('Nieznane działanie z logu.');
        return {title:webhookNotice(event).title,description:`<@${m.id}> • ${event.person}`,fields:{'💬 Powód':reason,'👤 Decyzję podjął/podjęła':event.actor}};
      });
    });
  }
  return {guild,member,companyMembers,courseMemberByName,employee,recordCourse,spinWheel,courseStatus,resetCourses,resetCoursesOnRelease,authorize,run,audit,tickLeaves,notify,applyWebhook};
}
