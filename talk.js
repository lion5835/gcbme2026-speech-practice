/* 整場播放: play the whole talk's detailed script (Kokoro clips) slide 1→34, synced slide + text */
(() => {
'use strict';
const APP = window.__app; if (!APP) return;
const { SL, settings, saveSettings, esc, fmt } = APP;
const VER = '17';
const $ = id => document.getElementById(id);
const GAP_SENT = 0.3, GAP_SLIDE = 0.8;
const VOICES = { heart: '自然女聲', michael: '自然男聲' };
let LV = null, DUR = {}, list = [], pos = 0, playing = false, paused = false, timer = null, wake = null, startT = 0;
const voice = () => (settings.talkVoice || (settings.nvoice === 'michael' ? 'michael' : 'heart'));
const rate = () => settings.talkRate || 1;
const scale = () => (window.__talkGapScale != null ? window.__talkGapScale : 1);
const audio = new Audio(); audio.preload = 'auto'; audio.setAttribute('playsinline', '');
const urlFor = (it, v = voice()) => `audio/${v}/d/s${String(it.slide).padStart(2, '0')}_${it.i}.mp3?v=${VER}`;

const html = `
<div id="talkPlayer" class="talk hidden" role="dialog" aria-label="整場播放">
 <div class="talkbar"><b>▶︎ 整場播放（詳細稿）</b><button id="tkClose" class="icon" aria-label="關閉">✕</button></div>
 <div class="talkbody">
  <div class="slidebox"><img id="tkImg" alt="slide"></div>
  <div class="row"><span id="tkPos" class="pill">1 / 34</span><span id="tkTitle" class="small tktitle"></span></div>
  <div class="progress"><div id="tkBar"></div></div>
  <div class="row small"><span id="tkTime" class="timer small">0:00 / 0:00</span><span class="muted" id="tkState"></span></div>
  <div class="ctl tkctl">
   <button id="tkPrev" class="btn" aria-label="上一張">⏮</button>
   <button id="tkPlay" class="btn primary" aria-label="播放/暫停">▶︎ 播放</button>
   <button id="tkNext" class="btn" aria-label="下一張">⏭</button>
   <button id="tkStop" class="btn ghost" aria-label="停止">⏹</button>
  </div>
  <div class="row"><select id="tkJump" aria-label="跳到投影片"></select></div>
  <div class="seg small" id="tkRate">${[0.8, 1, 1.2].map(r => `<button data-r="${r}">${r.toFixed(1)}×</button>`).join('')}</div>
  <div class="seg small" id="tkVoice">${Object.entries(VOICES).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join('')}</div>
  <div id="tkScript" class="script"></div>
  <div class="small muted tkdl">離線用：<button id="tkCache" class="btn ghost small" type="button">⬇︎ 存到這台裝置（離線可播）</button>
   <span id="tkCacheState"></span><br>整場 MP3：<a id="tkMp3h" href="audio/full/gcbme_full_talk_heart.mp3?v=${VER}" download>自然女聲</a> · <a id="tkMp3m" href="audio/full/gcbme_full_talk_michael.mp3?v=${VER}" download>自然男聲</a></div>
 </div>
</div>`;
document.body.insertAdjacentHTML('beforeend', html);
const top = document.querySelector('header.top');
const btn = document.createElement('button'); btn.id = 'btnTalk'; btn.className = 'talkbtn'; btn.textContent = '▶︎ 整場播放';
top.insertBefore(btn, $('btnSettings'));
$('tkJump').innerHTML = SL.map((s, i) => `<option value="${i}">${s.slide}. ${esc(s.title)}</option>`).join('');

function build() {
  list = []; let t = 0;
  SL.forEach((s, si) => {
    const sents = (LV && LV[s.slide] && LV[s.slide].detailed) || s.sentences;
    const d = (DUR[s.slide] && DUR[s.slide].d) || [];
    sents.forEach((txt, i) => { const dur = d[i] || txt.split(' ').length / 2.3; list.push({ si, slide: s.slide, i, txt, dur, t0: t }); t += dur + (i === sents.length - 1 ? GAP_SLIDE : GAP_SENT); });
  });
}
const totalRaw = () => list.length ? list[list.length - 1].t0 + list[list.length - 1].dur : 0;
const firstOf = si => list.findIndex(x => x.si === si);
let loadP = null;
function load() {
  if (loadP) return loadP;
  loadP = Promise.all([fetch('levels.json').then(r => r.json()).then(j => LV = j).catch(() => { }),
    fetch(`audio/${voice()}/durations.json?v=${VER}`).then(r => r.json()).then(j => DUR = j).catch(() => { })]).then(build);
  return loadP;
}
function reloadDur() { return fetch(`audio/${voice()}/durations.json?v=${VER}`).then(r => r.json()).then(j => { DUR = j; build(); render(); }).catch(() => { }); }

let shownSi = -1;
function render() {
  const it = list[pos]; if (!it) return; const s = SL[it.si];
  if (shownSi !== it.si) {
    shownSi = it.si; $('tkImg').src = s.image; $('tkImg').alt = 'Slide ' + s.slide;
    $('tkTitle').textContent = s.title; $('tkJump').value = it.si;
    const sents = list.filter(x => x.si === it.si);
    $('tkScript').innerHTML = sents.map(x => `<span class="sent" data-p="${list.indexOf(x)}"><span class="n">${x.i + 1}</span>${esc(x.txt)}</span>`).join('');
  }
  $('tkPos').textContent = `${s.slide} / ${SL.length}`;
  $('tkScript').querySelectorAll('.sent').forEach(e => e.classList.toggle('playing', +e.dataset.p === pos));
  const cur = $('tkScript').querySelector('.sent.playing'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  tick();
  $('tkRate').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.r === rate()));
  $('tkVoice').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === voice()));
  $('tkPlay').textContent = playing && !paused ? '⏸ 暫停' : '▶︎ 播放';
  $('tkState').textContent = playing ? (paused ? '已暫停' : '播放中') : '';
  if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title: `${s.slide}. ${s.title}`, artist: 'GCBME 2026 · 整場播放', album: 'Wen-Te Liu' }); } catch (e) { }
}
function tick() {
  const it = list[pos]; if (!it) return; const tot = totalRaw();
  const el = Math.min(tot, it.t0 + (playing && !audio.paused && isFinite(audio.currentTime) ? audio.currentTime : 0));
  $('tkTime').textContent = `${fmt(el / rate())} / ${fmt(tot / rate())}`;
  $('tkBar').style.width = (tot ? el / tot * 100 : 0) + '%';
}
setInterval(() => { if (playing && !paused) tick(); }, 500);

function playCur() {
  clearTimeout(timer); const it = list[pos]; if (!it) return finish();
  render();
  audio.src = urlFor(it); audio.playbackRate = rate(); audio.defaultPlaybackRate = rate();
  try { audio.preservesPitch = true; audio.webkitPreservesPitch = true; } catch (e) { }
  const p = audio.play(); if (p && p.catch) p.catch(err => { if (err && err.name === 'NotAllowedError') { paused = true; render(); } });
}
audio.onended = () => {
  if (!playing || paused) return;
  const it = list[pos]; const next = list[pos + 1];
  if (!next) return finish();
  const gap = (next.si !== it.si ? GAP_SLIDE : GAP_SENT) / rate() * scale() * 1000;
  timer = setTimeout(() => { if (!playing || paused) return; pos++; playCur(); }, gap);
};
audio.onerror = () => { if (!playing || paused) return; timer = setTimeout(() => { if (!playing || paused) return; pos++; pos < list.length ? playCur() : finish(); }, 300); };
async function lockWake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { } }
function unlockWake() { try { wake && wake.release(); } catch (e) { } wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing && !paused) lockWake(); });
function start(from) { APP.stopEverything(); pos = from; playing = true; paused = false; lockWake(); playCur(); }
function pause() { if (!playing) return; paused = true; clearTimeout(timer); audio.pause(); render(); }
function resume() { if (!playing) return start(pos); paused = false; lockWake(); const p = audio.play(); if (p && p.catch) p.catch(() => playCur()); if (audio.ended || !audio.src) playCur(); render(); }
function stop() { playing = false; paused = false; clearTimeout(timer); audio.pause(); unlockWake(); render(); }
function finish() { stop(); $('tkState').textContent = '整場播放完畢 👏'; }
function gotoSlide(si) { si = Math.max(0, Math.min(SL.length - 1, si)); const p = firstOf(si); if (p < 0) return; clearTimeout(timer); audio.pause(); pos = p; if (playing && !paused) playCur(); else render(); }
function open() {
  APP.stopEverything(); $('talkPlayer').classList.remove('hidden'); document.body.classList.add('talkopen');
  load().then(() => { pos = Math.max(0, firstOf(APP.cur || 0)); shownSi = -1; render(); });
}
function close() { stop(); $('talkPlayer').classList.add('hidden'); document.body.classList.remove('talkopen'); const it = list[pos]; if (it && APP.showSlide) APP.showSlide(it.si); }

btn.onclick = open;
$('tkClose').onclick = close;
$('tkPlay').onclick = () => { if (!list.length) return; if (!playing) start(pos); else if (paused) resume(); else pause(); };
$('tkStop').onclick = () => { stop(); pos = Math.max(0, firstOf(list[pos] ? list[pos].si : 0)); render(); };
$('tkPrev').onclick = () => { const it = list[pos]; gotoSlide(it ? it.si - 1 : 0); };
$('tkNext').onclick = () => { const it = list[pos]; gotoSlide(it ? it.si + 1 : 0); };
$('tkJump').onchange = e => gotoSlide(+e.target.value);
$('tkScript').onclick = e => { const s = e.target.closest('.sent'); if (!s) return; clearTimeout(timer); audio.pause(); pos = +s.dataset.p; if (playing) { paused = false; playCur(); } else render(); };
$('tkRate').onclick = e => { const b = e.target.closest('button'); if (!b) return; settings.talkRate = +b.dataset.r; saveSettings(); audio.playbackRate = rate(); render(); };
$('tkVoice').onclick = e => { const b = e.target.closest('button'); if (!b) return; settings.talkVoice = b.dataset.v; saveSettings(); reloadDur().then(() => { if (playing && !paused) playCur(); }); };
if ('mediaSession' in navigator) try {
  navigator.mediaSession.setActionHandler('play', () => resume()); navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('nexttrack', () => $('tkNext').onclick()); navigator.mediaSession.setActionHandler('previoustrack', () => $('tkPrev').onclick());
} catch (e) { }
/* offline: put every detailed clip of the chosen voice in the audio cache (sw.js serves it, with Range support) */
$('tkCache').onclick = async () => {
  if (!('caches' in window)) { $('tkCacheState').textContent = '這個瀏覽器不支援離線快取'; return; }
  await load(); const v = voice(); try { for (const k of await caches.keys()) if (k.startsWith('gcbme-audio') && k !== 'gcbme-audio-v' + VER) await caches.delete(k); } catch (e) { } const c = await caches.open('gcbme-audio-v' + VER); let n = 0, bad = 0;
  const urls = list.map(it => urlFor(it, v)).concat([`audio/${v}/durations.json?v=${VER}`]);
  for (const u of urls) { try { if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) await c.put(u, r); else bad++; } } catch (e) { bad++; } n++; if (n % 10 === 0) $('tkCacheState').textContent = `${n}/${urls.length}`; }
  $('tkCacheState').textContent = bad ? `完成，但有 ${bad} 個沒存到，請在網路好時再按一次` : `✓ 已存 ${VOICES[v]} 整場（${urls.length} 段），離線也能播`;
};
window.__talk = { open, close, start, pause, resume, stop, gotoSlide, get pos() { return pos; }, get item() { return list[pos]; }, get playing() { return playing; }, get paused() { return paused; }, get list() { return list; }, audio, total: () => totalRaw() / rate() };
})();
