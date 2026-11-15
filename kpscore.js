/* Key-point (meaning) scoring. Browser: window.KPScore ; Node: module.exports */
(function (root) {
  const A = root.Align || (typeof require !== 'undefined' ? require('./align.js') : null);
  const TH = { hi: 0.78, lo: 0.70 }; // key-point embedding thresholds (tuned in tune/tune.js)
  const TS = { hi: 0.68, lo: 0.47, lex: 0.5, lexLo: 0.25 }; // sentence-level thresholds (tuned in tune/tune_v3.js)
  const NEED = { detailed: 0.7, concise: 0.6 };
  const KWNEED = { detailed: 0.4, concise: 0.3, kp: 0 }; // share of on-slide keywords (numbers, terms) that must be heard
  const phraseCache = new Map();
  const ptoks = p => { if (!phraseCache.has(p)) phraseCache.set(p, A.normalize(p)); return phraseCache.get(p); };

  // short words (<=4 chars) must match exactly (avoids 'like' ~ 'line')
  const sim = (a, b) => (a.length <= 4 || b.length <= 4) ? (a === b || a.replace(/s$/, '') === b.replace(/s$/, '')) : A.similar(a, b);
  // does phrase occur in spoken tokens S (fuzzy, contiguous, allowing 1 filler word between)
  function phraseHit(phrase, S) {
    const P = ptoks(phrase); if (!P.length) return false;
    for (let j = 0; j < S.length; j++) {
      if (!sim(P[0], S[j])) continue;
      let k = j, ok = true;
      for (let m = 1; m < P.length; m++) {
        if (S[k + 1] && sim(P[m], S[k + 1])) k += 1;
        else if (S[k + 2] && sim(P[m], S[k + 2])) k += 2;
        else { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
  function groupHits(point, S) {
    return point.groups.map(g => { const h = g.find(p => phraseHit(p, S)); return h || null; });
  }
  // sliding windows of the transcript, sized to the model sentence
  function windows(transcript, modelSentence, minL) {
    const W = String(transcript).split(/\s+/).filter(Boolean);
    const L = Math.max(minL || 8, Math.min(30, modelSentence.split(/\s+/).length + 4));
    if (W.length <= L) return W.length ? [W.join(' ')] : [];
    const step = L <= 8 ? 2 : 4; const out = []; for (let i = 0; i < W.length; i += step) { out.push(W.slice(i, i + L).join(' ')); if (i + L >= W.length) break; }
    return out;
  }
  /**
   * score(slideKP, transcript, sims?) -> { points:[{covered, hits, groupsHit, need, sim, via}], covered, total, pass }
   * sims: optional array of max cosine similarity per point (from embeddings), or null.
   */
  function score(kp, transcript, sims) {
    const S = A.normalize(transcript || '');
    const pts = kp.points.map((p, i) => {
      const hits = groupHits(p, S); const gh = hits.filter(Boolean).length;
      const sim = sims ? sims[i] : null;
      const byGroups = gh >= p.need;
      const bySem = sim != null && (sim >= TH.hi || (sim >= TH.lo && gh >= 1));
      const covered = S.length > 0 && (byGroups || bySem);
      return { covered, hits, groupsHit: gh, need: p.need, sim, via: covered ? (byGroups && bySem ? 'both' : byGroups ? 'concepts' : 'meaning') : null, must: !!p.must };
    });
    const n = pts.length, c = pts.filter(p => p.covered).length;
    const needN = Math.ceil(n * 0.6);
    const mustOk = pts.every(p => !p.must || p.covered);
    return { points: pts, covered: c, total: n, needN, pass: c >= needN && mustOk, mustOk };
  }
  /** scoreLevel(slide, level, transcript, sims) — level: 'detailed' | 'concise' | 'kp'
   *  slide: {points, detailed[], concise[], keywords[]}; sims: {pts:[], sents:[]} or null */
  // on-slide keywords: extra weight on reading the slide's own words/numbers
  function kwScore(slide, level, transcript) {
    const kws = (slide.slideKw && slide.slideKw[level]) || [];
    const S = A.normalize(String(transcript || '').replace(/(\d)x\b/g, '$1 times'));
    const hits = kws.map(k => S.length > 0 && phraseHit(k, S));
    const n = hits.filter(Boolean).length;
    return { kw: kws, kwHits: hits, kwFrac: kws.length ? n / kws.length : 1, kwNeed: kws.length ? KWNEED[level] : 0 };
  }
  function scoreLevel(slide, level, transcript, sims) {
    const kpRes = score({ points: slide.points }, transcript, sims ? sims.pts : null);
    const kw = kwScore(slide, level, transcript); const kwOk = kw.kwFrac >= kw.kwNeed;
    if (level === 'kp') return Object.assign({}, kpRes, kw, { level, sentences: null, kpPass: kpRes.pass, kwOk, pass: kpRes.pass && kwOk });
    const sents = level === 'detailed' ? slide.detailed : slide.concise;
    const spoken = A.normalize(transcript || '').length > 0;
    const lex = A.score(sents, transcript || '', slide.keywords || [], TS.lex);
    const sres = sents.map((t, i) => {
      const cov = lex.sentences[i].coverage; const sim = sims && sims.sents ? sims.sents[i] : null;
      const byLex = cov >= TS.lex, bySem = sim != null && (sim >= TS.hi || (sim >= TS.lo && cov >= TS.lexLo));
      return { text: t, cov, sim, covered: spoken && (byLex || bySem), via: byLex ? 'words' : bySem ? 'meaning' : null, missed: lex.sentences[i].missed };
    });
    const frac = sres.length ? sres.filter(x => x.covered).length / sres.length : 0;
    const need = NEED[level];
    return Object.assign({}, kpRes, kw, { level, sentences: sres, sentFrac: frac, sentNeed: need, kpPass: kpRes.pass, kwOk, pass: kpRes.pass && frac >= need && kwOk });
  }
  const api = { score, scoreLevel, kwScore, windows, phraseHit, TH, TS, NEED, KWNEED };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KPScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
