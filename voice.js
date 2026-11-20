/* Natural demo voice: pre-generated Kokoro-82M clips (Apache-2.0), with browser TTS as fallback for dynamic text */
(() => {
'use strict';
const APP = window.__app; const { settings, saveSettings } = APP;
if (!settings.nvoice) settings.nvoice = 'heart';
if (!settings.nrate) settings.nrate = 1;
const VOICES = { heart: '自然女聲', michael: '自然男聲', browser: '瀏覽器' };
const PH = { 'You could add:': 'add', 'A better way to say it:': 'better', 'Excellent! You got the key points.': 'excellent',
  'Great job. You got the main idea.': 'greatjob', 'Good start.': 'goodstart', "Let's try again.": 'tryagain',
  "I didn't hear anything. Please try again.": 'nohear', 'Great.': 'great', 'Good.': 'good', 'Listen again.': 'listen',
  "I didn't hear you.": 'nohear2', 'Almost.': 'almost', 'Your turn.': 'yourturn', 'A little slower.': 'slower', 'A little faster.': 'faster', 'Nice pace.': 'nicepace', "I didn't hear an answer. Here is a model answer.": 'noanswer' };
const norm = t => String(t).replace(/\s+/g, ' ').trim();
const map = new Map(); let dur = {}; let ready = false;
const audio = new Audio(); audio.preload = 'auto'; audio.setAttribute('playsinline', '');
let token = 0, lastErr = false;
function index(levels) {
  Object.entries(levels).forEach(([n, d]) => {
    const pad = String(n).padStart(2, '0');
    (d.detailed || []).forEach((t, i) => map.set(norm(t), `d/s${pad}_${i}`));
    (d.concise || []).forEach((t, i) => { const k = norm(t); if (!map.has(k)) map.set(k, `c/s${pad}_${i}`); });
    (d.points || []).forEach((p, i) => { const k = norm(p.en); if (!map.has(k)) map.set(k, `k/s${pad}_${i}`); });
  });
  (window.QA || []).forEach((q, i) => { map.set(norm(q.q), `q/q${i}_q`); map.set(norm(q.a), `q/q${i}_a`); });
  Object.entries(PH).forEach(([t, k]) => map.set(norm(t), 'p/' + k));
  ready = true;
}
fetch('levels.json').then(r => r.json()).then(index).catch(e => console.warn('voice index', e));
fetch('audio/heart/durations.json?v=29').then(r => r.json()).then(d => dur = d).catch(() => { });
const natural = () => settings.nvoice !== 'browser';
const urlFor = key => `audio/${settings.nvoice}/${key}.mp3?v=29`;
function playKey(key) {
  const my = token; lastErr = false;
  return new Promise(resolve => {
    let done = false; const fin = ok => { if (done) return; done = true; audio.onended = audio.onerror = null; clearTimeout(guard); resolve(ok && my === token); };
    audio.onended = () => fin(true); audio.onerror = () => { lastErr = true; fin(false); };
    audio.src = urlFor(key); audio.playbackRate = settings.nrate; audio.defaultPlaybackRate = settings.nrate;
    try { audio.preservesPitch = true; audio.webkitPreservesPitch = true; } catch (e) { }
    const guard = setTimeout(() => fin(true), 60000);
    const p = audio.play(); if (p && p.catch) p.catch(err => { console.warn('audio play', err); if (err && err.name !== 'AbortError') lastErr = true; fin(false); });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* returns true if handled with natural audio (and finished), null if not available → caller falls back */
async function say(text) {
  if (!natural() || !ready) return null;
  const t = norm(text); let key = map.get(t);
  if (key) { const ok = await playKey(key); return ok ? true : (lastErr ? null : false); }
  for (const [ph, k] of Object.entries(PH)) {
    if (t.startsWith(ph + ' ')) { const rest = map.get(norm(t.slice(ph.length))); if (rest) { const my = token; if (!(await playKey('p/' + k)) || my !== token) return false; await sleep(120); const ok2 = await playKey(rest); return ok2 ? true : (lastErr ? null : false); } }
  }
  return null;
}
function stop() { token++; try { audio.pause(); } catch (e) { } }
function has(text) { return natural() && ready && map.has(norm(text)); }
function clipSec(text) { const k = map.get(norm(text)); if (!k) return null; const [lv, f] = k.split('/'); const m = f && f.match(/^s(\d+)_(\d+)$/); if (!m) return null; const a = dur[+m[1]] && dur[+m[1]][lv]; return a ? a[+m[2]] : null; }
function renderControls(el) {
  if (!el) return;
  el.innerHTML = `<div class="seg nvseg">${Object.entries(VOICES).map(([k, v]) => `<button data-nv="${k}" class="${settings.nvoice === k ? 'on' : ''}">${v}</button>`).join('')}</div>` +
    `<div class="seg nvrate">${[0.8, 1, 1.15].map(r => `<button data-rate="${r}" class="${settings.nrate === r ? "on" : ""}">${r === 1.15 ? "1.15" : r.toFixed(1)}×</button>`).join('')}</div>`;
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.nv) settings.nvoice = b.dataset.nv; if (b.dataset.rate) settings.nrate = +b.dataset.rate;
    saveSettings(); document.querySelectorAll('.nvctl').forEach(renderControls); audio.playbackRate = settings.nrate; };
}
document.querySelectorAll('.nvctl').forEach(renderControls);
window.NV = { say, stop, has, clipSec, natural, renderControls, VOICES, get ready() { return ready; }, audio };
})();
