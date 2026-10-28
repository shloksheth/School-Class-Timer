const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
(async()=>{
 const server=spawn('python3',['-m','http.server','8765','--bind','127.0.0.1'],{stdio:'ignore'});
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-sandbox']});
  const context=await browser.newContext({timezoneId:'America/New_York',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let ready=false;
  for(let n=0;n<20;n++){
   try{const r=await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded',timeout:5000});if(r?.ok()){ready=true;break;}}
   catch(_){}await new Promise(r=>setTimeout(r,300));
  }
  assert(ready,'test server did not start');
  await page.locator('#tpRoleCover:not([hidden])').waitFor({timeout:10000});
  await page.locator('[data-tp-action="chooseTeacher"]').click();
  await page.locator('#tpSettings:not([hidden])').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-app-role'),'teacher');
  await page.locator('[data-tp-pane="passes"]').click();
  await page.locator('#tpDemo').check();
  await page.locator('[data-tp-pane="connect"]').click();
  await page.locator('#tpGradeBand').selectOption('912');
  await page.locator('[data-tp-action="saveTeacherSettings"]').click();
  await page.locator('#tpSettingsNotice').waitFor({state:'visible'});
  await page.locator('[data-tp-action="closeTeacherSettings"]').click();
  await page.locator('#teacherDashboard').waitFor({state:'visible'});
  await page.locator('[data-tp-action="timerPreset"][data-min="2"]').click();
  assert.equal((await page.locator('#tpTimerNumber').textContent()).trim(),'2:00');
  await page.locator('[data-tp-action="timerEdit"]').click();
  await page.locator('#tpTimerDialog:not([hidden])').waitFor();
  for(const d of ['1','5','0','0'])await page.locator('[data-tp-action="timerKey"][data-key="'+d+'"]').click();
  await page.locator('[data-tp-action="timerSet"]').click();
  assert.equal((await page.locator('#tpTimerNumber').textContent()).trim(),'15:00');
  await page.locator('[data-tp-action="changeMode"]').click();
  await page.locator('[data-tp-action="chooseStudent"]').click();
  assert.equal(await page.locator('html').getAttribute('data-app-role'),'student');
  await page.locator('#today').waitFor({state:'visible'});
  await page.locator('#settingsNav').click();
  await page.locator('#tpSwitchSettings').click();
  await page.locator('[data-tp-action="chooseTeacher"]').click();
  await page.locator('#teacherDashboard').waitFor({state:'visible'});
  await page.locator('#settingsNav').click();
  await page.locator('#tpSettings:not([hidden])').waitFor();
  assert.equal(await page.locator('#tpGradeBand').inputValue(),'912');
  assert.equal(await page.locator('#tpDemo').isChecked(),true);
  assert.deepEqual(errors,[],'Browser errors: '+errors.join('; '));
  console.log('Teacher browser smoke test passed');
 }finally{if(browser)await browser.close();server.kill('SIGTERM');}
})().catch(err=>{console.error(err);process.exitCode=1;});
