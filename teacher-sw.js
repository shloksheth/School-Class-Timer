/* School Class Timer offline shell. Does not intercept or cache school rosters, Google Apps Script, weather or time API traffic. */
const CACHE = 'oss-class-timer-teacher-20261028-v1';
const BASE = self.registration.scope;
const FILES = ['index.html','teacher-mode.js','teacher-mode.css','teacher-calendar.js','teacher-manifest.webmanifest','teacher-app-icon.svg','assets/bell_ring.mp3','assets/lava_bg.jpg'].map(x=>new URL(x,BASE).href);
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(CACHE).then(c=>Promise.all(FILES.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('oss-class-timer-teacher-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==self.location.origin)return;
 const isPage=req.mode==='navigate'||url.pathname.endsWith('/index.html');
 if(isPage){e.respondWith(caches.open(CACHE).then(async c=>{
  const cached=await c.match(new URL('index.html',BASE));
  const net=fetch(req,{cache:'no-cache'}).then(async res=>{if(res.ok)await c.put(new URL('index.html',BASE),res.clone());return res;}).catch(()=>null);
  if(cached){e.waitUntil(net);return cached;}return await net||Response.error();
 }));return;}
 if(FILES.includes(url.href)||/\/teacher-sounds\/[^/]+\.(mp3|wav|ogg|m4a|aac)$/i.test(url.pathname)){
  e.respondWith(caches.open(CACHE).then(async c=>{
   const hit=await c.match(req);
   if(hit)return hit;
   const result=await fetch(req);if(result.ok)await c.put(req,result.clone());return result;
  }));
 }
});