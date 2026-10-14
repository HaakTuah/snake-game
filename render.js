// The canvas renderer for Bark & Bite.
//
// The board is drawn in a fixed logical space of GRID cells of CELL units
// (768 × 768). The canvas backing store is sized to the board's real size ×
// devicePixelRatio, so everything stays crisp, and one transform maps logical
// units to device pixels.
//
// Cost control, measured in Chrome's GPU process as well as in script: the
// bark, grid lines and holes live on a prerendered static layer; food, meat,
// the woodpecker and the "+1"s are cached sprites; particles come from a fixed
// pool; colours come from cached ramps. Bodies are drawn as rectangles, then
// circles: separate fills batch into one GPU operation, while one path of many
// circles is triangulated every frame and strokes between circles break the
// batch. The per-frame path builds no strings and no closures.
window.SnakeRender = (() => {
  const T = window.TUNING;
  const GRID = T.GRID;
  const CELL = 32;
  const SIZE = GRID * CELL;
  const BARK = '#5a3b22';
  const INK = '#0b1210';
  const TAU = Math.PI * 2;

  let canvas, ctx, PERSONAS;
  let devPerCss = 1;         // device pixels per CSS pixel on the board
  let shakeX = 0, shakeY = 0; // this frame's shake, in device pixels
  let viewerId = -1; // your snake on this screen (it gets the bright outline), -1 if none
  let k = 1;                 // device pixels per logical unit
  let reduced = false;       // prefers-reduced-motion
  let game = null;

  // ------------------------------------------------------------ utilities

  // Blend two #rrggbb colors; t = 0 gives a, t = 1 gives b. Results are cached,
  // so calling this with the same arguments every frame costs a lookup.
  const mixCache = new Map();
  function mix(a, b, t) {
    const key = a + b + t;
    let out = mixCache.get(key);
    if (out) return out;
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    out = '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    mixCache.set(key, out);
    return out;
  }

  // Perceived brightness 0..1 of a #rrggbb color.
  function luma(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }


  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function makeLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // ------------------------------------------------------------ the bark

  // The board is the top of a log lying on the forest floor under an apple
  // tree, seen from above, running from the top of the board to the bottom:
  // warm bark with its grain running along it (furrows, raised plates lit on
  // one edge, cracks, knots with growth rings), soft sun and shade from the
  // canopy, a little shadow down both sides where it rounds away, and moss
  // in small soft cushions, mostly down the sides. Drawn once per round at
  // the current resolution (a different stretch of log each round). The
  // moss is dark and olive, so it never passes for food.
  let barkLayer = null, staticLayer = null, holesDrawn = 0, sized = false;
  let barkSeed = 7;

  function buildBark() {
    const px = SIZE * k;
    const b = makeLayer(px, px);
    const g = b.getContext('2d');
    g.scale(k, k);
    let seed = barkSeed;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    g.fillStyle = BARK;
    g.fillRect(0, 0, SIZE, SIZE);
    // Patches of sun and shade from the canopy, very soft.
    for (let i = 0; i < 8; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 110 + rnd() * 170, sun = i % 3 !== 2;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, sun ? 'rgba(255,205,130,0.11)' : 'rgba(18,9,3,0.2)');
      grad.addColorStop(1, sun ? 'rgba(255,205,130,0)' : 'rgba(18,9,3,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // Furrows along the grain...
    for (let i = 0; i < 260; i++) {
      const dark = rnd() < 0.55;
      g.strokeStyle = dark ? `rgba(28,16,6,${0.15 + rnd() * 0.25})` : `rgba(150,108,66,${0.08 + rnd() * 0.15})`;
      g.lineWidth = 2 + rnd() * 10;
      let x = rnd() * SIZE, y = -20;
      g.beginPath();
      g.moveTo(x, y);
      while (y < SIZE + 20) { y += 30 + rnd() * 40; x += (rnd() - 0.5) * 14; g.lineTo(x, y); }
      g.stroke();
    }
    // ...raised plates between them, lit along their upper-left edge...
    for (let i = 0; i < 170; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, w = 5 + rnd() * 9, h = 18 + rnd() * 46, a = (rnd() - 0.5) * 0.2;
      g.fillStyle = `rgba(122,86,50,${0.1 + rnd() * 0.14})`;
      g.beginPath(); g.ellipse(x, y, w, h, a, 0, TAU); g.fill();
      g.strokeStyle = `rgba(196,154,102,${0.1 + rnd() * 0.12})`;
      g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(x, y, w, h, a, Math.PI * 0.85, Math.PI * 1.2); g.stroke();
    }
    // ...cracks, thin, dark and jagged...
    g.strokeStyle = 'rgba(16,8,2,0.45)';
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let x = rnd() * SIZE, y = rnd() * SIZE;
      g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0, n = 3 + rnd() * 4; j < n; j++) { x += (rnd() - 0.5) * 10; y += 6 + rnd() * 12; g.lineTo(x, y); }
      g.stroke();
    }
    // ...and knots, with the growth rings round them.
    for (let i = 0; i < 6; i++) {
      const x = rnd() * SIZE, y = rnd() * SIZE, r = 10 + rnd() * 16;
      const grad = g.createRadialGradient(x, y, 1, x, y, r);
      grad.addColorStop(0, 'rgba(20,10,3,0.8)');
      grad.addColorStop(0.6, 'rgba(60,36,16,0.5)');
      grad.addColorStop(1, 'rgba(60,36,16,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, r * 0.6, r, 0, 0, TAU);
      g.fill();
      g.lineWidth = 1.2;
      for (let j = 1; j <= 3; j++) {
        g.strokeStyle = `rgba(30,16,6,${0.28 - j * 0.06})`;
        g.beginPath(); g.ellipse(x, y, r * 0.6 + j * 4, r + j * 6, 0, 0, TAU); g.stroke();
      }
    }
    // The log rounds away down both sides: a little shadow there, and a soft
    // vignette, so the edge cells read as the edge of the log.
    const roll = g.createLinearGradient(0, 0, SIZE, 0);
    roll.addColorStop(0, 'rgba(8,5,2,0.34)');
    roll.addColorStop(0.15, 'rgba(8,5,2,0.04)');
    roll.addColorStop(0.5, 'rgba(255,214,150,0.04)');
    roll.addColorStop(0.85, 'rgba(8,5,2,0.04)');
    roll.addColorStop(1, 'rgba(8,5,2,0.34)');
    g.fillStyle = roll;
    g.fillRect(0, 0, SIZE, SIZE);
    const v = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.45, SIZE / 2, SIZE / 2, SIZE * 0.78);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = v;
    g.fillRect(0, 0, SIZE, SIZE);
    // Moss: small soft cushions, mostly down the sides (where it wraps round
    // the log), a few on top. Each is a clump of rounded tufts: a shadow under
    // it, a dark-green body, every tuft lit on its upper left and darker round
    // its edge, fuzz over it, and spore stalks out of the bigger ones.
    const MOSS = ['#344f1b', '#3a5520', '#2f4a1d', '#3d571a'];
    for (let i = 0; i < 12; i++) {
      const side = rnd() < 0.75;
      const x = side ? (rnd() < 0.5 ? rnd() * SIZE * 0.09 : SIZE - rnd() * SIZE * 0.09) : SIZE * (0.2 + rnd() * 0.6), y = rnd() * SIZE;
      const rx = side ? 10 + rnd() * 18 : 6 + rnd() * 9, ry = rx * (side ? 1.3 + rnd() * 0.7 : 1 + rnd() * 0.4);
      const bed = g.createRadialGradient(x, y, 0, x, y, ry * 1.15); // a soft bed, so it grows out of the bark
      bed.addColorStop(0, 'rgba(38,58,20,0.35)');
      bed.addColorStop(1, 'rgba(38,58,20,0)');
      g.fillStyle = bed;
      g.beginPath(); g.ellipse(x, y, rx * 1.2, ry * 1.15, 0, 0, TAU); g.fill();
      const tufts = [];
      for (let j = 0, n = 4 + Math.round(rx * ry / 22); j < n; j++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.85;
        tufts.push([x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, 3 + rnd() * Math.min(5, rx * 0.4)]);
      }
      tufts.sort((p, q) => p[1] - q[1]); // (back to front: nearer tufts overlap)
      const clump = (dx, dy, grow) => {
        g.beginPath();
        for (const [tx, ty, tr] of tufts) { g.moveTo(tx + dx + tr + grow, ty + dy); g.arc(tx + dx, ty + dy, tr + grow, 0, TAU); }
      };
      g.fillStyle = 'rgba(14,8,2,0.28)'; // its shadow on the bark
      clump(1, 2, 0.5); g.fill();
      g.fillStyle = MOSS[Math.floor(rnd() * MOSS.length)];
      clump(0, 0, 0); g.fill();
      for (const [tx, ty, tr] of tufts) {
        const lit = g.createRadialGradient(tx - tr * 0.35, ty - tr * 0.4, tr * 0.1, tx, ty, tr);
        lit.addColorStop(0, 'rgba(128,156,78,0.38)');
        lit.addColorStop(0.55, 'rgba(90,120,48,0.1)');
        lit.addColorStop(1, 'rgba(18,30,8,0.22)');
        g.fillStyle = lit;
        dot(tx, ty, tr);
      }
      for (const [tx, ty, tr] of tufts) { // fuzz: tiny fronds, light and dark
        for (let j = 0; j < tr * 2; j++) {
          const a = rnd() * TAU, d = tr * (0.2 + rnd() * 0.9);
          g.fillStyle = rnd() < 0.5 ? 'rgba(126,154,76,0.4)' : 'rgba(24,40,12,0.4)';
          dot(tx + Math.cos(a) * d, ty + Math.sin(a) * d, 0.5 + rnd() * 0.8);
        }
      }
      if (rx > 18) { // spore stalks, each with its little capsule
        g.lineWidth = 0.9;
        for (let j = 0, n = 2 + Math.floor(rnd() * 4); j < n; j++) {
          const [tx, ty, tr] = tufts[Math.floor(rnd() * tufts.length)];
          const sx = tx + (rnd() - 0.5) * tr, sy = ty + (rnd() - 0.5) * tr, ex = sx + (rnd() - 0.5) * 5, ey = sy - 5 - rnd() * 5;
          g.strokeStyle = 'rgba(120,70,30,0.85)';
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
          g.fillStyle = '#93522a';
          g.beginPath(); g.ellipse(ex, ey, 1.1, 1.7, (ex - sx) * 0.1, 0, TAU); g.fill();
        }
      }
    }
    // (No grid lines: the log is just a log. Everything on it still sits on
    // the cells, so the cells are still easy to read.)
    return b;
  }

  // Leaf shadows from the canopy overhead: soft dark dapples on a small layer
  // (it's all soft, so a low resolution is plenty), drawn stretched over the
  // board and swaying in the wind. Built once per round.
  let shadeLayer = null;
  function buildShade() {
    const n = 256, s = makeLayer(n, n), g = s.getContext('2d');
    let seed = barkSeed * 7 + 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 22; i++) {
      const cx = rnd() * n, cy = rnd() * n;
      for (let j = 0; j < 6; j++) {
        const x = cx + (rnd() - 0.5) * 34, y = cy + (rnd() - 0.5) * 34, r = 5 + rnd() * 10;
        const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.4);
        grad.addColorStop(0, 'rgba(12,6,2,0.2)');
        grad.addColorStop(1, 'rgba(12,6,2,0)');
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd() * Math.PI, 0, TAU); g.fill();
      }
    }
    return s;
  }
  // Snow settling on the bark: soft white drifts (a small soft layer, stretched
  // over the board, like the canopy's shadows), whiter the longer it snows.
  let drifts = null;
  function buildDrifts() {
    const n = 384, d = makeLayer(n, n), g = d.getContext('2d');
    let seed = barkSeed * 13 + 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgba(236,244,255,0.16)'; // a dusting everywhere...
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 34; i++) { // ...and drifts, long along the grain, each a few lumps: a blue shadow under them, each lump lit on top
      const x = rnd() * n, y = rnd() * n, lumps = [];
      for (let j = 0, m = 2 + Math.floor(rnd() * 4); j < m; j++) {
        const rx = 6 + rnd() * 14;
        lumps.push([x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 8, rx, rx * (0.4 + rnd() * 0.25)]);
      }
      g.fillStyle = 'rgba(120,146,186,0.28)';
      g.beginPath();
      for (const [lx, ly, rx, ry] of lumps) { g.moveTo(lx + 1 + rx, ly + ry * 0.45); g.ellipse(lx + 1, ly + ry * 0.45, rx, ry, 0, 0, TAU); }
      g.fill();
      for (const [lx, ly, rx, ry] of lumps) {
        const grad = g.createRadialGradient(lx - rx * 0.25, ly - ry * 0.35, 0, lx, ly, rx);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.7, 'rgba(242,247,255,0.95)');
        grad.addColorStop(0.92, 'rgba(226,236,250,0.7)');
        grad.addColorStop(1, 'rgba(226,236,250,0)');
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(lx, ly, rx, ry, 0, 0, TAU); g.fill();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.95)'; // and glints
    for (let i = 0; i < 140; i++) { g.beginPath(); g.arc(rnd() * n, rnd() * n, 0.6, 0, TAU); g.fill(); }
    return d;
  }
  function drawSnowCover() {
    if (snowCover < 0.02) return;
    if (!drifts) drifts = buildDrifts();
    ctx.globalAlpha = 0.8 * snowCover;
    ctx.drawImage(drifts, 0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;
  }

  // Falling snow: a seamless sheet of flakes, drifting down and swaying, in two layers.
  let snowTile = null;
  function buildSnowTile() {
    const n = RAIN_TILE, t = makeLayer(n * k, n * k), g = t.getContext('2d');
    g.scale(k, k);
    let seed = 77;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * n, y = rnd() * n, r = 1.4 + rnd() * 2.6;
      g.fillStyle = `rgba(255,255,255,${0.55 + rnd() * 0.4})`;
      for (const dx of [0, -n, n]) for (const dy of [0, -n, n]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, TAU); g.fill(); }
    }
    return t;
  }
  function drawSnow(now) {
    if (sky.snow < 0.02 || reduced) return;
    if (!snowTile) snowTile = buildSnowTile();
    const n = RAIN_TILE;
    for (const [speed, alpha, sway] of quality === 2 ? SNOW_LAYERS : SNOW_LAYER) {
      const oy = (now * speed) % n, ox = (Math.sin(now / 1700 * speed * 4) * 30 + now * speed * 0.15) % n;
      ctx.globalAlpha = sky.snow * alpha;
      for (let y = oy - n; y < SIZE; y += n) for (let x = ox - n; x < SIZE; x += n) ctx.drawImage(snowTile, x, y, n * sway, n * sway);
    }
    ctx.globalAlpha = 1;
  }
  const SNOW_LAYERS = [[0.06, 1, 1], [0.1, 0.7, 1]], SNOW_LAYER = [[0.06, 1, 1]];

  // In the cold, every snake's breath shows: a little puff now and then.
  const breathAt = new WeakMap();
  function breathe(now) {
    if (reduced) return;
    for (const s of game.snakes) {
      if (!s.alive || now < (breathAt.get(s) || 0)) continue;
      breathAt.set(s, now + 1100 + Math.random() * 900);
      const h = s.body[0], x = h.x * CELL + CELL / 2 + s.dir.x * CELL * 0.55, y = h.y * CELL + CELL / 2 + s.dir.y * CELL * 0.55;
      for (let i = 0; i < 2; i++) mote(x, y, s.dir.x * 14 + (Math.random() - 0.5) * 6, s.dir.y * 14 - 6, 900, 3 + Math.random() * 2, 0);
    }
  }

  // Burning leaves blown downwind: each arcs from its fire to where it lands,
  // spinning, trailing sparks.
  function drawEmbers(now) {
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i], t = (now - e.at) / 650;
      if (t >= 1) { embers.splice(i, 1); continue; }
      const x0 = e.fx * CELL + CELL / 2, y0 = e.fy * CELL + CELL / 2, x1 = e.x * CELL + CELL / 2, y1 = e.y * CELL + CELL / 2;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * CELL * 1.6;
      const w = SPRITE * CELL * 0.9;
      ctx.drawImage(fireGlowSprite(), x - w / 2, y - w / 2, w, w);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 9);
      ctx.drawImage(leafSprite('#ea580c'), -SPRITE * CELL / 2, -SPRITE * CELL / 2, SPRITE * CELL, SPRITE * CELL);
      ctx.restore();
      if (!reduced && Math.random() < 0.5) mote(x, y, (Math.random() - 0.5) * 20, -10 - Math.random() * 20, 450, 1.4, 3);
    }
  }

  function drawCanopy(now) {
    if (quality < 2) return;
    if (!shadeLayer) shadeLayer = buildShade();
    const t = reduced ? 0 : now / 1000, over = SIZE * 0.06, gusty = 1 + 2.2 * (sky.wind + sky.storm);
    const dx = Math.sin(t * 0.43) * 8 + Math.sin(t * 1.7) * 1.6 * gusty * gusty, dy = Math.cos(t * 0.37) * 6 + Math.sin(t * 1.3) * 1.2 * gusty;
    ctx.drawImage(shadeLayer, dx - over, dy - over, SIZE + 2 * over, SIZE + 2 * over);
  }

  // Now and then an autumn leaf drifts down onto the log, swaying and turning
  // (under the food and the snakes, so it never hides anything that matters).
  const fallen = [];
  let nextLeaf = 0;
  const LEAVES = ['#d97706', '#ca8a04', '#b45309', '#a16207'];
  const leafSprite = c => sprite('leaf', c, drawLeaf);
  const drawLeaf = (g, col) => {
    const c = CELL;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-c * 0.3, 0);
    g.quadraticCurveTo(-c * 0.05, -c * 0.2, c * 0.3, 0);
    g.quadraticCurveTo(-c * 0.05, c * 0.2, -c * 0.3, 0);
    g.fill();
    g.strokeStyle = 'rgba(60,30,8,0.55)'; // the midrib and stalk
    g.lineWidth = c * 0.025;
    g.beginPath(); g.moveTo(-c * 0.38, 0); g.lineTo(c * 0.24, 0); g.stroke();
    g.beginPath();
    for (const x of [-0.12, 0.04]) { g.moveTo(c * x, 0); g.lineTo(c * (x + 0.08), -c * 0.08); g.moveTo(c * x, 0); g.lineTo(c * (x + 0.08), c * 0.08); }
    g.stroke();
  };
  function drawLeaves(now, dt) {
    if (reduced || quality === 0) { fallen.length = 0; return; }
    if (!nextLeaf) nextLeaf = now + 1500 + Math.random() * 3000;
    const blow = Math.max(sky.wind, sky.storm * 0.7); // (wind: leaves stream across from the left)
    if (blow > 0.3 && nextLeaf - now > 700) nextLeaf = now + 200; // (the wind gets up: leaves at once)
    if (now > nextLeaf && fallen.length < 3 + Math.round(blow * 9)) {
      nextLeaf = now + (blow > 0.3 ? 250 + Math.random() * 600 : 4500 + Math.random() * 6500);
      const gust = blow > 0.3;
      fallen.push({
        x: gust ? -CELL : SIZE * (0.1 + Math.random() * 0.8), y: gust ? Math.random() * SIZE * 0.9 : -CELL,
        vx: gust ? 160 + Math.random() * 120 : (Math.random() - 0.5) * 30, vy: gust ? 10 + Math.random() * 30 : 26 + Math.random() * 18,
        rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 1.4, ph: Math.random() * TAU, col: LEAVES[Math.floor(Math.random() * LEAVES.length)],
      });
    }
    const st = dt / 1000;
    for (let i = fallen.length - 1; i >= 0; i--) {
      const l = fallen[i], sway = Math.sin(now / 800 + l.ph);
      l.x += (l.vx + sway * 26) * st;
      l.y += l.vy * st;
      l.rot += (l.spin + Math.cos(now / 800 + l.ph) * 0.7) * st;
      if (l.y > SIZE + CELL || l.x < -CELL * 2 || l.x > SIZE + CELL * 2) { fallen.splice(i, 1); continue; }
      shadowAt(l.x + 7, l.y + 10, 1.1);
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.scale(1, 0.7 + 0.3 * Math.abs(sway)); // tipping as it sways
      ctx.drawImage(leafSprite(l.col), -SPRITE * CELL / 2, -SPRITE * CELL / 2, SPRITE * CELL, SPRITE * CELL);
      ctx.restore();
    }
  }

  // The static layer is the bark plus every hole pecked so far.
  function resetStatic() {
    if (!sized) { staticLayer = null; holesDrawn = 0; return; } // (built once the board has its real size)
    if (!barkLayer) barkLayer = buildBark();
    if (!staticLayer || staticLayer.width !== barkLayer.width) staticLayer = makeLayer(barkLayer.width, barkLayer.height);
    const g = staticLayer.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(barkLayer, 0, 0);
    holesDrawn = 0;
    scorchDrawn = 0; // (scorch marks are baked again too)
  }

  // Draw any holes added since last time onto the static layer (a Set keeps
  // insertion order, so new holes are always at the end).
  function syncHoles() {
    if (!game || game.holes.size === holesDrawn) return;
    if (game.holes.size < holesDrawn) resetStatic();
    const g = staticLayer.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    // The new holes (a whole chunk at a time) are gouges that run together:
    // first a ragged lighter rim round all of them, then the dark hollows.
    const fresh = [];
    let i = 0;
    for (const key of game.holes) if (i++ >= holesDrawn) fresh.push(key);
    for (let pass = 0; pass < 2; pass++) {
      for (const key of fresh) {
        const x = (key % GRID) * CELL + CELL / 2, y = Math.floor(key / GRID) * CELL + CELL / 2, j = (key * 37) % 7 / 7;
        if (!pass) {
          g.fillStyle = 'rgba(176,124,70,0.5)'; // torn wood round the edge
          g.beginPath(); g.ellipse(x, y, CELL * (0.66 + j * 0.08), CELL * (0.62 + (1 - j) * 0.08), j * 2, 0, TAU); g.fill();
          continue;
        }
        const grad = g.createRadialGradient(x, y, 1, x, y, CELL * 0.62);
        grad.addColorStop(0, '#070402');
        grad.addColorStop(0.75, '#1c1007');
        grad.addColorStop(1, '#3b2412');
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(x, y, CELL * (0.58 + j * 0.06), CELL * (0.55 + (1 - j) * 0.06), j * 2, 0, TAU);
        g.fill();
      }
    }
    holesDrawn = game.holes.size;
  }

  // -------------------------------------------------------------- sprites

  // Sprites are drawn once per resolution into small canvases centered on
  // their cell, SPRITE cells across, and blitted with one drawImage.
  const SPRITE = 2;
  const sprites = new Map(); // name -> variant (a colour, a label, or '') -> canvas

  function sprite(name, variant, draw) {
    let byVariant = sprites.get(name);
    if (!byVariant) sprites.set(name, byVariant = new Map());
    let s = byVariant.get(variant);
    if (s) return s;
    const size = Math.max(2, Math.round(SPRITE * CELL * k));
    s = makeLayer(size, size);
    const g = s.getContext('2d');
    const scale = size / (SPRITE * CELL);
    g.setTransform(scale, 0, 0, scale, size / 2, size / 2);
    draw(g, variant);
    byVariant.set(variant, s);
    return s;
  }

  // A sprite that isn't rotated, on whole device pixels: never resampled.
  function blitCrisp(s, x, y, alpha) {
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s, Math.round(x * k + shakeX - s.width / 2), Math.round(y * k + shakeY - s.height / 2));
    ctx.setTransform(k, 0, 0, k, shakeX, shakeY);
    if (alpha !== undefined) ctx.globalAlpha = 1;
  }

  function blit(s, x, y, alpha) {
    const half = SPRITE * CELL / 2;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(s, x - half, y - half, SPRITE * CELL, SPRITE * CELL);
    if (alpha !== undefined) ctx.globalAlpha = 1;
  }

  // (Food sprites have no shadow of their own: it's drawn apart, on the bark,
  // so the food can bob up off it.)
  const shadowSprite = () => sprite('shadow', '', drawShadowBlob);
  const drawShadowBlob = g => {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(0, 0, CELL * 0.29, CELL * 0.09, 0, 0, TAU); g.fill();
  };
  function shadowAt(x, y, scale) {
    const w = SPRITE * CELL * scale;
    ctx.drawImage(shadowSprite(), x - w / 2, y - w / 2, w, w);
  }

  function drawAppleShape(g, body, leaf = '#15803d') {
    const c = CELL;
    g.fillStyle = body;
    g.beginPath(); g.arc(0, c * 0.04, c * 0.34, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(30,20,8,0.45)';
    g.lineWidth = c * 0.05;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.arc(-c * 0.12, -c * 0.06, c * 0.08, 0, TAU); g.fill();
    g.strokeStyle = '#78350f';
    g.lineWidth = c * 0.07;
    g.beginPath(); g.moveTo(0, -c * 0.22); g.lineTo(c * 0.04, -c * 0.42); g.stroke();
    g.fillStyle = leaf;
    g.beginPath(); g.ellipse(c * 0.17, -c * 0.36, c * 0.14, c * 0.07, -0.5, 0, TAU); g.fill();
  }

  // An apple as it ages (it rots away in the end): fresh; bruised, with brown
  // spots; rotten, brown and wrinkled, its leaf dead. Or baked in a fire:
  // deep red, glazed and split, a little caramel oozing.
  const APPLE_LOOKS = { fresh: ['#84cc16', '#15803d'], bruised: ['#9fb53a', '#4d7c0f'], rotten: ['#8a6a2a', '#78716c'], baked: ['#9a3412', '#57534e'] };
  const drawApple = (g, v) => {
    const [body, leaf] = APPLE_LOOKS[v] || APPLE_LOOKS.fresh, c = CELL;
    drawAppleShape(g, body, leaf);
    if (v === 'bruised' || v === 'rotten') {
      g.fillStyle = v === 'rotten' ? 'rgba(66,38,12,0.6)' : 'rgba(110,66,20,0.5)';
      for (const [x, y, rr] of [[0.1, 0.12, 0.07], [-0.1, 0.18, 0.05], [0.17, -0.02, 0.045]]) { g.beginPath(); g.arc(c * x, c * y, c * rr, 0, TAU); g.fill(); }
    }
    if (v === 'rotten') { // wrinkles
      g.strokeStyle = 'rgba(52,30,10,0.6)';
      g.lineWidth = c * 0.03;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-c * 0.2, -c * 0.02); g.quadraticCurveTo(-c * 0.12, c * 0.06, -c * 0.2, c * 0.14);
      g.moveTo(c * 0.02, c * 0.24); g.quadraticCurveTo(c * 0.1, c * 0.16, c * 0.2, c * 0.22);
      g.stroke();
    }
    if (v === 'baked') { // glazed and split, caramel in the split
      g.strokeStyle = '#fbbf24';
      g.lineWidth = c * 0.05;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(-c * 0.06, c * 0.02); g.lineTo(c * 0.02, c * 0.12); g.lineTo(-c * 0.02, c * 0.22); g.stroke();
      g.strokeStyle = 'rgba(254,215,170,0.8)';
      g.lineWidth = c * 0.04;
      g.beginPath(); g.arc(0, c * 0.04, c * 0.26, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    }
  };
  const drawGolden = g => drawAppleShape(g, '#fbbf24');
  const appleSprite = (v = 'fresh') => sprite('apple', v, drawApple);
  const goldenSprite = () => sprite('golden', '', drawGolden);
  const glowSprite = () => sprite('glow', '', drawGlow);
  const drawGlow = g => {
    const grad = g.createRadialGradient(0, 0, CELL * 0.2, 0, 0, CELL * 0.8);
    grad.addColorStop(0, 'rgba(253,224,71,0.55)');
    grad.addColorStop(1, 'rgba(253,224,71,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, CELL * 0.8, 0, TAU); g.fill();
  };
  // A four-point sparkle: the golden apple's non-color cue.
  const starSprite = () => sprite('star', '', drawStar);
  const drawStar = g => {
    g.fillStyle = '#fffbea';
    g.beginPath();
    const r1 = CELL * 0.2, r2 = CELL * 0.05;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, r = i % 2 ? r2 : r1;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(r, 0);
    }
    g.fill();
  };
  const mushroomSprite = () => sprite('mushroom', '', drawMushroom);
  const drawMushroom = g => {
    const c = CELL;
    g.fillStyle = '#fef3c7';
    g.beginPath(); // a rounded stem, like every other shape on the board
    if (g.roundRect) g.roundRect(-c * 0.1, -c * 0.02, c * 0.2, c * 0.36, c * 0.07); else g.rect(-c * 0.1, -c * 0.02, c * 0.2, c * 0.36);
    g.fill();
    g.fillStyle = '#dc2626';
    g.beginPath(); g.ellipse(0, 0, c * 0.4, c * 0.3, 0, Math.PI, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,20,8,0.45)';
    g.lineWidth = c * 0.05;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(-c * 0.18, -c * 0.1, c * 0.06, 0, TAU); g.fill();
    g.beginPath(); g.arc(c * 0.06, -c * 0.2, c * 0.06, 0, TAU); g.fill();
    g.beginPath(); g.arc(c * 0.22, -c * 0.06, c * 0.05, 0, TAU); g.fill();
  };
  // What's left of a snake: it falls to pieces, glossy beads in its own
  // colours and markings (Wildcard's rainbow, Mason's bricks, Colonist's
  // strap, a friend's spots), so no two snakes leave the same remains. A light
  // rim and a dark edge keep every bead readable on the bark.
  // variant: 'fill|mark', mark one of '', marble, marble2 (a gold vein), strap, strap2, spots, rings, dots, copy, ghost.
  const beadSprite = v => sprite('bead', v, drawBead);
  const drawBead = (g, v) => {
    const c = CELL, r = c * 0.26, bar = v.indexOf('|'), fill = v.slice(0, bar), mark = v.slice(bar + 1);
    const disc = (x, y, rr) => { g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill(); };
    if (mark === 'ghost') g.globalAlpha = 0.72;
    g.fillStyle = 'rgba(255,244,226,0.5)';
    disc(0, 0, r + c * 0.05);
    g.fillStyle = fill;
    disc(0, 0, r);
    g.strokeStyle = 'rgba(30,20,8,0.5)';
    g.lineWidth = c * 0.03;
    g.stroke();
    g.fillStyle = 'rgba(30,41,59,0.6)';
    if (mark === 'marble' || mark === 'marble2') {
      g.strokeStyle = mark === 'marble2' ? 'rgba(201,162,39,0.85)' : 'rgba(100,116,139,0.6)';
      g.lineWidth = c * 0.03;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-r * 0.7, -r * 0.45); g.quadraticCurveTo(0, r * 0.1, r * 0.75, -r * 0.2);
      g.moveTo(-r * 0.15, r * 0.75); g.quadraticCurveTo(r * 0.05, r * 0.35, r * 0.6, r * 0.45);
      g.stroke();
    } else if (mark === 'strap' || mark === 'strap2') {
      g.strokeStyle = '#fef3c7';
      g.lineWidth = c * 0.07;
      g.beginPath();
      const d = r * 0.7, sg = mark === 'strap' ? 1 : -1;
      g.moveTo(-d, -d * sg); g.lineTo(d, d * sg);
      g.stroke();
    } else if (mark === 'spots' || mark === 'dots') {
      g.fillStyle = 'rgba(58,38,20,0.45)';
      if (mark === 'dots') disc(0, 0, r * 0.32);
      else { disc(-r * 0.38, r * 0.12, r * 0.18); disc(r * 0.38, -r * 0.12, r * 0.18); }
    } else if (mark === 'diamond') {
      g.fillStyle = 'rgba(58,36,8,0.75)';
      g.beginPath(); g.moveTo(0, -r * 0.6); g.lineTo(r * 0.6, 0); g.lineTo(0, r * 0.6); g.lineTo(-r * 0.6, 0); g.closePath(); g.fill();
    } else if (mark === 'rings' || mark === 'copy') {
      g.strokeStyle = mark === 'copy' ? 'rgba(255,255,255,0.75)' : 'rgba(58,38,20,0.5)';
      g.lineWidth = c * 0.04;
      if (mark === 'copy') g.setLineDash([c * 0.07, c * 0.07]);
      g.beginPath(); g.arc(0, 0, r * (mark === 'copy' ? 0.75 : 0.55), 0, TAU); g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = 'rgba(255,255,255,0.55)'; // the gloss
    g.beginPath(); g.ellipse(-r * 0.32, -r * 0.38, r * 0.3, r * 0.2, -0.6, 0, TAU); g.fill();
  };
  // ------------------------------------------------------------ beetles

  // A jewel beetle, drawn live: an emerald shell with a gold rim, six legs and
  // feelers. It steps off and settles into its next cell during the tick it
  // moves (a beetle's walk: step, pause), legs scuttling, and turns smoothly.
  // Between steps it's never quite still: its feelers wave, it breathes, and
  // every few seconds it lifts its wing cases and buzzes, as if about to fly
  // off. Scared, it trembles. It pops in when it comes out.
  let beetleAng = null, beetleAt = 0;
  function drawBeetle(f, alpha, now) {
    const moved = game && f.movedAt === game.tick - 1 && f.px != null;
    const e = moved ? alpha * alpha * (3 - 2 * alpha) : 1;
    const gx = moved ? f.px + (f.x - f.px) * e : f.x, gy = moved ? f.py + (f.y - f.py) * e : f.y;
    let x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
    const c = CELL, lively = !reduced, t = now / 1000;
    const walking = moved && lively;
    const pop = beetleAt ? popOf(now - beetleAt) : 1;
    if (pop <= 0) return;
    const heading = Math.atan2(f.dir.y, f.dir.x);
    if (beetleAng === null || !lively) beetleAng = heading;
    else beetleAng += Math.atan2(Math.sin(heading - beetleAng), Math.cos(heading - beetleAng)) * Math.min(1, frameDt / 60);
    if (lively && f.scared && !moved) { x += Math.sin(now / 23) * 0.7; y += Math.cos(now / 31) * 0.7; } // trembling
    const step = walking ? Math.sin(now / (f.scared ? 28 : 45)) : 0;
    const cycle = ((now - beetleAt) / 1000) % 3.4; // the wing cases lift late in each cycle, if it's not walking
    const lift = lively && !walking && cycle > 2.7 ? Math.sin((cycle - 2.7) / 0.7 * Math.PI) : 0;
    if (f.gold) { // a golden beetle glows, and glints now and then
      const w = SPRITE * CELL * pop * (1 + (lively ? 0.12 * Math.sin(t * 4) : 0));
      ctx.globalAlpha = lively ? 0.75 + 0.25 * Math.sin(t * 4) : 0.9;
      ctx.drawImage(glowSprite(), x - w / 2, y - w / 2, w, w);
      ctx.globalAlpha = 1;
      if (lively && Math.random() < 0.06) mote(x + (Math.random() - 0.5) * c, y + (Math.random() - 0.5) * c, 0, -6, 650, 0.3 + Math.random() * 0.3, 1);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; // shadow
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, c * 0.38 * pop, c * 0.3 * pop, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(beetleAng + step * 0.07);
    const size = 1.35 * pop * (1 + (lively ? Math.sin(t * 3.1) * 0.02 : 0)); // about an apple's size, so it's easy to spot
    ctx.scale(size, size);
    // Legs: three a side, alternate pairs swinging.
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = c * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let leg = -1; leg <= 1; leg++) {
      const sw = (leg === 0 ? -step : step) * c * 0.06;
      const bx = leg * c * 0.12;
      ctx.moveTo(bx, -c * 0.12); ctx.lineTo(bx + c * 0.06 * leg + sw, -c * 0.32);
      ctx.moveTo(bx, c * 0.12); ctx.lineTo(bx + c * 0.06 * leg - sw, c * 0.32);
    }
    // Feelers, waving (twitching when it's scared).
    const wave = lively ? Math.sin(t * (f.scared ? 15 : 4.5)) * 0.05 : 0;
    ctx.moveTo(c * 0.26, -c * 0.04); ctx.quadraticCurveTo(c * 0.38, -c * (0.06 + wave), c * 0.42, -c * (0.18 - wave));
    ctx.moveTo(c * 0.26, c * 0.04); ctx.quadraticCurveTo(c * 0.38, c * (0.06 - wave), c * 0.42, c * (0.18 + wave));
    ctx.stroke();
    // Head, then (when the wing cases are lifted) the dark body under them and
    // the clear wings unfolding behind, buzzing...
    ctx.fillStyle = '#14532d';
    circle(c * 0.22, 0, c * 0.08);
    if (lift > 0) {
      ctx.fillStyle = '#052e16';
      ctx.beginPath(); ctx.ellipse(-c * 0.04, 0, c * 0.2, c * 0.12, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(240,249,255,0.7)';
      ctx.strokeStyle = 'rgba(148,163,184,0.7)';
      ctx.lineWidth = c * 0.015;
      const buzz = 0.9 + 0.1 * Math.sin(now / 9);
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(-c * 0.26 * lift, sg * c * 0.14 * lift, c * 0.34 * buzz * lift, c * 0.1, -sg * 0.45 * lift, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }
    // ...then the shell: two emerald wing cases with a gold rim, which swing
    // out from the front when it lifts them; the split down the middle and a shine.
    ctx.lineWidth = c * 0.03;
    for (const sg of [-1, 1]) {
      ctx.save();
      if (lift > 0) { ctx.translate(c * 0.16, 0); ctx.rotate(-sg * 0.4 * lift); ctx.translate(-c * 0.16, 0); }
      ctx.fillStyle = f.gold ? '#fbbf24' : '#059669'; // (a golden one: gold, rimmed in emerald)
      ctx.strokeStyle = f.gold ? '#047857' : '#fbbf24';
      ctx.beginPath();
      ctx.ellipse(-c * 0.02, 0, c * 0.22, c * 0.17, 0, sg < 0 ? Math.PI : 0, sg < 0 ? TAU : Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (sg < 0) { ctx.fillStyle = 'rgba(209,250,229,0.55)'; circle(c * 0.04, -c * 0.08, c * 0.045); }
      ctx.restore();
    }
    if (!lift) {
      ctx.strokeStyle = 'rgba(6,47,35,0.8)';
      ctx.beginPath();
      ctx.moveTo(c * 0.18, 0); ctx.lineTo(-c * 0.23, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --------------------------------------------------------- particles

  // A fixed pool: positions, velocities and life in typed arrays, colors as
  // indexes into a small palette, so bursts never allocate.
  const MAX_P = 320;
  const px = new Float32Array(MAX_P), py = new Float32Array(MAX_P);
  const pvx = new Float32Array(MAX_P), pvy = new Float32Array(MAX_P);
  const plife = new Float32Array(MAX_P), pmax = new Float32Array(MAX_P), psize = new Float32Array(MAX_P);
  const pcol = new Uint8Array(MAX_P), pshape = new Uint8Array(MAX_P); // shape: 0 a crumb, 1 a scrap of paper (confetti)
  let pNext = 0, pLive = 0;
  const PCOLORS = ['#a3e635', '#84cc16', '#fde68a', '#fbbf24', '#fffbea', '#dc2626', '#f6ecd2', '#c2410c', '#a16207'];
  const PCOLOR_INDEX = new Map(PCOLORS.map((c, i) => [c, i]));
  const colorIndex = c => {
    let i = PCOLOR_INDEX.get(c);
    if (i === undefined && PCOLORS.length < 255) { i = PCOLORS.length; PCOLORS.push(c); PCOLOR_INDEX.set(c, i); }
    return i ?? 0;
  };

  function spawn(x, y, n, speed, life, size, c1, c2, shape = 0) {
    if (reduced) return;
    const i1 = colorIndex(c1), i2 = colorIndex(c2);
    for (let j = 0; j < n; j++) {
      const i = pNext;
      pNext = (pNext + 1) % MAX_P;
      const a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.6);
      px[i] = x; py[i] = y;
      pvx[i] = Math.cos(a) * v; pvy[i] = Math.sin(a) * v - speed * 0.35;
      pmax[i] = plife[i] = life * (0.7 + Math.random() * 0.5);
      psize[i] = size * (0.6 + Math.random() * 0.6);
      pcol[i] = j % 2 ? i1 : i2;
      pshape[i] = shape;
    }
    pLive = Math.min(MAX_P, pLive + n);
  }

  function drawParticles(dt) {
    if (!pLive) return;
    const step = dt / 1000;
    let live = 0;
    for (let c = 0; c < PCOLORS.length; c++) {
      let started = false;
      for (let i = 0; i < MAX_P; i++) {
        if (plife[i] <= 0 || pcol[i] !== c) continue;
        if (!started) { ctx.fillStyle = PCOLORS[c]; started = true; }
        plife[i] -= dt;
        pvy[i] += 900 * step; // a little gravity
        px[i] += pvx[i] * step;
        py[i] += pvy[i] * step;
        const t = Math.max(0, plife[i] / pmax[i]);
        ctx.globalAlpha = t;
        if (pshape[i]) { // a scrap of paper, turning over as it falls
          pvx[i] *= 0.985; pvy[i] *= 0.97; // (paper floats)
          const sz = psize[i], flip = Math.abs(Math.cos(plife[i] / 70 + i));
          ctx.fillRect(px[i] - sz * flip, py[i] - sz * 0.6, sz * 2 * flip + 0.5, sz * 1.2);
        } else {
          ctx.beginPath();
          ctx.arc(px[i], py[i], psize[i] * (0.5 + 0.5 * t), 0, TAU);
          ctx.fill();
        }
        live++;
      }
    }
    ctx.globalAlpha = 1;
    pLive = live;
  }

  // Floating "+1" / "+3" over your head when you eat, from a tiny pool.
  const MAX_F = 6;
  const fx = new Float32Array(MAX_F), fy = new Float32Array(MAX_F), flife = new Float32Array(MAX_F);
  const ftext = new Array(MAX_F).fill('');
  const FLOAT_FONT = `700 ${Math.round(CELL * 0.72)}px Fredoka, system-ui, sans-serif`;
  const FLOAT_FILL = { 'KO!': '#f87171', 'Bonk!': '#fdba74', 'Ouch!': '#fdba74', '-1': '#fca5a5', '-2': '#fca5a5', '-3': '#fca5a5' }; // (the rest in honey)
  const drawFloat = (g, text) => {
    g.font = FLOAT_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = CELL * 0.14;
    g.strokeStyle = 'rgba(58,38,20,0.85)';
    g.strokeText(text, 0, 0);
    g.fillStyle = FLOAT_FILL[text] || '#fde68a';
    g.fillText(text, 0, 0);
  };
  let fNext = 0;
  function floater(x, y, text) {
    const half = CELL * (text.length > 3 ? 1.15 : 0.7); // (kept inside the board, words and all)
    fx[fNext] = Math.min(SIZE - half, Math.max(half, x)); fy[fNext] = y; flife[fNext] = T.FLOAT_MS; ftext[fNext] = text;
    fNext = (fNext + 1) % MAX_F;
  }
  function drawFloaters(dt) {
    let any = false;
    for (let i = 0; i < MAX_F; i++) if (flife[i] > 0) { any = true; break; }
    if (!any) return;
    for (let i = 0; i < MAX_F; i++) {
      if (flife[i] <= 0) continue;
      flife[i] -= dt;
      const t = Math.max(0, flife[i] / T.FLOAT_MS);
      const y = fy[i] - (reduced ? 0 : (1 - t) * CELL * 0.8); // rises, unless motion is reduced
      const sp = sprite('float', ftext[i], drawFloat);
      if (reduced || t < 0.86) blitCrisp(sp, fx[i], y, Math.min(1, t * 1.6));
      else { // ...after popping in, from big
        const w = SPRITE * CELL * (1 + (t - 0.86) / 0.14 * 0.7);
        ctx.drawImage(sp, fx[i] - w / 2, y - w / 2, w, w);
      }
    }
  }

  // ----------------------------------------------- per-snake animation state

  // Blink, tongue, gaze and gulps live outside the game state; they're purely visual.
  const anim = new WeakMap();
  function animOf(s, now) {
    let a = anim.get(s);
    if (!a) {
      a = {
        nextBlink: now + T.BLINK_MIN + Math.random() * (T.BLINK_MAX - T.BLINK_MIN), blinkUntil: 0,
        nextTongue: now + T.TONGUE_EVERY * (0.5 + Math.random()), tongueUntil: 0, tongueMs: T.TONGUE_MS,
        gx: s.dir.x, gy: s.dir.y, near: 99, // where the eyes point (on the screen, eased), and how far that is
        wx: 0, wy: 0, wanderAt: 0,          // Wildcard's eyes wander about on their own
        gulps: [-99, -99, -99, -99], gulpAt: 0,
        gulpR: T.GULP, gulpW: T.GULP_LENGTH, ateAt: -1e9, // gulp size and length (Gobbler's are bigger), last bite
        // This frame's layout (see prepare): segment centres, the corner each
        // band bends through, radii and fills, sized for the body as it grows.
        n: 0, pts: new Float32Array(64), cor: new Float32Array(64), rad: new Float32Array(32), fills: new Array(32),
        look: '', color: '', isPlayer: false, rim: false, bump: 0, tickPos: 0,
      };
      anim.set(s, a);
    }
    return a;
  }

  // ------------------------------------------------------------ looks

  // The look a snake is drawn with right now (Capricious borrows its mood's).
  function lookOf(s) {
    if (!s.persona) return 'player';
    if (s.persona.look === 'capricious' && s.memory.mood) return PERSONAS[s.memory.mood].look;
    return s.persona.look;
  }

  // Current body color, for personas whose color changes during a round.
  function colorOf(s) {
    if (!s.persona) return s.color;
    if (s.personaKey === 'mute') return muteShown.get(s) || s.color;
    if (s.personaKey === 'capricious' && s.memory.mood) return PERSONAS[s.memory.mood].color;
    if (s.personaKey === 'copycat' && game) {
      const model = findById(s.memory.modelId);
      if (model && model.alive) return mix(model.personaKey === 'capricious' ? colorOf(model) : model.color, '#ffffff', 0.45);
    }
    return s.color;
  }

  // Mute is a mood ring: its colour follows how it feels, from what anyone
  // can see on the board. Stunned: dazed grey. Just made a kill: proud gold.
  // Hemmed in, or a rival's head close: pale with fright. Its victim close:
  // deep rose (closing the box). Stalking someone: deep violet. Otherwise
  // calm violet. It changes over a moment, in a few steps.
  const MUTE_MOODS = { calm: '#a855f7', stalking: '#6d28d9', closing: '#be123c', scared: '#dbeafe', proud: '#eab308', dazed: '#9ca3af' };
  const muteState = new Map(), muteShown = new Map(); // snake -> { from, to, at, key }; snake -> the colour now
  // ...and its face says it too: the brows (outer end, arch, inner end, along
  // the head: more negative is higher) and, unless it's biting, the mouth.
  const MUTE_BROWS = { calm: [0.05, -0.04, 0.04], stalking: [0.0, 0.03, 0.11], closing: [-0.03, 0.06, 0.15], scared: [0.09, 0.0, -0.05], proud: [0.03, -0.02, 0.07], dazed: [0.07, 0.07, 0.07] };
  function muteMood(s) {
    if (s.stunUntil > game.tick) return 'dazed';
    for (const o of game.snakes) if (!o.alive && o.killerId === s.id && o.killer !== 'self' && game.tick - (o.diedAt ?? -99) < 30) return 'proud';
    const h = s.body[0];
    let shut = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = h.x + dx, y = h.y + dy;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || game.holes.has(y * GRID + x) || game.snakes.some(o => o.alive && o.body.some(c => c.x === x && c.y === y))) shut++;
    }
    if (shut >= 3 || game.snakes.some(o => o !== s && o.alive && Math.abs(o.body[0].x - h.x) + Math.abs(o.body[0].y - h.y) <= 2)) return 'scared';
    const v = findById(s.memory.victimId);
    if (v && v.alive) return Math.abs(v.body[0].x - h.x) + Math.abs(v.body[0].y - h.y) <= 4 ? 'closing' : 'stalking';
    return 'calm';
  }
  function updateMute(s, now) {
    const key = muteMood(s), mood = MUTE_MOODS[key];
    let m = muteState.get(s);
    if (!m) muteState.set(s, m = { from: mood, to: mood, at: -1e9 });
    m.key = key;
    if (mood !== m.to) { m.from = muteShown.get(s) || m.to; m.to = mood; m.at = now; }
    const k = reduced ? 1 : Math.min(1, (now - m.at) / 400);
    muteShown.set(s, mix(m.from, m.to, Math.round(k * 6) / 6)); // (in steps: each a cached colour ramp)
  }

  function findById(id) {
    if (id == null || !game) return null;
    for (const o of game.snakes) if (o.id === id) return o;
    return null;
  }

  // ------------------------------------------------------------ the gaze

  // What a snake is looking at: a cell, or null for straight ahead. Each rival
  // looks at what it cares about, read from its memory (purely for show: what
  // it draws never changes how anyone plays), so you can read who's hunting whom.
  const spot = { x: 0, y: 0 };
  function focusOf(s, look, a, now) {
    const m = s.memory;
    switch (look) {
      case 'player': case 'gobbler': return nearest(s, 'food');
      case 'drab': return nearest(s, 'food'); // a lazy look at lunch
      case 'sniper': case 'sovereign': case 'mute': return headOf(m.victimId) || nearest(s, 'head');
      case 'colonist': return headOf(m.victimId) || m.site || nearest(s, 'head');
      case 'vulture': return headOf(m.lureId) || nearest(s, 'head');
      case 'copycat': return headOf(m.modelId) || nearest(s, 'head');
      case 'creeper': return nearest(s, 'tail') || nearest(s, 'head');
      case 'mason': return nearest(s, 'head'); // keeping an eye on whoever's near the wall
      case 'ghost': case 'metagamer': case 'desperado': case 'joker': return nearest(s, 'head');
      case 'wildcard': // looks wherever, changing its mind every second or two
        if (now > a.wanderAt) {
          a.wanderAt = now + 900 + Math.random() * 1600;
          a.wx = Math.floor(Math.random() * GRID);
          a.wy = Math.floor(Math.random() * GRID);
        }
        spot.x = a.wx; spot.y = a.wy;
        return spot;
      default: return nearest(s, 'head');
    }
  }

  function headOf(id) {
    const o = findById(id);
    return o && o.alive ? o.body[0] : null;
  }

  // The nearest food (not mushrooms), rival head, or long rival's tail. Every
  // snake's eyes follow something, so no face ever just stares ahead.
  function nearest(s, what) {
    const h = s.body[0];
    let best = 1e9, out = null;
    if (what === 'food') {
      for (const f of game.food) {
        if (f.kind === 'mushroom') continue;
        const d = (f.x - h.x) * (f.x - h.x) + (f.y - h.y) * (f.y - h.y);
        if (d > 0 && d < best) { best = d; out = f; }
      }
    } else {
      for (const o of game.snakes) {
        if (o === s || !o.alive) continue;
        const c = what === 'head' ? o.body[0] : o.body.length >= 8 ? o.body[o.body.length - 1] : null;
        if (!c) continue;
        const d = (c.x - h.x) * (c.x - h.x) + (c.y - h.y) * (c.y - h.y);
        if (d > 0 && d < best) { best = d; out = c; }
      }
    }
    return out;
  }

  // Turn the eyes toward the focus (eased on the screen, so a turn of the
  // head doesn't swing them, and at the same speed at any frame rate).
  function updateGaze(s, look, a, now) {
    const f = game ? focusOf(s, look, a, now) : null;
    let tx = s.dir.x, ty = s.dir.y; // nothing to look at: straight ahead
    if (f) {
      const h = s.body[0], dx = f.x - h.x, dy = f.y - h.y;
      const len = Math.hypot(dx, dy) || 1;
      a.near = len;
      tx = dx / len; ty = dy / len;
    } else a.near = 99;
    const ease = 1 - Math.pow(1 - T.GLANCE_EASE, frameDt / 16.7);
    a.gx += (tx - a.gx) * ease;
    a.gy += (ty - a.gy) * ease;
  }

  // The mouth: open when food is right in front, then a couple of chews after a bite.
  let deadNow = false; // the snake being drawn has just died: mouth shut
  let frameDt = 16;     // this frame's length, for easing
  function mouthOpen(s, a) {
    if (deadNow) return 0;
    const t = (lastNow - a.ateAt) / T.CHEW_MS;
    if (t >= 0 && t < 1) return 0.55 * Math.abs(Math.sin(t * Math.PI * 2));
    if (!game) return 0;
    const h = s.body[0];
    if (s.personaKey === 'ouroboros' && s.body.length > 4) { // (its own tail right ahead: it bites it)
      const tl = s.body[s.body.length - 1];
      if ((tl.x - h.x) * s.dir.x + (tl.y - h.y) * s.dir.y === 1 && (tl.x - h.x) * s.dir.y - (tl.y - h.y) * s.dir.x === 0) return 1;
    }
    for (const f of game.food) {
      if (f.kind === 'mushroom' && s.personaKey !== 'ghost') continue;
      const ahead = (f.x - h.x) * s.dir.x + (f.y - h.y) * s.dir.y;
      const side = (f.x - h.x) * s.dir.y - (f.y - h.y) * s.dir.x;
      if (side === 0 && ahead >= 1 && ahead <= 2) return ahead === 1 ? 1 : 0.5;
    }
    return 0;
  }

  // Fades toward the bark as colour ramps: rampOf(c)[p] is c faded p% of the
  // way to the bark. Built once per colour, so no frame builds a colour string.
  const ramps = new Map(), stripes = new Map();
  function rampOf(c) {
    let ramp = ramps.get(c);
    if (!ramp) {
      ramp = new Array(101);
      for (let p = 0; p <= 100; p++) ramp[p] = p ? mix(c, BARK, p / 100) : c;
      ramps.set(c, ramp);
    }
    return ramp;
  }
  const lumas = new Map();
  function lumaOf(c) {
    let l = lumas.get(c);
    if (l === undefined) { l = c[0] === '#' ? luma(c) : 1; lumas.set(c, l); }
    return l;
  }

  // Wildcard's segments: a tan face, a white collar, then a blue field of
  // stars (two segments) and red and white stripes from there on.
  const WILD = i => i === 0 ? '#f59a52' : i === 1 ? '#f8fafc' : i < 4 ? '#3c3b6e' : i % 2 ? '#b22234' : '#f8fafc';

  // Every segment's fill: the look's pattern, fading toward the bark at the tail.
  function fillsOf(s, a, now) {
    const { look, color, n, fills } = a;
    if (s.personaKey === 'wildcard') { // the Stars and Stripes, behind an orange tan and a white collar
      for (let i = 0; i < n; i++) fills[i] = WILD(i);
      return;
    }
    const mime = look === 'mute'; // (its mood's colour down the body, behind a white greasepaint face: below)
    if (look === 'joker') {
      for (let i = 0; i < n; i++) fills[i] = i === 0 ? '#f8fafc' : i % 2 ? '#f59e0b' : '#a21caf';
      return;
    }
    const ramp = rampOf(color);
    let stripe = null;
    if (look === 'sniper') {
      stripe = stripes.get(color);
      if (!stripe) { stripe = rampOf(mix(color, '#fca5a5', 0.35)); stripes.set(color, stripe); }
    }
    for (let i = 0; i < n; i++) {
      const t = i / (n > 1 ? n - 1 : 1); // 0 at the head, 1 at the tail
      // (Ghost and Creeper fade the most, but never so far that you can't see a tail that kills.)
      const fade = look === 'ghost' ? Math.round(55 * t)
        : look === 'creeper' ? Math.round(15 + 30 * t)
        : look === 'drab' ? 15
        : Math.round(30 * t);
      fills[i] = (stripe && i % 3 === 2 ? stripe : ramp)[fade];
    }
    if (look === 'vulture') { fills[0] = '#f9a8d4'; if (n > 1) fills[1] = '#f5f5f4'; } // bald pink head, white neck ruff
    if (look === 'desperado') { if (n > 1) fills[1] = '#dc2626'; for (let i = 4; i < n; i += 4) fills[i] = '#fde68a'; } // bandana, poncho stripes
    if (mime) fills[0] = '#f8fafc';
  }

  // Once a frame per snake: where each segment is (between its last two
  // cells), the cell each band bends through, radii and fills.
  function prepare(s, alpha, now, dead, impact = 0) {
    const a = animOf(s, now);
    const n = s.body.length;
    if (a.rad.length < n) {
      a.pts = new Float32Array(4 * n); a.cor = new Float32Array(4 * n);
      a.rad = new Float32Array(2 * n); a.fills = new Array(2 * n);
    }
    a.n = n;
    a.look = lookOf(s);
    if (s.personaKey === 'mute' && !dead) updateMute(s, now);
    a.color = colorOf(s);
    a.isPlayer = !s.persona;
    // A pale rim so dark bodies read on the bark (Joker's amber and white do already).
    a.rim = !a.isPlayer && a.look !== 'joker' && (a.look === 'vulture' || lumaOf(a.color) < 0.4);
    const prev = s.prev, { pts, cor } = a;
    for (let i = 0; i < n; i++) {
      const c = s.body[i];
      const p = prev && i < prev.length ? prev[i] : c;
      pts[2 * i] = (p.x + (c.x - p.x) * alpha) * CELL + CELL / 2;
      pts[2 * i + 1] = (p.y + (c.y - p.y) * alpha) * CELL + CELL / 2;
      // The band to the next segment runs through the cell this one left
      // (where the next one is headed), so a bend never cuts its corner.
      if (i < n - 1) {
        const q = prev && i < prev.length ? prev[i] : s.body[i + 1];
        cor[2 * i] = q.x * CELL + CELL / 2;
        cor[2 * i + 1] = q.y * CELL + CELL / 2;
      }
    }
    // A held corpse presses its head a little into whatever it hit.
    if (impact) { pts[0] += s.dir.x * CELL * impact; pts[1] += s.dir.y * CELL * impact; }
    // Leaping (this tick): the head arcs up and over, the neck after it.
    if (a.leapTick === game?.tick && !dead && !reduced) {
      const up = Math.sin(Math.min(1, alpha) * Math.PI) * CELL * 0.7;
      pts[1] -= up;
      if (n > 1) pts[3] -= up * 0.45;
    }
    // Just crashed: the head lunges into what it hit, and bounces back.
    const hit = a.crashAt ? (now - a.crashAt) / 260 : 1;
    if (hit < 1 && hit >= 0 && !dead && !reduced) { const l = Math.sin(hit * Math.PI) * 0.34; pts[0] += a.crashDx * CELL * l; pts[1] += a.crashDy * CELL * l; }
    // Gulps: a bulge that travels one segment per tick after each bite, and
    // the head's squash at the bite itself.
    a.tickPos = game ? game.tick - 1 + alpha : 0;
    const bite = (lastNow - a.ateAt) / T.BITE_MS;
    a.bump = !dead && bite >= 0 && bite < 1 ? (a.gulpR > T.GULP ? 0.2 : 0.12) * Math.sin(bite * Math.PI) : 0;
    for (let i = 0; i < n; i++) a.rad[i] = radius(i, n, a, a.tickPos);
    fillsOf(s, a, now);
    return a;
  }

  // Segment radius: a big head, a body that tapers to the tail, plus any gulp passing through.
  function radius(i, n, a, tickPos) {
    let r = i === 0 ? CELL * 0.54 * (1 + a.bump) : CELL * (0.44 - 0.1 * (i / (n > 1 ? n - 1 : 1)));
    if (i > 0) {
      for (let g = 0; g < 4; g++) {
        const d = i - (tickPos - a.gulps[g]);
        if (d > -a.gulpW && d < a.gulpW) r += CELL * a.gulpR * (1 - Math.abs(d) / a.gulpW);
      }
    }
    return r;
  }

  const near = (u, v) => Math.abs(u - v) < 0.01;

  // One straight piece of a band, half-width h, as a rectangle (pieces always
  // run along the grid; anything else would be a bug, drawn as a line).
  function piece(x1, y1, x2, y2, h) {
    if (near(y1, y2)) { if (!near(x1, x2)) ctx.fillRect(Math.min(x1, x2), y1 - h, Math.abs(x2 - x1), 2 * h); }
    else if (near(x1, x2)) ctx.fillRect(x1 - h, Math.min(y1, y2), 2 * h, Math.abs(y2 - y1));
    else {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2 * h;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  // The band from segment i to i + 1: through its corner cell. Straight, it's
  // one piece (two pieces meeting mid-band leave a hairline seam when a cell
  // isn't a whole number of pixels); at a bend the corner's circle covers the join.
  function band(a, i, h) {
    const p = a.pts, c = a.cor;
    const x1 = p[2 * i], y1 = p[2 * i + 1], cx = c[2 * i], cy = c[2 * i + 1], x2 = p[2 * i + 2], y2 = p[2 * i + 3];
    if ((near(x1, cx) && near(cx, x2)) || (near(y1, cy) && near(cy, y2))) piece(x1, y1, x2, y2, h);
    else { piece(x1, y1, cx, cy, h); piece(cx, cy, x2, y2, h); }
  }

  // Does the band from i to i + 1 turn a corner (and need its outside rounded)?
  function bends(a, i) {
    const p = a.pts, c = a.cor;
    const x1 = p[2 * i], y1 = p[2 * i + 1], cx = c[2 * i], cy = c[2 * i + 1], x2 = p[2 * i + 2], y2 = p[2 * i + 3];
    if ((near(x1, cx) && near(y1, cy)) || (near(x2, cx) && near(y2, cy))) return false;
    return !(near(x1, cx) && near(cx, x2)) && !(near(y1, cy) && near(cy, y2));
  }

  // A body is a row of segments, one per cell, each a little round with a
  // narrower band joining it to the next: a caterpillar, so you can count
  // how long a snake is at a glance.
  const PINCH = 0.8;
  // The body's outline shape, `grow` units bigger all round, as one path
  // (bands as rectangles, joints as circles), filled once in the current
  // fill: one draw, and an even shade even where pieces overlap.
  function silhouette(a, grow) {
    ctx.beginPath();
    const p = a.pts, c = a.cor;
    for (let i = a.n - 2; i >= 0; i--) {
      const h = a.rad[i + 1] * PINCH + grow, x1 = p[2 * i], y1 = p[2 * i + 1], cx = c[2 * i], cy = c[2 * i + 1], x2 = p[2 * i + 2], y2 = p[2 * i + 3];
      pieceRect(x1, y1, cx, cy, h);
      pieceRect(cx, cy, x2, y2, h);
    }
    for (let i = a.n - 1; i >= 0; i--) {
      if (i < a.n - 1 && bends(a, i)) { const r = a.rad[i + 1] * PINCH + grow; ctx.moveTo(a.cor[2 * i] + r, a.cor[2 * i + 1]); ctx.arc(a.cor[2 * i], a.cor[2 * i + 1], r, 0, TAU); }
      const r = a.rad[i] + grow;
      ctx.moveTo(p[2 * i] + r, p[2 * i + 1]);
      ctx.arc(p[2 * i], p[2 * i + 1], r, 0, TAU);
    }
    ctx.fill();
  }
  // One straight piece of a band, added to the current path (pieces always
  // run along the grid; a zero-length one adds nothing).
  function pieceRect(x1, y1, x2, y2, h) {
    if (near(y1, y2)) { if (!near(x1, x2)) ctx.rect(Math.min(x1, x2), y1 - h, Math.abs(x2 - x1), 2 * h); }
    else if (near(x1, x2)) ctx.rect(x1 - h, Math.min(y1, y2), 2 * h, Math.abs(y2 - y1));
  }

  // The path through every segment centre and corner, head to tail.
  function spine(a) {
    ctx.beginPath();
    ctx.moveTo(a.pts[0], a.pts[1]);
    for (let i = 1; i < a.n; i++) {
      ctx.lineTo(a.cor[2 * i - 2], a.cor[2 * i - 1]);
      ctx.lineTo(a.pts[2 * i], a.pts[2 * i + 1]);
    }
  }

  // Pass 1, for every snake before any body: the shadow on the bark.
  function drawShadow(a) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.translate(2, 4);
    silhouette(a, 0);
    ctx.translate(-2, -4);
  }

  // Pass 2: people's cream outline (yours bright with a soft halo, so you find
  // yourself at a glance; friends' plainer), or a dark body's pale rim. Each is
  // a slightly bigger copy of the body, so it follows the taper and every corner.
  const FRIEND_OUTLINE = '#cdbd9f', RIM = '#9a8069';
  // People share one face, so online seats differ by a marking as well as a
  // colour (lavender and sky look alike to many colour-blind players).
  const MARKS = { '#fde047': 'spots', '#c4b5fd': 'rings', '#7dd3fc': 'dots' };
  const markOf = color => MARKS[color] || '';
  function drawOutline(s, a) {
    if (s.leaps > 0) { // holding a power (leaps): a faint golden outline, breathing, until it's spent
      ctx.fillStyle = rgba('#fbbf24', reduced ? 0.45 : 0.35 + 0.15 * Math.sin(lastNow / 260));
      silhouette(a, 5.5);
    }
    if (a.isPlayer) {
      const mine = s.id === viewerId;
      if (mine) {
        ctx.strokeStyle = 'rgba(255,251,234,0.3)';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = CELL * 1.34;
        spine(a);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,251,234,0.3)';
        circle(a.pts[0], a.pts[1], CELL * 0.78);
      }
      ctx.fillStyle = mine ? '#fffef8' : FRIEND_OUTLINE;
      silhouette(a, mine ? 3.5 : 2.5);
    } else if (a.rim) {
      ctx.fillStyle = RIM;
      silhouette(a, 1.5);
    }
  }

  // Pass 3: the body (bands, then circles tail to head, so the head ends up on
  // top), its pattern and its face.
  function drawBody(s, a, now, dead) {
    const { n, pts, rad, fills, look, color } = a;
    // Segments: narrower bands joining them, then a round one per cell.
    // (Bands as rectangles, fillRect's fast path; folding them into each
    // segment's circle as one shape measured slower.)
    for (let i = n - 2; i >= 0; i--) { ctx.fillStyle = fills[i + 1]; band(a, i, rad[i + 1] * PINCH); }
    for (let i = n - 1; i >= 0; i--) {
      if (i < n - 1 && bends(a, i)) { ctx.fillStyle = fills[i + 1]; circle(a.cor[2 * i], a.cor[2 * i + 1], rad[i + 1] * PINCH); }
      ctx.fillStyle = fills[i];
      circle(pts[2 * i], pts[2 * i + 1], rad[i]);
    }

    // A little roundness on every segment (light from the top left), in one fill.
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const hr = rad[i] * 0.35, hx = pts[2 * i] - rad[i] * 0.3, hy = pts[2 * i + 1] - rad[i] * 0.35;
      ctx.moveTo(hx + hr, hy); ctx.arc(hx, hy, hr, 0, TAU);
    }
    ctx.fill();

    // Patterns. Each follows the skin (by segment), not the board.
    if (a.isPlayer) {
      const mark = MARKS[color];
      if (mark === 'rings') {
        ctx.strokeStyle = 'rgba(58,38,20,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 1; i < n; i++) { const r = rad[i] * 0.55; ctx.moveTo(pts[2 * i] + r, pts[2 * i + 1]); ctx.arc(pts[2 * i], pts[2 * i + 1], r, 0, TAU); }
        ctx.stroke();
      } else if (mark) {
        ctx.fillStyle = 'rgba(58,38,20,0.45)';
        for (let i = 1; i < n; i++) {
          const x = pts[2 * i], y = pts[2 * i + 1], r = rad[i];
          if (mark === 'dots') circle(x, y, r * 0.3);
          else { circle(x - r * 0.38, y + r * 0.12, r * 0.17); circle(x + r * 0.38, y - r * 0.12, r * 0.17); }
        }
      }
    }
    if (s.personaKey === 'wildcard' && n > 2) {
      ctx.fillStyle = '#ffffff'; // stars on the blue
      for (let i = 2; i < Math.min(4, n); i++) for (const [dx, dy] of STARS) star(pts[2 * i] + dx * rad[i], pts[2 * i + 1] + dy * rad[i], rad[i] * 0.2);
      drawTie(a);
    }
    if (look === 'mason') { // Caesar in marble: grey veins wandering across every segment, now and then a gold one
      ctx.lineCap = 'round';
      for (let gold = 0; gold < 2; gold++) {
        ctx.strokeStyle = gold ? 'rgba(201,162,39,0.75)' : 'rgba(100,116,139,0.55)';
        ctx.lineWidth = gold ? 1.1 : 1.4;
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          if (gold !== (i % 4 === 3 ? 1 : 0)) continue;
          marbleVein(pts[2 * i], pts[2 * i + 1], rad[i], i);
        }
        ctx.stroke();
      }
    } else if (look === 'ouroboros') { // a python's back: a dark diamond on every segment, a pale fleck in each
      ctx.fillStyle = 'rgba(58,36,8,0.75)';
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1], d = rad[i] * 0.62;
        ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(253,230,138,0.6)';
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1], d = rad[i] * 0.2;
        ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
      }
      ctx.fill();
    } else if (look === 'colonist') { // a redcoat's cross-belts: a cream strap zig-zagging down the body
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 3;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1], d = rad[i] * 0.66;
        if (i % 2) { ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); }
        else { ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); }
      }
      ctx.stroke();
    }
    if (s.personaKey === 'copycat') { // dashed rings: a copy of someone
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(DASH);
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const r = rad[i] - 2;
        ctx.moveTo(pts[2 * i] + r, pts[2 * i + 1]);
        ctx.arc(pts[2 * i], pts[2 * i + 1], r, 0, TAU);
      }
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
    }
    if (s.personaKey === 'capricious') { // always findable, whatever the mood: a pink ring that breathes, pale dashes running round it
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pts[0], pts[1], rad[0] + 2.5 + (reduced ? 0 : Math.sin(now / 240) * 1.2), 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#fdf2f8';
      ctx.setLineDash(MOOD_DASH);
      ctx.lineDashOffset = reduced ? 0 : -now / 35;
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.lineDashOffset = 0;
    }

    // Head features, drawn in a frame where +x points the way the snake faces.
    const blinking = dead || now < a.blinkUntil;
    if (!dead && now > a.nextBlink) {
      a.blinkUntil = now + T.BLINK_MS;
      a.nextBlink = now + T.BLINK_MIN + Math.random() * (T.BLINK_MAX - T.BLINK_MIN);
    }
    if (!dead) { updateGaze(s, look, a, now); steer(s, a, now); }
    headCos = a.hc; headSin = a.hs;
    gazeX = a.gx * headCos + a.gy * headSin; // the gaze, turned into the face's frame
    gazeY = -a.gx * headSin + a.gy * headCos;
    deadNow = dead;
    ctx.save();
    ctx.translate(pts[0], pts[1]);
    const dizzy = !dead && s.stunUntil > game.tick; // (stunned: its head wobbles, and stars go round it)
    ctx.rotate(Math.atan2(a.hs, a.hc) + (dizzy && !reduced ? Math.sin(now / 45) * 0.16 : 0));
    ctx.scale(1.1 * (1 + a.bump), 1.1 * (1 + a.bump));
    if (a.isPlayer) drawPlayerFace(s, a, now, blinking);
    else drawFace(s, look, color, blinking, a);
    ctx.restore();

    if (!dead && s.leaps > 0) { // leaps held: a golden ring round the head, a pip on it for each
      const t = reduced ? 0 : now / 1000, rr = CELL * (0.66 + 0.04 * Math.sin(t * 3));
      ctx.strokeStyle = 'rgba(251,191,36,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pts[0], pts[1], rr, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = 'rgba(58,38,20,0.8)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < s.leaps; i++) {
        const a2 = -Math.PI / 2 + (i - (s.leaps - 1) / 2) * 0.5;
        ctx.beginPath(); ctx.arc(pts[0] + Math.cos(a2) * rr, pts[1] + Math.sin(a2) * rr, CELL * 0.11, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    if (dizzy) { // a faint halo, and three stars going round on it
      const t = reduced ? 0 : now / 240, cy = Math.max(CELL * 0.3, pts[1] - CELL * 0.72);
      ctx.strokeStyle = 'rgba(253,224,71,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(pts[0], cy, CELL * 0.55, CELL * 0.18, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = 'rgba(58,38,20,0.75)';
      ctx.lineWidth = 1.3;
      for (let i = 0; i < 3; i++) {
        const a2 = t + i * TAU / 3;
        star(pts[0] + Math.cos(a2) * CELL * 0.55, cy + Math.sin(a2) * CELL * 0.18, CELL * 0.22);
        ctx.stroke();
      }
    }

    // Capricious: a ring that flashes out when its mood changes.
    if (!reduced && s.personaKey === 'capricious' && s.memory.moodChangedAt != null && game) {
      const age = game.time - s.memory.moodChangedAt;
      if (age < T.MOOD_RING_MS) {
        ctx.strokeStyle = color;
        ctx.globalAlpha *= 1 - age / T.MOOD_RING_MS;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pts[0], pts[1], CELL * (0.6 + 1.6 * age / T.MOOD_RING_MS), 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  const DASH = [3, 3], NO_DASH = [], MOOD_DASH = [5, 7];

  // Marble veins across a disc (centre x, y, radius r), their own way for
  // each segment i: a long wandering one and a short faint one beside it,
  // added to the current path.
  function marbleVein(x, y, r, i) {
    const a = i * 2.39996, f = i % 2 ? 1 : -1;
    const arc = (a0, a1, bend, reach) => {
      const x0 = x + Math.cos(a0) * r * reach, y0 = y + Math.sin(a0) * r * reach;
      const x1 = x + Math.cos(a1) * r * reach, y1 = y + Math.sin(a1) * r * reach;
      const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, my, x1, y1);
    };
    arc(a, a + 2.6, 0.35 * f, 0.85);
    arc(a + 3.6, a + 4.7, -0.5 * f, 0.7);
  }

  const STARS = [[-0.45, -0.45], [0.45, -0.45], [0, 0], [-0.45, 0.45], [0.45, 0.45]];
  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.fill();
  }

  // Wildcard's long red tie: knotted under the chin, down over the collar and
  // on along the body, bending with it.
  function drawTie(a) {
    const p = a.pts, c = CELL;
    const seg = (i, j) => { const dx = p[2 * j] - p[2 * i], dy = p[2 * j + 1] - p[2 * i + 1], len = Math.hypot(dx, dy) || 1; return [dx / len, dy / len, len]; };
    const [ax, ay] = seg(0, 1), [bx, by, blen] = seg(1, 2);
    // From the chin (just inside the head's edge) to the collar...
    const kx = p[0] + ax * c * 0.45, ky = p[1] + ay * c * 0.45;
    const mx = p[2], my = p[3];
    // ...then on toward the next segment, ending in a point.
    const end = Math.min(blen, c * 0.85), ex = mx + bx * end, ey = my + by * end;
    const quad = (x1, y1, w1, x2, y2, w2, dx, dy) => {
      ctx.moveTo(x1 - dy * w1, y1 + dx * w1); ctx.lineTo(x2 - dy * w2, y2 + dx * w2);
      ctx.lineTo(x2 + dy * w2, y2 - dx * w2); ctx.lineTo(x1 + dy * w1, y1 - dx * w1); ctx.closePath();
    };
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    quad(kx, ky, c * 0.07, mx, my, c * 0.12, ax, ay);
    quad(mx, my, c * 0.12, ex - bx * c * 0.12, ey - by * c * 0.12, c * 0.15, bx, by);
    ctx.fill();
    circle(mx, my, c * 0.12); // (smooth where it bends)
    ctx.beginPath(); // the point
    ctx.moveTo(ex - bx * c * 0.12 - by * c * 0.15, ey - by * c * 0.12 + bx * c * 0.15);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - bx * c * 0.12 + by * c * 0.15, ey - by * c * 0.12 - bx * c * 0.15);
    ctx.fill();
    ctx.fillStyle = '#991b1b'; // the knot
    circle(kx, ky, c * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; // a sheen down the middle
    ctx.lineWidth = c * 0.03;
    ctx.beginPath(); ctx.moveTo(kx + ax * c * 0.1, ky + ay * c * 0.1); ctx.lineTo(mx, my); ctx.lineTo(ex - bx * c * 0.2, ey - by * c * 0.2); ctx.stroke();
  }

  // The living snakes, in passes, so no snake's shadow falls on another's body.
  const live = [];
  function drawSnakes(alpha, now) {
    live.length = 0;
    for (const s of game.snakes) if (s.alive) live.push(s);
    // (a snake leaping, or still arched over another one, goes on top)
    const over = s => anim.get(s)?.leapUntil > game.tick ? 1 : 0;
    if (live.some(over)) live.sort((p, q) => over(p) - over(q));
    for (const s of live) drawShadow(prepare(s, alpha, now, false));
    for (const s of live) drawOutline(s, animOf(s, now));
    for (const s of live) drawBody(s, animOf(s, now), now, false);
    for (const s of live) if (s.burnUntil > game.tick) drawBurning(s, animOf(s, now), now);
    for (const s of live) { // queasy after a mushroom: a sickly green wash, fading
      const a = animOf(s, now), q = a.queasyAt ? 1 - (now - a.queasyAt) / 1400 : 0;
      if (q > 0 && q <= 1) { ctx.fillStyle = rgba('#65a30d', 0.38 * q); silhouette(a, 0.5); }
    }
  }

  // A snake on fire: flames along its back (the fire's own flicker, smaller,
  // dying down as it goes out), a glow under them, embers and smoke going up.
  function drawBurning(s, a, now) {
    const lively = !reduced, t = now / 1000, left = Math.min(1, (s.burnUntil - game.tick) / (T.BURN_TICKS / 2));
    const size = SPRITE * CELL * (0.45 + 0.25 * left);
    for (let i = 1; i < a.n && i < 12; i += 2) {
      const x = a.pts[2 * i], y = a.pts[2 * i + 1];
      ctx.globalAlpha = 0.45;
      ctx.drawImage(fireGlowSprite(), x - size * 0.6, y - size * 0.6, size * 1.2, size * 1.2);
      ctx.globalAlpha = 1;
      const fr = lively ? Math.floor(t * 14 + i * 3) % FLAME_FRAMES : 0;
      ctx.drawImage(bodyFlameSprite(fr), x - size / 2, y - size * 0.62, size, size);
      if (lively && Math.random() < 0.05) mote(x, y - CELL * 0.3, (Math.random() - 0.5) * 12, -40 - Math.random() * 20, 650, 1.3 + Math.random(), 3);
      if (lively && Math.random() < 0.03) mote(x, y - CELL * 0.3, (Math.random() - 0.5) * 6, -18, 1100, 2.5 + Math.random() * 2, 2);
    }
  }

  // ---------------------------------------------------------------- faces

  // Shared helpers draw in the head's local frame (+x forward, one cell = CELL).
  // gazeX/gazeY: where this snake's eyes point (a unit vector in that frame).
  let blinkNow = false, gazeX = 1, gazeY = 0;
  let headCos = 1, headSin = 0; // the heading the face is drawn turned to
  // The way the head faces, as drawn: it swings round smoothly when the
  // snake turns, and when it turns again and again (a staircase, a wiggle)
  // it holds a steady line between them, instead of whipping round every
  // tick and flinging its tongue from side to side.
  function steer(s, a, now) {
    if (a.hc === undefined) { a.hx = a.hc = s.dir.x; a.hy = a.hs = s.dir.y; a.ldx = s.dir.x; a.ldy = s.dir.y; a.turned = [-1e9, -1e9]; }
    if (s.dir.x !== a.ldx || s.dir.y !== a.ldy) { a.ldx = s.dir.x; a.ldy = s.dir.y; a.turned[0] = a.turned[1]; a.turned[1] = now; }
    const busy = now - a.turned[0] < 650; // (two turns close together)
    const k = reduced ? 1 : 1 - Math.exp(-frameDt / (busy ? 300 : 70));
    a.hx += (s.dir.x - a.hx) * k;
    a.hy += (s.dir.y - a.hy) * k;
    const len = Math.hypot(a.hx, a.hy) || 1;
    a.hc = a.hx / len; a.hs = a.hy / len;
  }

  // Closed eyes: two short lids (at x, ±y), or crosses if knocked out.
  function lids(r, x = 0.14, y0 = 0.2) {
    const c = CELL;
    ctx.strokeStyle = INK;
    ctx.lineWidth = c * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const y of [-y0, y0]) {
      if (deadNow) { cross(x, y, Math.max(r, 0.08) * 0.85); continue; } // knocked out, not asleep
      ctx.moveTo(c * x, c * (y - r));
      ctx.quadraticCurveTo(c * (x + r * 0.9), c * y, c * x, c * (y + r));
    }
    ctx.stroke();
  }

  // An X at (x, y), half-width d, added to the current path.
  function cross(x, y, d) {
    const c = CELL;
    ctx.moveTo(c * (x - d), c * (y - d)); ctx.lineTo(c * (x + d), c * (y + d));
    ctx.moveTo(c * (x + d), c * (y - d)); ctx.lineTo(c * (x - d), c * (y + d));
  }

  // Plain dark eyes, shifted a touch toward what the snake is looking at.
  function eyes(r, fill) {
    if (blinkNow) return lids(r);
    const c = CELL, ox = gazeX * c * 0.03, oy = gazeY * c * 0.03;
    ctx.fillStyle = fill;
    circle(c * 0.15 + ox, -c * 0.2 + oy, c * r);
    circle(c * 0.15 + ox, c * 0.2 + oy, c * r);
  }

  // Small white eyes whose pupils turn toward what the snake is looking at.
  // r: the pupil's radius (the white is a size up).
  function lookingEyes(r, x = 0.15, y = 0.2) {
    if (blinkNow) return lids(r * 1.3, x, y);
    const c = CELL, w = r * 1.55, reach = (w - r) * 0.85;
    ctx.fillStyle = '#fffbea';
    circle(c * x, -c * y, c * w);
    circle(c * x, c * y, c * w);
    ctx.fillStyle = INK;
    const ox = gazeX * c * reach, oy = gazeY * c * reach;
    circle(c * x + ox, -c * y + oy, c * r);
    circle(c * x + ox, c * y + oy, c * r);
    if (r >= 0.045) catchlights(c * x + ox, c * y, oy, c * r);
  }

  // A small mouth at the front of the head, open by `open` (0..1).
  function mouth(open, x = 0.42) {
    if (open < 0.08) return;
    const c = CELL;
    ctx.fillStyle = '#3b0d0d';
    ctx.beginPath();
    ctx.ellipse(c * x, 0, c * (0.03 + 0.04 * open), c * (0.05 + 0.1 * open), 0, 0, TAU);
    ctx.fill();
  }

  function poly(pts, sign, fill) {
    const c = CELL;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0] * c, pts[1] * c * sign);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * c, pts[i + 1] * c * sign);
    ctx.fill();
  }

  const CROWN = [0.02, -0.34, 0.02, 0.34, -0.42, 0.34, -0.22, 0.17, -0.42, 0, -0.22, -0.17, -0.42, -0.34];
  const TRICORN = [0.05, 0, -0.45, -0.45, -0.45, 0.45];
  const BEAK = [0.32, -0.12, 0.6, 0, 0.32, 0.12];
  const EAR = [-0.3, 0.1, -0.05, 0.42, -0.45, 0.5];
  const EAR_IN = [-0.28, 0.18, -0.12, 0.38, -0.38, 0.42];
  const JESTER = [-0.1, 0.3, -0.55, 0.62, -0.32, 0.05];
  const HARLEQUIN = [-0.07, 0.2, 0.15, 0.08, 0.31, 0.2, 0.15, 0.32];
  const WHISKERS = [0.3, 0.45, 0.6];
  // Colonist's tricorn: three corners (one forward), the brim wider than the head.
  const TRI_F = [0.1, 0], TRI_L = [-0.5, -0.6], TRI_R = [-0.5, 0.6], TRI_BOW = 0.1;
  function tricornSide(c, a, b) { // each side's middle pulled in toward the crown
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    ctx.quadraticCurveTo(c * (mx + (-0.28 - mx) * TRI_BOW * 2.4), c * (my * (1 - TRI_BOW * 2.4)), c * b[0], c * b[1]);
  }

  // ------------------------------------------------------- tongues
  // Every few seconds each snake flicks its tongue out and back. You and your
  // friends have the real, forked thing; each rival flicks out something that
  // fits it instead, drawn in the head's frame from the mouth (x = 0.42).
  // Per look: [how often (1 = like you), how long it stays out (1 = like
  // yours), what comes out]. Capricious flicks its mood's; Copycat its model's.
  const FLICKS = {
    player: [1, 1, forked], capricious: [1.2, 1, forked],
    creeper: [0.8, 1.5, slither], drab: [1.8, 1.6, limp], gobbler: [0.6, 1.4, lick], ghost: [1.8, 1.8, wisp],
    sniper: [1.2, 1.5, laser], sovereign: [1.6, 2.4, carpet], colonist: [1.4, 2.2, telescope], vulture: [1.6, 3, bone],
    mason: [1.4, 2.4, papyrus], metagamer: [1.4, 2, keyboard], wildcard: [1.2, 2, bill], desperado: [1.1, 2, revolver],
    joker: [1, 2.4, blower], copycat: [1.2, 1.4, blep], mute: [1.1, 2, innerJaw], ouroboros: [1.6, 1.6, fangs],
  };
  let flickP = -1, flickT = 0; // the flick being drawn: how far through it is (or -1), and how far out (0..1..0)

  // Time this snake's flick (more often near food, if `keen`) and draw it,
  // unless `draw` is false (Sniper's comes out of its scope instead).
  function tongue(a, now, open, look, keen = false, draw = true) {
    const [rate, len, fn] = FLICKS[look] || FLICKS.player;
    flickP = -1; flickT = 0;
    if (deadNow) return;
    if (now > a.nextTongue) {
      a.tongueMs = T.TONGUE_MS * len;
      a.tongueUntil = now + a.tongueMs;
      a.nextTongue = now + T.TONGUE_EVERY * rate * (keen && a.near <= 3 ? 0.4 : 0.7 + Math.random() * 0.8);
    }
    if (now >= a.tongueUntil || open >= 0.08) return;
    flickP = 1 - (a.tongueUntil - now) / a.tongueMs;
    flickT = 1 - Math.abs(flickP * 2 - 1); // out and back
    if (!draw) return;
    ctx.save();
    fn(flickT, flickP);
    ctx.restore();
  }

  // Out all the way for the middle of the flick, not just at its peak.
  const stayOut = (t, k = 1.6) => Math.min(1, t * k);
  // Only what's past the lips shows (for things that slide out of the mouth).
  function fromMouth() {
    ctx.beginPath();
    ctx.rect(CELL * 0.38, -CELL, CELL * 2, CELL * 2);
    ctx.clip();
  }

  // The look Copycat's tongue copies: its model's, or a cat's own blep.
  function copiedLook(s) {
    const m = findById(s.memory.modelId);
    const look = m && m.alive ? lookOf(m) : 'copycat';
    return FLICKS[look] ? look : 'copycat';
  }

  // A snake's own: thin, red and forked.
  function forked(t) {
    const c = CELL, reach = c * (0.42 + 0.3 * t);
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = c * 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c * 0.42, 0); ctx.lineTo(reach, 0);
    ctx.moveTo(reach, 0); ctx.lineTo(reach + c * 0.1, -c * 0.07);
    ctx.moveTo(reach, 0); ctx.lineTo(reach + c * 0.1, c * 0.07);
    ctx.stroke();
  }

  // Creeper: the snakiest tongue of all, long and wriggling.
  function slither(t, p) {
    const c = CELL, len = 0.55 * t;
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = c * 0.05;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(c * 0.42, 0);
    let x = 0.42, y = 0;
    for (let i = 1; i <= 10; i++) {
      x = 0.42 + len * i / 10;
      y = Math.sin(i * 0.9 - p * 30) * 0.06 * i / 10;
      ctx.lineTo(c * x, c * y);
    }
    ctx.lineTo(c * (x + 0.1), c * (y - 0.07));
    ctx.moveTo(c * x, c * y); ctx.lineTo(c * (x + 0.1), c * (y + 0.07));
    ctx.stroke();
  }

  // Drab: can't be bothered. A short, limp tongue, no fork, flopping to one side.
  function limp(t) {
    const c = CELL, r = 0.2 * t;
    ctx.strokeStyle = '#d9a3a8';
    ctx.lineWidth = c * 0.075;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c * 0.42, 0);
    ctx.quadraticCurveTo(c * (0.42 + r), 0, c * (0.42 + r * 1.1), c * r * 0.7);
    ctx.stroke();
  }

  // Gobbler: a fat pink tongue that licks its lips, side to side.
  function lick(t, p) {
    const c = CELL, len = 0.2 * stayOut(t, 2);
    ctx.translate(c * 0.38, 0);
    ctx.rotate(Math.sin(p * TAU) * 0.7);
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.ellipse(c * len * 0.6, 0, c * (0.06 + len * 0.6), c * 0.11, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#e11d48'; // the groove down the middle
    ctx.lineWidth = c * 0.025;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c * 0.05, 0); ctx.lineTo(c * len, 0);
    ctx.stroke();
  }

  // Ghost: a breath of ectoplasm that wafts out and fades back in.
  function wisp(t, p) {
    const c = CELL;
    ctx.globalAlpha *= 0.85 * stayOut(t, 2);
    ctx.fillStyle = '#f0f9ff';
    for (let k = 0; k < 3; k++) {
      const x = 0.48 + (0.15 + 0.16 * k) * t, y = Math.sin(p * 9 + k * 1.7) * 0.07;
      circle(c * x, c * y, c * (0.1 - 0.022 * k));
    }
  }

  // Sniper: the laser sight, a beam and a dot (from the scope, x0 = its lens).
  function laser(t, p, x0 = 0.42) {
    const c = CELL, end = c * (x0 + 1.3 * stayOut(t, 4));
    ctx.strokeStyle = 'rgba(239,68,68,0.75)';
    ctx.lineWidth = c * 0.025;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c * x0, 0); ctx.lineTo(end, 0);
    ctx.stroke();
    ctx.fillStyle = 'rgba(239,68,68,0.35)';
    circle(end, 0, c * 0.09);
    ctx.fillStyle = '#ef4444';
    circle(end, 0, c * 0.045);
    ctx.fillStyle = '#fee2e2';
    circle(end, 0, c * 0.018);
  }

  // Sovereign rolls out the red carpet (for itself): gold-edged, with the roll
  // still to unroll at the far end.
  function carpet(t) {
    const c = CELL, e = stayOut(t), x0 = 0.4, len = 0.6 * e, x1 = x0 + len, rr = 0.045 + 0.04 * (1 - e);
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(c * x0, -c * 0.12, c * len, c * 0.24);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(c * x0, -c * 0.12, c * len, c * 0.03);
    ctx.fillRect(c * x0, c * 0.09, c * len, c * 0.03);
    ctx.fillStyle = '#dc2626'; // the roll
    ctx.fillRect(c * (x1 - rr), -c * 0.13, c * rr * 2, c * 0.26);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(c * (x1 - rr), -c * 0.13, c * rr * 2, c * 0.03);
    ctx.fillRect(c * (x1 - rr), c * 0.1, c * rr * 2, c * 0.03);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(c * (x1 + rr * 0.2), -c * 0.13, c * rr * 0.8, c * 0.26);
  }

  // Colonist: a brass spyglass that draws out, section by section, to look
  // for land to claim.
  function telescope(t) {
    const c = CELL, e = stayOut(t), x = 0.38 - 0.24 * (1 - e);
    fromMouth();
    const tube = (x0, len, w) => {
      ctx.fillStyle = '#d4a017';
      ctx.fillRect(c * x0, -c * w, c * len, c * w * 2);
      ctx.fillStyle = '#fde68a'; // a shine along the top
      ctx.fillRect(c * x0, -c * w, c * len, c * w * 0.6);
      ctx.fillStyle = '#78350f'; // a ring at the front
      ctx.fillRect(c * (x0 + len - 0.03), -c * w, c * 0.03, c * w * 2);
    };
    ctx.fillStyle = '#bae6fd'; // the lens
    ctx.fillRect(c * (x + 0.38 * e + 0.17), -c * 0.06, c * 0.035, c * 0.12);
    tube(x + 0.38 * e, 0.19, 0.075); // the thinnest slides furthest...
    tube(x + 0.2 * e, 0.2, 0.095);
    tube(x, 0.22, 0.12); // ...out of the widest
  }

  // Vulture: a bone, held crosswise and chewed on a moment.
  function bone(t, p) {
    const c = CELL, k = stayOut(t, 3);
    ctx.translate(c * 0.64, 0);
    ctx.rotate(0.3 + Math.sin(p * 14) * 0.08);
    ctx.scale(k, k);
    const shape = () => {
      ctx.beginPath();
      ctx.rect(-c * 0.045, -c * 0.25, c * 0.09, c * 0.5);
      for (const y of [-0.26, 0.26]) for (const x of [-0.05, 0.05]) {
        ctx.moveTo(c * (x + 0.06), c * y);
        ctx.arc(c * x, c * y, c * 0.06, 0, TAU);
      }
    };
    ctx.strokeStyle = '#57534e'; // an outline round the whole bone...
    ctx.lineWidth = c * 0.05;
    shape();
    ctx.stroke();
    ctx.fillStyle = '#f5f5f4'; // ...then the bone over it
    shape();
    ctx.fill();
  }

  // Mason: a papyrus scroll, unrolled from the mouth: lines of writing (Latin,
  // naturally), a wooden rod at each end, and what's still rolled up at the far end.
  function papyrus(t) {
    const c = CELL, e = stayOut(t), x0 = 0.4, len = 0.56 * e, x1 = x0 + len, w = 0.17, rr = 0.035 + 0.045 * (1 - e);
    ctx.fillStyle = '#ecdcae'; // the sheet...
    ctx.fillRect(c * x0, -c * w, c * len, c * w * 2);
    ctx.fillStyle = 'rgba(146,110,52,0.35)'; // ...browner along its edges
    ctx.fillRect(c * x0, -c * w, c * len, c * 0.025);
    ctx.fillRect(c * x0, c * (w - 0.025), c * len, c * 0.025);
    ctx.strokeStyle = 'rgba(58,38,20,0.6)'; // the writing
    ctx.lineWidth = c * 0.02;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0, x = x0 + 0.07; x < x1 - rr - 0.03; i++, x += 0.065) {
      ctx.moveTo(c * x, -c * (w - 0.05));
      ctx.lineTo(c * x, c * (w - 0.05 - (i % 3) * 0.05));
    }
    ctx.stroke();
    const roll = (x, rad) => { // a rolled end: the roll, its rod's knobs either side
      ctx.fillStyle = '#d9c38c';
      ctx.fillRect(c * (x - rad), -c * (w + 0.015), c * rad * 2, c * (w + 0.015) * 2);
      ctx.fillStyle = 'rgba(58,38,20,0.25)';
      ctx.fillRect(c * (x + rad * 0.3), -c * (w + 0.015), c * rad * 0.7, c * (w + 0.015) * 2);
      ctx.fillStyle = '#7c2d12';
      circle(c * x, -c * (w + 0.05), c * 0.04);
      circle(c * x, c * (w + 0.05), c * 0.04);
    };
    roll(x0, 0.035);
    roll(x1, rr);
  }

  // Metagamer: a keyboard, slid out to type up its notes on you (a key or two
  // lighting up as it types).
  function keyboard(t, p) {
    const c = CELL;
    fromMouth();
    ctx.translate(-c * 0.62 * (1 - stayOut(t)), 0);
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = c * 0.025;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(c * 0.38, -c * 0.19, c * 0.6, c * 0.38, c * 0.05); else ctx.rect(c * 0.38, -c * 0.19, c * 0.6, c * 0.38);
    ctx.fill();
    ctx.stroke();
    const typing = Math.floor(p * 24); // which keys are down right now
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 7; col++) {
        if (row === 2 && col > 1 && col < 5) continue; // (the space bar's there)
        const lit = (col * 7 + row * 3 + typing * 5) % 11 === 0;
        ctx.fillStyle = lit ? '#22d3ee' : '#e2e8f0';
        ctx.fillRect(c * (0.42 + col * 0.077), c * (-0.15 + row * 0.105), c * 0.06, c * 0.08);
      }
    }
    ctx.fillStyle = typing % 4 === 1 ? '#22d3ee' : '#e2e8f0';
    ctx.fillRect(c * (0.42 + 2 * 0.077), c * (-0.15 + 2 * 0.105), c * (3 * 0.077 - 0.017), c * 0.08);
  }

  // Wildcard: a dollar bill, slid out like a tip.
  function bill(t, p) {
    const c = CELL;
    fromMouth();
    ctx.translate(-c * 0.52 * (1 - stayOut(t)), 0);
    ctx.rotate(Math.sin(p * 18) * 0.04); // a little flutter
    ctx.fillStyle = '#c7e3b8';
    ctx.strokeStyle = '#3f6212';
    ctx.lineWidth = c * 0.025;
    ctx.fillRect(c * 0.36, -c * 0.12, c * 0.52, c * 0.24);
    ctx.strokeRect(c * 0.36, -c * 0.12, c * 0.52, c * 0.24);
    ctx.strokeStyle = '#65a30d'; // the inner border...
    ctx.lineWidth = c * 0.012;
    ctx.strokeRect(c * 0.4, -c * 0.085, c * 0.44, c * 0.17);
    ctx.fillStyle = '#3f6212'; // ...and the dollar sign in the middle
    ctx.font = `800 ${c * 0.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', c * 0.62, c * 0.01);
  }

  // Desperado: the six-shooter. Out, bang (a flash and a puff of smoke), back.
  function revolver(t, p) {
    const c = CELL;
    ctx.save();
    fromMouth();
    ctx.translate(-c * 0.55 * (1 - stayOut(t)), 0);
    ctx.fillStyle = '#d6d3d1'; // the barrel, silver and outlined...
    ctx.strokeStyle = '#292524';
    ctx.lineWidth = c * 0.025;
    ctx.fillRect(c * 0.5, -c * 0.055, c * 0.4, c * 0.11);
    ctx.strokeRect(c * 0.5, -c * 0.055, c * 0.4, c * 0.11);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(c * 0.52, -c * 0.035, c * 0.36, c * 0.025);
    ctx.fillStyle = '#292524'; // ...its front sight...
    ctx.fillRect(c * 0.84, -c * 0.02, c * 0.04, c * 0.04);
    ctx.fillStyle = '#a8a29e'; // ...and the cylinder, six chambers
    circle(c * 0.47, 0, c * 0.13);
    ctx.stroke();
    ctx.fillStyle = '#292524';
    for (let i = 0; i < 6; i++) circle(c * (0.47 + Math.cos(i * TAU / 6) * 0.075), c * Math.sin(i * TAU / 6) * 0.075, c * 0.025);
    ctx.restore();
    if (p > 0.4 && p < 0.52) { // bang
      ctx.fillStyle = '#fde047';
      circle(c * 0.98, 0, c * 0.1);
      ctx.fillStyle = '#ffffff';
      circle(c * 0.98, 0, c * 0.05);
    }
    const sp = (p - 0.45) / 0.55;
    if (sp > 0) { // the smoke drifting off
      ctx.globalAlpha *= 0.85 * (1 - sp);
      ctx.fillStyle = '#f5f5f4';
      for (let k = 0; k < 3; k++) circle(c * (0.98 + 0.14 * sp + 0.08 * k), c * (k - 1) * 0.06 * (1 + sp), c * (0.06 + 0.05 * sp) * (1 - k * 0.15));
    }
  }

  // Joker: a party horn (a blowout). A mouthpiece, then a flat paper tube,
  // striped, that unrolls from its curl with a toot: at full stretch its
  // fringed tip flutters and a puff of confetti flies off it; then it rolls
  // back up. Outlined, so it reads at phone size.
  const HORN = ['#ec4899', '#facc15', '#8b5cf6', '#facc15'];
  function blower(t, p) {
    const c = CELL, e = stayOut(t, 1.4), k = Math.min(1, t * 5);
    ctx.translate(c * 0.4, 0); // (pops out of the mouth)
    ctx.scale(k, k);
    ctx.translate(-c * 0.4, 0);
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#f8fafc'; // the mouthpiece
    ctx.strokeStyle = INK;
    ctx.lineWidth = c * 0.025;
    ctx.beginPath(); ctx.rect(c * 0.36, -c * 0.05, c * 0.15, c * 0.1); ctx.fill(); ctx.stroke();
    // The tube, as far as it's unrolled...
    const w = c * 0.17, x0 = c * 0.5, len = c * 0.95 * e, n = Math.max(1, Math.round(len / (c * 0.1)));
    if (len > 0.5) {
      ctx.fillStyle = INK;
      ctx.fillRect(x0, -w / 2 - c * 0.02, len, w + c * 0.04);
      for (let i = 0; i < n; i++) { ctx.fillStyle = HORN[i % 4]; ctx.fillRect(x0 + len * i / n, -w / 2, len / n + 0.4, w); }
    }
    const x1 = x0 + len, curl = 1 - e;
    if (curl > 0.04) { // ...and the rest still rolled up at its end: a spiral, curling up and back
      const R = c * (0.05 + 0.12 * curl), turns = 0.8 + 1.6 * curl, steps = Math.ceil(turns * 10);
      const pts = [[x1, 0]];
      for (let i = 1; i <= steps; i++) {
        const a = i / steps * turns * TAU, rr = R * (1 - 0.6 * i / steps);
        pts.push([x1 + Math.sin(a) * rr, -R + Math.cos(a) * rr]);
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = w * 0.8 + c * 0.04;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.lineWidth = w * 0.8;
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = HORN[(n + i) % 4];
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
    } else { // full stretch: a fringe fluttering at the tip, and a toot of confetti
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = c * 0.03;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let j = 0; j < 4; j++) {
        const a = -0.5 + j * 0.33 + Math.sin(p * 40 + j * 1.7) * 0.18, y0 = (j - 1.5) * w / 4;
        ctx.moveTo(x1, y0); ctx.lineTo(x1 + Math.cos(a) * c * 0.17, y0 + Math.sin(a) * c * 0.17);
      }
      ctx.stroke();
      const q = Math.max(0, Math.min(1, (p - 0.3) / 0.4));
      if (q > 0 && q < 1) {
        ctx.globalAlpha *= 1 - q;
        for (let j = 0; j < 5; j++) {
          ctx.fillStyle = HORN[j % 4];
          ctx.fillRect(x1 + c * (0.12 + 0.35 * q + 0.04 * j), Math.sin(j * 2.3) * c * 0.22 * q - c * 0.025, c * 0.05, c * 0.05);
        }
      }
    }
  }

  // Mute: its painted lips part, and a second, inner jaw shoots out on its
  // stalk (glossy, dark, with little silver teeth, snapping), then back in.
  // A mime with a secret. It still never says a word.
  function innerJaw(t, p) {
    const c = CELL, e = stayOut(t, 2.2), x = c * (0.44 + 0.34 * e);
    ctx.translate(c * 0.4, 0); // (drawn big, from the mouth, so it reads at play size)
    ctx.scale(1.6, 1.6);
    ctx.translate(-c * 0.4, 0);
    ctx.fillStyle = '#1c1917'; // the lips parted wide...
    ctx.beginPath(); ctx.ellipse(c * 0.4, 0, c * 0.06, c * 0.11, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f1f5f9'; // ...teeth showing
    for (const sg of [-1, 1]) for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(c * (0.4 + i * 0.03), sg * c * 0.1); ctx.lineTo(c * (0.415 + i * 0.03), sg * c * 0.05); ctx.lineTo(c * (0.43 + i * 0.03), sg * c * 0.1); ctx.fill();
    }
    if (e < 0.05) return;
    const mid = (c * 0.42 + x) / 2;
    ctx.fillStyle = '#334155'; // the stalk: tapering, ribbed, glossy
    ctx.beginPath();
    ctx.moveTo(c * 0.42, -c * 0.065); ctx.quadraticCurveTo(mid, -c * 0.035, x - c * 0.08, -c * 0.045);
    ctx.lineTo(x - c * 0.08, c * 0.045); ctx.quadraticCurveTo(mid, c * 0.035, c * 0.42, c * 0.065);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let rx = c * 0.47; rx < x - c * 0.1; rx += c * 0.05) { ctx.moveTo(rx, -c * 0.04); ctx.lineTo(rx, c * 0.04); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = c * 0.015;
    ctx.beginPath(); ctx.moveTo(c * 0.44, -c * 0.035); ctx.lineTo(x - c * 0.1, -c * 0.028); ctx.stroke();
    const bite = 0.5 + 0.5 * Math.sin(p * TAU * 4); // (snapping)
    ctx.fillStyle = '#1e293b'; // the inner head: a glossy dome...
    ctx.beginPath(); ctx.ellipse(x, 0, c * 0.13, c * 0.09, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(x - c * 0.03, -c * 0.045, c * 0.06, c * 0.02, -0.15, 0, TAU); ctx.fill();
    const mx = x + c * 0.1, gap = c * (0.015 + 0.035 * bite); // ...its jaws open at the front...
    ctx.fillStyle = '#0b0f19';
    ctx.beginPath(); ctx.ellipse(mx, 0, c * 0.05, gap + c * 0.012, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e2e8f0'; // ...two rows of little silver teeth
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const tx = mx - c * 0.045 + i * c * 0.026, ty = sg * (gap + c * 0.01);
        ctx.moveTo(tx, ty); ctx.lineTo(tx + c * 0.013, ty - sg * c * 0.032); ctx.lineTo(tx + c * 0.026, ty);
      }
      ctx.fill();
    }
  }

  // Ouroboros: no forked tongue (only people have that): it bares its fangs.
  function fangs(t) {
    const c = CELL, e = stayOut(t, 2), x0 = c * 0.55; // (from the tip of its snout, past the wedge of its head)
    ctx.fillStyle = '#1c1917'; // the jaw, dropping open
    ctx.beginPath(); ctx.ellipse(x0, 0, c * 0.06, c * (0.04 + 0.1 * e), 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = 'rgba(58,36,8,0.85)';
    ctx.lineWidth = c * 0.02;
    for (const sg of [-1, 1]) { // two long fangs, curving forward and in
      ctx.beginPath();
      ctx.moveTo(x0 - c * 0.03, sg * c * 0.06);
      ctx.quadraticCurveTo(x0 + c * (0.14 + 0.08 * e), sg * c * 0.08, x0 + c * (0.16 + 0.14 * e), sg * c * (0.02 - 0.04 * e));
      ctx.lineTo(x0 + c * 0.06, sg * c * 0.13);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  // Copycat with no one to copy: a cat's blep, the tip of a pink tongue.
  function blep(t) {
    const c = CELL, e = stayOut(t, 2);
    ctx.fillStyle = '#f472b6'; // (deeper than its pale head)
    ctx.beginPath();
    ctx.ellipse(c * (0.44 + 0.06 * e), 0, c * (0.03 + 0.05 * e), c * 0.075, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#be185d';
    ctx.lineWidth = c * 0.02;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c * 0.44, 0); ctx.lineTo(c * (0.45 + 0.07 * e), 0);
    ctx.stroke();
  }

  // Your face: white eyes whose pupils glance toward the nearest food, a
  // mouth that opens for a bite, a blink now and then, and a forked tongue flick.

  function drawPlayerFace(s, a, now, blinking) {
    const c = CELL;
    const open = mouthOpen(s, a);
    tongue(a, now, open, 'player', true);
    mouth(open, 0.44);

    if (blinking) return lids(0.11);
    ctx.fillStyle = '#fffbea';
    circle(c * 0.16, -c * 0.2, c * 0.13);
    circle(c * 0.16, c * 0.2, c * 0.13);
    ctx.fillStyle = INK;
    const ox = gazeX * c * 0.05, oy = gazeY * c * 0.05;
    circle(c * 0.16 + ox, -c * 0.2 + oy, c * 0.07);
    circle(c * 0.16 + ox, c * 0.2 + oy, c * 0.07);
    catchlights(c * 0.16 + ox, c * 0.2, oy, c * 0.07);
  }

  // A speck of light in each pupil (at x, ±y + oy, pupils of radius pr), so eyes look alive.
  // (The face is drawn turned to the heading, so the light's offset is turned back.)
  function catchlights(x, y, oy, pr) {
    catchlight(x, -y + oy, pr);
    catchlight(x, y + oy, pr);
  }
  function catchlight(x, y, pr) {
    const dx = -pr * 0.35, dy = -pr * 0.35;
    ctx.fillStyle = '#ffffff';
    circle(x + headCos * dx + headSin * dy, y - headSin * dx + headCos * dy, pr * 0.38);
  }

  function drawFace(s, look, color, blinking, a) {
    const c = CELL;
    blinkNow = blinking;
    const open = mouthOpen(s, a);
    const flicks = look === 'copycat' ? copiedLook(s) : look;
    tongue(a, lastNow, open, flicks, flicks === 'gobbler', look !== 'sniper');
    switch (look) {
      case 'sniper': { // one eye squeezed shut (it never blinks on the job), the other behind a scope that swings onto its target
        ctx.strokeStyle = INK;
        ctx.lineWidth = c * 0.06;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (deadNow) cross(0.14, 0.2, 0.085);
        else { ctx.moveTo(c * 0.08, c * 0.11); ctx.lineTo(c * 0.2, c * 0.2); ctx.lineTo(c * 0.08, c * 0.29); }
        ctx.stroke();
        mouth(open, 0.4);
        ctx.save();
        ctx.translate(c * 0.1, -c * 0.2);
        // Aim, within reason; knocked out, the scope slumps off to the side.
        ctx.rotate(deadNow ? -1.25 : Math.max(-0.45, Math.min(0.45, Math.atan2(gazeY, gazeX))));
        ctx.fillStyle = '#1c1917'; // the scope: eyepiece, tube and a wider front bell
        circle(0, 0, c * 0.14);
        ctx.fillRect(0, -c * 0.09, c * 0.34, c * 0.18);
        circle(c * 0.36, 0, c * 0.15);
        ctx.fillStyle = '#57534e'; // a sheen along the top of the tube
        ctx.fillRect(0, -c * 0.09, c * 0.34, c * 0.045);
        ctx.fillStyle = deadNow ? '#475569' : '#7dd3fc'; // the lens, with a glint (or cracked)
        circle(c * 0.4, 0, c * 0.09);
        if (deadNow) {
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = c * 0.02;
          ctx.beginPath();
          ctx.moveTo(c * 0.34, -c * 0.06); ctx.lineTo(c * 0.4, -c * 0.01); ctx.lineTo(c * 0.37, c * 0.02); ctx.lineTo(c * 0.45, c * 0.06);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#ffffff';
          circle(c * 0.43, -c * 0.04, c * 0.03);
        }
        if (flickP >= 0) laser(flickT, flickP, 0.49); // its tongue: the laser sight
        ctx.restore();
        break;
      }
      case 'gobbler': { // stuffed hamster cheeks either side of the mouth, a mouth that opens near food
        // After a bite the cheeks puff up fast and go down slowly (still with reduced motion: no movement, just size).
        const t = (lastNow - a.ateAt) / T.CHEEKS_MS;
        const puff = t < 0 || t >= 1 ? 0 : t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
        const cr = c * (0.25 + 0.1 * puff), cy = c * (0.27 + 0.06 * puff);
        ctx.fillStyle = color; // the cheeks swell the head's own outline toward the front...
        circle(c * 0.24, -cy, cr);
        circle(c * 0.24, cy, cr);
        ctx.fillStyle = mix(color, '#ffffff', 0.22); // ...catch the light on top...
        circle(c * 0.2, -cy - c * 0.03, cr * 0.6);
        circle(c * 0.2, cy + c * 0.03, cr * 0.6);
        ctx.fillStyle = puff > 0.3 ? 'rgba(244,114,182,0.65)' : 'rgba(244,114,182,0.45)'; // ...and blush toward the mouth
        ctx.beginPath();
        ctx.ellipse(c * 0.3, -cy - c * 0.03, c * 0.11, c * 0.07, 0, 0, TAU);
        ctx.moveTo(c * 0.41, cy + c * 0.03); // a separate shape, not joined to the first
        ctx.ellipse(c * 0.3, cy + c * 0.03, c * 0.11, c * 0.07, 0, 0, TAU);
        ctx.fill();
        // A big mouth: open wide within 3 cells of food, and chomping after a bite.
        const hungry = a.near <= 3 ? 1 : 0;
        const gape = Math.max(open, hungry);
        ctx.fillStyle = '#3b0d0d';
        ctx.beginPath();
        if (gape > 0.5) ctx.arc(c * 0.38, 0, c * (0.12 + 0.08 * gape), -Math.PI / 2, Math.PI / 2);
        else ctx.ellipse(c * 0.38, 0, c * 0.04, c * (0.12 + 0.08 * gape), 0, 0, TAU);
        ctx.fill();
        // Eyes that grow as food gets closer.
        const greed = Math.max(0, 1 - a.near / 6);
        lookingEyes(0.055 * (1 + 0.8 * greed), 0.12, 0.2);
        break;
      }
      case 'ghost': { // hollow, tall eyes that drift toward the nearest threat
        mouth(open * 0.6, 0.4);
        if (blinking) { lids(0.12); break; }
        const ox = gazeX * c * 0.04, oy = gazeY * c * 0.04;
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.ellipse(c * 0.12 + ox, -c * 0.2 + oy, c * 0.1, c * 0.14, 0, 0, TAU);
        ctx.ellipse(c * 0.12 + ox, c * 0.2 + oy, c * 0.1, c * 0.14, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#cbd5e1'; // a pale glint in each hollow, turned to what it's watching
        circle(c * 0.12 + ox * 2.2, -c * 0.2 + oy * 2.2, c * 0.03);
        circle(c * 0.12 + ox * 2.2, c * 0.2 + oy * 2.2, c * 0.03);
        break;
      }
      case 'sovereign': // a golden crown, spikes pointing back
        poly(CROWN, 1, '#facc15');
        ctx.fillStyle = '#dc2626';
        circle(-c * 0.06, 0, c * 0.07);
        mouth(open);
        lookingEyes(0.055);
        break;
      case 'colonist': { // a redcoat's tricorn from above: three corners (one forward), brims bowing in, thin gold lace, a raised crown
        // The brim: three rounded corners joined by sides that curve inward.
        ctx.beginPath();
        ctx.moveTo(c * TRI_F[0], c * TRI_F[1]);
        tricornSide(c, TRI_F, TRI_L); tricornSide(c, TRI_L, TRI_R); tricornSide(c, TRI_R, TRI_F);
        ctx.closePath();
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#1c1917';
        ctx.strokeStyle = '#facc15'; // gold lace along the edge
        ctx.lineWidth = c * 0.035;
        ctx.fill();
        ctx.stroke();
        ctx.lineJoin = 'miter';
        ctx.fillStyle = '#2f2a27'; // the crown, catching a little light
        ctx.beginPath();
        ctx.ellipse(-c * 0.27, 0, c * 0.15, c * 0.22, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        circle(-c * 0.31, -c * 0.06, c * 0.045);
        mouth(open);
        lookingEyes(0.055);
        break;
      }
      case 'drab': { // bored, heavy-lidded eyes that do drift toward lunch
        mouth(open * 0.5);
        if (blinking) { lids(0.09); break; }
        const ox = gazeX * c * 0.035, oy = gazeY * c * 0.04;
        ctx.fillStyle = '#fffbea';
        circle(c * 0.15, -c * 0.2, c * 0.09);
        circle(c * 0.15, c * 0.2, c * 0.09);
        ctx.fillStyle = INK;
        circle(c * 0.17 + ox, -c * 0.2 + oy, c * 0.045);
        circle(c * 0.17 + ox, c * 0.2 + oy, c * 0.045);
        ctx.fillStyle = mix(color, '#000000', 0.18); // the lids, drooping over the back half
        ctx.beginPath();
        ctx.arc(c * 0.15, -c * 0.2, c * 0.1, Math.PI / 2, Math.PI * 1.5);
        ctx.arc(c * 0.15, c * 0.2, c * 0.1, Math.PI / 2, Math.PI * 1.5);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = c * 0.035;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(c * 0.15, -c * 0.3); ctx.lineTo(c * 0.15, -c * 0.1);
        ctx.moveTo(c * 0.15, c * 0.1); ctx.lineTo(c * 0.15, c * 0.3);
        ctx.stroke();
        break;
      }
      case 'vulture': { // beady eyes under a scowl, and a big hooked beak that gapes at a meal
        const beak = () => {
          ctx.beginPath();
          ctx.moveTo(c * 0.2, -c * 0.17);
          ctx.quadraticCurveTo(c * 0.56, -c * 0.17, c * 0.8, c * 0.04); // over the top to the hook
          ctx.quadraticCurveTo(c * 0.62, c * 0.14, c * 0.2, c * 0.17);
          ctx.closePath();
        };
        ctx.fillStyle = '#e7d7a8'; // pale horn, outlined dark so it reads small
        ctx.strokeStyle = '#292524';
        ctx.lineWidth = c * 0.04;
        ctx.lineJoin = 'round';
        beak();
        ctx.fill();
        ctx.save();
        beak();
        ctx.clip();
        ctx.fillStyle = '#a8a29e'; // a grey cere across the base...
        ctx.fillRect(c * 0.18, -c * 0.2, c * 0.1, c * 0.4);
        ctx.fillStyle = '#44403c'; // ...and a dark hooked tip
        ctx.beginPath();
        ctx.moveTo(c * 0.58, -c * 0.2);
        ctx.quadraticCurveTo(c * 0.62, c * 0.02, c * 0.56, c * 0.2);
        ctx.lineTo(c * 0.9, c * 0.2); ctx.lineTo(c * 0.9, -c * 0.2);
        ctx.fill();
        if (open > 0.08) { // gaping at a meal
          ctx.fillStyle = '#3b0d0d';
          ctx.beginPath();
          ctx.ellipse(c * 0.46, c * 0.03, c * 0.22 * open, c * 0.05, 0.08, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        beak();
        ctx.stroke();
        ctx.fillStyle = '#44403c'; // a nostril
        ctx.beginPath();
        ctx.ellipse(c * 0.36, -c * 0.07, c * 0.04, c * 0.018, 0.2, 0, TAU);
        ctx.fill();
        lookingEyes(0.05, 0.1, 0.24);
        if (!deadNow) { // brows slanting down to the beak
          ctx.strokeStyle = INK;
          ctx.lineWidth = c * 0.06;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-c * 0.01, -c * 0.34); ctx.lineTo(c * 0.1, -c * 0.15);
          ctx.moveTo(-c * 0.01, c * 0.34); ctx.lineTo(c * 0.1, c * 0.15);
          ctx.stroke();
        }
        break;
      }
      case 'mason': { // laurel wreath around the back of the head; eyes on the job
        // Two branches from a knot at the back, round the sides of the head, open at the front.
        ctx.strokeStyle = '#3f6212';
        ctx.lineWidth = c * 0.03;
        ctx.beginPath();
        ctx.arc(0, 0, c * 0.36, Math.PI * 0.52, Math.PI * 1.48);
        ctx.stroke();
        for (let side = -1; side <= 1; side += 2) {
          for (let k = 0; k < 4; k++) {
            const ang = Math.PI + side * (0.12 + k * 0.12) * Math.PI;
            const ex = Math.cos(ang) * c * 0.36, ey = Math.sin(ang) * c * 0.36;
            const along = ang + side * Math.PI / 2; // the way the branch grows (toward the front)
            for (let tilt = -0.6; tilt < 1; tilt += 1.2) { // a pair of leaves either side of the stem
              const dir = along + tilt;
              ctx.fillStyle = tilt < 0 ? '#65a30d' : '#4d7c0f';
              ctx.beginPath();
              ctx.ellipse(ex + Math.cos(dir) * c * 0.05, ey + Math.sin(dir) * c * 0.05, c * 0.07, c * 0.032, dir, 0, TAU);
              ctx.fill();
            }
          }
        }
        ctx.fillStyle = '#facc15'; // the knot
        circle(-c * 0.37, 0, c * 0.04);
        mouth(open);
        lookingEyes(0.055);
        break;
      }
      case 'creeper': { // narrow glinting eyes on whoever's tail it rides
        mouth(open * 0.6, 0.4);
        if (blinking) { lids(0.12); break; }
        const ox = gazeX * c * 0.05, oy = gazeY * c * 0.05;
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.ellipse(c * 0.15 + ox, -c * 0.2 + oy, c * 0.035, c * 0.12, 0, 0, TAU);
        ctx.ellipse(c * 0.15 + ox, c * 0.2 + oy, c * 0.035, c * 0.12, 0, 0, TAU);
        ctx.fill();
        break;
      }
      case 'metagamer': { // 3D glasses (red and cyan, card frame), eyes on whoever it's studying through them
        mouth(open);
        lookingEyes(0.05);
        const lens = (sg, tint) => {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(c * 0.03, sg < 0 ? -c * 0.33 : c * 0.07, c * 0.25, c * 0.26, c * 0.06);
          else ctx.rect(c * 0.03, sg < 0 ? -c * 0.33 : c * 0.07, c * 0.25, c * 0.26);
          ctx.fillStyle = tint;
          ctx.fill();
        };
        lens(-1, 'rgba(239,68,68,0.62)'); // left eye red...
        lens(1, 'rgba(14,165,233,0.6)'); // ...right eye cyan
        for (const [w, col] of [[0.085, '#0f172a'], [0.05, '#f8fafc']]) { // the card frame, outlined so it reads on a cyan head
          ctx.strokeStyle = col;
          ctx.lineWidth = c * w;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (const sg of [-1, 1]) {
            const y0 = sg < 0 ? -c * 0.33 : c * 0.07;
            if (ctx.roundRect) ctx.roundRect(c * 0.03, y0, c * 0.25, c * 0.26, c * 0.06); else ctx.rect(c * 0.03, y0, c * 0.25, c * 0.26);
            ctx.moveTo(c * 0.1, sg * c * 0.33); ctx.lineTo(-c * 0.14, sg * c * 0.36); // the arms, back over the head
          }
          ctx.moveTo(c * 0.15, -c * 0.07); ctx.lineTo(c * 0.15, c * 0.07); // the bridge
          ctx.stroke();
        }
        break;
      }
      case 'wildcard': { // a golden combover swept forward with a flip at the front, squinty eyes, a pout
        // The hair, seen from above: a puffy golden mass at the back, combed
        // across to one side and forward, ending in a curl over that eye.
        const hair = () => {
          ctx.beginPath();
          ctx.moveTo(-c * 0.2, c * 0.44); // the back of the far side...
          ctx.bezierCurveTo(-c * 0.62, c * 0.42, -c * 0.66, -c * 0.3, -c * 0.32, -c * 0.5); // ...puffed out round the back...
          ctx.bezierCurveTo(-c * 0.04, -c * 0.62, c * 0.3, -c * 0.56, c * 0.36, -c * 0.34); // ...swept forward along the near side...
          ctx.bezierCurveTo(c * 0.4, -c * 0.2, c * 0.24, -c * 0.12, c * 0.18, -c * 0.24); // ...the curl over the brow...
          ctx.bezierCurveTo(c * 0.1, -c * 0.34, -c * 0.06, -c * 0.12, -c * 0.06, c * 0.08); // ...the parting line, back across...
          ctx.bezierCurveTo(-c * 0.06, c * 0.26, -c * 0.12, c * 0.38, -c * 0.2, c * 0.44);
          ctx.closePath();
        };
        ctx.save();
        ctx.translate(-c * 0.02, c * 0.03);
        hair();
        ctx.fillStyle = 'rgba(120,53,15,0.35)'; // its shadow on the head
        ctx.fill();
        ctx.restore();
        hair();
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#fde68a'; // combed strands, all swept the same way
        ctx.lineWidth = c * 0.024;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-c * 0.18, c * 0.32); ctx.bezierCurveTo(-c * 0.5, c * 0.2, -c * 0.4, -c * 0.42, c * 0.08, -c * 0.46);
        ctx.moveTo(-c * 0.1, c * 0.16); ctx.bezierCurveTo(-c * 0.34, c * 0.04, -c * 0.24, -c * 0.36, c * 0.2, -c * 0.4);
        ctx.moveTo(-c * 0.36, c * 0.3); ctx.bezierCurveTo(-c * 0.56, 0, -c * 0.5, -c * 0.34, -c * 0.2, -c * 0.46);
        ctx.stroke();
        ctx.strokeStyle = '#d97706'; // the curl's edge
        ctx.lineWidth = c * 0.03;
        ctx.beginPath();
        ctx.moveTo(c * 0.34, -c * 0.32); ctx.bezierCurveTo(c * 0.36, -c * 0.2, c * 0.24, -c * 0.16, c * 0.2, -c * 0.24);
        ctx.stroke();
        // A pout.
        if (open > 0.08) mouth(open, 0.43);
        else {
          ctx.fillStyle = '#f472b6';
          ctx.beginPath(); ctx.ellipse(c * 0.42, 0, c * 0.045, c * 0.06, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#9d174d';
          ctx.beginPath(); ctx.ellipse(c * 0.43, 0, c * 0.018, c * 0.025, 0, 0, TAU); ctx.fill();
        }
        if (blinking) { lids(0.08); break; }
        // Squinting eyes, both wandering about together.
        const ox = gazeX * c * 0.03, oy = gazeY * c * 0.035;
        ctx.fillStyle = '#fffbea';
        ctx.beginPath();
        ctx.ellipse(c * 0.2, -c * 0.06, c * 0.065, c * 0.08, 0, 0, TAU);
        ctx.ellipse(c * 0.2, c * 0.22, c * 0.065, c * 0.08, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = INK;
        circle(c * 0.21 + ox, -c * 0.06 + oy, c * 0.04);
        circle(c * 0.21 + ox, c * 0.22 + oy, c * 0.04);
        ctx.fillStyle = '#ffffff';
        circle(c * 0.2 + ox, -c * 0.075 + oy, c * 0.015);
        circle(c * 0.2 + ox, c * 0.205 + oy, c * 0.015);
        ctx.strokeStyle = INK; // the squint: heavy lids across the back of each eye
        ctx.lineWidth = c * 0.03;
        ctx.beginPath();
        ctx.moveTo(c * 0.17, -c * 0.14); ctx.quadraticCurveTo(c * 0.14, -c * 0.06, c * 0.17, c * 0.02);
        ctx.moveTo(c * 0.17, c * 0.14); ctx.quadraticCurveTo(c * 0.14, c * 0.22, c * 0.17, c * 0.3);
        ctx.stroke();
        break;
      }
      case 'copycat': { // cat ears, cat eyes, whiskers, and a party pin
        poly(EAR, -1, color);
        poly(EAR, 1, color);
        poly(EAR_IN, -1, '#f9a8d4');
        poly(EAR_IN, 1, '#f9a8d4');
        mouth(open * 0.7, 0.4);
        if (blinking) lids(0.1);
        else {
          ctx.fillStyle = '#16a34a';
          ctx.beginPath();
          ctx.ellipse(c * 0.15, -c * 0.2, c * 0.08, c * 0.1, 0, 0, TAU);
          ctx.ellipse(c * 0.15, c * 0.2, c * 0.08, c * 0.1, 0, 0, TAU);
          ctx.fill();
          const ox = gazeX * c * 0.03, oy = gazeY * c * 0.05; // slit pupils on its model
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.ellipse(c * 0.15 + ox, -c * 0.2 + oy, c * 0.025, c * 0.08, 0, 0, TAU);
          ctx.ellipse(c * 0.15 + ox, c * 0.2 + oy, c * 0.025, c * 0.08, 0, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(15,23,42,0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let w = 0; w < 3; w++) {
          ctx.moveTo(c * 0.34, -c * 0.08); ctx.lineTo(c * 0.52, -c * WHISKERS[w]);
          ctx.moveTo(c * 0.34, c * 0.08); ctx.lineTo(c * 0.52, c * WHISKERS[w]);
        }
        ctx.stroke();
        // Party member: a little hammer and sickle on the back of the head.
        ctx.save();
        ctx.translate(-c * 0.2, 0);
        ctx.rotate(Math.PI / 2);
        ctx.strokeStyle = '#fde047';
        ctx.fillStyle = '#fde047';
        ctx.lineWidth = c * 0.05;
        ctx.beginPath();
        ctx.arc(0, 0, c * 0.15, -Math.PI * 0.25, Math.PI * 0.95);
        ctx.stroke();
        ctx.rotate(-Math.PI / 4);
        ctx.fillRect(-c * 0.02, -c * 0.16, c * 0.04, c * 0.3); // handle
        ctx.fillRect(-c * 0.09, -c * 0.18, c * 0.18, c * 0.06); // head
        ctx.restore();
        break;
      }
      case 'desperado': { // cowboy hat tipped back, eyes peeking out in front
        ctx.fillStyle = '#78350f';
        ctx.beginPath();
        ctx.ellipse(-c * 0.24, 0, c * 0.3, c * 0.56, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#a16207';
        ctx.beginPath();
        ctx.ellipse(-c * 0.26, 0, c * 0.16, c * 0.26, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#3f1d0a';
        ctx.fillRect(-c * 0.13, -c * 0.27, c * 0.05, c * 0.54); // hat band
        mouth(open, 0.43);
        lookingEyes(0.06, 0.2, 0.2);
        break;
      }
      case 'ouroboros': { // a real snake's head: a wedge, scaled, slit-pupilled amber eyes, nostrils
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(58,36,8,0.8)';
        ctx.lineWidth = c * 0.04;
        ctx.beginPath(); // (wider at the jaw, a rounded snout)
        ctx.moveTo(-c * 0.3, -c * 0.44);
        ctx.quadraticCurveTo(c * 0.2, -c * 0.4, c * 0.46, -c * 0.12);
        ctx.quadraticCurveTo(c * 0.54, 0, c * 0.46, c * 0.12);
        ctx.quadraticCurveTo(c * 0.2, c * 0.4, -c * 0.3, c * 0.44);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(58,36,8,0.75)'; // a diamond on its crown
        ctx.beginPath(); ctx.moveTo(-c * 0.22, 0); ctx.lineTo(-c * 0.06, -c * 0.12); ctx.lineTo(c * 0.1, 0); ctx.lineTo(-c * 0.06, c * 0.12); ctx.closePath(); ctx.fill();
        if (open > 0.08) mouth(open, 0.46);
        ctx.fillStyle = INK; // nostrils
        circle(c * 0.42, -c * 0.06, c * 0.022); circle(c * 0.42, c * 0.06, c * 0.022);
        if (blinking || deadNow) { lids(0.1, 0.14, 0.22); break; }
        for (const sg of [-1, 1]) { // amber eyes, a black slit each, turned to what it's watching
          ctx.fillStyle = '#facc15';
          circle(c * 0.14, sg * c * 0.22, c * 0.1);
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.ellipse(c * 0.14 + gazeX * c * 0.035, sg * c * 0.22 + gazeY * c * 0.035, c * 0.025, c * 0.085, 0, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'mute': { // a mime: white greasepaint, a black beret, high arched brows, a painted tear, small dark lips
        ctx.fillStyle = '#18181b'; // the beret, on the back of the head, with its little stalk
        ctx.beginPath(); ctx.ellipse(-c * 0.27, 0, c * 0.19, c * 0.3, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#18181b';
        ctx.lineWidth = c * 0.05;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-c * 0.44, 0); ctx.lineTo(-c * 0.52, -c * 0.06); ctx.stroke();
        const mood = muteState.get(s)?.key || 'calm', brow = MUTE_BROWS[mood];
        if (!open || open < 0.08) { // the lips: a small dark bow (a smug curl when proud, an O when scared)
          ctx.fillStyle = ctx.strokeStyle = '#7f1d1d';
          ctx.lineWidth = c * 0.04;
          if (mood === 'proud') { ctx.beginPath(); ctx.arc(c * 0.28, 0, c * 0.12, -0.75, 0.75); ctx.stroke(); }
          else if (mood === 'scared') { ctx.fillStyle = '#18181b'; circle(c * 0.39, 0, c * 0.055); ctx.stroke(); }
          else { ctx.beginPath(); ctx.ellipse(c * 0.4, 0, c * 0.035, c * 0.08, 0, 0, TAU); ctx.fill(); }
        } else mouth(open);
        ctx.fillStyle = rgba(color, 0.5); // (cheeks blushing its mood)
        circle(c * 0.24, -c * 0.26, c * 0.07); circle(c * 0.24, c * 0.26, c * 0.07);
        lookingEyes(0.055);
        if (!blinking) { // brows: arched high when calm, knitted when it's hunting, raised in the middle when scared...
          ctx.strokeStyle = INK;
          ctx.lineWidth = c * 0.035;
          ctx.beginPath();
          for (const sg of [-1, 1]) { ctx.moveTo(c * brow[0], sg * c * 0.3); ctx.quadraticCurveTo(c * brow[1], sg * c * 0.2, c * brow[2], sg * c * 0.1); }
          ctx.stroke();
        } // ...and a tear under one eye

        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.moveTo(c * 0.27, c * 0.2); ctx.quadraticCurveTo(c * 0.33, c * 0.24, c * 0.3, c * 0.27); ctx.quadraticCurveTo(c * 0.27, c * 0.24, c * 0.27, c * 0.2); ctx.fill();
        break;
      }
      case 'joker': // jester hat with bells, harlequin diamonds round its eyes, a clown's red grin and nose, eyes on its mark
        poly(JESTER, -1, '#a21caf');
        poly(JESTER, 1, '#f59e0b');
        ctx.fillStyle = '#facc15';
        circle(-c * 0.55, -c * 0.62, c * 0.08);
        circle(-c * 0.55, c * 0.62, c * 0.08);
        ctx.strokeStyle = '#dc2626'; // the grin, wider when it's about to bite
        ctx.lineWidth = c * (0.05 + 0.03 * open);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(c * 0.24, 0, c * 0.22, -0.85, 0.85);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        circle(c * 0.33, 0, c * 0.09);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        circle(c * 0.3, -c * 0.03, c * 0.025);
        poly(HARLEQUIN, -1, '#a21caf'); // a diamond painted round each eye
        poly(HARLEQUIN, 1, '#f59e0b');
        lookingEyes(0.055);
        break;
      case 'capricious': { // (until its first mood) can't make its mind up: one eye big, one small, a brow cocked
        mouth(open);
        if (blinking) { lids(0.09); break; }
        const eye = (y, w, r) => {
          const reach = (w - r) * 0.85, ox = gazeX * c * reach, oy = gazeY * c * reach;
          ctx.fillStyle = '#fffbea';
          circle(c * 0.15, c * y, c * w);
          ctx.fillStyle = INK;
          circle(c * 0.15 + ox, c * y + oy, c * r);
          catchlight(c * 0.15 + ox, c * y + oy, c * r);
        };
        eye(-0.21, 0.12, 0.07);
        eye(0.21, 0.075, 0.045);
        ctx.strokeStyle = INK;
        ctx.lineWidth = c * 0.045;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(c * 0.03, c * 0.11);
        ctx.quadraticCurveTo(-c * 0.09, c * 0.2, c * 0.02, c * 0.31);
        ctx.stroke();
        break;
      }
      default:
        mouth(open);
        lookingEyes(0.06);
    }
    blinkNow = false;
  }

  // ------------------------------------------------------- homes and flags

  // Sovereign's home and Colonist's colonies are force fields: a dome of light
  // in the owner's colour, deepest at the rim, a fine honeycomb of light
  // showing toward its edge and a gleam on its upper left (like a bubble),
  // with ripples welling out from the middle (each lights up the honeycomb as
  // it passes) and sparks running round the edge. The field lies only on the
  // log that's left: a hole pecked in it stays dark. A rival inside lights it
  // up (it pulses faster, ripples spread from where it came in), and every
  // part of the rival inside glows in the field's colour, as if wading
  // through coloured light. The edge is exactly the trespass line.
  const rgbaCache = new Map(); // hex -> alpha -> string (no key string built per call)
  function rgba(hex, a) {
    let byA = rgbaCache.get(hex);
    if (!byA) rgbaCache.set(hex, byA = new Map());
    let v = byA.get(a);
    if (!v) { const n = parseInt(hex.slice(1), 16); v = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; byA.set(a, v); }
    return v;
  }
  // Each field's look, drawn once per resolution: its glow and edge, and the
  // honeycomb on its own (for the ripples to light up).
  const fieldLooks = new Map();
  function fieldLook(r, color) {
    const key = r + color;
    let f = fieldLooks.get(key);
    if (f) return f;
    const side = 2 * r + 4, px = Math.max(2, Math.round(side * k));
    const make = () => {
      const c = makeLayer(px, px), g = c.getContext('2d');
      g.setTransform(px / side, 0, 0, px / side, px / 2, px / 2);
      return [c, g];
    };
    const comb = (g, alpha) => { // pointy-topped hexagons, centre to corner hs
      const hs = CELL * 0.3, w = Math.sqrt(3) * hs, rows = Math.ceil(r / (1.5 * hs)) + 1, cols = Math.ceil(r / w) + 1;
      g.strokeStyle = mix(color, '#ffffff', 0.55);
      g.globalAlpha = alpha;
      g.lineWidth = 0.9;
      g.beginPath();
      for (let row = -rows; row <= rows; row++) {
        for (let col = -cols; col <= cols; col++) {
          const hx = col * w + (row & 1 ? w / 2 : 0), hy = row * 1.5 * hs;
          for (let i = 0; i <= 6; i++) {
            const a = Math.PI / 6 + i * Math.PI / 3, ex = hx + Math.cos(a) * hs, ey = hy + Math.sin(a) * hs;
            if (i) g.lineTo(ex, ey); else g.moveTo(ex, ey);
          }
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    };
    // The honeycomb alone, cut to the circle.
    const [lattice, lg] = make();
    comb(lg, 0.7);
    lg.globalCompositeOperation = 'destination-in';
    lg.beginPath(); lg.arc(0, 0, r - 1, 0, TAU); lg.fill();
    // The field: its glow, deepest at the rim...
    const [body, bg] = make();
    const grad = bg.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, rgba(color, 0.05));
    grad.addColorStop(0.6, rgba(color, 0.1));
    grad.addColorStop(0.9, rgba(color, 0.24));
    grad.addColorStop(0.985, rgba(color, 0.42));
    grad.addColorStop(1, rgba(color, 0));
    bg.fillStyle = grad;
    bg.fillRect(-r, -r, 2 * r, 2 * r);
    // ...the honeycomb, showing only toward the edge...
    const [edge, eg] = make();
    eg.setTransform(1, 0, 0, 1, 0, 0);
    eg.drawImage(lattice, 0, 0);
    eg.setTransform(px / side, 0, 0, px / side, px / 2, px / 2);
    eg.globalCompositeOperation = 'destination-in';
    const fade = eg.createRadialGradient(0, 0, 0, 0, 0, r);
    fade.addColorStop(0.55, 'rgba(0,0,0,0)');
    fade.addColorStop(0.85, 'rgba(0,0,0,0.16)');
    fade.addColorStop(0.97, 'rgba(0,0,0,0.42)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    eg.fillStyle = fade;
    eg.fillRect(-r, -r, 2 * r, 2 * r);
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.drawImage(edge, 0, 0);
    bg.setTransform(px / side, 0, 0, px / side, px / 2, px / 2);
    // ...and a gleam on its upper left, like light on a bubble.
    bg.lineCap = 'round';
    bg.strokeStyle = 'rgba(255,255,255,0.2)';
    bg.lineWidth = Math.max(2, r * 0.06);
    bg.beginPath(); bg.arc(0, 0, r * 0.82, Math.PI * 1.1, Math.PI * 1.38); bg.stroke();
    bg.fillStyle = 'rgba(255,255,255,0.16)';
    bg.beginPath(); bg.arc(Math.cos(Math.PI * 1.47) * r * 0.82, Math.sin(Math.PI * 1.47) * r * 0.82, Math.max(1.5, r * 0.035), 0, TAU); bg.fill();
    fieldLooks.set(key, f = { body, lattice, side });
    return f;
  }
  const fields = [];          // this frame's fields: { x, y, r, color, owner, key }
  const inField = new Map();  // snake -> the field keys its head was in last frame
  const ripples = [];         // a ripple where someone crossed in: { x, y, color, at }
  // Every field this frame (homes and colonies), drawn knowing about each
  // other: a snake's own fields that overlap (Colonist's colonies) are one
  // merged field, one rim round the lot; where two snakes' fields meet, the
  // border between them crackles. A field: { x, y, r (drawn, eased as it
  // moves or swells), color, owner, id, lookR (the radius it's settling to,
  // whose look is cached), swell (1 just after it grew or shrank, fading) }.
  const fieldSpecs = [];
  function drawFields(now) {
    fieldSpecs.length = 0;
    for (const s of game.snakes) {
      if (!s.alive) continue;
      if (s.memory.home) fieldSpecs.push(homeField(s, now));
      if (s.memory.colonies) for (const c of s.memory.colonies) {
        const cr = (c.radius + 1) * CELL;
        fieldSpecs.push({ x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2, r: cr, color: s.color, owner: s, id: 'colony' + s.id + ':' + (c.n || 1) + ':' + c.x + ',' + c.y, lookR: cr, swell: 0 });
      }
    }
    for (let i = 0; i < fieldSpecs.length; i++) drawField(i, now);
    for (const s of game.snakes) if (s.alive && s.memory.colonies) drawColonyFlags(s, now);
  }
  // Is (px, py) inside another field (than i): of the same owner (same) or of someone else's?
  function insideOther(i, px, py, same, slack = 0) {
    const f = fieldSpecs[i];
    for (let j = 0; j < fieldSpecs.length; j++) {
      if (j === i) continue;
      const o = fieldSpecs[j];
      if ((o.owner === f.owner) !== same) continue;
      if (Math.hypot(px - o.x, py - o.y) < o.r - slack) return true;
    }
    return false;
  }
  function drawField(i, now) {
    const f = fieldSpecs[i], { x, y, r, color, owner, id } = f, lookR = f.lookR || r, swell = f.swell || 0, key = id;
    fields.push({ x, y, r, color, owner, key });
    let alert = false;
    for (const s of game.snakes) {
      if (!s.alive || s === owner) continue;
      const hx = s.body[0].x * CELL + CELL / 2, hy = s.body[0].y * CELL + CELL / 2;
      if (Math.hypot(hx - x, hy - y) <= r) alert = true;
    }
    const lively = !reduced, t = now / 1000, look = fieldLook(lookR, color), side = look.side * r / lookR;
    const pulse = lively ? 0.5 + 0.5 * Math.sin(t * (alert ? 9 : 2.2)) : 0.5;
    const flare = Math.max(swell, 1 - (now - flashAt) / 700); // (lightning, or it just grew: it flares)
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    // (holes inside it stay dark: the field lies on the log that's left)
    for (const h of game.holes) {
      const hx = (h % GRID) * CELL, hy = Math.floor(h / GRID) * CELL;
      if (Math.abs(hx + CELL / 2 - x) < r + CELL && Math.abs(hy + CELL / 2 - y) < r + CELL) ctx.rect(hx, hy, CELL, CELL);
    }
    ctx.clip('evenodd');
    for (let j = 0; j < i; j++) { // (not again where its own field's already drawn: one merged field)
      const o = fieldSpecs[j];
      if (o.owner !== owner || Math.hypot(o.x - x, o.y - y) >= o.r + r) continue;
      ctx.beginPath(); ctx.rect(0, 0, SIZE, SIZE); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.clip('evenodd');
    }
    ctx.globalAlpha = alert ? 1 : 0.85 + 0.15 * pulse;
    ctx.drawImage(look.body, x - side / 2, y - side / 2, side, side);
    if (lively) { // ripples welling out from the middle, lighting up the honeycomb as they pass
      for (let i = 0; i < 2; i++) {
        const p = (t * (alert ? 0.9 : 0.35) + i * 0.5) % 1, rr = r * p, bw = CELL * 0.8;
        if (quality > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, rr + bw / 2, 0, TAU);
          ctx.arc(x, y, Math.max(0.1, rr - bw / 2), 0, TAU, true);
          ctx.clip();
          ctx.globalAlpha = (alert ? 0.5 : 0.24) * Math.sin(p * Math.PI);
          ctx.drawImage(look.lattice, x - side / 2, y - side / 2, side, side);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = rgba(color, 0.22 * (1 - p));
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      }
    }
    const wobble = fieldWeather(x, y, r, color, look.lattice, side, id, now, flare);
    ctx.restore();
    ctx.globalAlpha = 1;
    // The rim: a soft glow and a bright line, breathing (and shivering in the
    // wind)... in pieces: none where it's inside another of its owner's
    // fields (they're one field), and where it's inside someone else's, a
    // crackling seam instead (two fields pushing against each other).
    const rr = r - 2 + wobble, steps = Math.max(24, Math.round(r / 5));
    const others = fieldSpecs.length > 1;
    let anyRim = false, seams = null;
    ctx.beginPath();
    for (let k = 0; k < steps; k++) {
      const a0 = k / steps * TAU, a1 = (k + 1) / steps * TAU, am = (a0 + a1) / 2;
      const mx = x + Math.cos(am) * rr, my = y + Math.sin(am) * rr;
      if (others && insideOther(i, mx, my, true, 1)) continue;
      if (others && insideOther(i, mx, my, false)) { (seams ||= []).push([a0, a1]); continue; }
      ctx.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr);
      ctx.arc(x, y, rr, a0, a1);
      anyRim = true;
    }
    if (anyRim) {
      ctx.lineWidth = 8 + 4 * flare;
      ctx.strokeStyle = rgba(color, Math.min(1, (alert ? 0.32 : 0.16) + 0.08 * pulse + 0.3 * flare));
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = rgba(color, Math.min(1, (alert ? 0.9 : 0.5) + 0.2 * pulse + 0.4 * flare));
      ctx.stroke();
    }
    if (seams) { // the seam: a jagged, flickering line of light, and the odd spark
      ctx.beginPath();
      for (const [a0, a1] of seams) {
        for (let q = 0; q <= 3; q++) {
          const a = a0 + (a1 - a0) * q / 3, jit = lively ? Math.sin(t * 47 + a * 31 + i) * 2.2 : 0;
          const px = x + Math.cos(a) * (rr + jit), py = y + Math.sin(a) * (rr + jit);
          if (q) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        if (lively && Math.random() < 0.012) spawn(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr, 2, 90, 260, 1.6, '#fef08a', '#ffffff');
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = rgba('#fde047', lively ? 0.25 + 0.15 * Math.sin(t * 13 + i) : 0.3);
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = rgba('#fefce8', 0.9);
      ctx.stroke();
    }
    if (snowCover > 0.02) { // ...snow gathered along its top...
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba('#ffffff', 0.55 * snowCover);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r - 3, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      ctx.fillStyle = rgba('#ffffff', 0.7 * snowCover);
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (1.15 + i * 0.14), w = 2 + ((i * 7 + id.length) % 3);
        circle(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3) - 1, w);
      }
    }
    if (lively) { // ...with sparks running round it
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let n = 0; n < 5; n++) {
        const a = t * (0.5 + n * 0.12) * (n % 2 ? 1 : -1) + n * 1.3, sx = x + Math.cos(a) * (r - 2), sy = y + Math.sin(a) * (r - 2);
        if (others && insideOther(i, sx, sy, true, 1)) continue;
        circle(sx, sy, 1.7);
      }
    }
  }
  // After the snakes: whatever of a rival is inside a field takes on its
  // colour, with a glow of it clinging round, as if wading through coloured
  // light; and a ripple spreads where a head just crossed in.
  function drawFieldHues(now) {
    for (const f of fields) {
      for (const s of game.snakes) {
        if (!s.alive || s === f.owner) continue;
        const a = anim.get(s);
        if (!a || !a.n) continue;
        const hx = s.body[0].x * CELL + CELL / 2, hy = s.body[0].y * CELL + CELL / 2, inside = Math.hypot(hx - f.x, hy - f.y) <= f.r;
        let was = inField.get(s);
        if (!was) inField.set(s, was = new Set());
        if (inside && !was.has(f.key)) { // just crossed in
          ripples.push({ x: a.pts[0], y: a.pts[1], color: f.color, at: now });
          spawn(a.pts[0], a.pts[1], 8, 160, 420, 2.2, f.color, '#ffffff');
        }
        if (inside) was.add(f.key); else was.delete(f.key);
        let touches = false;
        for (let i = 0; i < a.n && !touches; i++) touches = Math.hypot(a.pts[2 * i] - f.x, a.pts[2 * i + 1] - f.y) <= f.r + a.rad[i] + 5;
        if (!touches) continue;
        ctx.save();
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.clip();
        ctx.fillStyle = rgba(f.color, 0.13);
        silhouette(a, 5);
        ctx.fillStyle = rgba(f.color, 0.28);
        silhouette(a, 0.5);
        ctx.restore();
      }
    }
    fields.length = 0;
    for (let i = dimples.length - 1; i >= 0; i--) if (now - dimples[i].at > 450 || now < dimples[i].at) dimples.splice(i, 1);
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i], t = (now - rp.at) / 520;
      if (t >= 1) { ripples.splice(i, 1); continue; }
      ctx.lineWidth = 3 * (1 - t);
      ctx.strokeStyle = rgba(rp.color, 0.8 * (1 - t));
      ctx.beginPath(); ctx.arc(rp.x, rp.y, CELL * (0.4 + 1.3 * t), 0, TAU); ctx.stroke();
    }
  }
  // The weather on a field, inside it: rain dimples it, snow frosts its
  // honeycomb, wind sends shivers across it, lightning lights it all up.
  // Returns how far its rim shivers in the wind.
  const dimples = []; // raindrops landing on fields: { id, dx, dy, at }
  function fieldWeather(x, y, r, color, lattice, side, id, now, flare) {
    if (reduced) return 0;
    const wet = sky.rain + sky.storm * 0.6, blow = Math.max(sky.wind, sky.storm * 0.7), t = now / 1000;
    for (let n = wet * (r / CELL) * 5 * frameDt / 1000; n > 0; n--) { // (about five drops a second per cell of radius)
      if (Math.random() >= n) break;
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r * 0.92;
      dimples.push({ id, dx: Math.cos(a) * d, dy: Math.sin(a) * d, at: now });
    }
    let drew = false;
    for (const d of dimples) {
      if (d.id !== id) continue;
      const p = (now - d.at) / 450;
      if (p >= 1 || p < 0) continue;
      if (!drew) { drew = true; ctx.lineWidth = 1.6; ctx.strokeStyle = ctx.fillStyle = mix(color, '#ffffff', 0.75); }
      ctx.globalAlpha = 0.9 * (1 - p);
      ctx.beginPath(); ctx.arc(x + d.dx, y + d.dy, 2 + 10 * p, 0, TAU); ctx.stroke();
      if (p < 0.3) circle(x + d.dx, y + d.dy, 1.8 * (1 - p / 0.3)); // (the drop itself)
    }
    const lit = 0.9 * flare + 0.28 * snowCover; // (lightning, or frost)
    if (lit > 0.02 && quality > 0) {
      ctx.globalAlpha = Math.min(1, lit);
      ctx.drawImage(lattice, x - side / 2, y - side / 2, side, side);
    }
    if (blow > 0.05 && quality > 0) { // a shiver sweeping across with the wind (from the left)
      const p = (t * 0.6 * (1 + blow)) % 1, bx = x - r + p * 2 * r, bw = CELL * 0.9;
      ctx.save();
      ctx.beginPath(); ctx.rect(bx - bw, y - r, 2 * bw, 2 * r); ctx.clip();
      ctx.globalAlpha = 0.6 * blow;
      ctx.drawImage(lattice, x - side / 2, y - side / 2, side, side);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    return blow * 1.3 * Math.sin(t * 11 + x * 0.05);
  }
  // Sovereign's home: drawn where it is, easing to wherever it has moved or
  // grown to, flaring as it changes size.
  const homeShown = new Map(); // snake -> { x, y, r, tr, at }
  function homeField(s, now) {
    const h = s.memory.home;
    const tx = h.x * CELL + CELL / 2, ty = h.y * CELL + CELL / 2, tr = (h.radius + 1) * CELL;
    let e = homeShown.get(s);
    if (!e) homeShown.set(s, e = { x: tx, y: ty, r: tr, tr, at: -1e9 });
    if (tr !== e.tr) { e.tr = tr; e.at = now; }
    const k = reduced ? 1 : 1 - Math.exp(-frameDt / 260);
    e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.r += (tr - e.r) * k;
    return { x: e.x, y: e.y, r: e.r, color: s.color, owner: s, id: 'home' + s.id, lookR: tr, swell: Math.max(0, 1 - (now - e.at) / 900) };
  }

  // The Union Flag, as flown over the Empire's colonies (a redcoat's flag: St
  // George's cross for England, St Andrew's saltire for Scotland, St Patrick's,
  // counterchanged, for Ireland), 5:3, its hoist at the sprite's centre.
  // The second colony and later fly colonial ensigns, as the Empire's
  // colonies did: the Union Flag in the corner, a Blue Ensign with the
  // Southern Cross, or a Red Ensign with a colony's badge (here, the log's own
  // oak on a white roundel). 'union' | 'blue' | 'red'.
  const UNION_W = 0.95, UNION_H = 0.57;
  const flagSprite = v => sprite('flag', v, drawColonyFlag);
  const drawColonyFlag = (g, v) => {
    const c = CELL, w = c * UNION_W, h = c * UNION_H, y0 = -h / 2;
    if (v === 'union') unionAt(g, 0, y0, w, h);
    else {
      g.fillStyle = v === 'blue' ? '#012169' : '#c8102e';
      g.fillRect(0, y0, w, h);
      unionAt(g, 0, y0, w / 2, h / 2);
      g.fillStyle = '#ffffff';
      if (v === 'blue') { // the Southern Cross
        for (const [sx, sy, sr] of [[0.75, -0.3, 0.08], [0.62, 0.02, 0.07], [0.88, -0.06, 0.07], [0.75, 0.32, 0.08], [0.8, 0.12, 0.04]]) starOn(g, w * sx, h * sy, h * sr);
      } else { // a badge: the oak on a white roundel
        const bx = w * 0.74, by = h * 0.04, br = h * 0.24;
        g.beginPath(); g.arc(bx, by, br, 0, TAU); g.fill();
        g.fillStyle = '#7c2d12';
        g.fillRect(bx - br * 0.12, by, br * 0.24, br * 0.6);
        g.fillStyle = '#15803d';
        g.beginPath(); g.arc(bx, by - br * 0.1, br * 0.5, 0, TAU); g.fill();
      }
    }
    g.strokeStyle = 'rgba(15,23,42,0.4)';
    g.lineWidth = 1;
    g.strokeRect(0, y0, w, h);
  };
  function starOn(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 7, rr = i % 2 ? r * 0.45 : r;
      if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
  }
  // The Union Flag in a rectangle (whole, or in an ensign's corner).
  function unionAt(g, x0, y0, w, h) {
    const u = h / 30;
    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.fillStyle = '#012169';
    g.fillRect(x0, y0, w, h);
    const cx = x0 + w / 2, cy = y0 + h / 2;
    g.lineCap = 'butt';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6 * u;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0 + h); g.moveTo(x0 + w, y0); g.lineTo(x0, y0 + h); g.stroke();
    // St Patrick's: each arm offset to one side of the white (anticlockwise), so it turns like a pinwheel.
    g.strokeStyle = '#c8102e';
    g.lineWidth = 2 * u;
    g.beginPath();
    for (const [ex, ey] of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]) {
      const len = Math.hypot(ex - cx, ey - cy), dx = (ex - cx) / len, dy = (ey - cy) / len, nx = dy * u, ny = -dx * u;
      g.moveTo(cx + nx, cy + ny); g.lineTo(ex + nx, ey + ny);
    }
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fillRect(x0, cy - 5 * u, w, 10 * u);
    g.fillRect(cx - 5 * u, y0, 10 * u, h);
    g.fillStyle = '#c8102e';
    g.fillRect(x0, cy - 3 * u, w, 6 * u);
    g.fillRect(cx - 3 * u, y0, 6 * u, h);
    g.restore();
  }
  // Drawn in vertical strips that ripple from the pole outward, so it flies.
  const FLAG_STRIPS = 8;
  function drawFlag(x, top, now, phase, kind = 'union') {
    const sp = flagSprite(kind), half = SPRITE * CELL / 2, dev = sp.width / (SPRITE * CELL);
    const w = CELL * UNION_W, h = CELL * UNION_H, sw = w / FLAG_STRIPS;
    for (let i = 0; i < FLAG_STRIPS; i++) {
      const out = (i + 0.5) / FLAG_STRIPS;
      const dy = reduced ? 0 : Math.sin(now / 180 - i * 0.9 + phase) * CELL * 0.05 * out;
      // (each strip a hair wider than its slot, so no seams show between them)
      ctx.drawImage(sp, (half + i * sw) * dev, (half - h / 2) * dev, (sw + 0.6) * dev, h * dev, x + i * sw, top + dy, sw + 0.6, h);
    }
  }

  // Colonist's colonies: a force field each, and a flag flying over it (the
  // Union Flag over the first, an ensign over later ones).
  function drawColonyFlags(s, now) {
    for (const c of s.memory.colonies) {
      const x = c.x * CELL + CELL / 2, y = c.y * CELL + CELL / 2;
      ctx.strokeStyle = '#e7d7b1';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y + CELL * 0.6); ctx.lineTo(x, y - CELL * 0.95); ctx.stroke();
      ctx.fillStyle = '#facc15'; // a gilt finial
      circle(x, y - CELL * 0.97, 2.6);
      const n = c.n || 1;
      drawFlag(x + 1.5, y - CELL * 0.92, now, c.x * 0.7 + c.y * 1.3, n === 1 ? 'union' : n % 2 ? 'red' : 'blue');
    }
  }

  // ------------------------------------------------------------ the food

  // When each piece of food first showed, so it pops in once, and when its
  // next spore or glint is due. Kept by cell rather than by object (a guest
  // online gets fresh food objects every tick). At the start of a round the
  // food pops in one piece after another; a dead snake's beads pop in head to
  // tail. born: cell -> { kind, at, i, next, v (a bead's look) }.
  const born = new Map();
  const eatenNow = new Set(); // cells eaten on the last tick (so food that just vanished poofs)
  let bornTick = -1, bornGen = 0, fresh = true;
  const POP_MS = 420, RIPPLE_MS = 30;

  function trackFood(now) {
    if (game.tick === bornTick) return;
    bornTick = game.tick;
    bornGen++;
    let n = 0;
    for (const f of game.food) {
      if (f.kind === 'beetle') continue;
      const key = f.y * GRID + f.x;
      let b = born.get(key);
      if (!b || b.kind !== f.kind) {
        b = { kind: f.kind, at: now + (fresh ? 200 + 90 * n : 0), i: 0, next: 0, gen: 0, v: (f.color || '#a16207') + '|', fell: !fresh && f.kind === 'food' };
        born.set(key, b);
      }
      b.gen = bornGen;
      n++;
    }
    for (const [key, b] of born) {
      if (b.gen === bornGen) continue;
      // Gone without being eaten (a mushroom withered, a golden apple rotted): a little poof.
      if (!eatenNow.has(key) && (b.kind === 'mushroom' || b.kind === 'golden')) {
        spawn((key % GRID) * CELL + CELL / 2, Math.floor(key / GRID) * CELL + CELL / 2, 7, 110, 420, 2.2, b.kind === 'golden' ? '#a16207' : '#dc2626', '#f6ecd2');
      }
      born.delete(key);
    }
    eatenNow.clear();
    fresh = false;
  }

  // A dead snake's beads: what each one looks like, and a ripple from head to tail.
  function noteRemains(s, now) {
    for (let i = 0; i < s.body.length; i++) {
      const key = s.body[i].y * GRID + s.body[i].x, old = born.get(key);
      if (old && old.kind !== 'pellet') continue; // (food there stays food)
      born.set(key, { kind: 'pellet', at: now + i * RIPPLE_MS, i, next: 0, gen: bornGen, v: beadOf(s, i) });
    }
  }

  // The bead a snake leaves at body segment i: its own colours and markings.
  function beadOf(s, i) {
    const look = lookOf(s), col = colorOf(s);
    let fill = col[0] === '#' ? col : '#a16207', mark = '';
    if (s.personaKey === 'wildcard') fill = WILD(i);
    else if (look === 'mute') fill = i === 0 ? '#f8fafc' : fill; // (its mood's colour as it went)
    else if (look === 'joker') fill = i === 0 ? '#f8fafc' : i % 2 ? '#f59e0b' : '#a21caf';
    else if (look === 'sniper' && i % 3 === 2) fill = mix(fill, '#fca5a5', 0.35);
    else if (look === 'vulture' && i < 2) fill = i ? '#f5f5f4' : '#f9a8d4';
    else if (look === 'desperado' && i === 1) fill = '#dc2626';
    else if (look === 'desperado' && i >= 4 && i % 4 === 0) fill = '#fde68a';
    if (!s.persona) mark = MARKS[col] || '';
    else if (look === 'mason') mark = i % 4 === 3 ? 'marble2' : 'marble';
    else if (look === 'colonist') mark = i % 2 ? 'strap' : 'strap2';
    else if (look === 'ouroboros') mark = 'diamond';
    else if (s.personaKey === 'copycat') mark = 'copy';
    else if (look === 'ghost') mark = 'ghost';
    return fill + '|' + mark;
  }

  // How big something popping in is, ms after it appeared: nothing yet, then
  // up past full size and back (with reduced motion, simply there).
  function popOf(ms) {
    if (reduced) return 1;
    const t = ms / POP_MS;
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const u = t - 1;
    return 1 + 2.7 * u * u * u + 1.7 * u * u;
  }

  // A sprite drawn at (x, y) + offset, scaled about a pivot (px, py) relative to (x, y).
  function blitAbout(sp, x, y, px, py, sx, sy, rot) {
    const half = SPRITE * CELL / 2;
    ctx.save();
    ctx.translate(x + px, y + py);
    if (rot) ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(sp, -half - px, -half - py, SPRITE * CELL, SPRITE * CELL);
    ctx.restore();
  }

  // An apple (or the golden one): it bobs up off its shadow and squashes a
  // touch as it comes down, swaying its leaf; now and then a glint winks on it.
  // t: seconds, offset per apple so they don't move together.
  function drawAppleAt(sp, x, y, t, pop, alpha) {
    const lively = !reduced;
    const h = lively ? 0.5 - 0.5 * Math.cos(t * 3.9) : 0; // 0 down .. 1 up
    const sq = lively ? 0.08 * (1 - h) * (1 - h) * (1 - h) : 0;
    const lift = h * 3.2;
    ctx.globalAlpha = alpha * (1 - 0.35 * h);
    shadowAt(x + 1.3, y + CELL * 0.36, pop * (1 - 0.22 * h));
    ctx.globalAlpha = alpha;
    blitAbout(sp, x, y - lift, 0, CELL * 0.38, pop * (1 + sq), pop * (1 - sq), lively ? Math.sin(t * 1.9) * 0.06 : 0);
    const g = (t * 0.27) % 1;
    if (lively && g < 0.09 && pop >= 1) {
      const w = SPRITE * CELL * 0.75 * Math.sin(g / 0.09 * Math.PI);
      ctx.drawImage(starSprite(), x - CELL * 0.13 - w / 2, y - CELL * 0.08 - lift - w / 2, w, w);
    }
    ctx.globalAlpha = 1;
  }

  // A mushroom sways on its stem and breathes; near the end it wilts, leaning
  // over, shrinking and fading; and it lets go of a spore now and then.
  // A mushroom: poisonous-looking, a faint violet haze round it that breathes.
  const hazeSprite = () => sprite('haze', '', g => {
    const grad = g.createRadialGradient(0, 0, CELL * 0.1, 0, 0, CELL * 0.75);
    grad.addColorStop(0, 'rgba(192,132,252,0.5)');
    grad.addColorStop(0.6, 'rgba(167,139,250,0.14)');
    grad.addColorStop(1, 'rgba(132,204,22,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, CELL * 0.75, 0, TAU); g.fill();
  });
  function drawMushroomAt(f, x, y, t, pop) {
    const lively = !reduced;
    const hz = SPRITE * CELL * pop * (1 + (lively ? 0.12 * Math.sin(t * 2.3) : 0));
    ctx.globalAlpha = lively ? 0.75 + 0.25 * Math.sin(t * 2.3) : 0.85;
    ctx.drawImage(hazeSprite(), x - hz / 2, y - hz / 2 - CELL * 0.05, hz, hz);
    ctx.globalAlpha = 1;
    const left = f.expires != null ? f.expires - game.tick : 99;
    const wilt = left < 30 ? Math.min(1, 1 - left / 30) : 0;
    const breathe = lively ? Math.sin(t * 5.1) * 0.04 : 0;
    const lean = (lively ? Math.sin(t * 2.5) * 0.12 : 0) + 0.5 * wilt * (f.x % 2 ? 1 : -1);
    ctx.globalAlpha = 1 - 0.4 * wilt;
    shadowAt(x + 1, y + CELL * 0.36, pop * (1 - 0.25 * wilt));
    blitAbout(mushroomSprite(), x, y, 0, CELL * 0.34, pop * (1 - 0.2 * wilt) * (1 - breathe * 0.5), pop * (1 - 0.3 * wilt) * (1 + breathe), lean);
    if (lively && pop >= 1) { // stink lines: two wavy violet wisps rising off it (the cartoon for "don't eat me")
      ctx.strokeStyle = '#c4b5fd';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const ph = (t * 0.55 + k * 0.5) % 1, x0 = x + (k ? 0.16 : -0.14) * CELL, y0 = y - CELL * (0.4 + 0.55 * ph);
        ctx.globalAlpha = Math.sin(ph * Math.PI) * 0.85 * (1 - 0.4 * wilt);
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) {
          const yy = y0 - i * CELL * 0.04, xx = x0 + Math.sin(i * 0.9 + t * 4 + k * 2) * CELL * 0.06;
          if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Ambient motes from a small pool: poison spores drifting up off the mushrooms
  // (kind 0, violet), glints twinkling round a golden apple (1), smoke (2), embers (3)
  // and steam off baked food (4).
  const MAX_M = 96;
  const mx = new Float32Array(MAX_M), my = new Float32Array(MAX_M), mvx = new Float32Array(MAX_M), mvy = new Float32Array(MAX_M);
  const mlife = new Float32Array(MAX_M), mmax = new Float32Array(MAX_M), msize = new Float32Array(MAX_M);
  const mkind = new Uint8Array(MAX_M);
  let mNext = 0, mLive = 0;
  function mote(x, y, vx, vy, life, size, kind) {
    if (reduced) return;
    const i = mNext;
    mNext = (mNext + 1) % MAX_M;
    mx[i] = x; my[i] = y; mvx[i] = vx; mvy[i] = vy; mmax[i] = mlife[i] = life; msize[i] = size; mkind[i] = kind;
    mLive = Math.min(MAX_M, mLive + 1);
  }
  // Drawn in batches: every mote of a kind at the same fade (four steps of
  // it) goes in one shape, so a busy fire is a handful of fills, not hundreds.
  const MOTE_LOOK = [['#d8b4fe', 0.7], null, ['#78716c', 0.32], ['#fdba74', 1], ['#f8fafc', 0.4]]; // spores, (glints), smoke, embers, steam
  const mBucket = new Uint8Array(MAX_M), mRad = new Float32Array(MAX_M);
  function drawMotes(dt) {
    if (!mLive) return;
    const st = dt / 1000;
    let live = 0;
    for (let i = 0; i < MAX_M; i++) {
      mBucket[i] = 0;
      if (mlife[i] <= 0) continue;
      mlife[i] -= dt;
      if (mlife[i] <= 0) continue;
      mx[i] += mvx[i] * st;
      my[i] += mvy[i] * st;
      const t = Math.min(1, Math.max(0, mlife[i] / mmax[i])), fade = Math.sin(t * Math.PI); // in and out
      live++;
      if (mkind[i] === 1) { // a glint: the sparkle sprite, twinkling (only ever a few)
        const w = SPRITE * CELL * msize[i] * fade;
        ctx.globalAlpha = fade;
        ctx.drawImage(starSprite(), mx[i] - w / 2, my[i] - w / 2, w, w);
        continue;
      }
      if (mkind[i] === 0) mx[i] += Math.sin(mlife[i] / 160) * 0.15; // spores waft
      mRad[i] = mkind[i] === 2 || mkind[i] === 4 ? msize[i] * (1.6 - t * 0.6) : msize[i]; // (smoke and steam grow as they rise)
      mBucket[i] = 1 + Math.min(3, Math.floor(fade * 4)); // 1..4
    }
    for (let kind = 0; kind < MOTE_LOOK.length; kind++) {
      const look = MOTE_LOOK[kind];
      if (!look) continue;
      ctx.fillStyle = look[0];
      for (let b = 1; b <= 4; b++) {
        let any = false;
        for (let i = 0; i < MAX_M; i++) {
          if (mBucket[i] !== b || mkind[i] !== kind) continue;
          if (!any) { ctx.beginPath(); any = true; }
          ctx.moveTo(mx[i] + mRad[i], my[i]);
          ctx.arc(mx[i], my[i], mRad[i], 0, TAU);
        }
        if (!any) continue;
        ctx.globalAlpha = look[1] * (b - 0.5) / 4;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    mLive = live;
  }

  // A beetle diving into its burrow: it shrinks away into the hole.
  function drawDive(now) {
    if (!dive) return;
    const age = (now - dive.at) / 320;
    if (age >= 1 || reduced) { dive = null; return; }
    const c = CELL, s = 1.35 * (1 - age);
    ctx.save();
    ctx.translate(dive.x * c + c / 2, dive.y * c + c / 2);
    ctx.rotate(dive.ang + age * 2);
    ctx.scale(s, s);
    ctx.fillStyle = '#059669';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = c * 0.03;
    ctx.beginPath(); ctx.ellipse(-c * 0.02, 0, c * 0.22, c * 0.17, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // A roast: a piece of snake that fell off in the flames, browned all over.
  const ROAST = '#92400e|';
  // Baked food steams now and then.
  function steam(b, x, y, now) {
    if (reduced || !b || now < b.next) return;
    b.next = now + 450 + Math.random() * 500;
    mote(x + (Math.random() - 0.5) * CELL * 0.3, y - CELL * 0.3, (Math.random() - 0.5) * 6, -16 - Math.random() * 8, 1200, 2 + Math.random(), 4);
  }

  // Every piece of food on the board, under the snakes.
  function drawFood(alpha, now) {
    trackFood(now);
    const lively = !reduced;
    for (const f of game.food) {
      if (f.kind === 'beetle') { drawBeetle(f, alpha, now); continue; }
      const key = f.y * GRID + f.x, b = born.get(key);
      if (f.kind === 'pellet' && heldCells[key]) { if (b) b.at = now + b.i * RIPPLE_MS; continue; } // (under a held corpse: not yet)
      const pop = b ? popOf(now - b.at) : 1;
      if (pop <= 0) continue;
      const x = f.x * CELL + CELL / 2, y = f.y * CELL + CELL / 2;
      const t = now / 1000 + ((f.x * 7 + f.y * 13) % 10) * 0.63; // each piece on its own beat
      if (f.kind === 'food') {
        const drop = b?.fell && !reduced ? Math.max(0, 1 - (now - b.at) / 380) : 0; // (a new apple drops from the tree above)
        const left = f.expires != null ? f.expires - game.tick : 999;
        const look = f.cooked ? 'baked' : left > 50 ? 'fresh' : left > 22 ? 'bruised' : 'rotten';
        const shrivel = look === 'rotten' && left < 10 ? 0.78 + 0.22 * Math.max(0, left) / 10 : 1;
        drawAppleAt(appleSprite(look), x, y - drop * drop * CELL * 3, t, (b?.fell ? 1 : pop) * shrivel, 1);
        if (look === 'rotten' && lively) { // a fly has found it
          const fa = now / 150 + f.x * 1.7, fx = x + Math.cos(fa) * CELL * 0.4, fy = y - CELL * 0.32 + Math.sin(fa * 1.6) * CELL * 0.14;
          ctx.fillStyle = 'rgba(241,245,249,0.7)';
          const flap = 0.6 + 0.6 * Math.abs(Math.sin(now / 18));
          ctx.beginPath(); ctx.ellipse(fx - 1.4, fy - 1.6, 1.6 * flap, 1, -0.5, 0, TAU); ctx.ellipse(fx + 1.4, fy - 1.6, 1.6 * flap, 1, 0.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#1c1917';
          circle(fx, fy, 1.7);
        }
        if (look === 'baked') steam(b, x, y, now);
      }
      else if (f.kind === 'pellet') {
        const h = lively ? 0.5 - 0.5 * Math.cos(t * 3) : 0;
        shadowAt(x + 1, y + CELL * 0.3, pop * 0.85 * (1 - 0.2 * h));
        const sz = pop * (1 + (lively ? Math.sin(t * 6) * 0.03 : 0));
        blitAbout(beadSprite(f.cooked ? ROAST : b ? b.v : (f.color || '#a16207') + '|'), x, y - h * 1.8, 0, 0, sz, sz, 0);
        if (f.cooked) steam(b, x, y, now);
      } else if (f.kind === 'mushroom') {
        drawMushroomAt(f, x, y, t, pop);
        if (lively && b && pop >= 1 && now > b.next) {
          b.next = now + 250 + Math.random() * 300; // (poison spores, puffing off it)
          mote(x + (Math.random() - 0.5) * CELL * 0.5, y - CELL * 0.12, (Math.random() - 0.5) * 8, -12 - Math.random() * 8, 1700, 1.8 + Math.random() * 1.2, 0);
        }
      } else if (f.kind === 'golden') {
        // A calm dim instead of a blink when it's about to rot.
        const left = f.expires - game.tick;
        const fade = left > T.GOLDEN_DIM_TICKS ? 1 : 0.45 + 0.55 * (left / T.GOLDEN_DIM_TICKS);
        const glow = pop * (1 + (lively ? 0.14 * Math.sin(t * 4) : 0)), w = SPRITE * CELL * glow;
        ctx.globalAlpha = fade * (lively ? 0.8 + 0.2 * Math.sin(t * 4) : 1);
        ctx.drawImage(glowSprite(), x - w / 2, y - w / 2, w, w);
        drawAppleAt(goldenSprite(), x, y, t * 1.1, pop, fade);
        ctx.save();
        ctx.translate(x + CELL * 0.2, y - CELL * 0.22);
        ctx.rotate(reduced ? 0 : now / 900);
        ctx.scale(pop, pop);
        blit(starSprite(), 0, 0, fade);
        ctx.restore();
        if (lively && b && pop >= 1 && now > b.next) {
          b.next = now + 180 + Math.random() * 260;
          mote(x + (Math.random() - 0.5) * CELL * 1.1, y + (Math.random() - 0.5) * CELL, 0, -6, 650, 0.35 + Math.random() * 0.3, 1);
        }
      }
    }
  }

  // ------------------------------------------------------------ burrows

  // A beetle burrow: an oval opening in the bark, splintered round its rim,
  // a little sawdust about it, and cracks that spread from it as the round
  // goes on (the beetles are hollowing the log out). Wood splits along its
  // grain, so the cracks run along the log, either way from the hole,
  // tapering, now and then forking. Each burrow's cracks
  // are its own (seeded by where it is) and grow to full length over about
  // half a minute. It opens with a pop.
  const CRACK_GROW_TICKS = 260;
  const crackCache = new Map(); // cell -> branches of [x, y] points (cells)
  const burrowSeen = new Map(); // cell -> when it first showed (for its pop)
  function cracksOf(b) {
    const k = b.y * GRID + b.x;
    let br = crackCache.get(k);
    if (br) return br;
    let seed = (k * 7919 + 13) % 2147483647 || 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    br = [];
    const split = (x, y, base, len) => {
      const pts = [[x, y]];
      let a = base + (rnd() - 0.5) * 0.4;
      for (let j = 0; j < len; j++) {
        a += (rnd() - 0.5) * 0.5 + (base - a) * 0.4; // (wandering, but kept to the grain)
        const step = 0.35 + rnd() * 0.25;
        x += Math.cos(a) * step; y += Math.sin(a) * step;
        pts.push([x, y]);
      }
      return pts;
    };
    for (const base of [Math.PI / 2, -Math.PI / 2]) { // (up and down the log)
      const main = split(0, 0, base, 5 + Math.floor(rnd() * 4));
      br.push(main);
      if (rnd() < 0.6) { // a fork
        const [fx, fy] = main[2 + Math.floor(rnd() * 2)];
        br.push(split(fx, fy, base + (rnd() < 0.5 ? -0.6 : 0.6), 2 + Math.floor(rnd() * 2)));
      }
    }
    crackCache.set(k, br);
    return br;
  }
  function drawBurrows(now) {
    if (!game.burrows?.length) return;
    const c = CELL;
    for (const b of game.burrows) {
      const k = b.y * GRID + b.x, x = b.x * c + c / 2, y = b.y * c + c / 2;
      if (!burrowSeen.has(k)) burrowSeen.set(k, now);
      const pop = popOf(now - burrowSeen.get(k));
      const grow = Math.min(1, Math.max(0.15, (game.tick - b.at) / CRACK_GROW_TICKS));
      // The cracks: dark, with a lit lip along one side, thinning out.
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const [col, off, w] of [['rgba(196,154,102,0.28)', 1.2, 1.6], ['rgba(14,7,2,0.7)', 0, 2.8]]) {
        ctx.strokeStyle = col;
        for (const pts of cracksOf(b)) {
          const shown = (pts.length - 1) * grow, thick = pts[0][0] || pts[0][1] ? 0.6 : 1;
          for (let j = 1; j <= Math.ceil(shown); j++) { // (tapering as it goes)
            const t = Math.min(1, shown - (j - 1)), [px, py] = pts[j - 1], [qx, qy] = pts[j];
            ctx.lineWidth = w * thick * (1 - 0.75 * (j - 1) / (pts.length - 1));
            ctx.beginPath();
            ctx.moveTo(x + off + px * c, y + off + py * c);
            ctx.lineTo(x + off + (px + (qx - px) * t) * c, y + off + (py + (qy - py) * t) * c);
            ctx.stroke();
          }
        }
      }
      // The opening (a cached sprite, one of four).
      const w = SPRITE * CELL * pop;
      ctx.drawImage(burrowSprite(String(k % 4)), x - w / 2, y - w / 2, w, w);
    }
  }
  // A burrow's opening: splinters round the rim, the dark hole, sawdust.
  const burrowSprite = v => sprite('burrow', v, drawBurrowHole);
  const drawBurrowHole = (g, v) => {
    const c = CELL, seed = Number(v);
    g.fillStyle = 'rgba(214,180,128,0.55)';
    g.beginPath(); g.ellipse(0, 0, c * 0.3, c * 0.22, 0.4, 0, TAU); g.fill();
    const grad = g.createRadialGradient(0, 0, 1, 0, 0, c * 0.24);
    grad.addColorStop(0, '#050201');
    grad.addColorStop(0.75, '#1c1007');
    grad.addColorStop(1, '#3b2412');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(0, 0, c * 0.24, c * 0.16, 0.4, 0, TAU); g.fill();
    g.fillStyle = 'rgba(232,206,160,0.75)';
    for (let i = 0; i < 6; i++) {
      const a = i * 1.9 + seed;
      g.beginPath(); g.arc(Math.cos(a) * c * (0.34 + (i % 3) * 0.05), Math.sin(a) * c * (0.3 + (i % 2) * 0.06), 1.1 + (i % 2) * 0.5, 0, TAU); g.fill();
    }
  };

  // ------------------------------------------------------------ weather

  // How much of each kind of weather is showing (eased, so spells come and go
  // gradually), the fire as last seen (to know when a cell burns out and
  // leaves a scorch mark), a lightning bolt, a rainbow.
  const sky = { sun: 0, wind: 0, rain: 0, storm: 0, snow: 0 };
  let snowCover = 0; // how white the bark has gone (it settles slowly, and melts slowly)
  const embers = []; // burning leaves in the air: { fx, fy, x, y, at }
  const fireSeen = new Map(); // cell -> it was burning
  const scorched = [];        // cells that burned (baked into the static layer)
  let scorchDrawn = 0, fireTick = -1;
  let bolt = null, flashAt = -1e9, rainbow = null, dive = null;

  function easeSky(dt) {
    const kind = game.weather?.kind || 'clear';
    const step = Math.min(1, dt / 1400);
    for (const k in sky) sky[k] += ((k === kind ? 1 : 0) - sky[k]) * step;
    snowCover += ((kind === 'snow' ? 1 : 0) - snowCover) * Math.min(1, dt / (kind === 'snow' ? 7000 : 9000));
  }

  // Where the fire was and is: cells that burned out leave a scorch (and a puff of smoke).
  function trackFire(now) {
    if (game.tick === fireTick) return;
    fireTick = game.tick;
    for (const [k, was] of fireSeen) {
      if (game.fires?.has(k)) continue;
      fireSeen.delete(k);
      if (!was) continue;
      scorched.push(k);
      const x = (k % GRID) * CELL + CELL / 2, y = Math.floor(k / GRID) * CELL + CELL / 2;
      for (let i = 0; i < 3; i++) mote(x + (Math.random() - 0.5) * CELL * 0.5, y, (Math.random() - 0.5) * 10, -18 - Math.random() * 10, 1500, 4 + Math.random() * 3, 2);
    }
    if (game.fires) for (const [k, f] of game.fires) fireSeen.set(k, game.tick >= f.from);
  }
  function syncScorch() {
    if (scorchDrawn === scorched.length || !staticLayer) return;
    const g = staticLayer.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    for (; scorchDrawn < scorched.length; scorchDrawn++) {
      const key = scorched[scorchDrawn], x = (key % GRID) * CELL + CELL / 2, y = Math.floor(key / GRID) * CELL + CELL / 2;
      const grad = g.createRadialGradient(x, y, 1, x, y, CELL * 0.62);
      grad.addColorStop(0, 'rgba(12,8,6,0.75)');
      grad.addColorStop(0.6, 'rgba(24,14,8,0.45)');
      grad.addColorStop(1, 'rgba(24,14,8,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, CELL * 0.62, 0, TAU); g.fill();
      g.fillStyle = 'rgba(160,150,140,0.35)'; // ash
      for (let i = 0; i < 5; i++) { const a = i * 2.3 + key; g.beginPath(); g.arc(x + Math.cos(a) * CELL * 0.22, y + Math.sin(a) * CELL * 0.18, 1.2, 0, TAU); g.fill(); }
    }
  }

  // Fire on the bark: lightning on its way crackles (a ring of light closing
  // in on the cell, so you can see how long there is), smouldering cells glow,
  // burning cells flame (deadly), sending up embers and smoke.
  const fireGlowSprite = () => sprite('fireglow', '', g => {
    const grad = g.createRadialGradient(0, 0, CELL * 0.1, 0, 0, CELL * 0.95);
    grad.addColorStop(0, 'rgba(253,186,116,0.6)');
    grad.addColorStop(1, 'rgba(249,115,22,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, CELL * 0.95, 0, TAU); g.fill();
  });
  function flame(g, x, y, h, w, lean) {
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x - w * 0.9, y - h * 0.55, x + lean, y - h);
    g.quadraticCurveTo(x + w * 0.9, y - h * 0.55, x + w, y);
    g.quadraticCurveTo(x, y + w * 0.5, x - w, y);
    g.fill();
  }
  // Flames on a burning cell, in eight frames of a flicker that loops (drawn
  // once each, as sprites: a fire is many curves, and many fires a lot of them).
  const FLAME_FRAMES = 8;
  const flameSprite = f => sprite('flame', String(f), drawFlames);
  const bodyFlameSprite = f => sprite('flame', 'b' + f, drawFlames); // (on a snake: no burnt bark under it)
  const drawFlames = (g, v) => {
    const c = CELL, bare = v[0] === 'b', p = Number(bare ? v.slice(1) : v) / FLAME_FRAMES * TAU;
    if (!bare) {
      g.fillStyle = 'rgba(20,8,2,0.55)'; // the burning bark under it
      g.beginPath(); g.arc(0, c * 0.12, c * 0.4, 0, TAU); g.fill();
    }
    const base = c * 0.42;
    for (const [col, sc] of [['#dc2626', 1.12], ['#f97316', 0.9], ['#fbbf24', 0.64], ['#fff7ed', 0.34]]) {
      g.fillStyle = col;
      for (let i = -1; i <= 1; i++) {
        const fl = Math.sin(p * (i === 0 ? 2 : 1) + i * 2.1), lean = Math.sin(p + i * 2.6);
        flame(g, i * c * 0.22 * sc, base, c * (0.95 + 0.2 * fl - Math.abs(i) * 0.22) * sc, c * 0.19 * (sc * 0.6 + 0.4), lean * c * 0.09);
      }
    }
  };
  function drawFire(alpha, now) {
    if (!game.fires?.size) return;
    const c = CELL, lively = !reduced, t = now / 1000, tickPos = game.tick - 1 + alpha;
    for (const [k, f] of game.fires) {
      const x = (k % GRID) * c + c / 2, y = Math.floor(k / GRID) * c + c / 2, ph = k * 0.73;
      if (tickPos < f.from - 1) {
        if (f.strike) { // lightning on its way: a ring closing in, and sparks
          const left = Math.max(0, Math.min(1, (f.from - 1 - tickPos) / T.STRIKE_WARN_TICKS));
          const flick = lively ? 0.7 + 0.3 * Math.sin(now / 37 + ph) : 1;
          ctx.beginPath(); ctx.arc(x, y, c * (0.35 + 1.1 * left), 0, TAU);
          ctx.strokeStyle = `rgba(196,181,253,${0.25 * flick})`;
          ctx.lineWidth = 9;
          ctx.stroke();
          ctx.strokeStyle = `rgba(237,233,254,${0.9 * flick})`;
          ctx.lineWidth = 2.2;
          ctx.stroke();
          ctx.fillStyle = `rgba(196,181,253,${0.35 + 0.3 * (1 - left)})`;
          circle(x, y, c * 0.34);
          ctx.strokeStyle = '#f5f3ff';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = (lively ? now / 90 : 0) + i * 2.1 + ph, r0 = c * 0.12, r1 = c * 0.42;
            ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
            ctx.lineTo(x + Math.cos(a + 0.4) * (r0 + r1) / 2, y + Math.sin(a + 0.4) * (r0 + r1) / 2);
            ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          }
          ctx.stroke();
        } else { // smouldering: an ember glow, a thread of smoke
          const glow = 0.45 + (lively ? 0.25 * Math.sin(now / 160 + ph) : 0);
          ctx.fillStyle = `rgba(239,68,68,${glow})`;
          circle(x, y + c * 0.1, c * 0.2);
          ctx.fillStyle = `rgba(253,186,116,${glow})`;
          circle(x, y + c * 0.1, c * 0.09);
          if (lively && Math.random() < 0.05) mote(x, y, (Math.random() - 0.5) * 6, -16, 1300, 3 + Math.random() * 2, 2);
        }
        continue;
      }
      // Burning: a glow, then flames, outer to inner.
      const w = SPRITE * CELL * 1.3; // (one size: the glow flickers by its opacity)
      ctx.globalAlpha = lively ? 0.8 + 0.2 * Math.sin(t * 9 + ph) : 1;
      ctx.drawImage(fireGlowSprite(), x - w / 2, y - w / 2, w, w);
      ctx.globalAlpha = 1;
      const fr = lively ? Math.floor(t * 12 + ph * 5) % FLAME_FRAMES : 0, fw = SPRITE * CELL;
      ctx.drawImage(flameSprite(fr), x - fw / 2, y - fw / 2, fw, fw);
      if (lively && Math.random() < 0.18) mote(x + (Math.random() - 0.5) * c * 0.5, y - c * 0.2, (Math.random() - 0.5) * 14, -40 - Math.random() * 30, 700, 1.4 + Math.random(), 3);
      if (lively && Math.random() < 0.06) mote(x, y - c * 0.4, (Math.random() - 0.5) * 8, -20, 1800, 4 + Math.random() * 3, 2);
    }
  }

  // The sky over the bark: a warm glow for the sun, grey for rain, a storm's
  // gloom (all under the snakes, so they stay bright); rain falling over
  // everything; a lightning bolt and its flash; a rainbow after the rain.
  function drawSkyTint() {
    const sun = sky.sun, rain = sky.rain, storm = sky.storm;
    if (sky.snow > 0.01) { // winter's cold blue light
      ctx.globalAlpha = 0.14 * sky.snow;
      ctx.fillStyle = '#bfdbfe';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
    }
    if (sun > 0.01) {
      ctx.globalAlpha = 0.16 * sun;
      ctx.drawImage(sunSprite(), -SIZE * 0.2, -SIZE * 0.2, SIZE * 1.2, SIZE * 1.2);
    }
    if (rain > 0.01 || storm > 0.01) {
      ctx.globalAlpha = 0.16 * rain + 0.3 * storm;
      ctx.fillStyle = storm > rain ? '#140f28' : '#1e293b';
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    ctx.globalAlpha = 1;
  }
  const sunSprite = () => sprite('sun', '', g => { // (a sprite's 2 cells, stretched over the board: it's all soft)
    const grad = g.createRadialGradient(-CELL * 0.8, -CELL * 0.8, 0, -CELL * 0.8, -CELL * 0.8, CELL * 2.2);
    grad.addColorStop(0, 'rgba(255,228,160,1)');
    grad.addColorStop(0.5, 'rgba(255,190,90,0.5)');
    grad.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = grad;
    g.fillRect(-CELL, -CELL, CELL * 2, CELL * 2);
  });
  // Rain: a seamless sheet of streaks, drawn once (at the board's resolution)
  // and scrolled down and across, in two layers at different speeds for depth.
  const RAIN_TILE = 384, RAIN_LAYERS = [[0.85, 1], [1.2, 0.55]], RAIN_LAYER = [[0.85, 1]];
  let rainTile = null;
  function buildRainTile() {
    const n = RAIN_TILE, t = makeLayer(n * k, n * k), g = t.getContext('2d');
    g.scale(k, k);
    g.strokeStyle = 'rgba(220,232,255,0.6)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.beginPath();
    for (let i = 0; i < 60; i++) {
      const x = rnd() * n, y = rnd() * n, len = 14 + rnd() * 10;
      for (const dx of [0, -n, n]) for (const dy of [0, -n, n]) { g.moveTo(x + dx, y + dy); g.lineTo(x + dx + len * 0.28, y + dy - len); }
    }
    g.stroke();
    return t;
  }
  function drawRain(now) {
    const wet = Math.max(sky.rain, sky.storm * 0.3); // (a storm only spits: it takes real rain to put fire out)
    if (wet < 0.02 || reduced) return;
    if (!rainTile) rainTile = buildRainTile();
    const n = RAIN_TILE;
    for (const [speed, alpha] of quality === 2 ? RAIN_LAYERS : RAIN_LAYER) {
      const oy = (now * speed) % n, ox = -(now * speed * 0.28) % n;
      ctx.globalAlpha = wet * alpha;
      for (let y = oy - n; y < SIZE; y += n) for (let x = ox - n; x < SIZE; x += n) ctx.drawImage(rainTile, x, y, n, n);
    }
    ctx.globalAlpha = 1;
  }
  function drawBolt(now) {
    if (!bolt) return;
    const age = now - bolt.at;
    if (age > 320) { bolt = null; return; }
    const a = 1 - age / 320;
    for (const [col, w] of [['rgba(196,181,253,0.55)', 9], ['rgba(237,233,254,0.95)', 3.2], ['#ffffff', 1.4]]) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawFlash(now) {
    const age = now - flashAt;
    if (age < 0 || age > 300 || reduced) return;
    ctx.globalAlpha = 0.28 * (1 - age / 300); // (soft, and once: no strobing)
    ctx.fillStyle = '#f5f3ff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1;
  }
  const RAINBOW = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#6366f1', '#a855f7'];
  // A rainbow after the rain: one great arch right across the log, rising out
  // of the golden apple (its foot fading into it) and over, its top on the
  // board where there's room, its other foot beyond the far edge. It draws
  // itself out from the apple, glows a moment, and fades.
  function drawRainbow(now) {
    if (!rainbow) return;
    const age = now - rainbow.at, life = 9000;
    if (age > life) { rainbow = null; return; }
    const fade = Math.min(1, age / 600, (life - age) / 1600), grow = reduced ? 1 : Math.min(1, age / 1400), c = CELL;
    const x = rainbow.x * c + c / 2, y = rainbow.y * c + c / 2, fromLeft = rainbow.x < GRID / 2;
    const R = Math.min(SIZE * 0.95, Math.max(SIZE * 0.45, y - SIZE * 0.1)), cx = fromLeft ? x + R : x - R;
    // From the apple's foot round over the top, as far as it has grown.
    const a0 = fromLeft ? Math.PI : TAU, dir = fromLeft ? 1 : -1, span = Math.PI * grow, foot = Math.min(span, 0.32);
    const bw = c * 0.3;
    const arc = (rad, from, to) => { ctx.beginPath(); ctx.arc(cx, y, rad, a0 + dir * from, a0 + dir * to, !fromLeft); ctx.stroke(); };
    const bands = (alpha, from, to) => {
      ctx.globalAlpha = 0.14 * fade * alpha; // a soft glow under it
      ctx.strokeStyle = '#fffbea';
      ctx.lineWidth = bw * 9;
      arc(R, from, to);
      ctx.globalAlpha = 0.3 * fade * alpha;
      ctx.lineWidth = bw + 0.8;
      for (let i = 0; i < RAINBOW.length; i++) { ctx.strokeStyle = RAINBOW[i]; arc(R + (3 - i) * bw, from, to); }
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, SIZE, SIZE); ctx.clip();
    ctx.lineCap = 'butt';
    // (the foot fades in, out of the apple)
    for (let i = 0; i < 6; i++) bands((i + 1) / 7, foot * i / 6, foot * (i + 1) / 6);
    if (span > foot) bands(1, foot, span);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ the woodpecker

  // A great spotted woodpecker, big (about six cells tall), clinging to the
  // log just outside the board: on whichever side of the board has room on
  // this screen, as near as it can to where it's working. It flies in when
  // sudden death starts; eyes its next chunk (which glows and cracks, faster
  // and faster as the strike nears); flies at it, drums it out in a shower of
  // chips; flies back; rests. It's drawn on its own layer over the whole page,
  // so it can sit outside the board.
  let birdLayer = null, birdG = null, birdShown = false;
  const boardRect = { x: 0, y: 0, w: 0 }; // the board on the page, in CSS px (the game keeps it current)
  function setBoardRect(x, y, w) { boardRect.x = x; boardRect.y = y; boardRect.w = w; }
  const BU = CELL * 0.85; // the bird's unit
  const BILL = [2.55, -1.72]; // its beak tip, in units, before its head moves
  const bird = { x: 0, y: 0, rot: 0, flip: 1, placed: false, arrivedAt: -1e9, chipAt: 0 };
  // Where it perches to work on a spot (board px): beside the board on the
  // nearest side with room for it on this screen, else the roomiest. It
  // always stands upright, facing the spot.
  function perchFor(tx, ty) {
    const sc = boardRect.w / SIZE;
    const room = sc ? {
      left: boardRect.x / sc, right: (innerWidth - boardRect.x - boardRect.w) / sc,
      top: boardRect.y / sc, bottom: (innerHeight - boardRect.y - boardRect.w) / sc,
    } : { left: 999, right: 0, top: 0, bottom: 0 };
    const need = { left: BU * 3.4, right: BU * 3.4, top: BU * 5, bottom: BU * 5 };
    const dist = { left: tx, right: SIZE - tx, top: ty, bottom: SIZE - ty };
    const fits = Object.keys(dist).filter(k => room[k] >= need[k]).sort((p, q) => dist[p] - dist[q]);
    const side = fits[0] || Object.keys(room).sort((p, q) => room[q] / need[q] - room[p] / need[p])[0];
    const along = v => Math.max(BU * 2, Math.min(SIZE - BU * 2, v));
    const face = tx < SIZE / 2 ? 1 : -1; // (above or below the board, it stands off to one side of the spot)
    switch (side) {
      case 'left': return { x: -Math.min(BU * 2.7, Math.max(BU, room.left - BU * 0.8)), y: along(ty) + BU * 1.75, flip: 1 };
      case 'right': return { x: SIZE + Math.min(BU * 2.7, Math.max(BU, room.right - BU * 0.8)), y: along(ty) + BU * 1.75, flip: -1 };
      case 'top': return { x: along(tx) - face * BU * 1.6, y: -Math.min(BU * 3.3, Math.max(BU * 1.5, room.top - BU * 2.6)), flip: face };
      default: return { x: along(tx) - face * BU * 1.6, y: SIZE + Math.min(BU * 2.6, Math.max(BU * 2.45, room.bottom - BU * 3.2)), flip: face };
    }
  }
  // Where it has to hover for its beak to reach a spot, facing `flip`.
  const strikeAt = (tx, ty, flip) => ({ x: tx - flip * BILL[0] * BU, y: ty - BILL[1] * BU });

  const ease = t => t * t * (3 - 2 * t);
  function drawWoodpecker(alpha, now, dt) {
    const w = game.woodpecker;
    if (!w || !birdLayer) {
      if (birdShown) { birdLayer.style.display = 'none'; birdShown = false; bird.placed = false; bird.box = null; }
      return;
    }
    if (!birdShown) { birdLayer.style.display = 'block'; birdShown = true; }
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 2 ? 2 : quality === 1 ? 1.5 : 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (birdLayer.width !== W || birdLayer.height !== H) { birdLayer.width = W; birdLayer.height = H; bird.box = null; }
    birdG.setTransform(1, 0, 0, 1, 0, 0);
    // (The layer is the whole page and the bird a small part of it: only
    // where it was last drawn is cleared, not the whole page every frame.)
    if (bird.box) birdG.clearRect(bird.box[0], bird.box[1], bird.box[2], bird.box[3]);
    else birdG.clearRect(0, 0, W, H);
    if (!boardRect.w) { bird.box = null; return; }
    const sc = boardRect.w / SIZE * dpr;
    birdG.setTransform(sc, 0, 0, sc, boardRect.x * dpr, boardRect.y * dpr);

    const tp = game.tick - 1 + alpha, lively = !reduced;
    const tx = w.x * CELL + CELL / 2, ty = w.y * CELL + CELL / 2;
    const perch = perchFor(tx, ty), hit = strikeAt(tx, ty, perch.flip);
    // The pose this moment calls for: perched, flying in or out, drumming.
    let gx = perch.x, gy = perch.y, fly = 0, drum = false;
    const aiming = w.target.length > 0;
    const out = aiming ? Math.max(0, Math.min(1, (tp - (w.strikeAt - 3.5)) / 2.5)) : 0; // flying at it...
    const back = !aiming && w.struckAt >= 0 ? Math.max(0, Math.min(1, (tp - (w.struckAt + 1.5)) / 2.5)) : 1; // ...and home again
    if (aiming && out > 0) {
      const e = ease(out);
      gx = perch.x + (hit.x - perch.x) * e; gy = perch.y + (hit.y - perch.y) * e;
      fly = out < 1 ? 1 : 0; drum = out >= 1;
    } else if (!aiming && back < 1) {
      const e = ease(back);
      gx = hit.x + (perch.x - hit.x) * e; gy = hit.y + (perch.y - hit.y) * e;
      fly = back > 0 ? 1 : 0; drum = back === 0;
    }
    // Arriving: swooping down from high above.
    const arrive = Math.min(1, (now - bird.arrivedAt) / 1100);
    if (arrive < 1) { const e = ease(arrive); gy -= (1 - e) * SIZE * 0.9; gx -= (1 - e) * SIZE * 0.25 * perch.flip; fly = 1; }
    // Moving between perches (its next chunk is elsewhere): a quick hop.
    if (!bird.placed || !lively) { bird.x = gx; bird.y = gy; bird.placed = true; }
    else if (fly || drum) { bird.x = gx; bird.y = gy; }
    else {
      const k2 = Math.min(1, dt / 160), dx = gx - bird.x, dy = gy - bird.y;
      bird.x += dx * k2; bird.y += dy * k2;
      if (Math.hypot(dx, dy) > BU * 0.8) fly = 1;
    }
    bird.flip = perch.flip;
    // Eyeing its chunk: the head turns to it, and it crouches as the strike nears.
    const crouch = aiming && out === 0 ? Math.max(0, 1 - (w.strikeAt - 3.5 - tp) / T.PECK_AIM_TICKS) : 0;
    let look = 0;
    if (aiming && out === 0) {
      const hx = bird.x + bird.flip * BU * 0.45, hy = bird.y - BU * 1.75;
      look = Math.max(-1.2, Math.min(1.2, Math.atan2(ty - hy, (tx - hx) * bird.flip)));
    }
    // Chips fly while it drums.
    if (drum && lively && now - bird.chipAt > 70) {
      bird.chipAt = now;
      spawn(tx + (Math.random() - 0.5) * CELL, ty + (Math.random() - 0.5) * CELL, 3, 260, 420, 2.6, '#c08a4a', '#f6ecd2');
    }
    paintWoodpecker(birdG, bird.x, bird.y, 0, bird.flip, { fly, drum, look, crouch, now: lively ? now : 0 });
    const bx = boardRect.x * dpr + (bird.x - 6 * BU) * sc, by = boardRect.y * dpr + (bird.y - 7 * BU) * sc;
    bird.box = [Math.floor(bx) - 2, Math.floor(by) - 2, Math.ceil(12 * BU * sc) + 4, Math.ceil(13 * BU * sc) + 4];
  }

  // The bird, in its own frame: beak towards +x, head up (-y), clinging by
  // its feet at the origin, its stiff tail propped below. u = BU.
  function paintWoodpecker(g, x, y, rot, flip, { fly, drum, look, crouch, now }) {
    const u = BU, flap = fly ? Math.sin(now / 55) : 0;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(flip * (1 + fly * 0.08), 1 + fly * 0.08); // (a touch bigger in the air: nearer to you)
    g.translate(0, crouch * u * 0.25);
    const ell = (cx, cy, rx, ry, a, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(cx * u, cy * u, rx * u, ry * u, a, 0, TAU); g.fill(); };
    // Its shadow on the bark.
    g.globalAlpha = fly ? 0.18 : 0.28;
    ell(0.35 + fly * 0.6, 0.6 + fly * 0.9, 1.1, 2, 0, '#000');
    g.globalAlpha = 1;
    // Wings out when it flies: big, black, barred white, beating.
    if (fly) {
      for (const sg of [1, -1]) {
        g.save();
        g.translate(-0.1 * u, -0.4 * u);
        g.rotate(sg * (0.9 + 0.7 * flap) + Math.PI);
        ell(1.5, 0, 1.6, 0.55, 0, '#18181b');
        g.fillStyle = '#f5f5f4';
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc((0.8 + i * 0.42) * u, (i % 2 ? 0.12 : -0.12) * u, 0.1 * u, 0, TAU); g.fill(); }
        g.restore();
      }
    }
    // The stiff tail it props itself on, the body, its buff belly, the red under its tail.
    g.fillStyle = '#18181b';
    g.beginPath(); g.moveTo(-0.55 * u, 1.1 * u); g.lineTo(-0.15 * u, 3.1 * u); g.lineTo(0.3 * u, 1.2 * u); g.fill();
    ell(-0.1, 0.3, 0.95, 1.55, 0.08, '#18181b');
    ell(0.38, 0.45, 0.52, 1.15, 0.12, '#efe9dc');
    ell(0.22, 1.42, 0.36, 0.3, 0, '#dc2626');
    // The folded wing: a white shoulder patch and white bars.
    if (!fly) {
      ell(-0.3, -0.5, 0.32, 0.52, 0.2, '#f5f5f4');
      g.fillStyle = '#f5f5f4';
      for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) { g.beginPath(); g.arc((-0.62 + i * 0.22) * u, (0.15 + row * 0.38) * u, 0.075 * u, 0, TAU); g.fill(); }
    }
    // Feet, gripping the bark.
    g.strokeStyle = '#57534e';
    g.lineWidth = 0.12 * u;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0.5 * u, 0.7 * u); g.lineTo(0.95 * u, 0.55 * u); g.moveTo(0.5 * u, 0.95 * u); g.lineTo(0.95 * u, 1.05 * u); g.stroke();
    // The head, which turns, and drives forward when it drums.
    const thrust = drum ? (0.5 - 0.5 * Math.cos(now / 26)) * 0.42 : 0;
    g.translate(0.25 * u, -1.15 * u);
    g.rotate(look + (drum ? 0.05 : 0));
    g.translate(thrust * u - 0.25 * u, 1.15 * u);
    ell(0.45, -1.75, 0.72, 0.7, 0, '#18181b');
    ell(-0.12, -1.95, 0.3, 0.28, 0, '#dc2626'); // red nape
    ell(0.62, -1.58, 0.44, 0.33, 0, '#f5f5f4'); // white cheek...
    g.strokeStyle = '#18181b'; // ...under a black moustache stripe
    g.lineWidth = 0.15 * u;
    g.beginPath(); g.moveTo(0.2 * u, -1.25 * u); g.quadraticCurveTo(0.6 * u, -1.38 * u, 1.0 * u, -1.3 * u); g.stroke();
    ell(0.75, -1.9, 0.14, 0.14, 0, '#0a0a0a'); // the eye, with a glint
    ell(0.79, -1.94, 0.05, 0.05, 0, '#ffffff');
    g.fillStyle = '#71717a'; // the chisel beak
    g.beginPath(); g.moveTo(1.05 * u, -2.0 * u); g.lineTo(BILL[0] * u, BILL[1] * u); g.lineTo(1.05 * u, -1.5 * u); g.closePath(); g.fill();
    g.fillStyle = '#3f3f46';
    g.beginPath(); g.moveTo(1.05 * u, -2.0 * u); g.lineTo(BILL[0] * u, BILL[1] * u); g.lineTo(1.05 * u, -1.78 * u); g.closePath(); g.fill();
    g.restore();
  }

  // On the board: the chunk it's eyeing glows and cracks, the pulse quickening
  // as the strike nears.
  const markSprite = () => sprite('mark', '', g => {
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, CELL * 0.85);
    grad.addColorStop(0, 'rgba(239,68,68,0.55)');
    grad.addColorStop(0.55, 'rgba(220,38,38,0.3)');
    grad.addColorStop(1, 'rgba(220,38,38,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, CELL * 0.85, 0, TAU); g.fill();
  });
  function drawTarget(alpha, now) {
    const w = game.woodpecker;
    if (!w || !w.target.length) return;
    const tp = game.tick - 1 + alpha, prog = Math.max(0, Math.min(1, 1 - (w.strikeAt - tp) / T.PECK_AIM_TICKS));
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now * (0.008 + 0.03 * prog));
    // A red glow welling up through the chunk (soft, cell by cell, so it runs together)...
    ctx.globalAlpha = 0.45 + 0.45 * pulse * (0.4 + prog * 0.6);
    const w2 = SPRITE * CELL * 0.95;
    for (const k of w.target) ctx.drawImage(markSprite(), (k % GRID) * CELL + CELL / 2 - w2 / 2, Math.floor(k / GRID) * CELL + CELL / 2 - w2 / 2, w2, w2);
    ctx.globalAlpha = 1;
    // ...and cracks spreading across it.
    ctx.strokeStyle = 'rgba(20,8,2,0.75)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const k of w.target) {
      const x = (k % GRID) * CELL + CELL / 2, y = Math.floor(k / GRID) * CELL + CELL / 2, a = k * 1.7, len = CELL * 0.45 * prog;
      ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a + 2.4) * len * 0.8, y + Math.sin(a + 2.4) * len * 0.8);
    }
    ctx.stroke();
  }

  // ------------------------------------------------------------ the frame

  let shakeUntil = 0, shakePx = 0, lastNow = 0;

  // alpha: how far the current tick has played out (0..1).
  function frame(alpha, now) {
    if (!game || !sized) return;
    if (!staticLayer) resetStatic();
    const dt = lastNow ? Math.min(64, Math.max(0, now - lastNow)) : 16; // (never backwards: a clock a hair behind another)
    lastNow = now;
    frameDt = Math.max(1, dt);
    syncHoles();
    trackFire(now);
    syncScorch();
    easeSky(dt);
    if (deaths.length || corpses.length) updateCorpses(now);

    let sx = 0, sy = 0;
    if (!reduced && now < shakeUntil) {
      const t = (shakeUntil - now) / T.SHAKE_MS;
      sx = Math.round((Math.random() * 2 - 1) * shakePx * t * k);
      sy = Math.round((Math.random() * 2 - 1) * shakePx * t * k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BARK; // the bark shifts, so fill the sliver it uncovers
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    shakeX = sx; shakeY = sy;
    ctx.setTransform(1, 0, 0, 1, sx, sy);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(k, 0, 0, k, sx, sy);
    drawCanopy(now);

    drawFields(now); // (homes and colonies: their force fields, then the colonies' flags)


    drawBurrows(now);
    drawSnowCover();
    drawLeaves(now, dt);
    drawFood(alpha, now);
    drawDive(now);
    drawFire(alpha, now);
    drawSkyTint();
    drawRainbow(now);

    if (corpses.length) drawCorpses(alpha, now);
    drawSnakes(alpha, now);
    drawFieldHues(now);
    drawTarget(alpha, now);
    drawRain(now);
    drawSnow(now);
    drawEmbers(now);
    if (sky.snow > 0.5) breathe(now);
    drawBolt(now);
    drawMotes(dt);
    drawBlasts(now);
    drawParticles(dt);
    drawYou(now);
    drawFloaters(dt);
    drawFlash(now);
    drawWoodpecker(alpha, now, dt);
  }

  // ------------------------------------------------------------ the world

  // The first seconds of a round: which snake is yours. A bouncing arrow and
  // YOU over your head (below it, near the top edge), a ring pulsing round
  // it, chevrons marching the way you're heading; friends online get their
  // names. Each screen marks its own snake. It fades once you steer (or a few
  // seconds in): the game says when (showYou).
  let youOn = false, youA = 0;
  function showYou(on) { youOn = !!on; }
  function drawYou(now) {
    youA += ((youOn ? 1 : 0) - youA) * Math.min(1, frameDt / 180);
    if (youA < 0.02 || !game) return;
    const c = CELL, t = reduced ? 0 : now / 1000;
    for (const s of game.snakes) {
      if (!s.alive || s.persona) continue; // (people only)
      const a = anim.get(s);
      if (!a || !a.n) continue;
      const hx = a.pts[0], hy = a.pts[1], mine = s.id === viewerId, col = colorOf(s);
      ctx.globalAlpha = youA;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const below = hy < c * 2.6, sgn = below ? 1 : -1; // (near the top edge: under the head, pointing up)
      if (!mine) { // a friend: the same arrow (a touch smaller), with the name they picked
        marker(hx, hy, sgn, col, s.name, 0.82, t);
        continue;
      }
      // A ring pulsing round your head...
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.strokeStyle = '#fffbea';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(hx, hy, c * (0.75 + 0.15 * pulse), 0, TAU); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // ...chevrons marching the way you're heading...
      ctx.strokeStyle = col;
      ctx.lineWidth = c * 0.09;
      ctx.lineCap = 'round';
      const dx = s.dir.x, dy = s.dir.y;
      for (let i = 1; i <= 3; i++) {
        const along = i + ((t * 2) % 1) - 0.3, f = 1 - (along - 0.7) / 3;
        if (f <= 0) continue;
        const cx = hx + dx * c * along, cy = hy + dy * c * along, w = c * 0.22;
        if (cx < 0 || cy < 0 || cx > SIZE || cy > SIZE) continue;
        ctx.globalAlpha = youA * Math.min(1, f);
        ctx.beginPath();
        ctx.moveTo(cx - dx * w + dy * w, cy - dy * w + dx * w);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - dx * w - dy * w, cy - dy * w - dx * w);
        ctx.stroke();
      }
      // ...and a bouncing arrow with YOU on it.
      ctx.globalAlpha = youA;
      marker(hx, hy, sgn, col, 'YOU', 1, t);
    }
    ctx.globalAlpha = 1;
  }
  // A bouncing arrow over a head (under it, sgn 1, near the top edge) with a
  // label in the snake's colour; scale 1 for yours.
  function marker(hx, hy, sgn, col, label, scale, t) {
    const c = CELL * scale;
    const bob = Math.sin(t * 5) * c * 0.18, tip = hy + sgn * (CELL * 0.9 + Math.abs(bob)), aw = c * 0.55, ah = c * 0.6;
    ctx.fillStyle = '#fffbea';
    ctx.strokeStyle = INK;
    ctx.lineWidth = c * 0.07;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, tip);
    ctx.lineTo(hx - aw, tip + sgn * ah);
    ctx.lineTo(hx - aw * 0.42, tip + sgn * ah);
    ctx.lineTo(hx - aw * 0.42, tip + sgn * ah * 1.7);
    ctx.lineTo(hx + aw * 0.42, tip + sgn * ah * 1.7);
    ctx.lineTo(hx + aw * 0.42, tip + sgn * ah);
    ctx.lineTo(hx + aw, tip + sgn * ah);
    ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.font = `700 ${Math.round(c * (label === 'YOU' ? 0.85 : 0.62))}px Fredoka, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ly = tip + sgn * (ah * 1.7 + c * 0.6), half = Math.min(SIZE / 2, ctx.measureText(label).width / 2 + 4), lx = Math.min(SIZE - half, Math.max(half, hx));
    ctx.lineWidth = c * 0.16; ctx.strokeStyle = 'rgba(58,38,20,0.9)'; ctx.strokeText(label, lx, ly);
    ctx.fillStyle = col; ctx.fillText(label, lx, ly);
  }

  // Call after every tick, with that tick's events: sets off pops, gulps and puffs.
  function onTick(events) {
    if (!game) return;
    const now = lastNow || performance.now(); // the frame clock, like everything else drawn
    for (const e of events) {
      if (e.type === 'eat') {
        let x = e.x * CELL + CELL / 2, y = e.y * CELL + CELL / 2;
        const a = animOf(e.snake, now);
        if (e.kind !== 'mushroom') {
          a.gulps[a.gulpAt] = game.tick - 1; a.gulpAt = (a.gulpAt + 1) % 4;
          // Gobbler (and Capricious in a Gobbler mood) wolfs it down: a big gulp, cheeks puffed.
          const big = lookOf(e.snake) === 'gobbler';
          a.gulpR = big ? T.GOBBLE : T.GULP;
          a.gulpW = big ? T.GOBBLE_LENGTH : T.GULP_LENGTH;
        }
        a.ateAt = now; // every bite: the head squashes and the mouth chews
        x += e.snake.dir.x * CELL * 0.5; // the crumbs fly from the mouth, not over the face
        y += e.snake.dir.y * CELL * 0.5;
        if (e.kind === 'golden') spawn(x, y, T.PARTICLES_EAT + 6, 220, T.PARTICLE_LIFE, 3.2, '#fde68a', '#fbbf24');
        else if (e.kind === 'beetle') spawn(x, y, T.PARTICLES_EAT + (e.gold ? 10 : 4), e.gold ? 240 : 200, T.PARTICLE_LIFE, 3, e.gold ? '#fbbf24' : '#059669', e.gold ? '#fffbea' : '#fbbf24'); // emerald and gold, a crunchy catch (a golden one: a burst of gold)
        else if (e.kind === 'pellet') spawn(x, y, T.PARTICLES_EAT - 4, 150, T.PARTICLE_LIFE * 0.8, 2.6, e.color && e.color[0] === '#' ? e.color : '#c2410c', '#f6ecd2');
        else if (e.kind === 'mushroom') { // poison: a puff of spores, and it goes queasy green for a moment
          spawn(x, y, T.PARTICLES_EAT - 2, 160, T.PARTICLE_LIFE, 2.6, '#c084fc', '#84cc16');
          a.queasyAt = now;
        }
        else spawn(x, y, T.PARTICLES_EAT, 180, T.PARTICLE_LIFE, 2.8, '#a3e635', '#fde68a'); // sprout and honey: visible on bark and on green snakes alike
        eatenNow.add(e.y * GRID + e.x);
        if (e.snake.id === viewerId && e.kind !== 'mushroom') floater(e.x * CELL + CELL / 2, Math.max(CELL * 1.3, e.y * CELL - CELL * 0.6), e.kind === 'golden' ? '+3' : e.kind === 'beetle' ? '+2' : '+1');
      } else if (e.type === 'death') {
        deaths.push(e.snake); // bursts on the next frame, unless the moment is held
        noteRemains(e.snake, now);
        // A comic-book word where it went down: KO! if a snake did it, Bonk! for a wall or a hole.
        const k = e.snake.killer, h = e.snake.body[0];
        if (!reduced && e.snake.killerId === viewerId && e.snake.id !== viewerId && e.snake.killer !== 'self') shake(3); // (your kill: you feel it)
        if (k !== 'hunger') floater(h.x * CELL + CELL / 2, Math.max(CELL * 1.3, h.y * CELL - CELL * 0.2), k === 'wall' || k === 'self' || !game.snakes.some(o => o.name === k) ? 'Bonk!' : 'KO!');
      } else if (e.type === 'crash') { // a bonk where it hit, the head's lunge, and its tail breaking off as beads
        const s = e.snake, a = animOf(s, now), h = s.body[0];
        a.crashAt = now; a.crashDx = s.dir.x; a.crashDy = s.dir.y;
        // (its tail breaks off as beads in its own markings, last segment last)
        const prev = s.prev || [];
        for (let i = s.body.length; i < s.body.length + e.lost && i < prev.length; i++) {
          const key = prev[i].y * GRID + prev[i].x;
          if (!born.has(key)) born.set(key, { kind: 'pellet', at: now + (i - s.body.length) * RIPPLE_MS, i, next: 0, gen: bornGen, v: beadOf(s, i) });
        }
        const px = (h.x + 0.5 + s.dir.x * 0.5) * CELL, py = (h.y + 0.5 + s.dir.y * 0.5) * CELL;
        const other = e.killerId != null ? game.snakes[e.killerId] : null, col = other ? colorOf(other) : '';
        if (other && col[0] === '#') spawn(px, py, 12, 220, 480, 2.6, col, '#fffbea');
        else spawn(px, py, 12, 220, 480, 2.6, '#c08a4a', '#3b2412'); // (chips of bark)
        // (at the point of impact, clear of the stars over its head)
        floater(px + s.dir.x * CELL * 0.4 + (s.dir.y < 0 ? CELL * 1.2 : 0), Math.max(CELL * 1.3, py + s.dir.y * CELL * 0.4), 'Bonk!');
        if (s.id === viewerId) {
          if (e.lost >= 1 && e.lost <= 3) floater(h.x * CELL + CELL / 2 - s.dir.x * CELL * 1.2, Math.max(CELL * 1.3, h.y * CELL - CELL * 1.4), '-' + e.lost);
          if (!reduced) shake(4);
        }
      } else if (e.type === 'leap') { // up and over: a puff of dust where it took off
        const a = animOf(e.snake, now), h = e.snake.body[2] || e.snake.body[0];
        a.leapTick = game.tick;
        a.leapUntil = game.tick + e.snake.body.length; // (until the arch has run off its tail)
        spawn(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, 8, 140, 420, 2.2, '#d6b480', '#fde68a');
      } else if (e.type === 'cut') { // the woodpecker took its tail
        floater(e.x * CELL + CELL / 2, Math.max(CELL * 1.3, e.y * CELL - CELL * 0.2), 'Ouch!');
      } else if (e.type === 'alight') { // crawled into the fire: a burst of flame
        const h = e.snake.body[0];
        spawn(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, 14, 200, 520, 2.6, '#f97316', '#fde047');
      } else if (e.type === 'singe') { // a piece falls off in the flames
        const tl = e.snake.body[e.snake.body.length - 1];
        spawn(tl.x * CELL + CELL / 2, tl.y * CELL + CELL / 2, 6, 120, 420, 2.2, '#f97316', '#78716c');
        if (e.snake.id === viewerId) floater(e.snake.body[0].x * CELL + CELL / 2, Math.max(CELL * 1.3, e.snake.body[0].y * CELL - CELL * 1.1), '-1');
      } else if (e.type === 'baked') { // done: a puff of steam and a glint
        const x = e.x * CELL + CELL / 2, y = e.y * CELL + CELL / 2;
        for (let i = 0; i < 4; i++) mote(x + (Math.random() - 0.5) * CELL * 0.4, y - CELL * 0.2, (Math.random() - 0.5) * 10, -20 - Math.random() * 10, 1200, 2.5, 4);
        spawn(x, y, 6, 120, 420, 2, '#fdba74', '#fffbea');
      } else if (e.type === 'ash') { // burnt to nothing: grey ash and smoke
        const x = e.x * CELL + CELL / 2, y = e.y * CELL + CELL / 2;
        eatenNow.add(e.y * GRID + e.x);
        spawn(x, y, 10, 140, 600, 2.4, '#a8a29e', '#57534e');
        for (let i = 0; i < 3; i++) mote(x, y - CELL * 0.2, (Math.random() - 0.5) * 8, -16, 1400, 3, 2);
      } else if (e.type === 'rot') { // rotted away: a brown puff
        spawn(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 8, 110, 460, 2.2, '#8a6a2a', '#57534e');
      } else if (e.type === 'woodpecker') {
        bird.arrivedAt = now;
      } else if (e.type === 'peck') { // a chunk comes out: chips flying from every cell, and a thump
        for (const k of e.cells || []) spawn((k % GRID) * CELL + CELL / 2, Math.floor(k / GRID) * CELL + CELL / 2, 4, 240, 520, 2.8, '#c08a4a', '#3b2412');
        if (e.cells?.length && !reduced) shake(5);
      } else if ((e.type === 'spawn' && e.kind === 'beetle') || e.type === 'emerge') {
        beetleAt = now; // (it pops out of its burrow, kicking up a little sawdust)
        if (e.x >= 0) spawn(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 6, 110, 420, 2, '#d6b480', '#a16207');
      } else if (e.type === 'dive') { // down its burrow
        dive = { x: e.x, y: e.y, at: now, ang: beetleAng ?? 0 };
        spawn(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 6, 110, 420, 2, '#d6b480', '#a16207');
      } else if (e.type === 'burrow') {
        spawn(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 12, 170, 520, 2.4, '#d6b480', '#3b2412');
      } else if (e.type === 'gust' && e.x >= 0) { // an apple knocked loose: it drops in
        born.set(e.y * GRID + e.x, { kind: 'food', at: now, i: 0, next: 0, gen: bornGen, v: '', fell: true });
      } else if (e.type === 'strike') {
        const x = e.x * CELL + CELL / 2, y = e.y * CELL + CELL / 2, pts = [[x + (Math.random() - 0.5) * CELL * 6, -CELL]];
        for (let i = 1; i < 9; i++) { const f = i / 9; pts.push([pts[0][0] + (x - pts[0][0]) * f + (Math.random() - 0.5) * CELL * 1.6 * (1 - f), -CELL + (y + CELL) * f]); }
        pts.push([x, y]);
        bolt = { pts, at: now };
        flashAt = now;
        if (!reduced) { shake(3); spawn(x, y, 14, 260, 520, 2.6, '#fde047', '#f5f3ff'); }
      } else if (e.type === 'ember') {
        embers.push({ fx: e.fx, fy: e.fy, x: e.x, y: e.y, at: now });
      } else if (e.type === 'rainbow') {
        rainbow = { x: e.x, y: e.y, at: now };
      } else if (e.type === 'flown') { // a beetle nobody caught takes off
        spawn(e.x * CELL + CELL / 2, e.y * CELL + CELL / 2, 8, 260, T.PARTICLE_LIFE * 1.2, 2.2, '#d1fae5', '#059669');
      }
    }
  }

  // A dead snake bursts into meat, or with reduced motion fades over its meat.
  // When the game holds the moment (your death), the snakes that died on that
  // tick keep their pose, eyes screwed shut and covering their meat, until the
  // hold ends. corpses: { s, until (burst/fade time), fade (true once fading) }.
  const deaths = [], corpses = [];
  const FADE_MS = T.CORPSE_FADE_MS;
  const heldCells = new Uint8Array(GRID * GRID);

  function hold(until) {
    for (const s of deaths) corpses.push({ s, until, fade: false });
    deaths.length = 0;
  }

  // Out: it goes off with a pop. A white flash and a shockwave ring in its
  // colour at its head, a burst of pieces from the head and along the body,
  // and smoke.
  const blasts = []; // { x, y, at, color }
  function burst(s) {
    const col = colorOf(s), hex = col[0] === '#' ? col : '#f6ecd2', h = s.body[0];
    const hx = h.x * CELL + CELL / 2, hy = h.y * CELL + CELL / 2;
    blasts.push({ x: hx, y: hy, at: lastNow, color: hex });
    spawn(hx, hy, 26, 380, T.PARTICLE_LIFE * 1.3, 3.4, hex, '#fffbea');
    for (let i = 1; i < s.body.length; i += 2) {
      const c = s.body[i];
      spawn(c.x * CELL + CELL / 2, c.y * CELL + CELL / 2, Math.max(2, Math.round(T.PARTICLES_DEATH / Math.ceil(s.body.length / 2))), 240, T.PARTICLE_LIFE * 1.2, 3, hex, '#a16207');
    }
    for (let i = 0; i < 6; i++) mote(hx + (Math.random() - 0.5) * CELL, hy + (Math.random() - 0.5) * CELL, (Math.random() - 0.5) * 30, -18 - Math.random() * 18, 1400, 4 + Math.random() * 3, 2);
  }
  function drawBlasts(now) {
    for (let i = blasts.length - 1; i >= 0; i--) {
      const b = blasts[i], t = (now - b.at) / 480;
      if (t >= 1 || t < 0) { blasts.splice(i, 1); continue; }
      const grow = reduced ? 0.5 : t;
      const fr = CELL * (0.7 + 1.5 * grow); // the flash: a fireball, white-hot at the heart
      const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, fr);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.35, '#fef08a'); glow.addColorStop(0.7, 'rgba(249,115,22,0.55)'); glow.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.globalAlpha = (1 - t) * (1 - t);
      ctx.fillStyle = glow;
      circle(b.x, b.y, fr);
      ctx.globalAlpha = 1 - t; // the shockwave
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 7 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, CELL * (0.5 + 3.4 * grow), 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fffbea';
      ctx.lineWidth = 2 * (1 - t);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Before drawing: unheld deaths burst; held ones whose time is up burst or start fading.
  function updateCorpses(now) {
    for (const s of deaths) {
      if (reduced) corpses.push({ s, until: now, fade: true });
      else burst(s);
    }
    deaths.length = 0;
    heldCells.fill(0);
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      if (!c.fade && now >= c.until) {
        if (reduced) c.fade = true;
        else { burst(c.s); corpses.splice(i, 1); continue; }
      }
      if (c.fade && now >= c.until + FADE_MS) { corpses.splice(i, 1); continue; }
      if (!c.fade) for (const b of c.s.body) heldCells[b.y * GRID + b.x] = 1;
    }
  }

  // Held corpses are drawn at the frame's own point in the tick (a snake that
  // starved moved before it died), the head pressed into what it hit, with a spark.
  function drawCorpses(alpha, now) {
    for (const c of corpses) {
      const opacity = c.fade ? Math.max(0, 1 - (now - c.until) / FADE_MS) : 1;
      const hit = !c.fade && c.s.killer !== 'hunger';
      ctx.globalAlpha = opacity;
      const a = prepare(c.s, c.s.prev ? alpha : 1, now, true, hit ? 0.2 : 0);
      drawShadow(a);
      drawOutline(c.s, a);
      drawBody(c.s, a, now, true);
      ctx.globalAlpha = 1;
      if (hit) { // at the point of contact, kept on the board
        const sx = Math.min(SIZE, Math.max(0, a.pts[0] + c.s.dir.x * CELL * 0.55));
        const sy = Math.min(SIZE, Math.max(0, a.pts[1] + c.s.dir.y * CELL * 0.55));
        blitCrisp(starSprite(), sx, sy);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Confetti: for a win, a new best (all over the board), or the winner of a
  // round you're watching (from its head).
  const CONFETTI = ['#fde68a', '#a3e635', '#f472b6', '#22d3ee', '#fb923c', '#c4b5fd', '#fffbea'];
  function celebrate(s = null) {
    if (reduced) return;
    if (s && s.body.length) {
      const h = s.body[0];
      for (let i = 0; i < 4; i++) spawn(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, 9, 320, T.PARTICLE_LIFE * 3, 3.4, CONFETTI[i], CONFETTI[i + 3], 1);
      return;
    }
    for (let i = 0; i < 12; i++) spawn((i + 0.5) / 12 * SIZE, SIZE * (0.25 + (i % 3) * 0.12), 9, 400, T.PARTICLE_LIFE * 4, 4.6, CONFETTI[i % CONFETTI.length], CONFETTI[(i + 3) % CONFETTI.length], 1);
  }

  function shake(px) {
    shakePx = px;
    shakeUntil = (lastNow || performance.now()) + T.SHAKE_MS; // (the board's clock, which runs faster when watching faster)
  }

  // Where a snake's head is drawn right now, in CSS pixels from the board's
  // top-left (for speech bubbles). boardPx is the board's CSS width.
  function headPx(s, alpha, boardPx, out) {
    const c = s.body[0], p = s.prev && s.prev[0] ? s.prev[0] : c;
    const scale = boardPx / GRID;
    out.x = (p.x + (c.x - p.x) * alpha + 0.5) * scale;
    out.y = (p.y + (c.y - p.y) * alpha + 0.5) * scale;
    return out;
  }

  // Size the backing store to the board's real size × devicePixelRatio.
  // cssPx comes from a ResizeObserver, so no layout is read here.
  // The backing store matches the device pixels the canvas covers exactly, so
  // the browser never resamples it (devicePx comes from the ResizeObserver
  // where supported). It's capped at MAX_BACKING pixels across (a large board
  // on a dense screen), not at a density, so small dense phones stay crisp.
  const MAX_BACKING = 2048;
  // Quality: 2 everything; 1 no canopy shadows or second rain sheet, and at
  // most 1.5 device pixels per CSS pixel; 0 also no falling leaves, at 1.
  // (The game lowers it, for good, if this device keeps dropping frames.)
  let quality = 2, lastCss = 0, lastDevice = 0;
  function setQuality(q) {
    if (q === quality) return;
    quality = q;
    if (lastCss) resize(lastCss, lastDevice, true);
  }
  function resize(cssPx, devicePx, force = false) {
    lastCss = cssPx; lastDevice = devicePx;
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 2 ? 99 : quality === 1 ? 1.5 : 1);
    const estimate = Math.round(cssPx * dpr);
    const exact = devicePx && quality === 2 && Math.abs(devicePx - estimate) <= 2 ? devicePx : estimate;
    const target = Math.max(GRID, Math.min(MAX_BACKING, exact));
    if (target === canvas.width && sized && !force) return false;
    sized = true;
    devPerCss = target / cssPx;
    canvas.width = canvas.height = target;
    k = target / SIZE;
    barkLayer = null;
    rainTile = null;
    snowTile = null;
    sprites.clear();
    fieldLooks.clear();
    resetStatic();
    syncHoles();
    return true;
  }

  function init(opts) {
    canvas = opts.canvas;
    birdLayer = opts.birdLayer || null;
    birdG = birdLayer ? birdLayer.getContext('2d') : null;
    ctx = canvas.getContext('2d', { alpha: false });
    PERSONAS = opts.personas;
    k = canvas.width / SIZE;
    // Text sprites drawn before the font arrived get redrawn with it.
    document.fonts?.ready.then(() => sprites.delete('float'));
  }

  const FLOAT_WORDS = ['+1', '+2', '+3', 'KO!', 'Bonk!', 'Ouch!', '-1', '-2', '-3'];
  function setGame(g) {
    game = g;
    if (sized) for (const w of FLOAT_WORDS) sprite('float', w, drawFloat); // (drawn now, not on the first bite)
    deaths.length = 0;
    corpses.length = 0;
    pLive = 0;
    plife.fill(0);
    flife.fill(0);
    mLive = 0;
    mlife.fill(0);
    born.clear();
    eatenNow.clear();
    bornTick = -1;
    fresh = true;
    beetleAng = null;
    beetleAt = 0;
    fallen.length = 0;
    nextLeaf = 0;
    crackCache.clear();
    burrowSeen.clear();
    fireSeen.clear();
    scorched.length = 0;
    scorchDrawn = 0;
    fireTick = -1;
    bolt = null; rainbow = null; dive = null; flashAt = -1e9;
    blasts.length = 0;
    bird.placed = false; bird.arrivedAt = -1e9;
    for (const k in sky) sky[k] = 0;
    snowCover = 0;
    embers.length = 0;
    ripples.length = 0;
    dimples.length = 0;
    homeShown.clear();
    inField.clear();
    fieldLooks.clear();
    drifts = null;
    // A different stretch of log each round.
    barkSeed = 1 + Math.floor(Math.random() * 2147483645);
    barkLayer = null;
    shadeLayer = null;
    resetStatic();
  }

  return {
    showYou,
    init, setGame, resize, frame, onTick, shake, hold, headPx, colorOf, markOf, celebrate, setQuality, setBoardRect,
    get quality() { return quality; },
    holding: () => deaths.length > 0 || corpses.length > 0,
    setViewer(id) { viewerId = id; },
    setReducedMotion(v) { reduced = v; },
    get particles() { return pLive; },
  };
})();
