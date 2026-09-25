async (page) => {
// Shared helpers, inlined into each run by the verify scripts (run_code can't import).
async function openStory(browser, { w, h, novt, reduced }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  if (novt) await p.addInitScript(() => { delete window.ViewTimeline; });
  await p.goto('http://localhost:5173/');
  await p.waitForTimeout(1200);
  const story = await p.evaluate(() => { const s = document.getElementById('story'); const r = s.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height, vh: innerHeight }; });
  const to = async (q, wait = 900) => { await p.evaluate(({ story, q }) => scrollTo(0, story.top + q * (story.h - story.vh)), { story, q }); await p.waitForTimeout(wait); };
  return { ctx, p, story, to };
}

async function pick(p, to, driver) {
  await to(0.1);
  const scene = p.locator('section[aria-label="Pick a race"]');
  const change = scene.getByRole('button', { name: 'Change race' });
  if (await change.count()) await change.click();
  await scene.locator('button', { hasText: 'Italian Grand Prix' }).click();
  await scene.locator('button', { hasText: driver }).waitFor();
  await scene.locator('button', { hasText: driver }).click();
  await p.waitForTimeout(600);
}

async function scene5Outcome(p, to) {
  await to(0.7, 1200);
  await to(0.9, 1200);
  await p.locator('section[aria-label="Result: hypothetical vs actual"]').getByText(/P\d/).first().waitFor({ timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  return p.evaluate(() => document.querySelector('[data-tint-layer="glow"][data-tint-scene="5"]').dataset.tintColor);
}
  const browser = await page.context().browser().browserType().launch({ channel: 'chrome', headless: true, args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const DIR = (process.env.SHOT_DIR || '.playwright-mcp') + '/';
  const results = {};

  const COLOR_FNS = () => {
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    window.__rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    window.__lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    window.__contrast = (a, b) => { const [x, y] = [window.__lum(a), window.__lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    window.__over = (top, alpha, bottom) => top.slice(0, 3).map((v, i) => v * alpha + bottom[i] * (1 - alpha));
    // Combined occlusion at a viewport y from every heading-occlusion layer's computed
    // gradient stops, box and opacity: 1 - product of (1 - o * opacity).
    window.__occlusionAt = () => {
      const layers = [...document.querySelectorAll('[data-heading-occlusion]')].map((el) => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const stops = [...cs.backgroundImage.matchAll(/rgba?\(([^)]*)\)\s+([\d.-]+)px/g)].map((m) => { const p = m[1].split(',').map(Number); return [parseFloat(m[2]), p.length > 3 ? p[3] : 1]; });
        return { top: r.top, height: r.height, op: +cs.opacity, stops };
      });
      return (y) => {
        let keep = 1;
        for (const L of layers) {
          const v = y - L.top; if (v < 0 || v > L.height) continue;
          const s = L.stops; let o = s[s.length - 1][1];
          for (let i = 1; i < s.length; i++) if (v <= s[i][0]) { const [y0, o0] = s[i - 1], [y1, o1] = s[i]; o = y1 === y0 ? o1 : o0 + (o1 - o0) * (v - y0) / (y1 - y0); break; }
          keep *= 1 - o * L.op;
        }
        return 1 - keep;
      };
    };
  };

  // Worst case under every heading element of the active scene: the highest mask alpha
  // anywhere in the element's box, times full glow + outline + line + dot strength.
  const headingContrast = (p) => p.evaluate(() => {
    const active = [...document.querySelectorAll('#story section[aria-label]')].find((s) => s.getAttribute('aria-hidden') !== 'true');
    const sceneNo = +active.dataset.storyScene + 1;
    const occ = window.__occlusionAt();
    const frames = [...document.querySelectorAll('[data-track-frame]')];
    const fr = frames.reduce((a, b) => (+getComputedStyle(b).opacity > +getComputedStyle(a).opacity ? b : a));
    const lineEl = fr.querySelector(`[data-tint-layer="line"][data-tint-scene="${sceneNo}"]`);
    const dotEl = fr.querySelector(`[data-tint-layer="dot"][data-tint-scene="${sceneNo}"]`);
    const glowEl = document.querySelector(`[data-tint-layer="glow"][data-tint-scene="${sceneNo}"]`);
    const outline = fr.querySelector('[data-track-layer="outline"]');
    const base = window.__rgba(getComputedStyle(document.querySelector('[data-story-backdrop]')).backgroundColor);
    const glow = window.__rgba(getComputedStyle(glowEl).backgroundImage.match(/rgba?\([^)]+\)/)[0]);
    const layers = [
      [glow, glow[3]],
      [window.__rgba(getComputedStyle(outline).stroke), +getComputedStyle(outline).strokeOpacity],
      [window.__rgba(getComputedStyle(lineEl).stroke), +getComputedStyle(lineEl).opacity],
      [window.__rgba(getComputedStyle(dotEl).fill), +getComputedStyle(dotEl).opacity],
    ];
    const art = layers.reduce((acc, [c, al]) => window.__over(c, al, acc), base);
    // Any-tint worst case: the same stack in white at full strength (0.16/0.07/0.3/0.45).
    const white = [[255, 255, 255, 1], 0.16, [255, 255, 255, 1], 0.07, [255, 255, 255, 1], 0.3, [255, 255, 255, 1], 0.45];
    let artWhite = base; for (let i = 0; i < white.length; i += 2) artWhite = window.__over(white[i], white[i + 1], artWhite);
    const rows = [...active.querySelectorAll('[data-scene-heading]')].map((el) => {
      const r = el.getBoundingClientRect();
      let o = 1; for (let y = r.top; y <= r.bottom; y += 1) o = Math.min(o, occ(y));
      const text = window.__rgba(getComputedStyle(el).color);
      return { el: el.dataset.sceneHeading, box: [Math.round(r.top), Math.round(r.bottom)], minOcclusion: +o.toFixed(3), backdropKept: +(1 - o).toFixed(3), worstContrast: window.__contrast(text, window.__over(base, o, art)), anyTintWorst: window.__contrast(text, window.__over(base, o, artWhite)), withoutOcclusion: window.__contrast(text, art) };
    });
    return { scene: sceneNo, layerAlphas: layers.map(([, al]) => +al.toFixed(3)), rows };
  });

  const geometry = (p) => p.evaluate(() => {
    const active = [...document.querySelectorAll('#story section[aria-label]')].find((s) => s.getAttribute('aria-hidden') !== 'true');
    const cards = [];
    for (const el of active.querySelectorAll('*')) {
      if (window.__rgba(getComputedStyle(el).backgroundColor)[3] >= 0.9) { const r = el.getBoundingClientRect(); if (r.width > 40 && r.height > 40) cards.push([r.left, r.top, r.right, r.bottom]); }
    }
    const frames = [...document.querySelectorAll('[data-track-frame]')];
    const fr = frames.reduce((a, b) => (+getComputedStyle(b).opacity > +getComputedStyle(a).opacity ? b : a));
    const path = fr.querySelector('[data-track-layer="outline"]');
    const ctm = path.getScreenCTM();
    const total = path.getTotalLength();
    const N = 1000;
    const pts = [];
    for (let i = 0; i <= N; i++) { const q = path.getPointAtLength((total * i) / N); pts.push(new DOMPoint(q.x, q.y).matrixTransform(ctm)); }
    const inBox = (pt, [l, t, r, b]) => pt.x >= l && pt.x <= r && pt.y >= t && pt.y <= b;
    const vis = (pt) => pt.x >= 0 && pt.x <= innerWidth && pt.y >= 0 && pt.y <= innerHeight && !cards.some((c) => inBox(pt, c));
    const occ = window.__occlusionAt();
    let len = 0, visLen = 0, kept = 0;
    for (let i = 0; i < N; i++) { const a = pts[i], b = pts[i + 1]; const d = Math.hypot(b.x - a.x, b.y - a.y); const q = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; len += d; if (vis(q)) { visLen += d; kept += d * (1 - occ(q.y)); } }
    const svg = fr.querySelector('svg').getBoundingClientRect();
    const pathBox = path.getBoundingClientRect();
    return { frame: fr.dataset.trackFrame, unobscuredPct: +(100 * visLen / len).toFixed(1), afterOcclusionPct: +(100 * kept / len).toFixed(1), pathWidthPct: +(100 * pathBox.width / innerWidth).toFixed(1), pathCentreX: Math.round(pathBox.left + pathBox.width / 2), svgCentreX: Math.round(svg.left + svg.width / 2) };
  });

  const tintsNow = (p) => p.evaluate(() => {
    const out = {};
    for (let s = 1; s <= 5; s++) out[s] = getComputedStyle(document.querySelector(`[data-tint-layer="line"][data-tint-scene="${s}"]`)).stroke;
    return out;
  });
  // Opacity of each scene's line layer (visible frame), for crossfade-vs-cut checks.
  const lineOpacities = (p) => p.evaluate(() => {
    const frames = [...document.querySelectorAll('[data-track-frame]')];
    const fr = frames.reduce((a, b) => (+getComputedStyle(b).opacity > +getComputedStyle(a).opacity ? b : a));
    return [1, 2, 3, 4, 5].map((s) => +(+getComputedStyle(fr.querySelector(`[data-tint-layer="line"][data-tint-scene="${s}"]`)).opacity).toFixed(3));
  });
  const dashoffsets = (p) => p.evaluate(() => [...document.querySelectorAll('[data-tint-layer="line"]')].map((l) => getComputedStyle(l).strokeDashoffset).filter((v, i, a) => a.indexOf(v) === i));

  try {
    const configs = [];
    for (const [w, h] of [[390, 844], [1280, 800]]) for (const reduced of [false, true]) for (const novt of [false, true]) configs.push({ w, h, reduced, novt });
    for (const { w, h, reduced, novt } of configs) {
      const tag = `${w === 390 ? 'm' : 'd'}-${novt ? 'novt' : 'vt'}${reduced ? '-rm' : ''}`;
      const { ctx, p, to, story } = await openStory(browser, { w, h, novt, reduced });
      p.setDefaultTimeout(30000);
      const r = { log: [] };
      results[tag] = r;
      try {
      await p.evaluate(COLOR_FNS);
      r.viewTimeline = await p.evaluate(() => 'ViewTimeline' in window);
      r.reducedMotion = await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      await pick(p, to, 'Carlos Sainz'); r.log.push('picked');

      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(1200);
      await p.screenshot({ path: `${DIR}v3-${tag}-0-hero.png` });
      r.contrast = []; r.geometry = []; r.bandVsHeading = [];
      for (let i = 0; i < 5; i++) {
        await to((i + 0.5) / 5, 1500);
        if (i === 4) { await p.locator('section[aria-label="Result: hypothetical vs actual"]').getByText(/P\d/).first().waitFor({ timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500); }
        await p.screenshot({ path: `${DIR}v3-${tag}-${i + 1}.png` });
        const c = await headingContrast(p);
        r.contrast.push(c); r.log.push('scene ' + (i + 1));
        r.geometry.push(await geometry(p));
      }
      r.tintsWin = await tintsNow(p);
      r.chart = await p.evaluate(() => {
        const s5 = document.querySelector('section[aria-label="Result: hypothetical vs actual"]');
        const red = [...s5.querySelectorAll('path.recharts-curve')].find((e) => window.__rgba(getComputedStyle(e).stroke).slice(0, 3).join() === '239,68,68');
        if (!red) return 'red line not found';
        const card = red.closest('.bg-neutral-900');
        let op = 1; for (let e = card; e && e !== s5.parentElement; e = e.parentElement) op *= +getComputedStyle(e).opacity;
        return { cardBgAlpha: window.__rgba(getComputedStyle(card).backgroundColor)[3], opacityChain: +op.toFixed(3), contrast: window.__contrast(window.__rgba(getComputedStyle(red).stroke), window.__rgba(getComputedStyle(card).backgroundColor)) };
      });

      // Seam behaviour: each scene's line opacity just either side of the 3→4 seam.
      const seam = 3 / 5;
      await to(seam - 0.012, 700); const before = await lineOpacities(p);
      await to(seam, 700); const at = await lineOpacities(p);
      await to(seam + 0.012, 700); const after = await lineOpacities(p);
      r.seam34 = { before, at, after };

      if (reduced) {
        // Fully drawn and static: dashoffset at the top, mid-story and bottom, and twice
        // at the same spot 600ms apart.
        const draw = {};
        await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(800); draw.top = await dashoffsets(p);
        await to(0.5, 50); draw.midImmediate = await dashoffsets(p); await p.waitForTimeout(600); draw.midLater = await dashoffsets(p);
        await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(800); draw.bottom = await dashoffsets(p);
        r.draw = draw;
      }

      await pick(p, to, 'Charles Leclerc');
      await to(0.7, 1200); await to(0.9, 1200);
      await p.locator('section[aria-label="Result: hypothetical vs actual"]').getByText(/P\d/).first().waitFor({ timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(1500);
      await p.screenshot({ path: `${DIR}v3-${tag}-5-loss.png` });
      r.tintsLoss = await tintsNow(p);
      r.contrastLoss = await headingContrast(p);
      r.log.push('done');
      } catch (e) { r.log.push('ERR ' + e.message.slice(0, 200)); }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return results;
}
