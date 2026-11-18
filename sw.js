const V='gcbme-v19';const FILES=["./", "index.html", "style.css", "app.js", "align.js", "data.js", "kp.js", "voice.js", "kpscore.js", "talk.js", "levels.json", "manifest.webmanifest", "icon-192.png", "slides/s01.webp?v=19", "slides/s02.webp?v=19", "slides/s03.webp?v=19", "slides/s04.webp?v=19", "slides/s05.webp?v=19", "slides/s06.webp?v=19", "slides/s07.webp?v=19", "slides/s08.webp?v=19", "slides/s09.webp?v=19", "slides/s10.webp?v=19", "slides/s11.webp?v=19", "slides/s12.webp?v=19", "slides/s13.webp?v=19", "slides/s14.webp?v=19", "slides/s15.webp?v=19", "slides/s16.webp?v=19", "slides/s17.webp?v=19", "slides/s18.webp?v=19", "slides/s19.webp?v=19", "slides/s20.webp?v=19", "slides/s21.webp?v=19", "slides/s22.webp?v=19", "slides/s23.webp?v=19", "slides/s24.webp?v=19", "slides/s25.webp?v=19", "slides/s26.webp?v=19", "slides/s27.webp?v=19", "slides/s28.webp?v=19", "slides/s29.webp?v=19", "slides/s30.webp?v=19"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&!k.startsWith('gcbme-audio')).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// network-first for code (so updates show up), cache-first for images
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 if(u.pathname.includes('/audio/')){e.respondWith(audioResp(e.request));return;} // audio: saved-for-offline clips first (with Range/206 for iOS Safari), else straight to network
 if(u.pathname.includes('/slides/')){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));return;}
 e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(ca=>ca.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));});

async function audioResp(req){let hit=null;try{const ks=await caches.keys();for(const k of ks){if(!k.startsWith('gcbme-audio'))continue;hit=await (await caches.open(k)).match(req.url);if(hit)break;}}catch(e){}
 if(!hit)return fetch(req);
 const range=req.headers.get('range');if(!range)return hit;
 const buf=await hit.arrayBuffer(),n=buf.byteLength,m=/bytes=(\d*)-(\d*)/.exec(range);let a=0,b=n-1;
 if(m){if(m[1]!=='')a=+m[1];if(m[2]!=='')b=Math.min(+m[2],n-1);if(m[1]===''&&m[2]!==''){a=Math.max(0,n-+m[2]);b=n-1;}}
 if(a>=n)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+n}});
 return new Response(buf.slice(a,b+1),{status:206,headers:{'Content-Type':hit.headers.get('Content-Type')||'audio/mpeg','Content-Range':`bytes ${a}-${b}/${n}`,'Content-Length':String(b-a+1),'Accept-Ranges':'bytes'}});}
