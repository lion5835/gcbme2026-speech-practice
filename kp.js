/* 抓重點 (key-point) mode: meaning-based practice */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const APP = window.__app; const { SL, speak, stopTTS, Listener, LS, fmt, esc, settings } = APP;
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';
let data = null;
const mastered = LS.get('kpMastered', {});
let hint = LS.get('kpHint', 'zh');
let revealed = false, listener = null, tInt = null, t0 = 0, runId = 0;

/* ---------- embeddings (lazy) ---------- */
const EMB = { state: 'idle', ext: null, cache: new Map(), err: '' };
function modelStatus() {
  const el = $('kpModel'); if (!el) return;
  if (!settings.useEmbed) { el.textContent = '語意模型：關閉（只用關鍵概念）'; return; }
  el.textContent = { idle: '語意模型：待載入', loading: '語意模型下載中…（約 23 MB，只需一次）', ready: '🧠 語意判斷已啟用', failed: '⚠︎ 語意模型無法載入，改用關鍵概念比對' }[EMB.state];
}
function ensureModel() {
  if (!settings.useEmbed || EMB.state === 'loading' || EMB.state === 'ready') return EMB.p || Promise.resolve();
  EMB.state = 'loading'; modelStatus();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000));
  EMB.p = Promise.race([(async () => {
    const tf = await import(TF_URL);
    tf.env.allowLocalModels = false; tf.env.useBrowserCache = true;
    EMB.ext = await tf.pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'wasm' });
    EMB.state = 'ready';
  })(), timeout]).catch(e => { EMB.state = 'failed'; EMB.err = String(e && e.message || e); console.warn('embedding model failed:', EMB.err); })
    .finally(modelStatus);
  return EMB.p;
}
async function embed(texts) {
  const out = await EMB.ext(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
async function sims(kp, transcript) {
  if (!settings.useEmbed) return null;
  if (EMB.state === 'loading') await Promise.race([EMB.p, new Promise(r => setTimeout(r, 8000))]);
  if (EMB.state !== 'ready' || !transcript.trim()) return null;
  try {
    const need = kp.points.map(p => p.en).filter(t => !EMB.cache.has(t));
    if (need.length) (await embed(need)).forEach((v, i) => EMB.cache.set(need[i], v));
    const wins = kp.points.map(p => KPScore.windows(transcript, p.en));
    const uniq = [...new Set(wins.flat())]; if (!uniq.length) return null;
    const ev = await embed(uniq); const map = new Map(uniq.map((w, i) => [w, ev[i]]));
    return kp.points.map((p, i) => Math.max(...wins[i].map(w => dot(map.get(w), EMB.cache.get(p.en)))));
  } catch (e) { console.warn(e); return null; }
}
async function scoreText(slideNum, transcript) {
  const kp = data[slideNum]; const s = await sims(kp, transcript);
  return KPScore.score(kp, transcript, s);
}

/* ---------- UI ---------- */
const curSlide = () => SL[APP.cur];
function updateMastered() {
  const n = SL.filter(s => mastered[s.slide]).length;
  $('kpMastered').textContent = `已掌握 ${n}/${SL.length} 張` + (mastered[curSlide().slide] ? ' · 本張 ✓' : '');
  const sel = $('jump'); [...sel.options].forEach((o, i) => { const s = SL[i]; o.textContent = (mastered[s.slide] ? '✓ ' : '') + s.slide + '. ' + s.title; });
}
function markMastered(n) { mastered[n] = Date.now(); LS.set('kpMastered', mastered); updateMastered(); }
function renderHints(el, slideNum, level, noCover) {
  if (!data) { el.innerHTML = '<span class="muted">載入中…</span>'; return; }
  const kp = data[slideNum];
  if (level === 'none') { el.innerHTML = '<span class="muted">不提示：看著投影片，用自己的話講出這張的重點。</span>'; return; }
  if (level === 'zh' && !revealed && !noCover) {
    el.innerHTML = `<span class="cover">👆 先自己想想看，點一下顯示中文重點（${kp.points.length} 個）</span>`;
    el.querySelector('.cover').onclick = () => { revealed = true; renderHints(el, slideNum, level); };
    return;
  }
  el.innerHTML = kp.points.map((p, i) => `<span class="chip">${i + 1}. ${esc(level === 'zh' ? p.zh : level === 'kw' ? p.kw : p.en)}${p.must ? '<span class="must">必講</span>' : ''}</span>`).join('');
}
function renderPanel() {
  if (!data) return;
  [...$('kpHintSeg').children].forEach(b => b.classList.toggle('on', b.dataset.h === hint));
  renderHints($('kpHints'), curSlide().slide, hint);
  $('kpResult').classList.add('hidden'); $('kpLive').classList.add('hidden'); $('kpGistBox').classList.add('hidden');
  $('kpTimer').textContent = '0:00'; updateMastered(); modelStatus();
}
$('kpHintSeg').onclick = e => { const h = e.target.dataset.h; if (!h) return; hint = h; LS.set('kpHint', h); revealed = h !== 'zh' ? revealed : revealed; renderPanel(); };

function resultHTML(kp, r) {
  let h = `<div class="score"><span class="badge ${r.pass ? 'ok' : 'no'}">${r.pass ? '✓ 抓到重點了' : '再試一次'}</span><span>講到 ${r.covered}/${r.total} 個重點（過關：${r.needN} 個${r.points.some(p => p.must) ? '，含「必講」' : ''}）</span></div>`;
  h += r.points.map((p, i) => {
    const P = kp.points[i];
    const via = p.covered ? (p.via === 'meaning' ? `語意相似 ${Math.round(p.sim * 100)}%` : p.via === 'both' ? `關鍵概念＋語意 ${Math.round(p.sim * 100)}%` : `關鍵概念：${p.hits.filter(Boolean).map(esc).join('、')}`) : (p.sim != null ? `語意相似 ${Math.round(p.sim * 100)}%` : '');
    return `<div class="kpr"><span class="mk ${p.covered ? 'good' : 'bad'}">${p.covered ? '✓' : '✗'}</span><div><div class="zh">${esc(P.zh)}${P.must ? ' <span class="bad small">必講</span>' : ''}</div>${p.covered ? '' : `<div class="en">💬 可以這樣說：${esc(P.en)} <button class="btn small ghost" data-say="${i}">🔊</button></div>`}<div class="via">${via}</div></div></div>`;
  }).join('');
  if (r.pass && r.covered < r.total) h += '<p class="small muted">已經過關！沒講到的重點是加分題，熟了再補。</p>';
  return h;
}
async function feedback(kp, r) {
  if (!settings.voiceFb) return;
  stopTTS(); const my = ++runId;
  const got = r.points.map((p, i) => p.covered ? kp.points[i].kw : null).filter(Boolean);
  let intro = r.pass ? (r.covered === r.total ? 'Excellent! You got all the key points.' : 'Great job. You got the main idea.') : (r.covered ? 'Good start.' : "Let's try again. Here are the key points.");
  if (got.length && r.covered < r.total) intro += ' You covered: ' + got.join('; ') + '.';
  await speak(intro); if (my !== runId) return;
  for (let i = 0; i < r.points.length; i++) {
    if (r.points[i].covered) continue;
    await speak('You could add: ' + kp.points[i].en); if (my !== runId) return;
  }
}
function stop() {
  runId++; clearInterval(tInt);
  if (listener && listener.active) { listener.active = false; clearInterval(listener.timer); try { listener.rec.abort(); } catch (e) { } }
  const b = $('kpSpeak'); if (b) { b.classList.remove('recording'); b.textContent = '🎤 講重點'; }
  $('kpRec') && $('kpRec').classList.add('hidden');
}
$('kpStop').onclick = () => { stop(); stopTTS(); };
$('kpSpeak').onclick = async () => {
  if (listener && listener.active) { listener.stop(); return; }
  if (!APP.SR) return alert('此瀏覽器不支援語音辨識，請用電腦版 Chrome 或 iPhone Safari。');
  stopTTS(); ensureModel();
  const s = curSlide(), kp = data[s.slide], btn = $('kpSpeak');
  $('kpResult').classList.add('hidden'); $('kpGistBox').classList.add('hidden');
  const live = $('kpLive'); live.classList.remove('hidden'); live.innerHTML = '<i>請開始說，用自己的話就好…</i>';
  listener = new Listener({
    onText: (f, i) => { live.innerHTML = esc(f) + ' <i>' + esc(i || '') + '</i>'; },
    onState: (on, err) => { btn.classList.toggle('recording', on); btn.textContent = on ? '⏹ 講完了' : '🎤 講重點'; $('kpRec').classList.toggle('hidden', !on); if (err) alert(err); }
  });
  APP.listener = listener;
  t0 = Date.now(); clearInterval(tInt); tInt = setInterval(() => { $('kpTimer').textContent = fmt((Date.now() - t0) / 1000); }, 250);
  const text = await listener.start(); clearInterval(tInt);
  if (!text) { $('kpResult').innerHTML = '<p>沒有聽到聲音，請確認麥克風後再試一次。</p>'; $('kpResult').classList.remove('hidden'); speak("I didn't hear anything. Please try again."); return; }
  $('kpResult').innerHTML = '<p class="muted">判斷中…</p>'; $('kpResult').classList.remove('hidden');
  const r = await scoreText(s.slide, text);
  $('kpResult').innerHTML = resultHTML(kp, r);
  $('kpResult').querySelectorAll('[data-say]').forEach(b => b.onclick = () => { stopTTS(); speak(kp.points[+b.dataset.say].en); });
  if (r.pass) markMastered(s.slide);
  const hist = LS.get('kpLast', {}); hist[s.slide] = { t: Date.now(), c: r.covered, n: r.total, pass: r.pass }; LS.set('kpLast', hist);
  feedback(kp, r);
};
$('kpGist').onclick = async () => {
  stop(); stopTTS(); const my = ++runId;
  const g = data[curSlide().slide].gist; const box = $('kpGistBox');
  const sents = g.split(/(?<=[.!?])\s+/).filter(Boolean);
  box.innerHTML = '<b>簡短說法：</b>' + sents.map((x, i) => `<span class="sent" data-g="${i}">${esc(x.trim())}</span>`).join(' ');
  box.classList.remove('hidden');
  for (let i = 0; i < sents.length; i++) {
    if (my !== runId) break;
    box.querySelectorAll('.sent').forEach(e => e.classList.toggle('playing', +e.dataset.g === i));
    await speak(sents[i].trim());
  }
  box.querySelectorAll('.sent').forEach(e => e.classList.remove('playing'));
};

(window.__slideHooks = window.__slideHooks || []).push(() => { revealed = false; stop(); renderPanel(); });
(window.__viewHooks = window.__viewHooks || []).push(v => { if (v === 'kp') { renderPanel(); ensureModel(); } });

window.KPUI = { stop, renderHints, scoreText, markMastered, ensureModel, modelStatus, get data() { return data; }, get emb() { return EMB.state; } };
fetch('keypoints.json').then(r => r.json()).then(d => { data = d; renderPanel(); if (APP.view === 'kp') ensureModel(); })
  .catch(e => { $('kpHints').innerHTML = '<span class="bad">重點資料載入失敗，請重新整理。</span>'; console.error(e); });
})();
