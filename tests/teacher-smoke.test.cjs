const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {test}=require('node:test');
const read=p=>fs.readFileSync(p,'utf8');
const main=read('index.html'),script=read('teacher-mode.js'),calendar=read('teacher-calendar.js'),styles=read('teacher-mode.css');
test('teacher and student scripts load in correct order',()=>{
 assert(main.includes('<script src="teacher-calendar.js"></script>\n<script src="teacher-mode.js"></script>'));
 assert(main.includes('teacher-mode.css'));
 assert(main.includes('teacher-manifest.webmanifest'));
 assert(main.includes('teacher-sw.js'));
 assert(main.includes('dataset.appRole==='));
});
test('teacher module syntax and important features',()=>{
 assert.doesNotThrow(()=>new Function(script));
 ['chooseStudent','chooseTeacher','getDestinations','windowState','schoolRequest','verifyTeacher','completePassConfirmed','flushQueue','timerFromDialog','renderStudentChoices','schoolCalendarInfo','renderAgenda','renderWeather','refreshSchoolSounds','loadSounds','syncTime','timerKey','testMode','calendarOverrides','teacherName'].forEach(fn=>assert(script.includes(fn),fn));
});
test('official school calendar and grade-band schedules',()=>{
 const context={window:{}};vm.runInNewContext(calendar,context);
 assert.equal(context.window.CALENDAR['2026-10-28'],'A Day Wednesday');
 assert.equal(context.window.CALENDAR['2026-10-29'],'B Day Regular');
 assert.equal(context.window.CALENDAR['2026-11-26'],null);
 assert.equal(context.window.CALENDAR['2027-01-05'],'B Day Regular');
 for(const band of ['912','1011'])for(const dayType of ['regular','wednesday']){
   const rows=context.window.SCHEDULE_TABLES[band][dayType].rows;
   assert.equal(rows.filter(r=>/^Period [1-4]$/.test(r.label)).length,4);
   assert(rows.some(r=>r.label==='Lunch'));
 }
 assert.equal(context.window.SCHEDULE_TABLES['1011'].regular.rows.find(r=>r.label==='Period 3').start,'11:45');
 assert.equal(context.window.SCHEDULE_TABLES['912'].regular.rows.find(r=>r.label==='Period 3').start,'11:00');
});
test('teacher styling is based on class timer not the Hallpass CSS',()=>{
 assert(styles.includes('var(--panel)'));
 assert(styles.includes('var(--ink)'));
 assert(styles.includes('data-app-role="teacher"'));
 assert(!main.includes('patrick-hand-latin'));
});
test('privacy, offline install and author rights are documented',()=>{
 assert(read('teacher-sw.js').includes('url.origin!==self.location.origin'));
 assert(read('teacher-sw.js').includes('teacher-mode.js'));
 assert(read('HALLPASS-LICENSE.md').includes('Shamil Ganiev'));
 assert(script.includes('HALLPASS-LICENSE.md'));
 assert(read('teacher-manifest.webmanifest').includes('Class Timer'));
 assert(!script.includes('service_role'));
});
