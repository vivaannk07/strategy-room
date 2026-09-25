// Parameterised by a CFG line prepended at run time.
async (page) => {
  const out = { cfg: CFG, states: {}, draw: {} };
  const p = await page.context().newPage();
  await p.setViewportSize({ width: CFG.w, height: CFG.h });
  if (CFG.noVT) {
    await p.addInitScript(() => {
      delete window.ViewTimeline
      delete window.ScrollTimeline
    });
  }
  await p.goto('http://localhost:5173/');
  await p.waitForTimeout(1200);
  out.nativeTimeline = await p.evaluate(() => ({ view: 'ViewTimeline' in window, scroll: 'ScrollTimeline' in window }));

  const geo = await p.evaluate(() => {
    const s = document.getElementById('story');
    return { top: s.offsetTop, range: s.offsetHeight - innerHeight, max: document.documentElement.scrollHeight - innerHeight };
  });
  const toProgress = async (prog, settle = 1400) => {
    await p.evaluate((y) => window.scrollTo(0, y), Math.round(geo.top + prog * geo.range));
    await p.waitForTimeout(settle);
  };

  const measure = () => p.evaluate(() => {
    const svg = document.querySelector('[data-story-track]');
    const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => ({ el, cs: getComputedStyle(el) }))
      .reduce((a, b) => (+b.cs.opacity > +a.cs.opacity ? b : a));
    const line = pick('[data-tint-layer=line]');
    const dot = pick('[data-tint-layer=dot]');
    const glow = pick('[data-tint-layer=glow]');
    const outline = svg.querySelector('[data-track-layer=outline]');
    const r = outline.getBoundingClientRect();
    const stageW = document.documentElement.clientWidth;
    const stageH = document.querySelector('#story .sticky').getBoundingClientRect().height;
    const story = document.getElementById('story');
    const inHero = scrollY < story.offsetTop;
    const section = document.querySelector('#story section[aria-hidden="false"]');
    const heading = inHero ? document.querySelector('main h1') : section?.querySelector('h2');
    const hr = heading?.getBoundingClientRect();
    // Does any point on the circuit's stroke fall inside the heading box?
    const ctm = outline.getScreenCTM();
    const total = outline.getTotalLength();
    let crossings = 0;
    if (hr) for (let i = 0; i <= 800; i++) {
      const pt = outline.getPointAtLength((total * i) / 800).matrixTransform(ctm);
      if (pt.x >= hr.left - 2 && pt.x <= hr.right + 2 && pt.y >= hr.top - 2 && pt.y <= hr.bottom + 2) crossings++;
    }
    const backdropLayer = document.querySelector('[data-story-backdrop]').parentElement;
    const bl = getComputedStyle(backdropLayer);
    return {
      scrollY,
      scene: inHero ? 'hero' : section?.getAttribute('aria-label'),
      line: { scene: line.el.dataset.tintScene, stroke: line.cs.stroke, opacity: +line.cs.opacity, width: line.cs.strokeWidth, dashoffset: parseFloat(line.cs.strokeDashoffset) },
      drawnFraction: +(1 - parseFloat(line.cs.strokeDashoffset) / 1000).toFixed(4),
      dot: { fill: dot.cs.fill, opacity: +dot.cs.opacity },
      glow: { opacity: +glow.cs.opacity, color: glow.el.dataset.tintColor },
      outline: { stroke: getComputedStyle(outline).stroke, strokeOpacity: getComputedStyle(outline).strokeOpacity, width: getComputedStyle(outline).strokeWidth },
      loop: {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        margins: { left: Math.round(r.left), right: Math.round(stageW - r.right), top: Math.round(r.top), bottom: Math.round(stageH - r.bottom) },
        widthPct: +(r.width / stageW * 100).toFixed(1),
        centreOffset: { x: Math.round(r.x + r.width / 2 - stageW / 2), y: Math.round(r.y + r.height / 2 - stageH / 2) },
      },
      heading: hr ? { text: heading.textContent.slice(0, 40), y: Math.round(hr.top), bottom: Math.round(hr.bottom), crossings } : null,
      layer: { position: bl.position, zIndex: bl.zIndex, pointerEvents: bl.pointerEvents, svgPointerEvents: getComputedStyle(svg).pointerEvents },
    };
  });

  // Brightest background pixel behind an element, with the element's own paint hidden.
  const maxBgLum = async (selector, hideCss) => {
    const box = await p.evaluate(({ selector, hideCss }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = document.createElement('style');
      style.id = 'probe-hide';
      style.textContent = hideCss;
      document.head.appendChild(style);
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, innerWidth - r.x), height: Math.min(r.height, innerHeight - r.y) };
    }, { selector, hideCss });
    if (!box || box.width < 1 || box.height < 1) return null;
    await p.waitForTimeout(50);
    const buf = await p.screenshot({ clip: box, scale: 'css' });
    await p.evaluate(() => document.getElementById('probe-hide')?.remove());
    return p.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      let max = 0, px = null;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
        if (L > max) { max = L; px = [d[i], d[i + 1], d[i + 2]]; }
      }
      return { maxLum: max, px };
    }, buf.toString('base64'));
  };
  const lumOf = (css) => p.evaluate((css) => {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = css; c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }, css);
  const ratio = (a, b) => +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);

  const headingContrast = async (inHero) => {
    const sel = inHero ? 'main h1' : '#story section[aria-hidden="false"] h2';
    const color = await p.evaluate((s) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).color, sel);
    if (!color) return null;
    const bg = await maxBgLum(sel, `${sel} { color: transparent !important; }`);
    return { color, worstBg: bg.px, ratio: ratio(await lumOf(color), bg.maxLum) };
  };
  const chartContrast = async () => {
    const sel = '#story section[aria-hidden="false"] .recharts-wrapper';
    const info = await p.evaluate((s) => {
      const w = document.querySelector(s);
      if (!w) return null;
      const lines = [...w.querySelectorAll('.recharts-line-curve, .recharts-area-curve')].map((e) => getComputedStyle(e).stroke).filter((c) => c && c !== 'none');
      const ticks = [...w.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((e) => getComputedStyle(e).fill);
      return { lines: [...new Set(lines)], ticks: [...new Set(ticks)] };
    }, sel);
    if (!info) return null;
    const bg = await maxBgLum(sel, `${sel} * { visibility: hidden !important; }`);
    const rows = [];
    for (const c of [...info.lines, ...info.ticks]) rows.push({ color: c, ratio: ratio(await lumOf(c), bg.maxLum) });
    return { worstBg: bg.px, rows };
  };

  const shot = async (name) => {
    if (CFG.shots) await p.screenshot({ path: `.playwright-mcp/${CFG.tag}-${name}.png`, scale: 'css' });
  };

  // Hero.
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(1400);
  out.states.hero = await measure();
  out.states.hero.headingContrast = await headingContrast(true);
  await shot('0-hero');

  // Scene 1: pick race + driver.
  await toProgress(0.1);
  await p.locator('#story section[aria-label="Pick a race"] button', { hasText: 'Italian Grand Prix' }).click();
  await p.locator('#story section[aria-label="Pick a race"] button[aria-pressed]', { hasText: CFG.driverName }).first().click();
  await p.waitForTimeout(1500);
  out.states.s1 = await measure();
  out.states.s1.headingContrast = await headingContrast(false);
  await shot('1-pick');

  await toProgress(0.3);
  await p.waitForTimeout(800);
  out.states.s2 = await measure();
  out.states.s2.headingContrast = await headingContrast(false);
  out.states.s2.chartContrast = await chartContrast();
  await shot('2-actual');

  await toProgress(0.5);
  await p.locator(`#story section[aria-label="Change the pit strategy"] input[value="${CFG.compound}"]`).check({ force: true });
  if (CFG.lap) await p.locator('#story section[aria-label="Change the pit strategy"] input[type=range]').fill(String(CFG.lap));
  await p.waitForTimeout(1000);
  out.states.s3 = await measure();
  out.states.s3.headingContrast = await headingContrast(false);
  out.states.s3.chartContrast = await chartContrast();
  await shot('3-change');

  const sim = p.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 30000 }).catch(() => null);
  await toProgress(0.7);
  const res = await sim;
  out.simulate = res ? { status: res.status(), delta: (await res.json())?.simulated?.delta_vs_actual_seconds } : 'no request';
  await p.waitForTimeout(800);
  out.states.s4 = await measure();
  out.states.s4.headingContrast = await headingContrast(false);
  out.states.s4.chartContrast = await chartContrast();
  await shot('4-sim');

  await toProgress(0.9, 2200);
  out.states.s5 = await measure();
  out.states.s5.headingContrast = await headingContrast(false);
  out.states.s5.chartContrast = await chartContrast();
  await shot('5-result');

  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(1400);
  out.states.footer = await measure();
  await shot('6-footer');

  for (const prog of [0, 0.25, 0.5, 0.75, 1]) {
    await toProgress(prog, 1800);
    const m = await measure();
    out.draw[prog] = { dashoffset: m.line.dashoffset, drawnFraction: m.drawnFraction };
  }

  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  out.errors = errors;
  await p.close();

  // Compact the states for reading.
  for (const [k, s] of Object.entries(out.states)) {
    out.states[k] = {
      scene: s.scene, stroke: s.line.stroke, lineScene: s.line.scene, lineOpacity: s.line.opacity, lineWidth: s.line.width,
      drawn: s.drawnFraction, dot: s.dot, glow: s.glow, loop: s.loop, heading: s.heading,
      headingContrast: s.headingContrast, chartContrast: s.chartContrast,
      ...(k === 'hero' ? { outline: s.outline, layer: s.layer } : {}),
    };
  }
  return out;
}
