(() => {
'use strict';
const SL = window.SLIDES, QA = window.QA;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const LS = {
  get(k, d) { try { const v = localStorage.getItem('gcbme_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gcbme_' + k, JSON.stringify(v)); } catch (e) { } }
};
const settings = Object.assign({ useEmbed: true, rate: 0.9, thr: 0.75, voiceFb: true, shadowRetry: true, voice: '', mode: 'full' }, LS.get('settings', {}));
const saveSettings = () => LS.set('settings', settings);
const best = LS.get('best', {});

/* ---------- capability check ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const TTS = 'speechSynthesis' in window;
const msgs = [];
if (!SR) msgs.push('這個瀏覽器不支援語音辨識（例如 Firefox、LINE / Facebook 內建瀏覽器），「我來講」與跟讀無法使用。請改用<b>電腦版 Chrome</b>，或用 <b>iPhone / iPad 的 Safari</b> 開啟此網址。示範朗讀仍可使用。');
if (!TTS) msgs.push('這個瀏覽器不支援語音朗讀，示範與語音回饋無法使用。');
if (!window.isSecureContext) msgs.push('目前不是 https 安全連線，瀏覽器會擋住麥克風。');
if (msgs.length) { $('banner').innerHTML = msgs.join('<br>'); $('banner').classList.remove('hidden'); }

/* ---------- TTS ---------- */
let voices = [];
function loadVoices() {
  if (!TTS) return;
  voices = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
  const rank = v => (/natural|neural|premium|enhanced|siri/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : /samantha|daniel|karen|moira|aria|jenny|guy|libby|sonia/i.test(v.name) ? 2 : 5) + (/en[-_]US/i.test(v.lang) ? 0 : /en[-_]GB/i.test(v.lang) ? 0.5 : 1);
  voices.sort((a, b) => rank(a) - rank(b));
  const sel = $('voiceSel'); sel.innerHTML = voices.map(v => `<option value="${esc(v.name)}">${esc(v.name)} (${v.lang})</option>`).join('');
  if (settings.voice && voices.some(v => v.name === settings.voice)) sel.value = settings.voice;
}
if (TTS) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
const pickVoice = () => voices.find(v => v.name === settings.voice) || voices[0] || null;
let ttsToken = 0;
async function speak(text, opt = {}) {
  if (window.NV && !opt.browser) { const my = ttsToken; const r = await window.NV.say(text); if (r !== null) return r && my === ttsToken; }
  return speakBrowser(text, opt);
}
function speakBrowser(text, opt = {}) {
  return new Promise(resolve => {
    if (!TTS) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = opt.rate || settings.rate; u.pitch = 1;
    const my = ttsToken; let done = false;
    const fin = ok => { if (done) return; done = true; clearInterval(keep); resolve(ok && my === ttsToken); };
    u.onend = () => fin(true); u.onerror = () => fin(false);
    // safety: resolve if engine never fires onend
    const keep = setInterval(() => { if (!speechSynthesis.speaking && !speechSynthesis.pending) fin(true); }, 400 + 0 * text.length);
    speechSynthesis.speak(u);
  });
}
function stopTTS() { ttsToken++; if (window.NV) window.NV.stop(); if (TTS) speechSynthesis.cancel(); }

/* ---------- Speech recognition wrapper ---------- */
class Listener {
  constructor({ onText, onState, silenceMs = 0, maxMs = 0, noSpeechMs = 0 }) {
    Object.assign(this, { onText, onState, silenceMs, maxMs, noSpeechMs });
    this.final = ''; this.interim = ''; this.active = false; this.lastHeard = 0; this.err = null;
  }
  start() {
    if (!SR) { alert('此瀏覽器不支援語音辨識，請用電腦版 Chrome 或 iPhone Safari。'); return Promise.resolve(''); }
    this.active = true; this.final = ''; this.interim = ''; this.started = Date.now(); this.lastHeard = 0; this.firstHeard = 0; this.longPauses = 0;
    this.done = new Promise(r => this._resolve = r);
    this._spawn(); this.onState && this.onState(true);
    this.timer = setInterval(() => {
      const now = Date.now();
      if (this.maxMs && now - this.started > this.maxMs) this.stop();
      else if (this.silenceMs && this.lastHeard && now - this.lastHeard > this.silenceMs) this.stop();
      else if (this.noSpeechMs && !this.lastHeard && now - this.started > this.noSpeechMs) this.stop();
    }, 200);
    return this.done;
  }
  _spawn() {
    const r = new SR(); this.rec = r;
    r.lang = 'en-US'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let base = this.final;
    r.onresult = e => {
      let fin = '', inter = '';
      for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t + ' '; else inter += t; }
      this.final = (base + ' ' + fin).replace(/\s+/g, ' ').trim(); this.interim = inter; const now = Date.now(); if (!this.firstHeard) this.firstHeard = now; else if (now - this.lastHeard > 2500) this.longPauses++; this.lastHeard = now;
      this.onText && this.onText(this.final, this.interim);
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.err = '麥克風權限被拒絕。請在瀏覽器網址列的設定中允許麥克風，再重新整理。'; this.stop(); }
      else if (e.error === 'audio-capture') { this.err = '找不到麥克風。'; this.stop(); }
      else if (e.error === 'network') { this.err = '語音辨識需要網路連線（Chrome 會把聲音送到 Google 辨識）。'; }
    };
    r.onend = () => {
      if (this.interim) { this.final = (this.final + ' ' + this.interim).trim(); this.interim = ''; }
      if (this.active) { try { this._spawn(); } catch (e) { this.stop(); } } // Chrome stops after pauses; keep listening
    };
    try { r.start(); } catch (e) { }
  }
  stop() {
    if (!this.active) return; this.active = false; clearInterval(this.timer);
    try { this.rec && this.rec.stop(); } catch (e) { }
    setTimeout(() => { // allow last result to arrive
      const text = (this.final + ' ' + (this.interim || '')).trim();
      this.onState && this.onState(false, this.err); this._resolve(text);
    }, 600);
  }
}

/* ---------- shared slide state ---------- */
let cur = LS.get('cur', 0); if (cur >= SL.length) cur = 0;
let view = 'kp';
const total = SL.reduce((a, s) => a + s.seconds, 0);

function cueHTML(sent, kws) {
  const words = sent.split(/\s+/);
  const lead = words.slice(0, 3).join(' ');
  const rest = words.slice(3).join(' ');
  const terms = new Set();
  (rest.match(/[−–-]?\d[\d.,]*\s?(%|percent|patients|nights|seconds|events|cm|GHz)?/g) || []).forEach(t => terms.add(t.trim().replace(/[.,]$/, '')));
  (rest.match(/\b[A-Z][A-Za-z0-9₂–-]*[A-Z0-9₂]\b/g) || []).forEach(t => terms.add(t));
  kws.forEach(k => { if (rest.toLowerCase().includes(k.toLowerCase()) && !/^\d+$/.test(k)) terms.add(k); });
  const t = [...terms].filter(x => x.length > 1).slice(0, 5);
  return `${esc(lead)} <span class="dots">…</span> ${t.map(x => `<span class="kw">${esc(x)}</span>`).join(' · ')}`;
}
function renderScript(el, slide, mode) {
  if (mode === 'none') { el.innerHTML = '<span class="muted">（只看投影片：試著不看稿講出來。點這裡可暫時顯示關鍵字）</span>'; el.onclick = () => { el.onclick = null; renderScript(el, slide, 'kw'); }; return; }
  el.onclick = null;
  el.innerHTML = slide.sentences.map((s, i) => `<span class="sent ${mode === 'kw' ? 'cue' : ''}" data-i="${i}"><span class="n">${i + 1}</span>${mode === 'kw' ? cueHTML(s, slide.keywords) : esc(s)}</span>`).join('');
}

function showSlide(i) {
  stopEverything();
  cur = (i + SL.length) % SL.length; LS.set('cur', cur);
  const s = SL[cur];
  $('slideImg').src = s.image; $('slideImg').alt = 'Slide ' + s.slide + ': ' + s.title;
  $('jump').value = cur;
  $('target').textContent = `⏱ 目標 ${Math.round(s.seconds)} 秒 · ${s.words} 字`;
  const b = best[s.slide]; $('best').textContent = b != null ? `最佳 ${Math.round(b * 100)}%` : '尚未練習';
  $('progbar').style.width = ((cur + 1) / SL.length * 100) + '%';
  $('timerTarget').textContent = fmt(s.seconds); $('timer').textContent = '0:00'; $('timer').classList.remove('over');
  renderScript($('script'), s, settings.mode);
  $('result').classList.add('hidden'); $('live').classList.add('hidden');
  if (view === 'shadow') renderShadowScript();
  // preload neighbours
  (window.__slideHooks || []).forEach(f => { try { f(cur); } catch (e) { console.warn(e); } });
  [cur + 1, cur - 1].forEach(k => { if (SL[k]) { const im = new Image(); im.src = SL[k].image; } });
}
$('jump').innerHTML = SL.map((s, i) => `<option value="${i}">${s.slide}. ${esc(s.title)}</option>`).join('');
$('jump').onchange = e => showSlide(+e.target.value);
$('prev').onclick = () => showSlide(cur - 1);
$('next').onclick = () => showSlide(cur + 1);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || view === 'rh' || view === 'qa' || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowRight') showSlide(cur + 1); else if (e.key === 'ArrowLeft') showSlide(cur - 1);
});
(function swipe(el) {
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showSlide(cur + (dx < 0 ? 1 : -1)); x0 = null;
  });
})($('slidebox'));
$('modeSeg').onclick = e => {
  const m = e.target.dataset.mode; if (!m) return; settings.mode = m; saveSettings();
  [...$('modeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  renderScript($('script'), SL[cur], m);
};
[...$('modeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));

/* ---------- Listen (sentence by sentence with highlight) ---------- */
function highlight(container, i) {
  [...container.querySelectorAll('.sent')].forEach(el => el.classList.toggle('playing', +el.dataset.i === i));
  const el = container.querySelector(`.sent[data-i="${i}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function playSentences(sents, from = 0, container = $('script')) {
  stopTTS(); const my = ttsToken;
  for (let i = from; i < sents.length; i++) {
    if (my !== ttsToken) break;
    highlight(container, i);
    await speak(sents[i]);
    if (my !== ttsToken) break;
    await new Promise(r => setTimeout(r, 250));
  }
  highlight(container, -1);
}
$('btnListen').onclick = () => playSentences(SL[cur].sentences);
$('script').addEventListener('click', e => {
  const el = e.target.closest('.sent'); if (!el || view !== 'practice') return;
  const i = +el.dataset.i; stopTTS(); const my = ttsToken; highlight($('script'), i);
  speak(SL[cur].sentences[i]).then(() => { if (my === ttsToken) highlight($('script'), -1); });
});

/* ---------- timer ---------- */
let tInt = null, t0 = 0;
function startTimer(el, target) {
  clearInterval(tInt); t0 = Date.now();
  tInt = setInterval(() => { const s = (Date.now() - t0) / 1000; el.textContent = fmt(s); el.classList.toggle('over', s > target); }, 250);
}
const stopTimer = () => { clearInterval(tInt); tInt = null; return (Date.now() - t0) / 1000; };

/* ---------- Speak & score ---------- */
let listener = null;
function liveRender(el, fin, inter) { el.classList.remove('hidden'); el.innerHTML = esc(fin) + ' <i>' + esc(inter || '') + '</i>'; }
function tokensHTML(r) {
  return r.tokens.map(t => {
    if (!t.display) return '';
    const cls = !t.content ? (t.status === 'miss' ? 'w-fn' : 'w-ok') : 'w-' + t.status;
    return `<span class="${cls}">${esc(t.display)}</span>`;
  }).join(' ');
}
function resultHTML(res, secs, target) {
  const pct = Math.round(res.overall * 100), cls = pct >= 85 ? 'good' : pct >= settings.thr * 100 ? 'mid' : 'bad';
  const passN = res.sentences.filter(s => s.pass).length;
  let h = `<div class="score"><b class="${cls}">${pct}%</b><span>內容涵蓋率 · 過關 ${passN}/${res.sentences.length} 句</span>`;
  if (secs != null) h += `<span class="${secs > target * 1.15 ? 'bad' : 'good'}">用時 ${fmt(secs)}（目標 ${fmt(target)}）${secs > target * 1.15 ? ' 超時' : ''}</span>`;
  h += `</div>`;
  if (res.keywords.length) h += `<div class="kwlist">關鍵字：${res.keywords.map(k => `<span class="${k.hit ? 'y' : 'n'}">${k.hit ? '✓' : '✗'} ${esc(k.k)}</span>`).join('')}</div>`;
  h += res.sentences.map((s, i) => `<div class="rs"><div class="hd"><span>第 ${i + 1} 句 · ${Math.round(s.coverage * 100)}% ${s.pass ? '<span class="good">✓ 過關</span>' : '<span class="bad">✗ 再練</span>'}</span>${s.pass ? '' : `<button class="btn small ghost" data-say="${i}">🔊 正確說法</button>`}</div><div class="tx">${tokensHTML(s)}</div>${!s.pass && s.missed.length ? `<div class="missed">漏掉：${esc(s.missed.slice(0, 8).join(', '))}</div>` : ''}</div>`).join('');
  h += `<p class="small muted">綠色＝講到；橘色虛線＝講到但順序不同；紅色刪除線＝漏掉的重點字；灰色＝虛詞（不計分）。換句話說但意思對的地方，系統只能部分判斷，請以自己的判斷為準。</p>`;
  return h;
}
async function voiceFeedback(res, sents) {
  if (!settings.voiceFb || !TTS) return;
  stopTTS(); const my = ttsToken;
  const pct = Math.round(res.overall * 100);
  const weak = res.sentences.map((s, i) => ({ s, i })).filter(x => !x.s.pass);
  let intro = pct >= 85 ? `Excellent. You covered ${pct} percent.` : pct >= 60 ? `Good effort. You covered ${pct} percent.` : `You covered ${pct} percent. Let's practise the weak parts.`;
  if (!weak.length) intro += ' Every sentence passed.';
  await speak(intro); if (my !== ttsToken) return;
  for (const { s, i } of weak.slice(0, 3)) {
    if (my !== ttsToken) return;
    highlight($('script'), i);
    if (s.missed.length) await speak(`Sentence ${i + 1}. You missed: ${s.missed.slice(0, 5).join(', ')}.`);
    if (my !== ttsToken) return;
    await speak('A better way to say it:', { rate: Math.min(1, settings.rate + 0.05) });
    if (my !== ttsToken) return;
    await speak(sents[i]);
  }
  if (weak.length > 3 && my === ttsToken) await speak(`There are ${weak.length - 3} more sentences to review on the screen.`);
  highlight($('script'), -1);
}
function bindSay(container, sents) {
  container.querySelectorAll('[data-say]').forEach(b => b.onclick = () => { stopTTS(); speak(sents[+b.dataset.say]); });
}
$('btnSpeak').onclick = async () => {
  if (listener && listener.active) { listener.stop(); return; }
  stopTTS();
  const s = SL[cur], btn = $('btnSpeak');
  $('result').classList.add('hidden'); liveRender($('live'), '', '請開始說…');
  listener = new Listener({
    onText: (f, i) => liveRender($('live'), f, i),
    onState: (on, err) => { btn.classList.toggle('recording', on); btn.textContent = on ? '⏹ 講完了' : '🎤 我來講'; $('recState').classList.toggle('hidden', !on); if (err) alert(err); }
  });
  startTimer($('timer'), s.seconds);
  const text = await listener.start();
  const secs = stopTimer();
  const res = Align.score(s.sentences, text, s.keywords, settings.thr);
  if (best[s.slide] == null || res.overall > best[s.slide]) { best[s.slide] = res.overall; LS.set('best', best); $('best').textContent = `最佳 ${Math.round(res.overall * 100)}%`; }
  $('result').innerHTML = resultHTML(res, secs, s.seconds); $('result').classList.remove('hidden'); bindSay($('result'), s.sentences);
  if (text) voiceFeedback(res, s.sentences); else speak("I didn't hear anything. Please check the microphone and try again.");
};

/* ---------- Shadowing ---------- */
let shadowRun = 0;
let shLevel = LS.get('shLevel', 'detailed');
function shadowSentences(s) { const d = window.KPUI && KPUI.data && KPUI.data[s.slide]; return shLevel === 'concise' && d ? d.concise : s.sentences; }
function renderShadowScript() { const s = SL[cur]; $('script').onclick = null; $('script').innerHTML = shadowSentences(s).map((x, i) => `<span class="sent" data-i="${i}"><span class="n">${i + 1}</span>${esc(x)}</span>`).join(''); }
function paceNote(userSec, modelSec) {
  if (!userSec || !modelSec) return null; const r = userSec / modelSec;
  return r > 1.45 ? { cls: 'mid', zh: `偏慢（${userSec.toFixed(1)} 秒，示範 ${modelSec.toFixed(1)} 秒）`, en: 'A little faster.' }
    : r < 0.65 ? { cls: 'mid', zh: `偏快（${userSec.toFixed(1)} 秒，示範 ${modelSec.toFixed(1)} 秒）`, en: 'A little slower.' }
    : { cls: 'good', zh: `速度剛好（${userSec.toFixed(1)} 秒，示範 ${modelSec.toFixed(1)} 秒）`, en: 'Nice pace.' };
}
async function shadow() {
  const my = ++shadowRun; stopTTS();
  const s = SL[cur]; const sents = shadowSentences(s); renderShadowScript();
  const box = $('result'); box.classList.remove('hidden'); box.innerHTML = '';
  let passed = 0;
  for (let i = 0; i < sents.length; i++) {
    let attempt = 0;
    while (my === shadowRun) {
      highlight($('script'), i);
      liveRender($('live'), '', '🔊 先聽…');
      await speak(sents[i]); if (my !== shadowRun) return;
      liveRender($('live'), '', '🎤 換你說這一句…');
      const words = sents[i].split(/\s+/).length;
      listener = new Listener({ onText: (f, it) => liveRender($('live'), f, it), onState: (on, err) => { $('recState').classList.toggle('hidden', !on); if (err) { alert(err); shadowRun++; } }, silenceMs: 1500, maxMs: (words * 0.75 + 5) * 1000, noSpeechMs: 7000 });
      const L0 = listener; const text = await listener.start(); if (my !== shadowRun) return;
      const r = Align.score([sents[i]], text, s.keywords, settings.thr).sentences[0];
      let sim = null; if (!r.pass && text && window.KPUI && KPUI.sentSim) { try { sim = await KPUI.sentSim(sents[i], text); } catch (e) { } }
      const ok = r.pass || (sim != null && sim >= 0.8);
      const userSec = L0.firstHeard && L0.lastHeard > L0.firstHeard ? (L0.lastHeard - L0.firstHeard) / 1000 + 0.4 : 0;
      const modelSec = window.NV && NV.clipSec(sents[i]) ? NV.clipSec(sents[i]) / (settings.nrate || 1) : words / 2.4;
      const pace = text ? paceNote(userSec, modelSec) : null;
      const row = document.createElement('div'); row.className = 'rs';
      row.innerHTML = `<div class="hd"><span>第 ${i + 1} 句 · ${Math.round(r.coverage * 100)}%${sim != null ? ` · 意思 ${Math.round(sim * 100)}%` : ''} ${ok ? '<span class="good">✓</span>' : '<span class="bad">✗</span>'}${attempt ? '（重試）' : ''}</span></div><div class="tx">${tokensHTML(r)}</div>${!ok && r.missed.length ? `<div class="missed">漏掉：${esc(r.missed.join(', '))}</div>` : ''}${pace ? `<div class="small ${pace.cls}">⏱ ${pace.zh}</div>` : ''}`;
      box.appendChild(row); row.scrollIntoView({ block: 'nearest' });
      if (ok) { passed++; if (settings.voiceFb) await speak(pace && pace.cls !== 'good' ? pace.en : (r.coverage > 0.9 ? 'Great.' : 'Good.'), { rate: 1 }); break; }
      if (settings.voiceFb) await speak(!text ? "I didn't hear you." : (window.NV && NV.natural()) ? 'Almost.' : (r.missed.length ? `You missed: ${r.missed.slice(0, 4).join(', ')}.` : 'Almost.'), { rate: 1 });
      if (my !== shadowRun) return;
      attempt++; if (!settings.shadowRetry || attempt > 1) break;
      if (settings.voiceFb) await speak('Listen again.', { rate: 1 });
    }
  }
  if (my !== shadowRun) return;
  highlight($('script'), -1); $('live').classList.add('hidden');
  const msg = `This slide is done. ${passed} of ${sents.length} sentences passed.`;
  const d = document.createElement('div'); d.className = 'score'; d.innerHTML = `<b class="${passed === sents.length ? 'good' : 'mid'}">${passed}/${sents.length}</b><span>句過關。可按 › 進入下一張再跟讀。</span>`; box.appendChild(d);
  if (settings.voiceFb) speak(msg);
}
$('shLevelSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; shLevel = b.dataset.lv; LS.set('shLevel', shLevel); [...$('shLevelSeg').children].forEach(x => x.classList.toggle('on', x === b)); stopEverything(); renderShadowScript(); };
[...$('shLevelSeg').children].forEach(x => x.classList.toggle('on', x.dataset.lv === shLevel));
$('btnShadow').onclick = () => { if (!SR) return alert('此瀏覽器不支援語音辨識，請用電腦版 Chrome 或 iPhone Safari。'); shadow(); };
$('btnShadowStop').onclick = () => stopEverything();

function stopEverything() {
  shadowRun++; stopTTS(); if (listener && listener.active) { listener.onState && listener.onState(false); listener.active = false; clearInterval(listener.timer); try { listener.rec.abort(); } catch (e) { } }
  stopTimer(); highlight($('script'), -1); $('recState').classList.add('hidden'); $('qaRec').classList.add('hidden');
  if (window.KPUI) window.KPUI.stop();
  $('btnSpeak').classList.remove('recording'); $('btnSpeak').textContent = '🎤 我來講';
}
$('btnStopAll').onclick = stopEverything;

/* ---------- Q&A ---------- */
let qi = 0;
function showQA(i) {
  stopEverything(); qi = (i + QA.length) % QA.length;
  $('qaNum').textContent = `Q${qi + 1} / ${QA.length}`; $('qaQ').textContent = QA[qi].q; $('qaA').textContent = QA[qi].a;
  $('qaA').classList.toggle('hidden', !$('qaShowA').checked); $('qaResult').classList.add('hidden'); $('qaLive').classList.add('hidden');
}
$('qaPrev').onclick = () => showQA(qi - 1); $('qaNext').onclick = () => showQA(qi + 1);
$('qaShowA').onchange = () => $('qaA').classList.toggle('hidden', !$('qaShowA').checked);
$('qaAsk').onclick = () => { stopTTS(); speak(QA[qi].q); };
$('qaModel').onclick = () => { stopTTS(); speak(QA[qi].a); };
$('qaAnswer').onclick = async () => {
  const btn = $('qaAnswer');
  if (listener && listener.active) { listener.stop(); return; }
  stopTTS(); liveRender($('qaLive'), '', '請開始回答…'); $('qaResult').classList.add('hidden');
  listener = new Listener({ onText: (f, i) => liveRender($('qaLive'), f, i), onState: (on, err) => { btn.classList.toggle('recording', on); btn.textContent = on ? '⏹ 答完了' : '🎤 我來回答'; $('qaRec').classList.toggle('hidden', !on); if (err) alert(err); } });
  const text = await listener.start();
  const c = Align.keyCoverage(QA[qi].a, text); const pct = Math.round(c.coverage * 100);
  $('qaResult').innerHTML = `<div class="score"><b class="${pct >= 60 ? 'good' : pct >= 35 ? 'mid' : 'bad'}">${pct}%</b><span>範例答案重點字涵蓋率（Q&A 不需逐字，40–60% 通常就表示重點有講到）</span></div>
    <div class="kwlist">講到：${c.hits.map(w => `<span class="y">${esc(w)}</span>`).join('')}</div>
    <div class="kwlist">沒提到：${c.missed.map(w => `<span class="n">${esc(w)}</span>`).join('')}</div>
    <div class="a"><b>範例答案：</b>${esc(QA[qi].a)}</div>`;
  $('qaResult').classList.remove('hidden');
  if (settings.voiceFb && TTS) { stopTTS(); await speak(text ? `You covered ${pct} percent of the key points. Here is a model answer.` : "I didn't hear an answer. Here is a model answer."); await speak(QA[qi].a); }
};

/* ---------- Full rehearsal ---------- */
let rh = null;
function rhRenderHistory() {
  const hist = LS.get('rehearsals', []);
  $('rhHistory').innerHTML = hist.length ? hist.map((h, i) => `<div class="hist"><span>${new Date(h.date).toLocaleString('zh-TW', { hour12: false })} · ${h.kind === 'gist' ? `🎯 ${({ detailed: '詳細', concise: '精簡', kp: '重點式' })[h.level || 'kp']}彩排 · 過關 ${h.passN}/${h.rows.length} 張 · ${fmt(h.total)}` : `逐字 · ${fmt(h.total)} · 平均 ${Math.round(h.avg * 100)}%`}</span><button class="btn small ghost" data-h="${i}">看報告</button></div>`).join('') : '<p class="muted small">還沒有紀錄。</p>';
  $('rhHistory').querySelectorAll('[data-h]').forEach(b => b.onclick = () => rhShowReport(LS.get('rehearsals', [])[+b.dataset.h]));
}
let rhMode = 'none';
$('rhModeSeg').onclick = e => { const m = e.target.dataset.mode; if (!m) return; rhMode = m; [...$('rhModeSeg').children].forEach(b => b.classList.toggle('on', b.dataset.mode === m)); };
function rhShow(i) {
  rh.i = i; const s = SL[i];
  $('rhImg').src = s.image; $('rhProg').style.width = ((i + 1) / SL.length * 100) + '%';
  if (rh.kind === 'gist') { const D = window.KPUI.data[s.slide]; $('rhSlideTarget').textContent = rh.level === 'detailed' ? '參考 ' + fmt(D.secD) : '不限'; window.KPUI.renderHints($('rhScript'), s.slide, rh.level === 'kp' ? { none: 'none', kw: 'zh', full: 'en' }[rhMode] : { none: 'none', kw: 'cue', full: 'full' }[rhMode], true, rh.level); }
  else { $('rhSlideTarget').textContent = fmt(s.seconds); renderScript($('rhScript'), s, rhMode); }
  $('rhLive').innerHTML = esc(rh.text[i] || '');
  rh.slideStart = Date.now();
  $('rhNext').textContent = i === SL.length - 1 ? '完成 ✓' : '下一張 ›';
  if (SL[i + 1]) new Image().src = SL[i + 1].image;
}
function rhAccount() { if (!rh) return; rh.time[rh.i] = (rh.time[rh.i] || 0) + (Date.now() - rh.slideStart) / 1000; }
$('rhStart').onclick = () => rhBegin('verbatim');
let rhLevel = LS.get('rhLevel', 'kp');
const syncRhLevel = () => [...$('rhLevelSeg').children].forEach(b => b.classList.toggle('on', b.dataset.lv === rhLevel));
syncRhLevel();
$('rhLevelSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; rhLevel = b.dataset.lv; LS.set('rhLevel', rhLevel); syncRhLevel(); };
$('rhGistStart').onclick = () => { if (window.KPUI) window.KPUI.ensureModel(); rhBegin('gist'); };
function rhBegin(kind) {
  if (!SR && !confirm('此瀏覽器不支援語音辨識，只能計時不能評分。要繼續嗎？')) return;
  stopEverything();
  rh = { kind, level: rhLevel, i: 0, text: SL.map(() => ''), time: SL.map(() => 0), start: Date.now(), base: '' };
  $('rhTotalGoal').classList.toggle('hidden', kind === 'gist' && rhLevel !== 'detailed');
  $('rhTotalGoal').textContent = kind === 'gist' && rhLevel === 'detailed' ? ' / 參考 20:00' : ' / 20:00';
  $('rhIntro').classList.add('hidden'); $('rhReport').classList.add('hidden'); $('rhRun').classList.remove('hidden');
  rhShow(0);
  rh.tick = setInterval(() => {
    const T = (Date.now() - rh.start) / 1000, st = (Date.now() - rh.slideStart) / 1000;
    $('rhTotal').textContent = fmt(T); $('rhTotal').classList.toggle('over', rh.kind !== 'gist' && T > 1200);
    $('rhSlideT').textContent = fmt(st); $('rhSlideT').style.color = rh.kind !== 'gist' && st > SL[rh.i].seconds * 1.15 ? 'var(--bad)' : '';
  }, 250);
  if (SR) {
    let consumed = 0; // chars of listener.final already assigned to slides
    listener = new Listener({
      onText: (f, inter) => { const add = f.slice(consumed); $('rhLive').innerHTML = esc((rh.text[rh.i] + ' ' + add).trim()) + ' <i>' + esc(inter) + '</i>'; rh.pending = add; },
      onState: (on, err) => { $('rhRec').classList.toggle('hidden', !on); if (err) alert(err); }
    });
    rh.flush = () => { const f = listener.final; rh.text[rh.i] = (rh.text[rh.i] + ' ' + f.slice(consumed)).trim(); consumed = f.length; };
    listener.start();
  } else rh.flush = () => { };
}
$('rhNext').onclick = () => { if (!rh) return; rh.flush(); rhAccount(); if (rh.i < SL.length - 1) rhShow(rh.i + 1); else rhFinish(); };
$('rhBack').onclick = () => { if (!rh || rh.i === 0) return; rh.flush(); rhAccount(); rhShow(rh.i - 1); };
$('rhEnd').onclick = () => { if (rh && confirm('結束彩排並產生報告？')) { rh.flush(); rhAccount(); rhFinish(); } };
async function rhFinish() {
  clearInterval(rh.tick); if (listener && listener.active) { listener.active = false; clearInterval(listener.timer); try { listener.rec.abort(); } catch (e) { } }
  if (rh.kind === 'gist') {
    const R = rh; rh = null; $('rhRun').classList.add('hidden');
    $('rhReport').innerHTML = '<div class="card">評分中…</div>'; $('rhReport').classList.remove('hidden');
    const rows = [];
    for (let i = 0; i < SL.length; i++) {
      const s = SL[i]; const r = R.text[i] ? await window.KPUI.scoreText(s.slide, R.text[i], R.level) : null;
      rows.push({ slide: s.slide, title: s.title, t: Math.round(R.time[i]), spoken: !!R.text[i], covered: r ? r.covered : 0, total: window.KPUI.data[s.slide].points.length, pass: r ? r.pass : false, marks: r ? r.points.map(p => p.covered ? 1 : 0) : [], sent: r && r.sentences ? r.sentFrac : null });
      if (r && r.pass) window.KPUI.markMastered(s.slide, R.level);
    }
    const rep = { kind: 'gist', level: R.level, date: Date.now(), total: Math.round((Date.now() - R.start) / 1000), passN: rows.filter(r => r.pass).length, rows, avg: 0 };
    const hist = LS.get('rehearsals', []); hist.unshift(rep); LS.set('rehearsals', hist.slice(0, 10));
    rhShowReport(rep);
    if (settings.voiceFb && TTS) speak(`Rehearsal finished. You got the main idea on ${rep.passN} of ${rows.length} slides.${rep.passN >= rows.length * 0.8 ? ' Excellent work.' : ' Keep going, you are improving.'}`);
    return;
  }
  const rows = SL.map((s, i) => {
    const sc = rh.text[i] ? Align.score(s.sentences, rh.text[i], s.keywords, settings.thr) : null;
    return { slide: s.slide, title: s.title, t: Math.round(rh.time[i]), target: Math.round(s.seconds), cov: sc ? sc.overall : 0, spoken: !!rh.text[i], text: rh.text[i] };
  });
  const scored = rows.filter(r => r.spoken);
  const rep = { date: Date.now(), total: Math.round((Date.now() - rh.start) / 1000), avg: scored.length ? scored.reduce((a, r) => a + r.cov, 0) / scored.length : 0, rows };
  const hist = LS.get('rehearsals', []); hist.unshift(rep); LS.set('rehearsals', hist.slice(0, 10));
  rh = null; $('rhRun').classList.add('hidden'); rhShowReport(rep);
  if (settings.voiceFb && TTS) {
    const over = rows.filter(r => r.t > r.target * 1.25 && r.t - r.target > 5);
    speak(`Rehearsal finished in ${Math.floor(rep.total / 60)} minutes ${rep.total % 60} seconds. Average coverage ${Math.round(rep.avg * 100)} percent. ${over.length ? over.length + ' slides ran over time.' : 'No slide ran badly over time.'}`);
  }
}
function rhShowReport(rep) {
  if (!rep) return;
  if (rep.kind === 'gist') {
    const LVN = ({ detailed: '詳細', concise: '精簡', kp: '重點式' })[rep.level || 'kp'];
    $('rhReport').innerHTML = `<div class="card"><h3>🎯 ${LVN}彩排報告 · ${new Date(rep.date).toLocaleString('zh-TW', { hour12: false })}</h3>
      <div class="score"><b class="${rep.passN >= rep.rows.length * 0.8 ? 'good' : 'mid'}">${rep.passN}/${rep.rows.length}</b><span>張抓到重點</span><span class="muted">用時 ${fmt(rep.total)}${rep.level === 'detailed' ? '（參考 20:00，不計分）' : '（不計分）'}</span></div>
      <p>講了但還沒抓到重點（建議回「抓重點」練）：${rep.rows.filter(r => r.spoken && !r.pass).map(r => r.slide).join('、') || '無'}${rep.rows.some(r => !r.spoken) ? `<br><span class="muted">沒有講（跳過）：${rep.rows.filter(r => !r.spoken).length} 張</span>` : ''}</p>
      <table class="rep"><tr><th>#</th><th>標題</th><th>重點</th><th>句意</th><th></th></tr>
      ${rep.rows.map(r => `<tr><td>${r.slide}</td><td><a href="#" data-go="${r.slide}">${esc(r.title)}</a></td><td class="num">${r.spoken ? r.marks.map(m => m ? '✓' : '✗').join('') : '—'}</td><td class="num">${r.spoken && r.sent != null ? Math.round(r.sent * 100) + '%' : ''}</td><td class="num ${r.pass ? 'good' : 'bad'}">${r.spoken ? `${r.covered}/${r.total}` : ''}</td></tr>`).join('')}</table>
      <div class="ctl"><button class="btn" id="rhBackIntro">回彩排首頁</button></div></div>`;
    $('rhReport').classList.remove('hidden'); $('rhIntro').classList.add('hidden');
    $('rhBackIntro').onclick = () => { $('rhReport').classList.add('hidden'); $('rhIntro').classList.remove('hidden'); rhRenderHistory(); };
    $('rhReport').querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); const k = SL.findIndex(s => s.slide === +a.dataset.go); setView('kp'); showSlide(k); });
    return;
  }
  const over = r => r.t > r.target * 1.25 && r.t - r.target > 5;
  const weak = rep.rows.filter(r => r.spoken && r.cov < settings.thr);
  $('rhReport').innerHTML = `<div class="card"><h3>彩排報告 · ${new Date(rep.date).toLocaleString('zh-TW', { hour12: false })}</h3>
    <div class="score"><b class="${rep.total > 1260 ? 'bad' : 'good'}">${fmt(rep.total)}</b><span>總時間（目標 20:00）</span><b class="${rep.avg >= settings.thr ? 'good' : 'mid'}">${Math.round(rep.avg * 100)}%</b><span>平均涵蓋率</span></div>
    <p>超時投影片：${rep.rows.filter(over).map(r => r.slide).join('、') || '無'}<br>涵蓋率偏低（建議回逐張練習）：${weak.map(r => r.slide).join('、') || '無'}</p>
    <table class="rep"><tr><th>#</th><th>標題</th><th>用時/目標</th><th>涵蓋</th></tr>
    ${rep.rows.map(r => `<tr><td>${r.slide}</td><td><a href="#" data-go="${r.slide}">${esc(r.title)}</a></td><td class="num ${over(r) ? 'bad' : ''}">${fmt(r.t)}/${fmt(r.target)}</td><td class="num ${!r.spoken ? 'muted' : r.cov >= settings.thr ? 'good' : 'bad'}">${r.spoken ? Math.round(r.cov * 100) + '%' : '—'}</td></tr>`).join('')}</table>
    <div class="ctl"><button class="btn" id="rhBackIntro">回彩排首頁</button></div></div>`;
  $('rhReport').classList.remove('hidden'); $('rhIntro').classList.add('hidden');
  $('rhBackIntro').onclick = () => { $('rhReport').classList.add('hidden'); $('rhIntro').classList.remove('hidden'); rhRenderHistory(); };
  $('rhReport').querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); const k = SL.findIndex(s => s.slide === +a.dataset.go); setView('practice'); showSlide(k); });
}

/* ---------- views ---------- */
function setView(v) {
  if (rh && v !== 'rh' && !confirm('彩排進行中，離開會中止。確定？')) return;
  if (rh && v !== 'rh') { clearInterval(rh.tick); rh = null; $('rhRun').classList.add('hidden'); $('rhIntro').classList.remove('hidden'); }
  stopEverything(); view = v;
  [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const kpLike = v === 'kp' || v === 'read';
  const slideView = v === 'practice' || v === 'shadow' || kpLike;
  $('view-slide').classList.toggle('hidden', !slideView);
  document.body.classList.toggle('readmode', v === 'read');
  ['modeSeg', 'script', 'best'].forEach(id => $(id).classList.toggle('hidden', kpLike));
  $('slideTimerRow').classList.toggle('hidden', kpLike);
  $('kpPanel').classList.toggle('hidden', !kpLike);
  $('target').classList.toggle('hidden', kpLike);
  (window.__viewHooks || []).forEach(f => f(v));
  $('view-qa').classList.toggle('hidden', v !== 'qa'); $('view-rh').classList.toggle('hidden', v !== 'rh');
  $('practiceCtl').classList.toggle('hidden', v !== 'practice'); $('shadowCtl').classList.toggle('hidden', v !== 'shadow');
  $('result').classList.add('hidden'); $('live').classList.add('hidden');
  if (v === 'shadow') { $('modeSeg').classList.add('hidden'); renderShadowScript(); }
  if (v === 'rh') rhRenderHistory();
  window.scrollTo(0, 0);
}
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); };

/* ---------- settings ---------- */
const dlg = $('settings');
function syncSettingsUI() { $('rate').value = settings.rate; $('rateVal').textContent = settings.rate + '×'; $('thr').value = settings.thr; $('thrVal').textContent = Math.round(settings.thr * 100) + '%'; $('voiceFb').checked = settings.voiceFb; $('shadowRetry').checked = settings.shadowRetry; $('useEmbed').checked = settings.useEmbed; }
$('btnSettings').onclick = () => { syncSettingsUI(); dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); };
$('rate').oninput = e => { settings.rate = +e.target.value; $('rateVal').textContent = settings.rate + '×'; saveSettings(); };
$('thr').oninput = e => { settings.thr = +e.target.value; $('thrVal').textContent = Math.round(settings.thr * 100) + '%'; saveSettings(); };
$('voiceFb').onchange = e => { settings.voiceFb = e.target.checked; saveSettings(); };
$('shadowRetry').onchange = e => { settings.shadowRetry = e.target.checked; saveSettings(); };
$('useEmbed').onchange = e => { settings.useEmbed = e.target.checked; saveSettings(); if (window.KPUI) window.KPUI.modelStatus(); };
$('voiceSel').onchange = e => { settings.voice = e.target.value; saveSettings(); };
$('testVoice').onclick = () => { stopTTS(); speak('Good morning, everyone. Thank you for the kind invitation.'); };

showSlide(cur); setView('kp'); showQA(0);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
window.__app = { Align, SL, QA, showSlide, setView, speak, speakBrowser, stopTTS, renderScript, Listener, stopEverything, settings, saveSettings, LS, fmt, esc, highlight, SR, TTS, get cur() { return cur; }, get view() { return view; }, get listener() { return listener; }, set listener(l) { listener = l; } };
})();
