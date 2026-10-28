/* Native Teacher Mode for School Class Timer.
   Uses the existing Class Timer styling. Integrates with the documented
   Hall Pass Board school Apps Script protocol, without importing its UI.
   Hall Pass Board concepts/API credit: Shamil Ganiev, Free School Use License. */
(() => {
'use strict';
const byId = id => document.getElementById(id);
const KEY = 'oss-app-role';
const CFG_KEY = 'oss-teacher-config-v1';
const STATE_KEY = 'oss-teacher-state-v1';
const SCHOOL_URL = 'https://script.google.com/macros/s/AKfycbyK0y5PNq5rJfvAAVGyctWzQhSYwjvACE3muXEAojeoQZYqvBlAdE_XXXrCC3i77kO5HA/exec';
const defaults = {
  teacherName:'',room:'',url:SCHOOL_URL,code:'',teacher:null,rosters:{},groups:{},sections:{},gradeBand:'1011',calendarOverrides:{},hour24:false,countdownPassed:false,fullScreen:false,demoSpeed:1,
  startClose:10,endClose:10,useRule:true,allowOverride:false,slots:2,autoLeave:5,
  destinations:'Restroom:8\nLocker:3\nWater:3\nOffice:8\nNurse:8\nOther:8',
  timerEnabled:true,timerWarn:60,timerSound:'bell',timerWarnSound:'beep',timerVolume:35,
  agendaEnabled:true,agendaDaily:false,agendaLead:5,agenda:{},
  weatherEnabled:false,cardsEnabled:false,cardSeconds:20,calendarCards:true,weatherCards:false,alertsEnabled:false,messagesEnabled:false,
  notificationsEnabled:false,notifyMin:5,notifySound:'bell',passEnabled:true,
  demo:false,testMode:false,shiftSec:0,driftDaily:0,driftAt:Date.now(),pinHash:'',pinSalt:'',
  boardId:'board-'+Math.random().toString(36).slice(2,8)
};
function parseStore(key, fallback) {
  try { const v=JSON.parse(localStorage.getItem(key)||'null'); return v && typeof v==='object' ? v : fallback; }
  catch(_) { return fallback; }
}
let cfg=Object.assign({},defaults,parseStore(CFG_KEY,{}));
let state=Object.assign({active:[],queue:[],recent:[],timer:{sec:300,remaining:300,endAt:0,running:false,warned:false,ended:false,recent:[]}},parseStore(STATE_KEY,{}));
state.timer=Object.assign({sec:300,remaining:300,endAt:0,running:false,warned:false,ended:false,recent:[]},state.timer||{});
if(!Array.isArray(state.active))state.active=[];
if(!Array.isArray(state.queue))state.queue=[];
if(!Array.isArray(state.recent))state.recent=[];
let role=localStorage.getItem(KEY);
if(role!=='student'&&role!=='teacher')role=null;
let weather=null,messages=[],lastWx=0,lastMsg=0,lastNotify='',requestCount=0,flushing=false;
let choosing=false,chooserPeriod='',pendingLeave=null,lastTickKey='',activePane='connect';
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=id=>byId(id)?.value||'';
const checked=id=>!!byId(id)?.checked;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a));
const fmt=s=>{let n=Math.max(0,Math.floor(s));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n%3600/60)).padStart(n>=3600?2:1,'0')+':'+String(n%60).padStart(2,'0');};
const timeLabel=n=>new Date(n).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const secDay=d=>d.getHours()*3600+d.getMinutes()*60+d.getSeconds();
const mins=s=>{const p=String(s||'0:00').split(':').map(Number);return p[0]*60+p[1];};
const save=()=>{localStorage.setItem(CFG_KEY,JSON.stringify(cfg));localStorage.setItem(STATE_KEY,JSON.stringify(state));};
const nowDate=()=>new Date(Date.now()+Number(cfg.shiftSec||0)*1000+Number(cfg.driftDaily||0)*((Date.now()-(cfg.driftAt||Date.now()))/86400000)*1000+(cfg.demo?Math.max(0,Date.now()-(cfg.demoStarted||Date.now()))*(Number(cfg.demoSpeed||1)-1):0));
let soundNames=[],soundDb=null;const soundBlobCache=new Map();
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const sectionCode=(row,rotation)=>{
 if(!row||!row.periodNumber||!rotation)return '';
 return rotation+((row.periodNumber-1)%4+1);
};
function schoolCalendarInfo(now){
 const day=iso(now),over=cfg.calendarOverrides?.[day],entry=window.CALENDAR?.[day];
 if(over==='noschool')return {rotation:null,type:'noschool'};
 if(over&&/^[AB]_(regular|wednesday)$/.test(over))return {rotation:over[0],type:over.split('_')[1]};
 if(entry){const m=/^([AB]) Day (Regular|Wednesday)$/.exec(entry);if(m)return {rotation:m[1],type:m[2].toLowerCase()};}
 return {rotation:null,type:'noschool'};
}
function schedule(){
 const now=nowDate(),day=iso(now),info=schoolCalendarInfo(now),rotation=info.rotation;
 const band=cfg.gradeBand==='912'?'912':'1011';
 const source=window.SCHEDULE_TABLES?.[band]?.[info.type]?.rows||[];
 const rows=source.map(item=>{
   const match=/^Period ([1-4])$/.exec(item.label),slot=match?Number(match[1]):null;
   const periodNumber=slot?(rotation==='A'?slot:slot+4):null;
   const code=sectionCode({periodNumber},rotation),section=cfg.sections?.[code];
   return {name:item.label,displayName:section?.course?.trim()||item.label,
     type:item.type,break:item.type!=='class',periodNumber,
     start:item.start,end:item.end,dur:mins(item.end)-mins(item.start),
     room:section?.room||'',slot,code};
 });
 const seconds=secDay(now),current=rows.find(r=>seconds>=mins(r.start)*60&&seconds<mins(r.end)*60)||null;
 const classRow=current&&current.periodNumber?current:null;
 const next=rows.find(r=>r.periodNumber&&mins(r.start)*60>seconds)||null;
 return {now,day,band,timeType:info.type,rotation,rows,current,classRow,next,code:sectionCode(classRow,rotation),seconds};
}
function windowState(sc) {
  const row=sc.classRow;
  if(!row)return {status:'between',reason:sc.rotation?'Between classes':'No school',remain:0,start:0,end:0,open:[]};
  const start=mins(row.start)*60,end=mins(row.end)*60,s=sc.seconds;
  const groupList=cfg.groups&&cfg.groups[sc.code];
  const spans=Array.isArray(groupList)&&groupList.length>1 ? groupList.map(g=>[Number(g.s)*60,Number(g.e)*60]) : [[start,end]];
  const open=spans.map(pair=>[pair[0]+(cfg.useRule?cfg.startClose:0)*60,pair[1]-(cfg.useRule?cfg.endClose:0)*60]).filter(pair=>pair[1]>pair[0]);
  const available=open.some(pair=>s>=pair[0]&&s<pair[1]);
  const nextOpen=open.filter(pair=>pair[0]>s).map(pair=>pair[0]).sort((a,b)=>a-b)[0];
  const nextClose=open.filter(pair=>s>=pair[0]&&s<pair[1]).map(pair=>pair[1]).sort((a,b)=>a-b)[0];
  return {status:available?'open':'closed',reason:available?'Passes open':'Passes closed',remain:Math.max(0,(available?nextClose:(nextOpen||end))-s),start,end,open,spans};
}
function getDestinations(){
  const d=String(cfg.destinations||'').split(/\n+/).map(x=>{const m=/^(.+?)(?::(\d+))?$/.exec(x.trim());return m?{name:m[1].trim(),limit:clamp(Number(m[2]||8),1,600)}:null;}).filter(x=>x&&x.name);
  return d.length?d:[{name:'Restroom',limit:8},{name:'Other',limit:8}];
}
function sectionStudents(code){
  if(cfg.demo)return ['Demo Student 1','Demo Student 2','Demo Student 3'].map((n,i)=>({name:n,id:'demo'+i}));
  const a=cfg.rosters[code]||[];
  return a.map(x=>typeof x==='string'?{name:x,id:''}:{name:String(x.name||''),id:String(x.id||'')}).filter(x=>x.name);
}
function hasTeacher(){return Boolean(cfg.demo||(cfg.teacher&&cfg.teacher.ok===true&&cfg.code));}
function panelHTML(){
  return '<main class="content-shell" id="teacherDashboard" hidden>'+
    '<div class="tp-toolbar"><div><div class="tp-kicker">Teacher mode</div><h1 id="tpRoomTitle">Classroom dashboard</h1><p id="tpSubTitle">Hall passes, lesson timing and classroom tools</p></div>'+
    '<div class="tp-actions"><button class="liquid-btn" data-tp-action="changeMode">Change mode</button><button class="liquid-btn primary-action" data-tp-action="openTeacherSettings">Teacher settings</button></div></div>'+
    '<div class="tp-grid"><div>'+
      '<section class="tp-panel"><div class="tp-panel-head"><span class="tp-status" id="tpStatus" data-status="between">School schedule</span><span class="tp-mini" id="tpDate"></span></div>'+
        '<div class="tp-headline" id="tpPeriod">Loading...</div><div class="tp-muted" id="tpPeriodMeta"></div>'+
        '<div class="tp-inline"><div><div class="tp-clock" id="tpCountdown">--:--</div><div class="tp-subclock" id="tpCountdownLabel">Until next transition</div></div><div class="tp-row"><button class="tp-smallbtn" data-tp-action="shiftMinus">-1s</button><button class="tp-smallbtn" data-tp-action="shiftPlus">+1s</button><button class="tp-smallbtn" data-tp-action="toggleFullscreen">Full screen</button></div></div>'+
        '<div id="tpLessonTrack" class="tp-progress" aria-label="Lesson progress"></div><div class="tp-inline"><span class="tp-mini" id="tpOpenAt"></span><span class="tp-mini" id="tpCloseAt"></span></div><div class="tp-mini" id="tpGroups"></div>'+
        '<div class="tp-stats"><article class="summary-card"><div class="summary-label">Rotation</div><div class="summary-value" id="tpRotation">-</div></article><article class="summary-card"><div class="summary-label">Passes out</div><div class="summary-value" id="tpOut">0</div></article><article class="summary-card"><div class="summary-label">Current time</div><div class="summary-value" id="tpRealTime">--:--</div></article></div>'+
      '</section>'+
      '<section class="tp-panel"><div class="tp-panel-head"><h2>Hall passes</h2><span class="tp-mini" id="tpConnection">Connect a teacher code</span></div>'+
        '<div class="tp-row"><button class="liquid-btn primary-action" data-tp-action="newPass" id="tpNewPass">+ Start a pass</button><span class="tp-muted" id="tpPassHint"></span></div><div id="tpPassList" class="tp-section"></div></section>'+
      '<section class="tp-panel" id="tpAgendaPanel"><div class="tp-panel-head"><h2>Lesson agenda</h2><button class="tp-smallbtn" data-tp-action="editAgenda">Edit</button></div><div id="tpAgendaContent" class="tp-agenda-list tp-muted">No agenda for this period.</div></section>'+
      '<section class="tp-panel"><div class="tp-panel-head"><h2>Bell schedule</h2><span id="tpScheduleType" class="tp-mini"></span></div><div id="tpScheduleRows" class="tp-stack"></div></section>'+
    '</div><div>'+
      '<section class="tp-panel" id="tpTimerPanel"><div class="tp-panel-head"><h2>Classroom timer</h2><button class="tp-smallbtn" data-tp-action="timerEdit">Set time</button></div>'+
        '<div class="tp-inline"><span class="tp-timer-number" id="tpTimerNumber">5:00</span><span class="tp-mini" id="tpTimerState">Ready</span></div>'+
        '<div class="tp-row"><button class="liquid-btn primary-action" data-tp-action="timerToggle" id="tpTimerToggle">Start</button><button class="liquid-btn" data-tp-action="timerReset">Reset</button></div>'+
        '<div class="tp-pills tp-section">'+[1,2,3,5,10,15,20,30].map(x=>'<button class="tp-smallbtn" data-tp-action="timerPreset" data-min="'+x+'">'+x+'m</button>').join('')+'</div></section>'+
      '<section class="tp-panel" id="tpCardPanel"><div class="tp-panel-head"><h2>Classroom cards</h2><span class="tp-mini" id="tpCardIndex"></span></div><div id="tpCardText" class="tp-muted"></div></section>'+
      '<section class="tp-panel" id="tpWeatherPanel"><div class="tp-panel-head"><h2>Orlando weather</h2><span class="tp-mini">Live forecast</span></div><div id="tpWeather" class="tp-muted">Weather off in Teacher settings.</div></section>'+
      '<section class="tp-panel"><div class="tp-panel-head"><h2>Recent passes</h2><span class="tp-mini" id="tpPending"></span></div><div id="tpRecent" class="tp-muted">No trips yet.</div></section>'+
    '</div></div></main>';
}
function roleHTML(){
  return '<div class="tp-cover" id="tpRoleCover" hidden><section class="tp-welcome content-shell" role="dialog" aria-modal="true" aria-labelledby="tpRoleHeading">'+
  '<div class="tp-kicker">Orlando Science Class Timer</div><h1 id="tpRoleHeading">How will you use the app?</h1>'+
  '<p class="tp-description">Choose the dashboard that fits you. You can switch modes later in Settings.</p>'+
  '<div class="tp-role-options">'+
  '<button class="tp-role" data-tp-action="chooseStudent"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M4 21c.5-5 3-7 8-7s7.5 2 8 7"/></svg><strong>Student</strong><span>Bell schedule, A/B days, class countdown, your profiles and reminders.</span></button>'+
  '<button class="tp-role" data-tp-action="chooseTeacher"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="14" rx="2"/><path d="M8 22h8M12 17.5V22M7 8h10M7 12h6"/></svg><strong>Teacher</strong><span>Classroom display, hall passes, 10/10 rule, lesson agenda and timer.</span></button>'+
  '</div></section></div>';
}
function teacherSettingsHTML() {
  return '<div class="tp-modal" id="tpSettings" hidden><section class="tp-dialog" role="dialog" aria-modal="true" aria-labelledby="tpSettingsTitle">'+
  '<div class="tp-toolbar"><div><div class="tp-kicker">Teacher mode</div><h2 id="tpSettingsTitle">Classroom settings</h2></div><button class="liquid-btn" data-tp-action="closeTeacherSettings">Close</button></div>'+
  '<div class="tp-dialog-inner"><nav class="tp-side" aria-label="Teacher settings">'+
  [['connect','Teacher code'],['passes','Hall passes'],['timer','Timer & sounds'],['agenda','Agenda'],['extras','Extras'],['clock','Clock & privacy']].map(x=>'<button data-tp-pane="'+x[0]+'" type="button">'+x[1]+'</button>').join('')+
  '</nav><div>'+
  '<section class="tp-pane" id="tpPane-connect"><div class="tp-form">'+
  '<div class="tp-field full"><label>Teacher code from the school</label><input id="tpCodeInput" type="password" autocomplete="off" placeholder="Personal teacher code"></div>'+
  '<div class="tp-field full"><label>Google Apps Script web app URL</label><input id="tpUrlInput" type="url" placeholder="https://script.google.com/macros/s/.../exec"></div>'+
  '<div class="tp-field"><label>Display name</label><input id="tpTeacherName"></div><div class="tp-field"><label>Room</label><input id="tpRoomInput"></div>'+
  '<div class="tp-field"><label>Bell schedule group</label><select id="tpGradeBand"><option value="1011">10th–11th Grade</option><option value="912">9th–12th Grade</option></select></div><div class="tp-field"><label>Clock style</label><select id="tpHourMode"><option value="12">12-hour</option><option value="24">24-hour</option></select></div><div class="tp-field full"><div class="tp-row"><button class="liquid-btn primary-action" type="button" data-tp-action="connectTeacher">Check code and load classes</button><button type="button" class="liquid-btn" data-tp-action="disconnectTeacher">Disconnect</button></div></div>'+
  '<div class="tp-field full tp-muted" id="tpTeacherMsg">Student rosters are only loaded after the school verifies the code.</div></div></section>'+
  '<section class="tp-pane" id="tpPane-passes" hidden><div class="tp-form">'+
  '<div class="tp-field"><label>Close first (minutes)</label><input id="tpCloseStart" type="number" min="0" max="60"></div><div class="tp-field"><label>Close last (minutes)</label><input id="tpCloseEnd" type="number" min="0" max="60"></div>'+
  '<div class="tp-field"><label>Simultaneous passes</label><input id="tpSlots" type="number" min="1" max="200"></div><div class="tp-field"><label>Auto-leave delay (seconds)</label><input id="tpAutoLeave" type="number" min="0" max="30"></div>'+
  '<div class="tp-field full"><label>Destinations (one per line, name:minute limit)</label><textarea id="tpDestinations"></textarea></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpRuleEnabled">Enforce 10/10 rule</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpAllowOverride">Allow one-time teacher override while closed</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpPassEnabled">Enable pass buttons</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpDemo">Demo passes with sample names (never sent to Google Sheets)</label></div><div class="tp-field full"><label><input type="checkbox" id="tpTestMode">Log verified test trips as TEST instead of LIVE</label></div><div class="tp-field full"><h3>Pass history</h3><div id="tpHistoryList" class="tp-stack"></div></div>'+
  '</div></section>'+
  '<section class="tp-pane" id="tpPane-timer" hidden><div class="tp-form">'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpTimerEnabled">Show classroom timer</label></div>'+
  '<div class="tp-field"><label>Warning when remaining (seconds)</label><input id="tpTimerWarn" type="number" min="0" max="3600"></div>'+
  '<div class="tp-field"><label>Sound volume (%)</label><input id="tpTimerVolume" type="number" min="0" max="100"></div>'+
  '<div class="tp-field"><label>Timer end sound</label><select id="tpTimerSound"><option value="bell">School bell</option><option value="beep">Short chime</option><option value="none">Off</option></select></div>'+
  '<div class="tp-field"><label>Timer warning sound</label><select id="tpTimerWarningSound"><option value="beep">Short chime</option><option value="bell">School bell</option><option value="none">Off</option></select></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpNotifications">Bell countdown notifications</label></div>'+
  '<div class="tp-field"><label>Alert before class ends (min)</label><input id="tpNotifyMin" type="number" min="1" max="30"></div>'+
  '<div class="tp-field"><label>Bell notification sound</label><select id="tpNotifySound"><option value="bell">School bell</option><option value="beep">Short chime</option><option value="none">Off</option></select></div>'+
  '<div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="testTeacherSound">Test selected end sound</button></div><div class="tp-field full"><h3>Sound library</h3><p class="tp-muted">Add your own short audio files. Each sound can be selected independently for timer end, warning, and bell notification. Files are stored on this device for offline use.</p><input type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/aac" id="tpSoundUpload" multiple aria-label="Upload classroom sounds"><div id="tpSoundLibrary" class="tp-stack"></div></div>'+
  '</div></section>'+
  '<section class="tp-pane" id="tpPane-agenda" hidden><div class="tp-form">'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpAgendaEnabled">Display lesson agenda</label></div>'+
  '<div class="tp-field"><label>Class</label><select id="tpAgendaSection">'+['A1','A2','A3','A4','B1','B2','B3','B4'].map(x=>'<option>'+x+'</option>').join('')+'</select></div>'+
  '<div class="tp-field"><label>Show minutes before class</label><input id="tpAgendaLead" type="number" min="0" max="30"></div>'+
  '<div class="tp-field full"><label>Agenda (one item per line, use [x] for completed)</label><textarea id="tpAgendaText" rows="7" placeholder="Warm-up&#10;Review yesterday&#10;Practice problems"></textarea></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpAgendaDaily">Clear agenda the next day</label></div>'+
  '<div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="saveAgenda">Save agenda for selected class</button></div>'+
  '</div></section>'+
  '<section class="tp-pane" id="tpPane-extras" hidden><div class="tp-form">'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpWeatherEnabled">Orlando weather (Open-Meteo)</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpCardsEnabled">Rotating classroom cards and questions</label></div><div class="tp-field full"><label>Seconds between classroom cards</label><input id="tpCardSeconds" type="number" min="5" max="120"></div><div class="tp-field full"><label><input type="checkbox" id="tpCalendarCards">School calendar countdown cards</label></div><div class="tp-field full"><label><input type="checkbox" id="tpWeatherCards">Weather information in cards</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpMessagesEnabled">School announcements from script</label></div>'+
  '<div class="tp-field full"><label><input type="checkbox" id="tpAlertsEnabled">Weather alerts from script</label></div>'+
  '<div class="tp-field full tp-muted">These extras start off by default and can be enabled separately. School announcements and weather alerts depend on the connected script.</div></div></section>'+
  '<section class="tp-pane" id="tpPane-clock" hidden><div class="tp-form">'+
  '<div class="tp-field"><label>Clock shift (seconds)</label><input id="tpShift" type="number" min="-600" max="600"></div>'+
  '<div class="tp-field"><label>Daily drift (seconds / day)</label><input id="tpDrift" type="number" min="-10" max="10" step="0.1"></div>'+
  '<div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="resetDrift">The school bell was reset</button></div>'+
  '<div class="tp-field full"><label>Settings PIN (optional, 4 to 12 digits)</label><input type="password" id="tpPinNew" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="Leave blank to keep current PIN"></div>'+
  '<div class="tp-field full"><div class="tp-row"><button class="liquid-btn" type="button" data-tp-action="setPin">Set or replace PIN</button><button class="liquid-btn" type="button" data-tp-action="removePin">Remove PIN</button></div></div>'+
  '<div class="tp-field full"><label>School day override (only this board)</label></div><div class="tp-field"><label>Date</label><input type="date" id="tpOverrideDate"></div><div class="tp-field"><label>Set day to</label><select id="tpOverrideType"><option value="">School calendar default</option><option value="noschool">No school</option><option value="A_regular">A Day Regular</option><option value="B_regular">B Day Regular</option><option value="A_wednesday">A Day Wednesday</option><option value="B_wednesday">B Day Wednesday</option></select></div><div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="saveOverride">Save calendar override</button></div><div class="tp-field full"><label><input type="checkbox" id="tpCountdownPassed">Show time passed rather than remaining</label></div><div class="tp-field"><label>Demo clock speed</label><select id="tpDemoSpeed"><option value="1">Normal</option><option value="10">10× speed</option><option value="30">30× speed</option><option value="60">60× speed</option></select></div><div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="flushQueue">Retry waiting logs</button> <span class="tp-mini" id="tpQueueCount"></span></div>'+
  '<div class="tp-field full"><button class="liquid-btn" type="button" data-tp-action="exportTrips">Export recent passes (CSV)</button></div>'+
  '<div class="tp-field full"><p class="tp-muted">Teacher codes and student rosters are stored locally on this device for offline use. Use Disconnect on a shared device to clear them. PIN is a local classroom deterrent, not a substitute for a secured school device.</p></div>'+
  '</div></section>'+
  '<div class="tp-foot"><span class="tp-mini" id="tpSettingsNotice"></span><button class="liquid-btn primary-action" data-tp-action="saveTeacherSettings">Save changes</button></div>'+
  '</div></div></section></div>';
}
function pickerHTML(){
  return '<div class="tp-modal tp-picker" id="tpPick" hidden><section class="tp-dialog" role="dialog" aria-modal="true" aria-labelledby="tpPickTitle"><div class="tp-toolbar"><div><div class="tp-kicker">Hall pass</div><h2 id="tpPickTitle">Start a pass</h2></div><button class="liquid-btn" data-tp-action="closePick">Close</button></div>'+
  '<div class="tp-form"><div class="tp-field"><label>Student</label><select id="tpStudent"></select></div><div class="tp-field" id="tpGuestWrap" hidden><label>Guest student name</label><input id="tpGuestName" maxlength="70"></div>'+
  '<div class="tp-field"><label>Destination</label><select id="tpDestination"></select></div></div>'+
  '<div id="tpPickWarning" class="tp-inline-status"></div><div class="tp-foot"><button class="liquid-btn" data-tp-action="closePick">Cancel</button><button class="liquid-btn primary-action" id="tpConfirmPass" data-tp-action="confirmPass">Start pass</button></div></section></div>';
}
function timerDialogHTML(){
 return '<div class="tp-modal" id="tpTimerDialog" hidden><section class="tp-dialog" style="max-width:480px" role="dialog" aria-modal="true"><div class="tp-toolbar"><h2>Set classroom timer</h2><button class="liquid-btn" data-tp-action="timerDialogClose">Close</button></div><div class="tp-form" style="margin-top:18px">'+
 '<div class="tp-field"><label>Minutes</label><input id="tpTimerMinutes" type="number" min="0" max="999"></div><div class="tp-field"><label>Seconds</label><input id="tpTimerSeconds" type="number" min="0" max="59"></div></div>'+
 '<div class="tp-pills tp-section">'+[-60,-10,10,60,300].map(n=>'<button class="tp-smallbtn" data-tp-action="timerAdjust" data-sec="'+n+'">'+(n>0?'+':'')+n+'s</button>').join('')+'</div>'+
 '<div class="tp-foot"><button class="liquid-btn" data-tp-action="timerSet">Set without starting</button><button class="liquid-btn primary-action" data-tp-action="timerSetStart">Set and start</button></div></section></div>';
}
function attach(){
  const nav=document.createElement('button');nav.className='nav-link';nav.type='button';nav.id='teacherNav';nav.dataset.nav='teacher';nav.innerHTML='<span>Teacher board</span>';byId('pillNav').insertBefore(nav,byId('settingsNav'));
  byId('glassRoot').insertAdjacentHTML('beforeend',panelHTML());
  document.body.insertAdjacentHTML('beforeend',roleHTML()+teacherSettingsHTML()+pickerHTML()+timerDialogHTML());
  const settingsMain=byId('settingsMain');
  const quick=document.createElement('div');quick.className='tp-settings-shortcut';quick.innerHTML='<div><strong>Student / Teacher mode</strong><small>Switch dashboards without changing your saved student profiles.</small></div><button class="liquid-btn" id="tpSwitchSettings">Change mode</button>';
  settingsMain.insertBefore(quick,byId('editorEmpty'));
  byId('tpSwitchSettings').addEventListener('click',()=>{if(typeof hasUnsavedProfileChanges==='function'&&hasUnsavedProfileChanges()){requestCloseSettings();return;} if(typeof finalizeCloseSettings==='function')finalizeCloseSettings();showRoleChooser();});
  nav.addEventListener('click',()=>{if(role==='teacher'){window.scrollTo({top:0,behavior:'smooth'}); nav.classList.add('active');}});
  document.addEventListener('click',onClick);byId('tpSoundUpload').addEventListener('change',uploadSounds);loadSounds();
  byId('tpStudent').addEventListener('change',()=>{byId('tpGuestWrap').hidden=val('tpStudent')!=='__guest';});
  byId('tpAgendaSection').addEventListener('change',showAgendaEditor);
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!byId('tpPick').hidden)closePick();else if(!byId('tpTimerDialog').hidden)byId('tpTimerDialog').hidden=true;else if(!byId('tpSettings').hidden)closeSettings();});
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const code=hash.get('code');
  if(code&&/^[a-z0-9]{6,20}$/i.test(code)){cfg.code=code.toUpperCase();save();history.replaceState(null,'',location.pathname+location.search);if(!role)role='teacher';}
  activate(role);
  setInterval(tick,1000);
  setTimeout(()=>{if(role==='teacher'){tick();if(cfg.code&&!cfg.demo)verifyTeacher(false);}},350);
}
function showRoleChooser(){byId('tpRoleCover').hidden=false;document.body.style.overflow='hidden';byId('tpRoleHeading').focus?.();}
function setRole(next){role=next;localStorage.setItem(KEY,role);byId('tpRoleCover').hidden=true;document.body.style.overflow='';activate(role);}
function activate(next){
  if(!next){document.documentElement.removeAttribute('data-app-role');showRoleChooser();return;}
  document.documentElement.dataset.appRole=next;
  byId('tpRoleCover').hidden=true;
  byId('teacherDashboard').hidden=next!=='teacher';
  if(next==='teacher'){byId('teacherNav').classList.add('active');byId('settingsNav').classList.remove('active');tick();if(cfg.code&&!hasTeacher())verifyTeacher(false);}
  else {document.title='Orlando Science Bell Schedule';byId('teacherNav').classList.remove('active');}
}
function showPane(pane){
  activePane=pane;
  document.querySelectorAll('[data-tp-pane]').forEach(b=>b.classList.toggle('active',b.dataset.tpPane===pane));
  document.querySelectorAll('.tp-pane').forEach(p=>p.hidden=p.id!=='tpPane-'+pane);
  if(pane==='agenda')showAgendaEditor();
}
async function openSettings(pane){
  if(cfg.pinHash) {
    const pin=window.prompt('Enter the Teacher Mode settings PIN:');
    if(pin===null||!(await checkPin(pin))){window.alert('Incorrect PIN.');return;}
  }
  byId('tpCodeInput').value=cfg.code||'';byId('tpUrlInput').value=cfg.url||SCHOOL_URL;
  const values={tpTeacherName:cfg.teacherName,tpRoomInput:cfg.room,tpCloseStart:cfg.startClose,tpCloseEnd:cfg.endClose,tpSlots:cfg.slots,tpAutoLeave:cfg.autoLeave,
    tpDestinations:cfg.destinations,tpTimerWarn:cfg.timerWarn,tpTimerSound:cfg.timerSound,tpTimerWarningSound:cfg.timerWarnSound,
    tpTimerVolume:cfg.timerVolume,tpNotifyMin:cfg.notifyMin,tpNotifySound:cfg.notifySound,tpAgendaLead:cfg.agendaLead,tpShift:cfg.shiftSec,tpDrift:cfg.driftDaily,tpCardSeconds:cfg.cardSeconds};
  Object.entries(values).forEach(([k,v])=>{if(byId(k))byId(k).value=v;});
  const toggles={tpRuleEnabled:cfg.useRule,tpAllowOverride:cfg.allowOverride,tpPassEnabled:cfg.passEnabled,tpDemo:cfg.demo,tpTestMode:cfg.testMode,
    tpTimerEnabled:cfg.timerEnabled,tpNotifications:cfg.notificationsEnabled,tpAgendaEnabled:cfg.agendaEnabled,tpAgendaDaily:cfg.agendaDaily,
    tpWeatherEnabled:cfg.weatherEnabled,tpCardsEnabled:cfg.cardsEnabled,tpCalendarCards:cfg.calendarCards,tpWeatherCards:cfg.weatherCards,tpAlertsEnabled:cfg.alertsEnabled,tpMessagesEnabled:cfg.messagesEnabled};
  Object.entries(toggles).forEach(([k,v])=>{if(byId(k))byId(k).checked=!!v;});
  byId('tpGradeBand').value=cfg.gradeBand||'1011';byId('tpHourMode').value=cfg.hour24?'24':'12';byId('tpCountdownPassed').checked=!!cfg.countdownPassed;byId('tpDemoSpeed').value=String(cfg.demoSpeed||1);byId('tpOverrideDate').value=iso(new Date());byId('tpOverrideType').value=cfg.calendarOverrides?.[iso(new Date())]||'';byId('tpSettingsNotice').textContent='';byId('tpQueueCount').textContent=state.queue.length+' waiting';refreshSoundOptions();byId('tpTimerSound').value=cfg.timerSound;byId('tpTimerWarningSound').value=cfg.timerWarnSound;byId('tpNotifySound').value=cfg.notifySound;
  byId('tpTeacherMsg').textContent=cfg.teacher?.ok?'Connected as '+(cfg.teacher.display||cfg.teacher.name):'No verified teacher code. Student names and live pass logging are locked.';byId('tpHistoryList').innerHTML=state.recent.length?state.recent.slice(0,25).map(t=>'<div class="tp-log-line"><strong>'+esc(t.student)+'</strong> · '+esc(t.where)+' · '+esc(t.status)+'<div class="tp-mini">'+esc(t.section)+' · '+esc(t.duration)+' · '+esc(t.when)+'</div></div>').join(''):'<p class="tp-muted">No passes completed on this device yet.</p>';
  showPane(pane||'connect');byId('tpSettings').hidden=false;
}
function closeSettings(){byId('tpSettings').hidden=true;}
function saveTeacherSettings(){
  cfg.teacherName=val('tpTeacherName').trim().slice(0,70);cfg.room=val('tpRoomInput').trim().slice(0,40);cfg.gradeBand=val('tpGradeBand')==='912'?'912':'1011';cfg.hour24=val('tpHourMode')==='24';cfg.countdownPassed=checked('tpCountdownPassed');cfg.cardSeconds=clamp(val('tpCardSeconds'),5,120);cfg.calendarCards=checked('tpCalendarCards');cfg.weatherCards=checked('tpWeatherCards');if(cfg.demoSpeed!==Number(val('tpDemoSpeed'))){cfg.demoSpeed=Number(val('tpDemoSpeed'))||1;cfg.demoStarted=Date.now();}
  cfg.startClose=clamp(val('tpCloseStart'),0,60);cfg.endClose=clamp(val('tpCloseEnd'),0,60);
  cfg.slots=clamp(val('tpSlots'),1,200);cfg.autoLeave=clamp(val('tpAutoLeave'),0,30);
  cfg.destinations=val('tpDestinations').trim().slice(0,1500);
  cfg.useRule=checked('tpRuleEnabled');cfg.allowOverride=checked('tpAllowOverride');cfg.passEnabled=checked('tpPassEnabled');
  cfg.timerEnabled=checked('tpTimerEnabled');cfg.timerWarn=clamp(val('tpTimerWarn'),0,3600);
  cfg.timerSound=val('tpTimerSound');cfg.timerWarnSound=val('tpTimerWarningSound');cfg.timerVolume=clamp(val('tpTimerVolume'),0,100);
  cfg.notificationsEnabled=checked('tpNotifications');cfg.notifyMin=clamp(val('tpNotifyMin'),1,30);cfg.notifySound=val('tpNotifySound');
  cfg.agendaEnabled=checked('tpAgendaEnabled');cfg.agendaDaily=checked('tpAgendaDaily');cfg.agendaLead=clamp(val('tpAgendaLead'),0,30);
  cfg.weatherEnabled=checked('tpWeatherEnabled');cfg.cardsEnabled=checked('tpCardsEnabled');cfg.messagesEnabled=checked('tpMessagesEnabled');cfg.alertsEnabled=checked('tpAlertsEnabled');
  cfg.shiftSec=clamp(val('tpShift'),-600,600);cfg.driftDaily=clamp(val('tpDrift'),-10,10);
  cfg.demo=checked('tpDemo');cfg.testMode=checked('tpTestMode');if(cfg.demo&&!cfg.demoStarted)cfg.demoStarted=Date.now();if(!cfg.demo)cfg.demoStarted=0;
  cfg.url=val('tpUrlInput').trim()||SCHOOL_URL;
  if(cfg.url&&!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(cfg.url)){byId('tpSettingsNotice').textContent='The script URL must be a Google Apps Script /exec HTTPS address.';return;}
  const code=val('tpCodeInput').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code!==cfg.code){cfg.code=code;cfg.teacher=null;cfg.rosters={};cfg.groups={};cfg.sections={};}
  save();byId('tpSettingsNotice').textContent='Saved.';tick();
}
function showAgendaEditor(){
  const section=val('tpAgendaSection')||'A1';
  byId('tpAgendaText').value=(cfg.agenda[section]||{}).text||'';
}
function saveAgenda(){
  cfg.agenda[val('tpAgendaSection')||'A1']={text:val('tpAgendaText').slice(0,5000),date:iso(nowDate())};
  save();byId('tpSettingsNotice').textContent='Agenda saved.';tick();
}
function digest(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(''));}
async function checkPin(pin){return !!cfg.pinHash&&await digest(String(cfg.pinSalt)+String(pin))===cfg.pinHash;}
async function setPin(){
  const p=val('tpPinNew').trim();if(!/^\d{4,12}$/.test(p)){byId('tpSettingsNotice').textContent='Use a PIN of 4 to 12 digits.';return;}
  cfg.pinSalt=Math.random().toString(36).slice(2);cfg.pinHash=await digest(cfg.pinSalt+p);save();byId('tpPinNew').value='';byId('tpSettingsNotice').textContent='PIN saved. It is needed next time settings are opened.';
}
function stamp(outAt,inAt){
  const d=new Date(outAt),b=new Date(inAt),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+p(b.getHours())+p(b.getMinutes())+p(b.getSeconds());
}
function schoolRequest(action,extra={},requiresCode=true) {
  const code=cfg.code.trim(),url=cfg.url||SCHOOL_URL;
  if(requiresCode&&!code)return Promise.resolve({ok:false,error:'No teacher code'});
  const query=new URLSearchParams({action,...(requiresCode?{code}:{}),...extra,t:String(Date.now())});
  const endpoint=url+(url.includes('?')?'&':'?')+query.toString();
  return fetch(endpoint,{cache:'no-store'}).then(r=>r.json()).catch(()=>new Promise(resolve=>{
    const callback='ossTeacherCb'+(++requestCount)+'_'+Date.now(),script=document.createElement('script');
    const done=value=>{clearTimeout(timeout);delete window[callback];script.remove();resolve(value||{ok:false,error:'School server unavailable'});};
    const timeout=setTimeout(()=>done(null),10000);
    window[callback]=data=>done(data);
    script.onerror=()=>done(null);
    script.src=endpoint+'&callback='+encodeURIComponent(callback);
    document.head.appendChild(script);
  }));
}
async function verifyTeacher(manual){
  if(!cfg.code||cfg.demo)return;
  if(manual)byId('tpTeacherMsg').textContent='Checking the school code...';
  try {
    const result=await schoolRequest('hello');
    if(result.ok&&result.role==='teacher'&&Array.isArray(result.sections)){
      cfg.teacher={ok:true,name:result.teacher,display:result.display||result.teacher,checkedAt:Date.now()};
      const rosters={},groups={},sections={};const rooms={};
      result.sections.forEach(sec=>{
        const code=String(sec.block||'');
        if(!/^[AB][1-4]$/.test(code))return;
        rosters[code]=(sec.students||[]).filter(x=>x&&x.n).map(x=>({name:String(x.n),id:String(x.id||'')}));sections[code]={course:String(sec.course||''),room:String(sec.room||''),time:String(sec.time||'')};
        if(Array.isArray(sec.groups)&&sec.groups.length>1)groups[code]=sec.groups.map(g=>({s:Number(g.start),e:Number(g.end),grades:g.grades||[]}));
        if(sec.room)rooms[String(sec.room)]=(rooms[String(sec.room)]||0)+1;
      });
      cfg.rosters=rosters;cfg.groups=groups;cfg.sections=sections;cfg.teacher.checkedAt=Date.now();
      if(!cfg.teacherName)cfg.teacherName=cfg.teacher.display;
      if(!cfg.room)cfg.room=Object.keys(rooms).sort((a,b)=>rooms[b]-rooms[a])[0]||'';
      save();if(manual)byId('tpTeacherMsg').textContent='Connected as '+cfg.teacher.display+'. Loaded '+Object.values(rosters).reduce((n,arr)=>n+arr.length,0)+' students.';
      await flushQueue();
    } else {
      if(result.error==='unknown code'||result.role==='admin'){cfg.teacher=null;cfg.rosters={};cfg.groups={};save();}
      if(manual)byId('tpTeacherMsg').textContent=result.error==='unknown code'?'Code not recognized or not active.':'The code cannot access a classroom roster.';
    }
  } catch(_) {if(manual)byId('tpTeacherMsg').textContent='Could not reach the school. Cached classes remain available offline.';}
  tick();
}
async function flushQueue(){
  if(flushing||!cfg.teacher?.ok||cfg.demo||!cfg.code||!navigator.onLine)return;
  flushing=true;
  try{
    for(const entry of [...state.queue]){
      if(entry.teacher!==cfg.teacher.name)continue;
      const result=await schoolRequest('log',entry.payload);
      if(result.ok||/^(bad trip id|bad times|bad status)/.test(String(result.error||''))) {
        state.queue=state.queue.filter(x=>x.id!==entry.id);save();
      }else{if(result.error==='unknown code'){cfg.teacher=null;cfg.rosters={};save();}break;}
    }
  }finally{flushing=false;tick();}
}
async function updateWeather(){
  if(!cfg.weatherEnabled||Date.now()-lastWx<1800000)return;lastWx=Date.now();
  try{
    const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude=28.5383&longitude=-81.3792&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York');
    const d=await r.json();if(d.current){weather={temp:d.current.temperature_2m,code:d.current.weather_code,at:Date.now()};renderWeather();}
  }catch(_){byId('tpWeather').textContent=weather?'Weather last updated '+timeLabel(weather.at):'Weather is unavailable offline.';}
}
async function updateMessages(){
  if(!(cfg.messagesEnabled||cfg.alertsEnabled)||Date.now()-lastMsg<1200000)return;
  lastMsg=Date.now();try{
    if(cfg.messagesEnabled){const m=await schoolRequest('messages',{},false);messages=m.ok?m.messages||[]:[];}
    if(cfg.alertsEnabled){const a=await schoolRequest('alerts',{},false);if(a.ok&&Array.isArray(a.alerts))messages=messages.concat(a.alerts.map(x=>({text:x.headline||x.event||String(x)})));}
  }catch(_){}
}
function renderWeather(){
  byId('tpWeatherPanel').hidden=!cfg.weatherEnabled;
  if(!cfg.weatherEnabled)return;
  if(!weather){byId('tpWeather').textContent='Loading local weather...';return;}
  const conditions=weather.code===0?'Clear':weather.code<4?'Partly cloudy':weather.code<50?'Cloudy':weather.code<70?'Rain or fog':weather.code<80?'Snow or showers':'Showers or storms';
  byId('tpWeather').innerHTML='<div class="tp-weather"><div><strong>'+Math.round(weather.temp)+'°F</strong><div class="tp-mini">'+esc(conditions)+' · '+timeLabel(weather.at)+'</div></div><span class="tp-chip">'+Math.round((weather.temp-32)*5/9)+'°C</span></div>';
}
function renderCards(sc){
  byId('tpCardPanel').hidden=!cfg.cardsEnabled;
  if(!cfg.cardsEnabled)return;
  const cards=[
    {title:'Lesson phase',text:sc.classRow?'We are in '+esc(sc.classRow.displayName)+'.':'The next class has not started.'},
    {title:'Day progress',text:sc.rotation?sc.rotation+' Day · '+(sc.now.getDay()===3?'Wednesday':'Regular')+' schedule.':'No school today.'},
    {title:'Quick question',text:'What is one thing you understand better today than yesterday?'},
    {title:'Classroom fact',text:'There are 60 seconds in a minute and 3,600 seconds in an hour.'}
  ];
  if(messages.length)cards.push(...messages.slice(0,4).map(m=>({title:'School announcement',text:esc(typeof m==='string'?m:m.text||m.message||'')})));
  if(weather&&cfg.weatherCards)cards.push({title:'Orlando weather',text:Math.round(weather.temp)+'°F right now.'});
  if(cfg.calendarCards){const dates=Object.entries(window.CALENDAR||{}).filter(([date,value])=>value&&date>=sc.day);if(dates.length)cards.push({title:'School calendar',text:dates.length+' school days remain in the published calendar.'});}const i=Math.floor(Date.now()/(clamp(cfg.cardSeconds,5,120)*1000))%cards.length;
  byId('tpCardIndex').textContent=(i+1)+' / '+cards.length;
  byId('tpCardText').innerHTML='<strong>'+esc(cards[i].title)+'</strong><p>'+cards[i].text+'</p>';
}
function renderAgenda(sc){
  byId('tpAgendaPanel').hidden=!cfg.agendaEnabled;
  if(!cfg.agendaEnabled)return;
  let code=sc.code;
  if(!code&&sc.next&&mins(sc.next.start)*60-sc.seconds<=cfg.agendaLead*60)code=sectionCode(sc.next);
  const entry=cfg.agenda[code],text=entry&&(!cfg.agendaDaily||entry.date===iso(sc.now))?entry.text:'';
  if(!text){byId('tpAgendaContent').textContent='No agenda for this period. Add one in Teacher settings.';return;}
  byId('tpAgendaContent').innerHTML=String(text).split('\n').filter(Boolean).map(line=>{
    const done=/^\[x\]\s*/i.test(line);
    return '<div class="'+(done?'done':'')+'">• '+esc(line.replace(/^\[[ x]\]\s*/i,''))+'</div>';
  }).join('');
}
function renderSchedule(sc){
  const target=byId('tpScheduleRows');
  const sig=iso(sc.now)+String(sc.rotation)+sc.rows.map(x=>x.displayName).join('|')+sc.current?.name;
  if(sig===lastTickKey)return;lastTickKey=sig;
  byId('tpScheduleType').textContent=sc.timeType==='wednesday'?'Wednesday':'Block day';
  target.innerHTML=sc.rotation?sc.rows.map(row=>{
    const current=sc.current===row;
    return '<div class="tp-inline" style="margin:0;padding:7px 9px;border-radius:10px;'+(current?'background:var(--blue-soft)':'')+'">'+
    '<span style="font-size:10px;font-weight:'+(current?800:600)+'">'+esc(row.displayName)+'</span><span class="tp-mini">'+esc(row.start)+'–'+esc(row.end)+'</span></div>';
  }).join(''):'<p class="tp-muted">No scheduled classes today.</p>';
}
function paintLesson(win,sc){
  const track=byId('tpLessonTrack');
  if(!sc.classRow){track.innerHTML='';byId('tpOpenAt').textContent='';byId('tpCloseAt').textContent='';byId('tpGroups').textContent='';return;}
  const duration=Math.max(1,win.end-win.start),pct=n=>clamp((n-win.start)/duration*100,0,100);
  const closed=[];
  let cursor=win.start;
  for(const [a,b] of [...win.open].sort((x,y)=>x[0]-y[0])){
    if(a>cursor)closed.push([cursor,a]);cursor=Math.max(cursor,b);
  }
  if(cursor<win.end)closed.push([cursor,win.end]);
  track.innerHTML=closed.map(pair=>'<div class="tp-zone" style="left:'+pct(pair[0])+'%;width:'+(pct(pair[1])-pct(pair[0]))+'%"></div>').join('')+
    '<div class="tp-marker" style="left:'+pct(sc.seconds)+'%"></div>';
  byId('tpGroups').textContent=(cfg.groups?.[sc.code]||[]).map(g=>(g.grades||g.g||[]).map(n=>n+'th').join(', ')+' grade').filter(Boolean).join(' / ');byId('tpOpenAt').textContent=win.open.length?'Open '+win.open.map(x=>timeLabel(new Date(new Date(sc.now.getFullYear(),sc.now.getMonth(),sc.now.getDate()).getTime()+x[0]*1000))).join(' / '):'No open pass window';
  byId('tpCloseAt').textContent=win.open.length?'Close '+win.open.map(x=>timeLabel(new Date(new Date(sc.now.getFullYear(),sc.now.getMonth(),sc.now.getDate()).getTime()+x[1]*1000))).join(' / '):'';
}
function renderPasses(sc,win){
  const total=state.active.length;
  byId('tpOut').textContent=String(total);
  byId('tpConnection').textContent=cfg.demo?'Demo mode':cfg.teacher?.ok?'Connected · '+esc(cfg.teacher.display||'Teacher'):'Teacher code required';
  const allowed=cfg.passEnabled&&(cfg.demo||hasTeacher())&&!!sc.classRow&&total<cfg.slots;
  byId('tpNewPass').disabled=!allowed;
  byId('tpPassHint').textContent=!cfg.passEnabled?'Passes disabled':!hasTeacher()?'Connect a teacher code to enable passes.':!sc.classRow?'No class in progress':total>=cfg.slots?'All passes in use':win.status!=='open'&&!cfg.allowOverride?'10/10 rule: passes are closed':'';
  const now=Date.now();
  byId('tpPassList').innerHTML=total?state.active.map(p=>{
    const limit=getDestinations().find(d=>d.name===p.where)?.limit||8;
    const elapsed=Math.floor((now-p.outMs)/1000),overdue=elapsed>limit*60;
    return '<div class="tp-pass-row'+(overdue?' is-overdue':'')+'"><div><div class="tp-pass-name">'+esc(p.student)+'</div><div class="tp-pass-meta">'+esc(p.where)+' · '+fmt(elapsed)+(overdue?' · Over '+limit+'-minute limit':'')+'</div></div>'+
    '<div class="tp-row"><button class="tp-smallbtn" data-tp-action="returnPass" data-pass-id="'+esc(p.id)+'">Returned</button><button class="tp-smallbtn" data-tp-action="cancelPass" data-pass-id="'+esc(p.id)+'">Cancel</button></div></div>';
  }).join(''):'<p class="tp-muted">No students are currently out.</p>';
  byId('tpPending').textContent=state.queue.length?state.queue.length+' pending sync':'';
  byId('tpRecent').innerHTML=state.recent.length?state.recent.slice(0,8).map(r=>'<div class="tp-log-line"><strong>'+esc(r.student)+'</strong> · '+esc(r.where)+'<div class="tp-mini">'+esc(r.status)+' · '+esc(r.duration)+' · '+esc(r.when)+'</div></div>').join(''):'No trips yet.';
}
function renderTimer(){
  const box=byId('tpTimerPanel');
  box.hidden=!cfg.timerEnabled;if(box.hidden)return;
  const t=state.timer,seconds=t.running?Math.max(0,Math.ceil((t.endAt-Date.now())/1000)):Math.max(0,t.remaining);
  if(t.running&&seconds===0){
    t.running=false;t.remaining=0;t.ended=true;
    playSound(cfg.timerSound);save();
  }
  if(t.running&&cfg.timerWarn>0&&seconds<=cfg.timerWarn&&!t.warned){
    t.warned=true;playSound(cfg.timerWarnSound);save();
  }
  byId('tpTimerNumber').textContent=fmt(seconds);
  byId('tpTimerNumber').classList.toggle('warning',seconds<=cfg.timerWarn&&seconds>0||t.ended);
  byId('tpTimerToggle').textContent=t.running?'Pause':seconds?'Start':'Set time';
  byId('tpTimerState').textContent=t.running?'Running':t.ended?'Finished':'Paused / ready';
}
async function soundStorage() {
 if(soundDb)return soundDb;
 soundDb=await new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error('IndexedDB not supported'));return;}
  const r=indexedDB.open('oss-teacher-sounds',1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('sounds'))r.result.createObjectStore('sounds',{keyPath:'id'});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
 return soundDb;
}
async function soundItems() {
 const db=await soundStorage();
 return new Promise((resolve,reject)=>{
  const req=db.transaction('sounds').objectStore('sounds').getAll();
  req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
 });
}
async function saveSound(item){
 const db=await soundStorage();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sounds','readwrite');tx.objectStore('sounds').put(item);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
}
async function removeSound(id) {
 const db=await soundStorage();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sounds','readwrite');tx.objectStore('sounds').delete(id);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
 });
}
function renderSoundList(){
 const box=byId('tpSoundLibrary');if(!box)return;
 box.innerHTML=soundNames.length?soundNames.map(x=>
  '<div class="tp-inline"><span class="tp-mini">'+esc(x.name)+'</span><div class="tp-row"><button class="tp-smallbtn" data-tp-action="soundPlay" data-sound-id="'+esc(x.id)+'">Test</button><button class="tp-smallbtn" data-tp-action="soundRemove" data-sound-id="'+esc(x.id)+'">Remove</button></div></div>').join('')
  :'<p class="tp-muted">No custom sounds on this device.</p>';
}
function refreshSoundOptions(){
 const options=[['bell','School bell'],['beep','Short chime'],['none','Off'],...soundNames.map(x=>['custom:'+x.id,x.name])];
 ['tpTimerSound','tpTimerWarningSound','tpNotifySound'].forEach(id=>{
  const el=byId(id);if(!el)return;const selected=el.value;
  el.innerHTML=options.map(([v,name])=>'<option value="'+esc(v)+'">'+esc(name)+'</option>').join('');
  el.value=options.some(x=>x[0]===selected)?selected:'none';
 });
 renderSoundList();
}
async function loadSounds(){
 try{soundNames=(await soundItems()).map(x=>({id:x.id,name:x.name}));refreshSoundOptions();
   byId('tpTimerSound').value=cfg.timerSound;
   byId('tpTimerWarningSound').value=cfg.timerWarnSound;
   byId('tpNotifySound').value=cfg.notifySound;
 }catch(e){console.warn('Classroom sound storage unavailable',e);}
}
async function uploadSounds(e){
 const files=[...(e.target.files||[])];e.target.value='';
 for(const file of files){
  if(file.size>5*1024*1024||!/^audio\//.test(file.type)){window.alert('Choose audio files smaller than 5 MB each.');continue;}
  const id='local_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  try{await saveSound({id,name:file.name.slice(0,80),blob:file});soundNames.push({id,name:file.name.slice(0,80)});}
  catch(err){window.alert('Could not save sound: '+err.message);}
 }
 refreshSoundOptions();
}
function playSound(which){
  if(!which||which==='none')return;
  if(String(which).startsWith('custom:')){const id=String(which).slice(7);soundItems().then(items=>{const item=items.find(x=>x.id===id);if(!item)return;const old=soundBlobCache.get(id);if(old)URL.revokeObjectURL(old);const url=URL.createObjectURL(item.blob);soundBlobCache.set(id,url);const a=new Audio(url);a.volume=clamp(cfg.timerVolume,0,100)/100;a.play().catch(()=>{});}).catch(()=>{});return;}if(which==='bell'){
    const audio=byId('bellAudio');
    if(audio){audio.pause();audio.currentTime=0;audio.volume=clamp(cfg.timerVolume,0,100)/100;audio.play().catch(()=>{});}return;
  }
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const ctx=window.ossTeacherAudio||(window.ossTeacherAudio=new AC());
    if(ctx.state==='suspended')ctx.resume().catch(()=>{});
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(840,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(550,ctx.currentTime+.25);
    gain.gain.setValueAtTime(Math.max(.001,clamp(cfg.timerVolume,0,100)/500),ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.29);
    osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.3);
  }catch(_){}
}
function tick(){
 if(role!=='teacher')return;
 const sc=schedule(),win=windowState(sc);
 const title=cfg.teacherName||(cfg.teacher?.display)||'Classroom dashboard';
 byId('tpRoomTitle').textContent=title;
 byId('tpSubTitle').textContent=(cfg.room?'Room '+cfg.room+' · ':'')+'Classroom tools & hall passes';
 byId('tpDate').textContent=sc.now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
 byId('tpRotation').textContent=sc.rotation?sc.rotation+' Day':'No school';
 byId('tpRealTime').textContent=sc.now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',hour12:!cfg.hour24});
 byId('tpPeriod').textContent=sc.classRow?sc.classRow.displayName:(sc.current?sc.current.displayName:sc.rotation?'Between classes':'No classes today');
 byId('tpPeriodMeta').textContent=sc.classRow?(sc.code+(sc.classRow.room?' · Room '+sc.classRow.room:'')+' · '+sc.classRow.start+'–'+sc.classRow.end):sc.next?'Next: '+sc.next.displayName+' at '+sc.next.start:'Orlando Science';
 byId('tpStatus').dataset.status=win.status;
 byId('tpStatus').textContent=win.status==='between'?'School schedule':win.reason;
 const nextAt=sc.current?mins(sc.current.end)*60:sc.next?mins(sc.next.start)*60:0;
 const duration=win.status!=='between'?win.remain:nextAt?nextAt-sc.seconds:0;
 byId('tpCountdown').textContent=duration?fmt(cfg.countdownPassed&&sc.current?Math.max(0,sc.seconds-mins(sc.current.start)*60):duration):'--:--';
 byId('tpCountdownLabel').textContent=cfg.countdownPassed&&sc.current?'Time passed this block':win.status==='open'?'Until passes close':win.status==='closed'?'Until passes open or class ends':sc.next?'Until '+sc.next.displayName:'No active school period';
 paintLesson(win,sc);renderPasses(sc,win);renderTimer();renderSchedule(sc);renderAgenda(sc);renderCards(sc);renderWeather();
 if(cfg.notificationsEnabled&&sc.classRow){
   const rem=mins(sc.classRow.end)*60-sc.seconds,key=iso(sc.now)+sc.code;
   if(rem>0&&rem<=cfg.notifyMin*60&&lastNotify!==key){lastNotify=key;playSound(cfg.notifySound);}
 }
 updateWeather();updateMessages();
 if(sc.now.getSeconds()===0&&sc.now.getMinutes()%5===0){flushQueue();if(cfg.code&&!cfg.demo&&(!cfg.teacher?.checkedAt||Date.now()-cfg.teacher.checkedAt>300000))verifyTeacher(false);}
 document.title=sc.rotation?sc.rotation+' Day · Teacher Mode':'Teacher Mode · Orlando Science';
}
function openPick(){
 const sc=schedule(),win=windowState(sc);
 if(!hasTeacher()||!sc.classRow||state.active.length>=cfg.slots)return;
 if(win.status!=='open'&&!cfg.allowOverride){window.alert('Hall passes are closed during the first and last '+cfg.startClose+'/'+cfg.endClose+' minutes.');return;}
 chooserPeriod=sc.code;choosing=true;
 const students=sectionStudents(chooserPeriod).filter(x=>!state.active.some(p=>p.studentId===x.id&&p.studentId||p.student===x.name));
 const select=byId('tpStudent');
 select.innerHTML='<option value="">Select a student</option>'+students.map((s,i)=>'<option value="'+i+'">'+esc(s.name)+'</option>').join('')+'<option value="__guest">Guest / visiting student</option>';
 select._students=students;byId('tpGuestWrap').hidden=true;byId('tpGuestName').value='';
 byId('tpDestination').innerHTML=getDestinations().map(d=>'<option value="'+esc(d.name)+'">'+esc(d.name)+' ('+d.limit+' min)</option>').join('');
 byId('tpPickWarning').textContent=win.status==='closed'?'Passes are currently closed. You will need to confirm an override.':'Passes are open for this class.';
 byId('tpPick').hidden=false;
}
function closePick(){if(pendingLeave){clearTimeout(pendingLeave.timer);pendingLeave=null;}byId('tpPick').hidden=true;choosing=false;}
function finishStart(student,where,outside,code){
 if(state.active.length>=cfg.slots)return;
 const p={id:'trip-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
   student:student.name,studentId:student.id||'',guest:!student.id,where,outMs:Date.now(),
   section:code,teacher:cfg.teacher?.name||'DEMO',outside:!!outside};
 state.active.push(p);save();closePick();tick();
}
function confirmPass(){
 const sc=schedule(),win=windowState(sc);
 if(!sc.classRow||sc.code!==chooserPeriod){byId('tpPickWarning').textContent='The class period changed. Close and try again.';return;}
 const selection=val('tpStudent'),where=val('tpDestination');
 const student=selection==='__guest'?{name:val('tpGuestName').trim().slice(0,70),id:''}:(byId('tpStudent')._students||[])[Number(selection)];
 if(!student||!student.name){byId('tpPickWarning').textContent='Select a student or type the guest name.';return;}
 if(state.active.some(p=>p.student===student.name)){byId('tpPickWarning').textContent='This student already has a pass.';return;}
 if(win.status!=='open'&&!cfg.allowOverride){byId('tpPickWarning').textContent='Passes closed. Ask the teacher.';return;}
 if(win.status!=='open'&&!window.confirm('Passes are closed right now. Authorize a one-time exception for this student?'))return;
 const sec=clamp(cfg.autoLeave,0,30);
 if(sec===0){finishStart(student,where,win.status!=='open',sc.code);return;}
 const end=Date.now()+sec*1000;
 byId('tpConfirmPass').disabled=true;
 const count=()=>{
   if(!pendingLeave)return;
   const left=Math.ceil((end-Date.now())/1000);
   byId('tpPickWarning').textContent=left>0?'Leaving in '+left+' seconds. Close to cancel.':'Pass started.';
   if(left<=0){clearInterval(pendingLeave.timer);pendingLeave=null;byId('tpConfirmPass').disabled=false;finishStart(student,where,win.status!=='open',sc.code);}
 };
 pendingLeave={timer:setInterval(count,250)};
 count();
}
function completePass(id,status){
 const index=state.active.findIndex(x=>x.id===id);if(index<0)return;
 const p=state.active[index],now=Date.now();
 if(status==='Cancelled'&&now-p.outMs>30000&&!cfg.pinHash&&!window.confirm('Cancel this pass? The cancelled trip stays in the log.'))return;if(status==='Cancelled'&&now-p.outMs>30000&&cfg.pinHash){
   const pin=window.prompt('Enter settings PIN to cancel this older trip:');
   if(pin===null)return;
   checkPin(pin).then(ok=>{if(ok)completePassConfirmed(id,status);else window.alert('Incorrect PIN.');});return;
 }
 completePassConfirmed(id,status);
}
function completePassConfirmed(id,status){
 const index=state.active.findIndex(x=>x.id===id);if(index<0)return;
 const p=state.active.splice(index,1)[0],back=Date.now();
 const trip={
   student:p.student,where:p.where,status,duration:fmt((back-p.outMs)/1000),when:timeLabel(back),
   out:p.outMs,back,section:p.section,studentId:p.studentId,teacher:p.teacher,guest:p.guest
 };
 state.recent.unshift(trip);state.recent=state.recent.slice(0,100);
 if(!cfg.demo&&p.teacher&&p.teacher!=='DEMO'){
   const payload={i:stamp(p.outMs,back),s:p.studentId||'',sec:p.section,blk:p.section,w:p.where,
     to:String(p.outMs),ti:String(back),o:p.outside?'1':'',m:cfg.testMode?'TEST':'LIVE',b:cfg.boardId,st:status,g:p.guest?p.student:''};
   state.queue.push({id:p.id,teacher:p.teacher,payload});
 }
 save();tick();flushQueue();
}
function timerValue(){const t=state.timer;return t.running?Math.max(0,Math.ceil((t.endAt-Date.now())/1000)):t.remaining;}
function setTimer(sec,start){
 const t=state.timer;t.sec=sec;t.remaining=sec;t.endAt=0;t.running=false;t.warned=false;t.ended=false;
 t.recent=[sec,...(t.recent||[]).filter(x=>x!==sec)].slice(0,4);
 if(start&&sec){t.running=true;t.endAt=Date.now()+sec*1000;}
 save();renderTimer();
}
function toggleTimer(){
 const t=state.timer,sec=timerValue();
 if(!sec){openTimerDialog();return;}
 if(t.running){t.running=false;t.remaining=sec;t.endAt=0;}
 else {t.running=true;t.endAt=Date.now()+sec*1000;t.ended=false;}
 save();renderTimer();
}
function openTimerDialog(){
 const sec=timerValue();byId('tpTimerMinutes').value=Math.floor(sec/60);byId('tpTimerSeconds').value=sec%60;
 byId('tpTimerDialog').hidden=false;
}
function timerFromDialog(start){setTimer(clamp(val('tpTimerMinutes'),0,999)*60+clamp(val('tpTimerSeconds'),0,59),start);byId('tpTimerDialog').hidden=true;}
function exportTrips(){
 const rows=[['Student','Destination','Status','Duration','Time returned','Section','Time out','Time back'],...state.recent.map(x=>[x.student,x.where,x.status,x.duration,x.when,x.section,new Date(x.out).toISOString(),new Date(x.back).toISOString()])];
 const csv=rows.map(row=>row.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 a.href=url;a.download='teacher-pass-history.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function onClick(ev){
 const btn=ev.target.closest('[data-tp-action],[data-tp-pane]');if(!btn)return;
 if(btn.dataset.tpPane){showPane(btn.dataset.tpPane);return;}
 const act=btn.dataset.tpAction;
 if(act==='chooseStudent')return setRole('student');
 if(act==='chooseTeacher')return setRole('teacher');
 if(act==='changeMode')return showRoleChooser();
 if(act==='openTeacherSettings')return openSettings('connect');
 if(act==='closeTeacherSettings')return closeSettings();
 if(act==='saveTeacherSettings')return saveTeacherSettings();
 if(act==='saveAgenda')return saveAgenda();
 if(act==='connectTeacher'){saveTeacherSettings();return verifyTeacher(true);}
 if(act==='disconnectTeacher'){
   if(!window.confirm('Disconnect teacher account and clear cached student names from this device?'))return;
   cfg.code='';cfg.teacher=null;cfg.rosters={};cfg.groups={};cfg.sections={};save();byId('tpCodeInput').value='';byId('tpTeacherMsg').textContent='Disconnected. Old waiting logs remain associated with their original teacher.';tick();return;
 }
 if(act==='setPin')return setPin();
 if(act==='removePin'){cfg.pinHash='';cfg.pinSalt='';save();byId('tpSettingsNotice').textContent='PIN removed.';return;}
 if(act==='resetDrift'){cfg.shiftSec=0;cfg.driftDaily=0;cfg.driftAt=Date.now();byId('tpShift').value=0;byId('tpDrift').value=0;save();return;}
 if(act==='flushQueue')return flushQueue();
 if(act==='exportTrips')return exportTrips();if(act==='toggleFullscreen'){if(document.fullscreenElement)document.exitFullscreen?.();else byId('glassRoot').requestFullscreen?.();return;}if(act==='saveOverride'){const d=val('tpOverrideDate'),o=val('tpOverrideType');if(!/^\d{4}-\d\d-\d\d$/.test(d))return;cfg.calendarOverrides=cfg.calendarOverrides||{};if(o)cfg.calendarOverrides[d]=o;else delete cfg.calendarOverrides[d];save();lastTickKey='';byId('tpSettingsNotice').textContent='Calendar override saved for '+d;tick();return;}
 if(act==='testTeacherSound')return playSound(val('tpTimerSound'));if(act==='soundPlay')return playSound('custom:'+btn.dataset.soundId);if(act==='soundRemove'){const id=btn.dataset.soundId;return removeSound(id).then(()=>{soundNames=soundNames.filter(x=>x.id!==id);refreshSoundOptions();});}
 if(act==='shiftMinus'||act==='shiftPlus'){cfg.shiftSec=clamp(Number(cfg.shiftSec)+(act==='shiftPlus'?1:-1),-600,600);save();tick();return;}
 if(act==='newPass')return openPick();
 if(act==='closePick')return closePick();
 if(act==='confirmPass')return confirmPass();
 if(act==='returnPass')return completePass(btn.dataset.passId,'Returned');
 if(act==='cancelPass')return completePass(btn.dataset.passId,'Cancelled');
 if(act==='editAgenda')return openSettings('agenda');
 if(act==='timerToggle')return toggleTimer();
 if(act==='timerReset')return setTimer(state.timer.sec||300,false);
 if(act==='timerPreset')return setTimer(Number(btn.dataset.min)*60,false);
 if(act==='timerEdit')return openTimerDialog();
 if(act==='timerDialogClose'){byId('tpTimerDialog').hidden=true;return;}
 if(act==='timerAdjust'){const s=clamp(val('tpTimerMinutes'),0,999)*60+clamp(val('tpTimerSeconds'),0,59)+Number(btn.dataset.sec);byId('tpTimerMinutes').value=Math.floor(Math.max(0,s)/60);byId('tpTimerSeconds').value=Math.max(0,s)%60;return;}
 if(act==='timerSet'||act==='timerSetStart')return timerFromDialog(act==='timerSetStart');
}
attach();
})();