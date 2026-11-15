/* 分級練習: 詳細 / 精簡 / 重點式 — meaning-based practice */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const APP = window.__app; const { SL, speak, stopTTS, Listener, LS, fmt, esc, settings } = APP;
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const LV_NAME = { detailed: '詳細', concise: '精簡', kp: '重點式' };
let data = null;
let globalLevel = LS.get('level', 'kp');
const override = LS.get('levelOverride', {});
const hints = Object.assign({ detailed: 'cue', concise: 'cue', kp: 'zh' }, LS.get('lvHints', {}));
let revealed = false, listener = null, tInt = null, t0 = 0, runId = 0;
const masteredKey = lv => 'mastered_' + lv;
const mastered = { detailed: LS.get(masteredKey('detailed'), {}), concise: LS.get(masteredKey('concise'), {}), kp: LS.get(masteredKey('kp'), LS.get('kpMastered', {})) };

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
const embed = async texts => (await EMB.ext(texts, { pooling: 'mean', normalize: true })).tolist();
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
async function maxSims(models, transcript, minL) {
  const need = models.filter(t => !EMB.cache.has(t));
  if (need.length) (await embed(need)).forEach((v, i) => EMB.cache.set(need[i], v));
  const wins = models.map(m => KPScore.windows(transcript, m, minL));
  const uniq = [...new Set(wins.flat())]; if (!uniq.length) return models.map(() => 0);
  const ev = await embed(uniq); const map = new Map(uniq.map((w, i) => [w, ev[i]]));
  return models.map((m, i) => wins[i].length ? Math.max(...wins[i].map(w => dot(map.get(w), EMB.cache.get(m)))) : 0);
}
async function sentSim(model, transcript) {
  if (!settings.useEmbed || EMB.state !== 'ready' || !transcript.trim()) return null;
  return (await maxSims([model], transcript, 3))[0];
}
function slideObj(n) { const s = SL.find(x => x.slide === +n); const d = data[n]; return { points: d.points, detailed: s.sentences, concise: d.concise, keywords: s.keywords }; }
function levelText(n, lv) { const o = slideObj(n); return lv === 'detailed' ? o.detailed : lv === 'concise' ? o.concise : o.points.map(p => p.en); }
async function scoreText(n, transcript, lv) {
  lv = lv || levelOf(n); const o = slideObj(n); let sims = null;
  if (settings.useEmbed) {
    if (EMB.state === 'loading') await Promise.race([EMB.p, new Promise(r => setTimeout(r, 8000))]);
    if (EMB.state === 'ready' && transcript.trim()) {
      try { sims = { pts: await maxSims(o.points.map(p => p.en), transcript), sents: lv === 'kp' ? null : await maxSims(levelText(n, lv), transcript, 5) }; }
      catch (e) { console.warn(e); sims = null; }
    }
  }
  return KPScore.scoreLevel(o, lv, transcript, sims);
}

/* ---------- level state ---------- */
const curSlide = () => SL[APP.cur];
function levelOf(n) { return override[n] || globalLevel; }
function setLevel(lv) {
  const n = curSlide().slide;
  if ($('lvThis').checked) { override[n] = lv; LS.set('levelOverride', override); }
  else { globalLevel = lv; LS.set('level', lv); }
  revealed = false; renderPanel();
}
$('lvSeg').onclick = e => { const b = e.target.closest('button'); if (b) setLevel(b.dataset.lv); };
$('lvThis').onchange = e => {
  const n = curSlide().slide;
  if (e.target.checked) override[n] = levelOf(n); else delete override[n];
  LS.set('levelOverride', override); renderPanel();
};

function updateMastered() {
  const lv = levelOf(curSlide().slide), m = mastered[lv];
  const n = SL.filter(s => m[s.slide]).length;
  $('kpMastered').textContent = `${LV_NAME[lv]}：已掌握 ${n}/${SL.length} 張` + (m[curSlide().slide] ? ' · 本張 ✓' : '');
  const sel = $('jump'); [...sel.options].forEach((o, i) => { const s = SL[i]; const k = ['detailed', 'concise', 'kp'].map(l => mastered[l][s.slide] ? '✓' : '·').join(''); o.textContent = `${s.slide}. ${s.title}  [${k}]`; });
}
function markMastered(n, lv) { mastered[lv][n] = Date.now(); LS.set(masteredKey(lv), mastered[lv]); updateMastered(); }

const HINTS = { kp: [['none', '不提示'], ['zh', '中文重點'], ['kw', '英文關鍵字'], ['en', '示範句']], other: [['none', '不提示'], ['cue', '開頭＋關鍵字'], ['full', '完整稿＋停頓重音']] };
const markHTML = t => esc(t).replace(/\s*\/\/\s*/g, ' <span class="pz2">‖</span> ').replace(/\s*\/\s*/g, ' <span class="pz">|</span> ').replace(/\*([^*]+)\*/g, '<b class="st">$1</b>');
function cue(sent) {
  const w = sent.split(/\s+/); const lead = w.slice(0, 3).join(' '); const rest = w.slice(3).join(' ');
  const terms = new Set();
  (rest.match(/[−–-]?\d[\d.,]*\s?(%|percent|patients|nights|seconds|events|cm|centimeters|gigahertz)?/g) || []).forEach(t => terms.add(t.trim().replace(/[.,]$/, '')));
  (rest.match(/\b[A-Z][A-Za-z0-9₂–-]*[A-Z0-9₂]\b/g) || []).forEach(t => terms.add(t));
  const t = [...terms].filter(x => x.length > 1).slice(0, 4);
  return `${esc(lead)} <span class="dots">…</span> ${t.map(x => `<span class="kw">${esc(x)}</span>`).join(' · ')}`;
}
function renderHints(el, n, hint, noCover, lv) {
  if (!data) { el.innerHTML = '<span class="muted">載入中…</span>'; return; }
  lv = lv || levelOf(n); const d = data[n];
  if (hint === 'none') { el.innerHTML = `<span class="muted">不提示：看著投影片，用自己的話講${lv === 'kp' ? '出這張的重點' : '這張的內容'}。</span>`; return; }
  if (lv === 'kp') {
    if (hint === 'zh' && !revealed && !noCover) {
      el.innerHTML = `<span class="cover">👆 先自己想想看，點一下顯示中文重點（${d.points.length} 個）</span>`;
      el.querySelector('.cover').onclick = () => { revealed = true; renderHints(el, n, hint, false, lv); }; return;
    }
    const h = { zh: 'zh', kw: 'kw', en: 'en', cue: 'zh', full: 'en' }[hint] || 'zh';
    el.innerHTML = d.points.map((p, i) => `<span class="chip sent" data-i="${i}">${i + 1}. ${esc(p[h])}${p.must ? '<span class="must">必講</span>' : ''}</span>`).join('');
    return;
  }
  const sents = levelText(n, lv); const full = hint === 'full' || hint === 'en'; const marks = full && (lv === 'detailed' ? d.dMark : d.cMark);
  el.innerHTML = `<div class="small muted">重點：${d.points.map(p => esc(p.zh) + (p.must ? '（必講）' : '')).join('　')}</div>` +
    sents.map((s, i) => `<span class="sent ${full ? '' : 'cue'}" data-i="${i}"><span class="n">${i + 1}</span>${full ? (marks ? markHTML(marks[i]) : esc(s)) : cue(s)}</span>`).join('') +
    (marks ? '<div class="small muted legend"><span class="pz">|</span> 換氣短停　<span class="pz2">‖</span> 較長停頓　<b class="st">粗體</b> 加重語氣</div>' : '');
}
function renderPanel() {
  if (!data) return;
  const n = curSlide().slide, lv = levelOf(n);
  [...$('lvSeg').children].forEach(b => b.classList.toggle('on', b.dataset.lv === lv));
  $('lvThis').checked = !!override[n];
  const opts = HINTS[lv === 'kp' ? 'kp' : 'other'];
  if (!opts.some(o => o[0] === hints[lv])) hints[lv] = opts[1][0];
  $('kpHintSeg').innerHTML = opts.map(o => `<button data-h="${o[0]}" class="${o[0] === hints[lv] ? 'on' : ''}">${o[1]}</button>`).join('');
  renderHints($('kpHints'), n, hints[lv], false, lv);
  $('kpResult').classList.add('hidden'); $('kpLive').classList.add('hidden'); $('kpGistBox').classList.add('hidden');
  $('kpTimer').textContent = '0:00';
  const d = data[n];
  $('kpTarget').textContent = lv === 'detailed' ? `（參考約 ${Math.round(d.secD)} 秒，不強制）` : lv === 'concise' ? `（約 ${Math.round(d.secC)} 秒，不限時）` : '（不限時，講到重點就好）';
  $('kpSpeak').textContent = lv === 'kp' ? '🎤 講重點' : `🎤 開始講（${LV_NAME[lv]}）`;
  updateMastered(); modelStatus();
}
$('kpHintSeg').onclick = e => { const h = e.target.dataset.h; if (!h) return; const lv = levelOf(curSlide().slide); hints[lv] = h; LS.set('lvHints', hints); renderPanel(); };

/* ---------- results & feedback ---------- */
function resultHTML(n, r) {
  const d = data[n], lv = r.level;
  let h = `<div class="score"><span class="badge ${r.pass ? 'ok' : 'no'}">${r.pass ? '✓ 過關' : '再試一次'}</span><span>${LV_NAME[lv]} · 重點 ${r.covered}/${r.total}（需 ${r.needN}${r.points.some(p => p.must) ? '＋必講' : ''}）`;
  if (r.sentences) h += ` · 句意 ${Math.round(r.sentFrac * 100)}%（需 ${Math.round(r.sentNeed * 100)}%）`;
  h += '</span></div>';
  h += '<div class="small muted" style="margin-top:6px">重點</div>' + r.points.map((p, i) => {
    const P = d.points[i];
    const via = p.covered ? (p.via === 'meaning' ? `語意相似 ${Math.round(p.sim * 100)}%` : p.via === 'both' ? `關鍵概念＋語意 ${Math.round(p.sim * 100)}%` : `關鍵概念：${p.hits.filter(Boolean).map(esc).join('、')}`) : (p.sim != null ? `語意相似 ${Math.round(p.sim * 100)}%` : '');
    return `<div class="kpr"><span class="mk ${p.covered ? 'good' : 'bad'}">${p.covered ? '✓' : '✗'}</span><div><div class="zh">${esc(P.zh)}${P.must ? ' <span class="bad small">必講</span>' : ''}</div>${p.covered ? '' : `<div class="en">💬 可以這樣說：${esc(P.en)} <button class="btn small ghost" data-say="p${i}">🔊</button></div>`}<div class="via">${via}</div></div></div>`;
  }).join('');
  if (r.sentences) {
    h += `<div class="small muted" style="margin-top:8px">${LV_NAME[lv]}稿逐句（判斷意思，不要求逐字）</div>` + r.sentences.map((s, i) => `<div class="sres"><span class="mk ${s.covered ? 'good' : 'bad'}">${s.covered ? '✓' : '✗'}</span>${esc(s.text)}${s.covered ? `<span class="via small muted"> · ${s.via === 'meaning' ? '意思相近 ' + Math.round(s.sim * 100) + '%' : '用字涵蓋 ' + Math.round(s.cov * 100) + '%'}</span>` : ` <button class="btn small ghost" data-say="s${i}">🔊</button>`}</div>`).join('');
  }
  if (r.pace) h += `<div class="small pace">⏱ ${r.pace}</div>`;
  if (r.pass && (r.covered < r.total || (r.sentences && r.sentFrac < 1))) h += '<p class="small muted">已經過關！沒講到的部分是加分題，熟了再補。</p>';
  return h;
}
async function feedback(n, r) {
  if (!settings.voiceFb) return;
  stopTTS(); const my = ++runId; const d = data[n];
  const got = r.points.map((p, i) => p.covered ? d.points[i].kw : null).filter(Boolean);
  let intro = r.pass ? (r.covered === r.total ? 'Excellent! You got the key points.' : 'Great job. You got the main idea.') : (r.covered ? 'Good start.' : "Let's try again.");
  if (got.length && r.covered < r.total && !(window.NV && NV.natural())) intro += ' You covered: ' + got.join('; ') + '.';
  await speak(intro); if (my !== runId) return;
  const adds = [];
  r.points.forEach((p, i) => { if (!p.covered) adds.push(d.points[i].en); });
  if (r.sentences && !r.pass) r.sentences.forEach(s => { if (!s.covered && adds.length < 4) adds.push(s.text); });
  for (const a of adds.slice(0, 4)) { await speak('You could add: ' + a); if (my !== runId) return; }
}
function paceText(L, text, lv) {
  const secs = L && L.firstHeard && L.lastHeard > L.firstHeard ? (L.lastHeard - L.firstHeard) / 1000 + 0.5 : 0;
  const w = text.split(/\s+/).filter(Boolean).length; if (secs < 4 || w < 8) return '';
  const wpm = Math.round(w / secs * 60); const [lo, hi] = lv === 'detailed' ? [115, 160] : [100, 150];
  const tag = wpm < lo ? '偏慢，可以再順一點' : wpm > hi ? '偏快，句子之間多停一下' : '速度剛好';
  return `語速約 ${wpm} 字/分（${tag}；參考 ${lo}–${hi}）` + (L.longPauses ? ` · 停頓超過 2.5 秒 ${L.longPauses} 次` : '');
}
function stop() {
  runId++; clearInterval(tInt);
  if (listener && listener.active) { listener.active = false; clearInterval(listener.timer); try { listener.rec.abort(); } catch (e) { } }
  const b = $('kpSpeak'); if (b && b.classList.contains('recording')) { b.classList.remove('recording'); renderSpeakLabel(); }
  $('kpRec') && $('kpRec').classList.add('hidden');
}
function renderSpeakLabel() { const lv = levelOf(curSlide().slide); $('kpSpeak').textContent = lv === 'kp' ? '🎤 講重點' : `🎤 開始講（${LV_NAME[lv]}）`; }
$('kpStop').onclick = () => { stop(); stopTTS(); };
$('kpSpeak').onclick = async () => {
  if (listener && listener.active) { listener.stop(); return; }
  if (!APP.SR) return alert('此瀏覽器不支援語音辨識，請用電腦版 Chrome 或 iPhone Safari。');
  stopTTS(); ensureModel();
  const s = curSlide(), n = s.slide, lv = levelOf(n), btn = $('kpSpeak');
  $('kpResult').classList.add('hidden'); $('kpGistBox').classList.add('hidden');
  const live = $('kpLive'); live.classList.remove('hidden'); live.innerHTML = '<i>請開始說，用自己的話就好…</i>';
  listener = new Listener({
    onText: (f, i) => { live.innerHTML = esc(f) + ' <i>' + esc(i || '') + '</i>'; },
    onState: (on, err) => { btn.classList.toggle('recording', on); if (on) btn.textContent = '⏹ 講完了'; else renderSpeakLabel(); $('kpRec').classList.toggle('hidden', !on); if (err) alert(err); }
  });
  APP.listener = listener;
  t0 = Date.now(); clearInterval(tInt); tInt = setInterval(() => { $('kpTimer').textContent = fmt((Date.now() - t0) / 1000); }, 250);
  const text = await listener.start(); clearInterval(tInt);
  if (!text) { $('kpResult').innerHTML = '<p>沒有聽到聲音，請確認麥克風後再試一次。</p>'; $('kpResult').classList.remove('hidden'); speak("I didn't hear anything. Please try again."); return; }
  $('kpResult').innerHTML = '<p class="muted">判斷中…</p>'; $('kpResult').classList.remove('hidden');
  const r = await scoreText(n, text, lv); r.pace = paceText(listener, text, lv);
  $('kpResult').innerHTML = resultHTML(n, r);
  $('kpResult').querySelectorAll('[data-say]').forEach(b => b.onclick = () => { stopTTS(); const k = b.dataset.say; speak(k[0] === 'p' ? data[n].points[+k.slice(1)].en : r.sentences[+k.slice(1)].text); });
  if (r.pass) markMastered(n, lv);
  const hist = LS.get('lvLast', {}); hist[lv + ':' + n] = { t: Date.now(), c: r.covered, n: r.total, f: r.sentFrac, pass: r.pass }; LS.set('lvLast', hist);
  feedback(n, r);
};
$('kpGist').onclick = async () => {
  stop(); stopTTS(); const my = ++runId;
  const n = curSlide().slide, lv = levelOf(n); const sents = levelText(n, lv);
  const box = $('kpGistBox');
  box.innerHTML = `<b>${LV_NAME[lv]}示範：</b>` + sents.map((x, i) => `<span class="sent" data-g="${i}">${esc(x)}</span>`).join(' ');
  box.classList.remove('hidden');
  for (let i = 0; i < sents.length; i++) {
    if (my !== runId) break;
    box.querySelectorAll('.sent').forEach(e => e.classList.toggle('playing', +e.dataset.g === i));
    await speak(sents[i]);
    if (my === runId && window.NV && NV.natural()) await new Promise(r => setTimeout(r, lv === 'detailed' ? 250 : 400));
  }
  box.querySelectorAll('.sent').forEach(e => e.classList.remove('playing'));
};

(window.__slideHooks = window.__slideHooks || []).push(() => { revealed = false; stop(); renderPanel(); });
(window.__viewHooks = window.__viewHooks || []).push(v => { if (v === 'kp') { renderPanel(); ensureModel(); } });

window.KPUI = { stop, sentSim, renderHints, scoreText, markMastered, ensureModel, modelStatus, levelOf, levelText, LV_NAME,
  get data() { return data; }, get emb() { return EMB.state; }, get globalLevel() { return globalLevel; } };
fetch('levels.json').then(r => r.json()).then(d => { data = d; renderPanel(); if (APP.view === 'kp') ensureModel(); })
  .catch(e => { $('kpHints').innerHTML = '<span class="bad">練習資料載入失敗，請重新整理。</span>'; console.error(e); });
})();
