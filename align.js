/* Alignment / scoring engine. Works in browser (window.Align) and Node (module.exports). */
(function (root) {
  const STOP = new Set(('a an the and or but of to in on at for with by from as is are was were be been being this that these those it its it\'s we our us i my me you your they their them he she his her so then than there here which who whom what when where why how do does did done have has had not no can could will would should may might must also very just into over about up down out more most some such only each per vs versus all any both one'
  ).split(' '));
  // loose synonym groups (spoken alternatives accepted as equivalent)
  const SYN = [
    ['percent', 'percentage', 'pct'], ['equals', 'equal', 'is', 'of'], ['patients', 'people', 'subjects', 'cases'],
    ['show', 'shows', 'showed', 'demonstrate', 'demonstrates', 'demonstrated'], ['use', 'uses', 'using', 'used', 'utilize'],
    ['big', 'large', 'major', 'huge'], ['small', 'minor', 'little', 'tiny'], ['start', 'begin', 'starts', 'begins'],
    ['contactless', 'non-contact', 'noncontact', 'contact-free'], ['radar', 'raider', 'radars'], ['okay', 'ok'],
    ['gigahertz', 'ghz', 'giga', 'gigahertz'], ['versus', 'vs', 'compared'], ['severe', 'serious'], ['home', 'house'],
    ['hospital', 'ward', 'inpatient'], ['breathing', 'respiration', 'respiratory'], ['chest', 'thorax', 'thoracic'],
    ['co2', 'carbon', 'c02'], ['spo2', 'oxygen'], ['psg', 'polysomnography'], ['osa', 'apnea', 'apnoea'],
    ['heart', 'cardiac'], ['today', 'now'], ['thank', 'thanks'], ['about', 'around', 'approximately', 'roughly'],
  ];
  const SYNMAP = new Map();
  SYN.forEach((g, i) => g.forEach(w => { if (!SYNMAP.has(w)) SYNMAP.set(w, i); }));

  const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SCALE = { hundred: 100, thousand: 1000 };

  function wordsToNumbers(tokens) {
    // "ninety point three" -> "90.3", "one hundred ninety six" -> "196", "point nine one" -> "0.91"
    const out = []; let i = 0;
    const isNumW = t => t in ONES || t in TENS || t in SCALE;
    const digitW = t => (t in ONES && ONES[t] < 10) || /^\d$/.test(t);
    const dval = t => /^\d$/.test(t) ? t : String(ONES[t]);
    function decimals() { let d = ''; while (i < tokens.length && digitW(tokens[i])) { d += dval(tokens[i]); i++; } return d; }
    while (i < tokens.length) {
      const t0 = tokens[i];
      if (t0 === 'point' && i + 1 < tokens.length && digitW(tokens[i + 1]) && !/^\d/.test(out[out.length - 1] || '')) { i++; out.push('0.' + decimals()); continue; }
      if (!isNumW(t0) || (t0 === 'one' && !(isNumW(tokens[i + 1] || '') || tokens[i + 1] === 'point'))) { out.push(t0); i++; continue; }
      let total = 0, cur = 0, last = '';
      while (i < tokens.length) {
        const t = tokens[i];
        if (t in ONES) { if (last === 'ones' || (last === 'tens' && ONES[t] >= 10)) break; cur += ONES[t]; last = 'ones'; }
        else if (t in TENS) { if (last === 'ones' || last === 'tens') break; cur += TENS[t]; last = 'tens'; }
        else if (t === 'hundred') { if (last === 'hundred') break; cur = (cur || 1) * 100; last = 'hundred'; }
        else if (t === 'thousand') { total += (cur || 1) * 1000; cur = 0; last = 'hundred'; }
        else if (t === 'and' && last === 'hundred' && isNumW(tokens[i + 1] || '')) { i++; continue; }
        else break;
        i++;
      }
      let num = String(total + cur);
      if (tokens[i] === 'point' && i + 1 < tokens.length && digitW(tokens[i + 1])) { i++; num += '.' + decimals(); }
      out.push(num);
    }
    const out2 = [];
    for (let k = 0; k < out.length; k++) {
      if (out[k] === 'point' && /^\d+$/.test(out2[out2.length - 1] || '') && /^\d+$/.test(out[k + 1] || '')) { out2[out2.length - 1] += '.' + out[k + 1]; k++; }
      else out2.push(out[k]);
    }
    return out2.filter(t => t !== ',');
  }

  function normalize(text) {
    let t = String(text).toLowerCase()
      .replace(/₂/g, '2').replace(/[–—−]/g, ' minus ').replace(/×/g, ' by ')
      .replace(/(\d),(\d{3})/g, '$1$2').replace(/(^|[^\d])\.(\d)/g, '$1 0.$2').replace(/%/g, ' percent ').replace(/±/g, ' plus or minus ')
      .replace(/&/g, ' and ').replace(/\be\.g\./g, 'for example').replace(/\bi\.e\./g, 'that is')
      .replace(/(\d)-(?=[a-z])/g, '$1 ').replace(/,/g, ' , ').replace(/[^a-z0-9.,\s'-]/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
      .replace(/(^|\s)'|'(\s|$)/g, ' ');
    let toks = t.split(/[\s-]+/).filter(Boolean);
    toks = wordsToNumbers(toks);
    // join spelled-out letters: "p s g" -> "psg"
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      if (/^[a-z]$/.test(toks[i]) && toks[i] !== 'a' && toks[i] !== 'i' && /^[a-z]$/.test(toks[i + 1] || '')) {
        let s = ''; while (/^[a-z]$/.test(toks[i] || '')) { s += toks[i]; i++; } i--; out.push(s);
      } else out.push(toks[i]);
    }
    return out;
  }

  function stem(w) {
    if (/^\d/.test(w) || w.length <= 3) return w;
    return w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w;
  }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function similar(a, b) {
    if (a === b) return true;
    if (/^\d/.test(a) || /^\d/.test(b)) { // numbers: exact, or same ignoring trailing zeros
      return parseFloat(a) === parseFloat(b) && !isNaN(parseFloat(a));
    }
    const sa = stem(a), sb = stem(b);
    if (sa === sb) return true;
    if (a.length >= 7 && b.length >= 7 && a.slice(0, 6) === b.slice(0, 6)) return true; // validation ~ validated
    if (SYNMAP.has(a) && SYNMAP.get(a) === SYNMAP.get(b)) return true;
    const L = Math.max(a.length, b.length);
    if (L >= 5) return lev(a, b) / L <= 0.25;
    if (L === 4) return lev(a, b) <= 1 && a[0] === b[0];
    return false;
  }
  const isContent = w => !STOP.has(w) && (w.length > 2 || /^\d/.test(w));

  // LCS alignment target vs spoken with fuzzy equality
  function lcsAlign(T, S) {
    const m = T.length, n = S.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = similar(T[i], S[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const tm = new Array(m).fill(-1), sm = new Array(n).fill(-1);
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (similar(T[i], S[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) { tm[i] = j; sm[j] = i; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return { tm, sm };
  }

  /**
   * score(sentences[], transcript, keywords[], passThreshold)
   * returns { overall, sentences:[{text, tokens:[{w, display, content, status}], coverage, pass, missed[]}], keywords:[{k,hit}], extra[] }
   * status: 'ok' (in order) | 'loose' (said, but out of order) | 'miss'
   */
  function score(sentences, transcript, keywords, passThreshold) {
    passThreshold = passThreshold == null ? 0.75 : passThreshold;
    const S = normalize(transcript || '');
    const T = []; const sentIdx = []; const displays = []; const wordIdx = []; let wc = 0;
    sentences.forEach((s, si) => {
      const raw = String(s).split(/\s+/).filter(Boolean);
      raw.forEach(rw => {
        const nt = normalize(rw);
        nt.forEach((w, k) => { T.push(w); sentIdx.push(si); displays.push(k === 0 ? rw : ''); wordIdx.push(wc); }); wc++;
        if (!nt.length) { /* punctuation-only token */ }
      });
    });
    const { tm, sm } = lcsAlign(T, S);
    const used = sm.map(x => x >= 0);
    const status = T.map((w, i) => tm[i] >= 0 ? 'ok' : null);
    // order-tolerant second pass for content words
    T.forEach((w, i) => {
      if (status[i] || !isContent(w)) return;
      const j = S.findIndex((sw, k) => !used[k] && similar(w, sw));
      if (j >= 0) { used[j] = true; status[i] = 'loose'; }
    });
    T.forEach((w, i) => { if (!status[i]) status[i] = 'miss'; });
    const res = sentences.map((text, si) => ({ text, tokens: [], coverage: 0, pass: false, missed: [] }));
    T.forEach((w, i) => {
      const r = res[sentIdx[i]];
      r.tokens.push({ w, display: displays[i], content: isContent(w), status: status[i], wi: wordIdx[i] });
    });
    const kwSet = new Set((keywords || []).flatMap(k => normalize(k)).filter(isContent));
    const wt = t => (/^\d/.test(t.w) || kwSet.has(t.w)) ? 2 : 1; // numbers & keywords count double
    const sum = arr => arr.reduce((a, t) => a + wt(t), 0);
    let totC = 0, hitC = 0;
    res.forEach(r => {
      const c = r.tokens.filter(t => t.content);
      const h = c.filter(t => t.status !== 'miss');
      r.coverage = c.length ? sum(h) / sum(c) : (r.tokens.some(t => t.status !== 'miss') || !S.length ? 1 : 0);
      if (!S.length) r.coverage = 0;
      r.pass = r.coverage >= passThreshold;
      const missW = new Set(c.filter(t => t.status === 'miss').map(t => t.wi));
      r.missed = [...new Set(r.tokens.filter(t => t.display && missW.has(t.wi)).map(t => t.display))].map(x => x.replace(/[,.;:!?"“”()]+$/g, '').replace(/^[("“]+/, ''));
      totC += sum(c); hitC += sum(h);
    });
    const kw = (keywords || []).map(k => {
      const kt = normalize(k).filter(isContent);
      const hit = kt.length > 0 && kt.every(x => S.some(sw => similar(x, sw)));
      return { k, hit };
    });
    const extra = S.filter((w, j) => !used[j] && isContent(w));
    return { overall: totC ? hitC / totC : 0, sentences: res, keywords: kw, extra, spokenWords: S.length };
  }

  // Coverage of model answer's key content words (for Q&A)
  function keyCoverage(model, transcript) {
    const M = [...new Set(normalize(model).filter(isContent))];
    const S = normalize(transcript || '');
    const hits = M.filter(w => S.some(s => similar(w, s)));
    return { coverage: M.length ? hits.length / M.length : 0, hits, missed: M.filter(w => !hits.includes(w)) };
  }

  const api = { normalize, similar, score, keyCoverage, isContent, STOP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Align = api;
})(typeof window !== 'undefined' ? window : globalThis);
