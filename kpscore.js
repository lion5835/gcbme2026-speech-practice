/* Key-point (meaning) scoring. Browser: window.KPScore ; Node: module.exports */
(function (root) {
  const A = root.Align || (typeof require !== 'undefined' ? require('./align.js') : null);
  const TH = { hi: 0.78, lo: 0.70 }; // embedding thresholds (tuned in tune/tune.js)
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
  function windows(transcript, modelSentence) {
    const W = String(transcript).split(/\s+/).filter(Boolean);
    const L = Math.max(8, Math.min(30, modelSentence.split(/\s+/).length + 4));
    if (W.length <= L) return W.length ? [W.join(' ')] : [];
    const out = []; for (let i = 0; i < W.length; i += 4) { out.push(W.slice(i, i + L).join(' ')); if (i + L >= W.length) break; }
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
  const api = { score, windows, phraseHit, TH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KPScore = api;
})(typeof window !== 'undefined' ? window : globalThis);
