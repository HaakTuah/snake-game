// The rules of Bark & Bite: no DOM, no drawing. The game (snake.js) and the
// headless simulator both run this file unchanged. Tuning lives in tuning.js.
window.SnakeEngine = (() => {
  const T = window.TUNING;
  const { GRID } = T;
  const CELLS = GRID * GRID;
  const { DIRS, PERSONAS, POOL, decide } = window.SnakeAI;
  const PLAYER_COLOR = '#4ade80';

  const SPAWNS = [
    { x: 5, y: 3, dir: DIRS.right },
    { x: 20, y: 5, dir: DIRS.down },
    { x: 18, y: 20, dir: DIRS.left },
    { x: 3, y: 18, dir: DIRS.up },
  ];

  // Occupancy grids for collision checks, reused every tick. A cell counts as
  // marked only when its stamp equals the current tick's stamp, so nothing
  // needs clearing between ticks.
  const bodyStamp = new Int32Array(CELLS), bodyOwner = new Int16Array(CELLS);
  const headStamp = new Int32Array(CELLS), headCount = new Uint8Array(CELLS), headFirst = new Int16Array(CELLS);
  let stamp = 0;

  const key = (x, y) => y * GRID + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;
  // One cell on from (x, y) in direction d: off the board, unless the edges
  // wrap round for this snake (a golden mushroom).
  const wraps = (game, s) => s.wrapUntil > game.time;
  function ahead(game, s, x, y, d) {
    let nx = x + d.x, ny = y + d.y;
    if (wraps(game, s)) { nx = (nx + GRID) % GRID; ny = (ny + GRID) % GRID; }
    return { x: nx, y: ny };
  }
  const between = (a, b) => a + Math.random() * (b - a);
  const WEATHER = ['clear', 'sun', 'wind', 'rain', 'storm', 'snow'];

  function makeSnake(id, spawn, props) {
    const d = spawn.dir;
    const body = Array.from({ length: T.START_LENGTH }, (_, k) => ({ x: spawn.x - d.x * k, y: spawn.y - d.y * k }));
    return {
      id, body, dir: d, alive: true, grow: 0, eaten: 0, pellets: 0, lastAte: 0, ateTick: -1, nextStarve: T.HUNGER_MS,
      // stunUntil: the tick it moves again after a crash; burnUntil, burnFrom: on fire (from, until)
      stunUntil: -1, burnUntil: -1, burnFrom: -1,
      // Powers. leaps: golden leaps held (golden beetles); dashes: golden
      // dashes held (golden leaves; one golden power at a time); leapReadyAt:
      // when it can next leap (game time); wrapUntil: the edges wrap round for
      // it till then (a golden mushroom); flight: { dir } while it's in the air
      // (it lands next tick); leapArmed: the last tick a power it asked for waits.
      leaps: 0, dashes: 0, leapReadyAt: 0, wrapUntil: -1, flight: null, leapArmed: -1,
      queue: [], cause: null, killer: null, killerId: null, diedAt: null, memory: {}, planned: null, plannedTick: -1, ...props,
    };
  }

  const aiSnake = (id, spawn, key) => {
    const p = PERSONAS[key];
    return makeSnake(id, spawn, { name: p.name, color: p.color, persona: p, personaKey: key });
  };

  function pickOpponents(n) {
    const pool = [...POOL];
    const picks = [];
    while (picks.length < n && pool.length) picks.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    return picks;
  }

  // humans: [{ name, color }] for the snakes people steer (isPlayer: driven by
  // an input queue): one by default, none for an AI-only round, up to four
  // online. AI snakes fill the other seats, from persona keys (random by
  // default). Names are made unique, so a person called "Sniper" can't be
  // mistaken for the rival of that name.
  function createGame({ humans = null, withPlayer = true, personas = null } = {}) {
    const people = (humans || (withPlayer ? [{ name: 'You', color: PLAYER_COLOR }] : [])).slice(0, SPAWNS.length);
    const wanted = T.OPPONENTS + 1 - people.length;
    const keys = (personas || pickOpponents(wanted)).filter(k => Object.prototype.hasOwnProperty.call(PERSONAS, k)).slice(0, wanted);
    const snakes = [];
    // (The killer of a snake that hit a wall, itself or hunger is that word, so no one may be called it.)
    const taken = new Set([...keys.map(k => PERSONAS[k].name), 'wall', 'self', 'hunger', 'fire']);
    for (const h of people) {
      const base = String(h.name || 'Green');
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      taken.add(name);
      snakes.push(makeSnake(snakes.length, SPAWNS[snakes.length], { name, color: h.color || PLAYER_COLOR, isPlayer: true }));
    }
    keys.forEach(k => {
      const id = snakes.length;
      snakes.push(aiSnake(id, SPAWNS[id % SPAWNS.length], k));
    });
    const game = {
      snakes, food: [], tick: 0, time: 0, history: [], withPlayer: people.length > 0, events: [],
      holes: new Set(), woodpecker: null,
      // Beetle burrows ({ x, y, at: the tick it cracked open }), the beetle
      // underground (if one is), fire (cell -> { from, until, group, strike }:
      // it burns (setting alight any head that enters) from tick `from` to `until`; before that it's
      // only smouldering, or crackling where lightning will strike), and the
      // weather ({ kind, since, until, nextGust, nextStrike }, in game time).
      burrows: [], underground: null, fires: new Map(), fireGroups: new Map(), fireGroup: 0,
      weather: { kind: 'clear', since: 0, until: T.WEATHER_FIRST_MS, nextGust: 0, nextStrike: 0 },
    };
    fillFood(game);
    snapshot(game);
    return game;
  }

  // How long the next tick lasts. The opening ticks ease from OPENING_TICK down
  // to START_TICK, then the speed ramps gently toward MIN_TICK.
  function tickMs(game) {
    if (game.tick < T.OPENING_TICKS) {
      return T.OPENING_TICK + (T.START_TICK - T.OPENING_TICK) * (game.tick / T.OPENING_TICKS);
    }
    return Math.max(T.MIN_TICK, T.START_TICK - (T.START_TICK - T.MIN_TICK) * game.time / T.RAMP_MS);
  }

  const suddenDeath = game => game.time >= T.SUDDEN_DEATH_MS;

  // Milliseconds until a snake starts starving (negative once it has).
  const hungerLeft = (game, s) => s.lastAte + T.HUNGER_MS - game.time;

  // Mark every living body cell in the occupancy grid (with a fresh stamp).
  function markBodies(game) {
    stamp++;
    for (const s of game.snakes) {
      if (!s.alive) continue;
      for (const c of s.body) { bodyStamp[key(c.x, c.y)] = stamp; bodyOwner[key(c.x, c.y)] = s.id; }
    }
  }

  // An apple: it rots away after a while (and another drops somewhere else).
  const apple = game => ({ kind: 'food', expires: game.tick + Math.round(T.APPLE_TICKS * between(0.75, 1.25)) });

  function fillFood(game) {
    // Apples and golden apples rot, mushrooms wither, and beetles nobody caught fly off.
    if (game.food.some(f => f.expires != null && f.expires <= game.tick)) {
      for (const f of game.food) {
        if (f.expires > game.tick) continue;
        if (f.kind === 'beetle') game.events.push({ type: 'flown', x: f.x, y: f.y });
        else if (f.kind === 'food') game.events.push({ type: 'rot', x: f.x, y: f.y });
      }
      game.food = game.food.filter(f => f.expires == null || f.expires > game.tick);
    }
    // Once the woodpecker is here, nothing new grows.
    if (suddenDeath(game)) return;

    let apples = 0, mushrooms = 0, golden = 0, beetles = 0;
    for (const f of game.food) {
      if (f.kind === 'food') apples++;
      else if (f.kind === 'mushroom') mushrooms++;
      else if (f.kind === 'golden') golden++;
      else if (f.kind === 'beetle') beetles++;
    }

    const place = placer(game);
    const raining = game.weather.kind === 'rain', winter = game.weather.kind === 'snow';
    // (Winter: fewer apples, no new mushrooms.)
    for (; apples < (winter ? T.SNOW_APPLES : T.APPLES); apples++) place(apple(game));
    // (Rain: more mushrooms sprout.)
    for (; !winter && mushrooms < T.MUSHROOMS + (raining ? T.RAIN_MUSHROOMS : 0); mushrooms++) place({ kind: 'mushroom', expires: game.tick + T.MUSHROOM_TICKS });
    // (Sun: golden hour. Winter: hardly any.)
    const goldenChance = winter ? 0 : T.GOLDEN_CHANCE * (game.weather.kind === 'sun' ? T.SUN_GOLDEN : 1); // (none in winter)
    if (!golden && Math.random() < goldenChance && place({ kind: 'golden', expires: game.tick + T.GOLDEN_TICKS })) {
      const g = game.food[game.food.length - 1];
      game.events.push({ type: 'spawn', kind: 'golden', x: g.x, y: g.y });
    }
    // Now and then a beetle comes out of a burrow for a crawl (one at a time).
    // The first cracks a burrow open where it's quiet; later ones come out of
    // a free burrow, or now and then open another.
    if (!beetles && !game.underground && game.time >= T.BEETLE_FIRST_MS && Math.random() < T.BEETLE_CHANCE) {
      let b = freeBurrow(game, -1);
      if (game.burrows.length < T.BURROW_MAX && (!b || Math.random() < T.BURROW_NEW_CHANCE)) {
        const at = place(null, true);
        if (at) {
          b = { x: at.x, y: at.y, at: game.tick };
          game.burrows.push(b);
          game.events.push({ type: 'burrow', x: b.x, y: b.y });
        }
      }
      if (b) {
        const gold = Math.random() < T.GOLD_BEETLE_CHANCE;
        game.food.push({ x: b.x, y: b.y, kind: 'beetle', expires: game.tick + T.BEETLE_TICKS, dir: CRAWL[Math.floor(Math.random() * 4)], movedAt: game.tick, ...(gold ? { gold: 1 } : {}) });
        game.events.push({ type: 'spawn', kind: 'beetle', x: b.x, y: b.y, gold });
      }
    }
  }

  // Picks free cells (no bodies, holes, food, burrows or fire), worked out
  // only when something actually needs placing. place(props, quiet): puts
  // food there (props: null to only pick a cell), and returns the cell.
  // quiet: pick the spot farthest from any head, of a few tries.
  function placer(game) {
    let free = null;
    return (props, quiet = false) => {
      if (!free) {
        markBodies(game);
        for (const f of game.food) bodyStamp[key(f.x, f.y)] = stamp;
        for (const k of game.holes) bodyStamp[k] = stamp;
        for (const b of game.burrows) bodyStamp[key(b.x, b.y)] = stamp;
        for (const k of game.fires.keys()) bodyStamp[k] = stamp;
        free = [];
        for (let k = 0; k < CELLS; k++) if (bodyStamp[k] !== stamp) free.push(k);
      }
      if (!free.length) return null; // a full board: nothing grows, and that's fine
      let at = Math.floor(Math.random() * free.length);
      if (quiet) {
        let best = -1;
        for (let t = 0; t < 8; t++) {
          const i = Math.floor(Math.random() * free.length), c = free[i];
          const gap = headGap(game, c % GRID, Math.floor(c / GRID));
          if (gap > best) { best = gap; at = i; }
        }
      }
      const [k] = free.splice(at, 1);
      const cell = { x: k % GRID, y: Math.floor(k / GRID) };
      if (props) game.food.push({ ...cell, ...props });
      return cell;
    };
  }

  // How far (in cells) the nearest living head is.
  function headGap(game, x, y) {
    let gap = 99;
    for (const s of game.snakes) if (s.alive) gap = Math.min(gap, Math.abs(s.body[0].x - x) + Math.abs(s.body[0].y - y));
    return gap;
  }

  // A burrow a beetle can come out of: nothing on it (not `not`, if
  // there's another), the one farthest from any head.
  function freeBurrow(game, not) {
    markBodies(game);
    for (const f of game.food) bodyStamp[key(f.x, f.y)] = stamp;
    let best = null, gap = -1, fallback = null;
    for (const b of game.burrows) {
      const k = key(b.x, b.y);
      if (bodyStamp[k] === stamp || game.fires.has(k) || game.holes.has(k)) continue;
      if (k === not) { fallback = b; continue; }
      const g = headGap(game, b.x, b.y);
      if (g > gap) { gap = g; best = b; }
    }
    return best || fallback;
  }
  const burrowAt = (game, x, y) => game.burrows.some(b => b.x === x && b.y === y);

  // Beetles crawl a cell every few ticks: mostly straight on, now and then
  // turning. With a head close by they scurry away, faster. Never into a body,
  // a hole, other food or off the board; boxed in, they wait.
  const CRAWL = [DIRS.up, DIRS.right, DIRS.down, DIRS.left];
  // A scared beetle heads for a burrow if one's near, and dives in when it
  // gets there; it comes out of a burrow (another, if there is one) a moment later.
  function crawl(game) {
    const u = game.underground;
    if (u && game.tick >= u.until) {
      if (game.tick >= u.expires || suddenDeath(game)) game.underground = null; // (it stays home)
      else {
        const b = freeBurrow(game, u.from);
        if (b) {
          game.food.push({ x: b.x, y: b.y, kind: 'beetle', expires: u.expires, dir: CRAWL[Math.floor(Math.random() * 4)], movedAt: game.tick, ...(u.gold ? { gold: 1 } : {}) });
          game.events.push({ type: 'emerge', x: b.x, y: b.y });
          game.underground = null;
        }
      }
    }
    let marked = false;
    for (const b of game.food) {
      if (b.kind !== 'beetle') continue;
      let fear = 99, hx = 0, hy = 0;
      for (const s of game.snakes) {
        if (!s.alive) continue;
        const h = s.body[0], d = Math.abs(h.x - b.x) + Math.abs(h.y - b.y);
        if (d < fear) { fear = d; hx = h.x; hy = h.y; }
      }
      const scared = fear <= T.BEETLE_FEAR;
      if (game.tick - b.movedAt < (scared ? T.BEETLE_SCARED_EVERY : T.BEETLE_EVERY)) continue;
      if (!marked) {
        markBodies(game);
        for (const f of game.food) bodyStamp[key(f.x, f.y)] = stamp;
        for (const k of game.holes) bodyStamp[k] = stamp;
        for (const k of game.fires.keys()) bodyStamp[k] = stamp; // (beetles keep out of fire...)
        if (game.woodpecker) for (const k of game.woodpecker.target) bodyStamp[k] = stamp; // (...and the woodpecker's way)
        marked = true;
      }
      // The nearest burrow, if one's close enough to run for.
      let home = null, homeGap = 7;
      if (scared) for (const h of game.burrows) {
        const g = Math.abs(h.x - b.x) + Math.abs(h.y - b.y);
        if (g < homeGap) { homeGap = g; home = h; }
      }
      let best = null, bestScore = -Infinity;
      for (const d of CRAWL) {
        const nx = b.x + d.x, ny = b.y + d.y;
        if (!inside(nx, ny) || bodyStamp[key(nx, ny)] === stamp) continue;
        let score = Math.random(); // a little wandering
        if (d === b.dir) score += 1.5; // it likes to keep going
        else if (d.x === -b.dir.x && d.y === -b.dir.y) score -= 1;
        if (scared) score += 3 * (Math.abs(nx - hx) + Math.abs(ny - hy) - fear); // away from the nearest head...
        if (home) score += 2 * (homeGap - Math.abs(home.x - nx) - Math.abs(home.y - ny)); // ...and home, if it's near
        if (score > bestScore) { bestScore = score; best = d; }
      }
      if (!best) continue;
      b.px = b.x; b.py = b.y;
      b.x += best.x; b.y += best.y;
      b.dir = best;
      b.movedAt = game.tick;
      b.scared = scared;
      bodyStamp[key(b.x, b.y)] = stamp;
      if (scared && burrowAt(game, b.x, b.y)) { // home: down it goes
        game.food.splice(game.food.indexOf(b), 1);
        game.underground = { until: game.tick + Math.round(between(T.BEETLE_UNDER_MIN, T.BEETLE_UNDER_MAX)), expires: b.expires, from: key(b.x, b.y), gold: !!b.gold };
        game.events.push({ type: 'dive', x: b.x, y: b.y });
        break; // (there's only ever one beetle)
      }
    }
  }

  // ------------------------------------------------------------- weather

  // Spells of weather, one after another with clear spells between: sun
  // (golden hour), wind (gusts knock apples loose; fire flings burning
  // leaves downwind), rain (mushrooms sprout, fires go out; a rainbow when it
  // stops, with a golden apple at its end), storms (lightning, which crackles
  // where it'll strike first, never near a head, and sets the bark alight)
  // and snow (winter: less food, hunger runs faster, fires go out).
  // Everyone sees all of it.
  function weather(game) {
    const w = game.weather;
    // (Once the woodpecker is here, the sky clears and stays clear.)
    if (game.time >= w.until || (suddenDeath(game) && w.kind !== 'clear')) {
      let next = 'clear';
      if (suddenDeath(game)) next = 'clear';
      else if (w.kind === 'clear') next = spell(game);
      else if (w.kind === 'storm' && Math.random() < T.AFTER_STORM_RAIN) next = 'rain';
      else if (w.kind === 'rain' && Math.random() < T.RAINBOW_CHANCE) rainbow(game);
      const span = next === 'clear' ? between(T.CLEAR_MIN_MS, T.CLEAR_MAX_MS) : between(T.SPELL_MIN_MS, T.SPELL_MAX_MS);
      if (next !== w.kind) game.events.push({ type: 'weather', kind: next });
      game.weather = { kind: next, since: next === w.kind ? w.since : game.time, until: game.time + span, nextGust: game.time + 600, nextStrike: game.time + between(1200, 2500) };
      // (Rain: once in a while, a golden mushroom comes up some time in it.)
      if (next === 'rain' && Math.random() < T.GOLDCAP_CHANCE) game.weather.goldcapAt = game.time + between(1000, Math.max(1000, span - 4000));
    }
    const now = game.weather;
    if (now.kind === 'wind' && game.time >= now.nextGust) {
      now.nextGust = game.time + T.GUST_EVERY_MS;
      let apples = 0;
      for (const f of game.food) if (f.kind === 'food') apples++;
      const fell = apples < T.APPLES + T.WINDFALL_MAX ? placer(game)(apple(game)) : null;
      game.events.push({ type: 'gust', x: fell ? fell.x : -1, y: fell ? fell.y : -1 });
      // Now and then a gust brings a golden leaf (one at a time): dashes.
      if (Math.random() < T.LEAF_CHANCE && !game.food.some(f => f.kind === 'leaf')) {
        const at = placer(game)({ kind: 'leaf', expires: game.tick + T.LEAF_TICKS });
        if (at) game.events.push({ type: 'spawn', kind: 'leaf', x: at.x, y: at.y });
      }
    }
    if (now.kind === 'rain' && now.goldcapAt != null && game.time >= now.goldcapAt) { // a golden mushroom comes up
      now.goldcapAt = null;
      const at = placer(game)({ kind: 'goldcap', expires: game.tick + T.GOLDCAP_TICKS }, true);
      if (at) game.events.push({ type: 'spawn', kind: 'goldcap', x: at.x, y: at.y });
    }
    if (now.kind === 'storm' && game.time >= now.nextStrike) {
      now.nextStrike = game.time + between(T.STRIKE_MIN_MS, T.STRIKE_MAX_MS);
      strike(game);
    }
    // Winter: hunger runs faster (the clock to everyone's next meal runs
    // down quicker), and apples rot twice as fast.
    if (now.kind === 'snow') {
      const extra = tickMs(game) * (T.SNOW_HUNGER - 1);
      for (const s of game.snakes) if (s.alive) { s.lastAte -= extra; s.nextStarve -= extra; }
      for (const f of game.food) if (f.kind === 'food' && f.expires != null && !f.cooked) f.expires--;
    }
    burn(game);
  }

  function spell(game) {
    const odds = Object.entries(T.WEATHER_ODDS).filter(([k]) => k !== 'storm' || game.time >= T.STORM_FROM_MS);
    let roll = Math.random() * odds.reduce((a, [, n]) => a + n, 0);
    for (const [k, n] of odds) if ((roll -= n) < 0) return k;
    return 'clear';
  }

  // After the rain: a rainbow, and a golden apple at its end (if there isn't one).
  function rainbow(game) {
    if (game.food.some(f => f.kind === 'golden')) return;
    const at = placer(game)({ kind: 'golden', expires: game.tick + T.GOLDEN_TICKS }, true);
    if (at) game.events.push({ type: 'rainbow', x: at.x, y: at.y });
  }

  // Lightning picks a free cell well away from every head, and crackles there
  // for a moment before it strikes.
  function strike(game) {
    markBodies(game);
    for (const f of game.food) bodyStamp[key(f.x, f.y)] = stamp;
    const spots = [];
    for (let k = 0; k < CELLS; k++) {
      const x = k % GRID, y = Math.floor(k / GRID);
      if (bodyStamp[k] === stamp || game.holes.has(k) || game.fires.has(k) || burrowAt(game, x, y)) continue;
      if (headGap(game, x, y) <= T.STRIKE_CLEARANCE) continue;
      spots.push(k);
    }
    if (!spots.length) return;
    const k = spots[Math.floor(Math.random() * spots.length)], from = game.tick + T.STRIKE_WARN_TICKS;
    const group = ++game.fireGroup;
    game.fires.set(k, { from, until: from + T.FIRE_TICKS, group, strike: true });
    game.fireGroups.set(group, 1);
    game.events.push({ type: 'charge', x: k % GRID, y: Math.floor(k / GRID) });
  }

  // Fire: a strike lands when its crackling's done, burning cells now and then
  // catch a neighbour (smouldering first, so everyone sees it coming), and
  // cells burn out. Rain puts it all out. (Times are ticks: the next tick is
  // game.tick + 1, when anything that's burning by then can kill.)
  function burn(game) {
    if (!game.fires.size) return;
    const next = game.tick + 1, raining = game.weather.kind === 'rain' || game.weather.kind === 'snow'; // (rain or snow: it goes out)
    const windy = game.weather.kind === 'wind' || game.weather.kind === 'storm';
    let marked = false;
    for (const [k, f] of game.fires) {
      if (raining) f.until = Math.min(f.until, Math.max(f.from, next) + T.RAIN_DOUSE_TICKS);
      if (f.until <= next) { // burnt out
        game.fires.delete(k);
        const left = (game.fireGroups.get(f.group) || 1) - 1;
        if (left > 0) game.fireGroups.set(f.group, left); else game.fireGroups.delete(f.group);
        continue;
      }
      if (f.strike && f.from === next) game.events.push({ type: 'strike', x: k % GRID, y: Math.floor(k / GRID) });
      // Wind: a burning leaf blown downwind (to the right), to start a small fire where it lands.
      if (windy && !raining && !f.ember && game.tick >= f.from && game.fires.size < T.FIRE_BOARD_MAX && Math.random() < T.EMBER_CHANCE) ember(game, k);
      if (f.ember || raining || game.tick < f.from || Math.random() >= T.FIRE_SPREAD || (game.fireGroups.get(f.group) || 0) >= T.FIRE_MAX || game.fires.size >= T.FIRE_BOARD_MAX) continue;
      if (!marked) {
        markBodies(game);
        for (const fo of game.food) if (fo.kind === 'beetle') bodyStamp[key(fo.x, fo.y)] = stamp; // (food can catch; a beetle runs)
        marked = true;
      }
      const x = k % GRID, y = Math.floor(k / GRID);
      const d = CRAWL[Math.floor(Math.random() * 4)], nx = x + d.x, ny = y + d.y, nk = key(nx, ny);
      if (!inside(nx, ny) || bodyStamp[nk] === stamp || game.holes.has(nk) || game.fires.has(nk) || burrowAt(game, nx, ny)) continue;
      const from = next + T.FIRE_SMOLDER_TICKS;
      game.fires.set(nk, { from, until: from + T.FIRE_TICKS, group: f.group, strike: false });
      game.fireGroups.set(f.group, (game.fireGroups.get(f.group) || 0) + 1);
    }
    cook(game);
  }
  // Food in a burning cell cooks: an apple or a piece of meat bakes (worth
  // more, and an apple stops rotting for a while), and anything left in too
  // long goes to ash.
  function cook(game) {
    let ash = false;
    for (const f of game.food) {
      if (f.kind === 'beetle') continue;
      const fire = game.fires.get(key(f.x, f.y));
      if (!fire || game.tick < fire.from) continue;
      f.heat = (f.heat || 0) + 1;
      if (f.heat === T.COOK_TICKS && (f.kind === 'food' || f.kind === 'pellet')) {
        f.cooked = 1;
        if (f.expires != null) f.expires = Math.max(f.expires, game.tick + T.APPLE_TICKS / 2);
        game.events.push({ type: 'baked', x: f.x, y: f.y, kind: f.kind });
      }
      if (f.heat >= T.ASH_TICKS) { f.ash = true; ash = true; game.events.push({ type: 'ash', x: f.x, y: f.y, kind: f.kind }); }
    }
    if (ash) game.food = game.food.filter(f => !f.ash);
  }
  // A burning leaf flung from cell k, landing 2 to EMBER_REACH cells downwind
  // (a cell either side, perhaps) on a free cell, never by a head: it smoulders
  // there first, longer than spreading fire does, then burns briefly, small.
  function ember(game, k) {
    markBodies(game);
    for (const fo of game.food) bodyStamp[key(fo.x, fo.y)] = stamp;
    const x = k % GRID, y = Math.floor(k / GRID);
    const nx = x + 2 + Math.floor(Math.random() * (T.EMBER_REACH - 1)), ny = y + Math.floor(Math.random() * 3) - 1, nk = key(nx, ny);
    if (!inside(nx, ny) || bodyStamp[nk] === stamp || game.holes.has(nk) || game.fires.has(nk) || burrowAt(game, nx, ny) || headGap(game, nx, ny) <= 1) return;
    const from = game.tick + 1 + T.EMBER_SMOLDER_TICKS, group = ++game.fireGroup;
    game.fires.set(nk, { from, until: from + T.EMBER_FIRE_TICKS, group, strike: false, ember: true });
    game.fireGroups.set(group, 1);
    game.events.push({ type: 'ember', x: nx, y: ny, fx: x, fy: y });
  }

  // Is cell k burning on this tick (and so sets alight a head that enters)?
  const burning = (game, k) => { const f = game.fires.get(k); return !!f && game.tick >= f.from && game.tick < f.until; };

  // Sudden death: the woodpecker takes the log away a patch at a time. It
  // lands, then over and over (hungrier each time: a shorter rest, a patch a
  // cell bigger): picks a patch of PECK_CHUNK cells somewhere on
  // the log (clear of every body and all food, and PECK_CLEARANCE cells from
  // every head, while there's such a spot), eyes it for PECK_AIM_TICKS
  // (everyone sees where, and the AIs keep out of it, like a hole), hammers
  // it all out at once, and rests a good while. Whatever's in the patch when
  // it strikes goes: food, fire, a burrow, and any part of a snake. A head
  // there, and that snake's out; a body there is cut, and everything behind
  // the cut falls off as food (out too, if what's left is less than
  // MIN_LENGTH).
  // game.woodpecker: { at (time it came), target: [cells it's aiming at],
  //   strikeAt (tick), last: [cells it took out last], struckAt (tick), restUntil (tick), x, y (where it's busy) }
  function peck(game, dying, drops) {
    if (!suddenDeath(game)) return;
    let w = game.woodpecker;
    if (!w) {
      w = game.woodpecker = { x: GRID / 2, y: 0, at: game.time, target: [], strikeAt: -1, last: [], struckAt: -1, restUntil: game.tick + T.PECK_ARRIVE_TICKS };
      game.events.push({ type: 'woodpecker' });
      return;
    }
    if (w.target.length && game.tick >= w.strikeAt) {
      const zone = new Set(w.target.filter(k => !game.holes.has(k)));
      for (const s of game.snakes) {
        if (!s.alive) continue;
        const i = s.body.findIndex((c, i) => (i || !s.flight) && zone.has(key(c.x, c.y))); // (a head in the air: not its head)
        if (i < 0) continue;
        if (i < T.MIN_LENGTH) { // (its head, or too little left behind it)
          s.cause = 'fell into a woodpecker hole'; s.killer = 'wall'; s.killerId = null;
          s.alive = false;
          dying.push(s);
          continue;
        }
        const cut = s.body.splice(i);
        for (const c of cut) if (!zone.has(key(c.x, c.y))) drops.push({ x: c.x, y: c.y, color: s.color });
        game.events.push({ type: 'cut', snake: s, x: cut[0].x, y: cut[0].y, lost: cut.length });
      }
      for (const k of zone) { game.holes.add(k); game.fires.delete(k); } // (a burning cell pecked out: the fire there's gone too)
      game.food = game.food.filter(f => !zone.has(key(f.x, f.y)));
      game.burrows = game.burrows.filter(b => !zone.has(key(b.x, b.y))); // (a burrow pecked open is a hole now)
      const hit = [...zone];
      game.events.push({ type: 'peck', x: w.x, y: w.y, cells: hit });
      w.pecks = (w.pecks || 0) + 1; // (it gets hungrier: shorter rests, bigger patches)
      w.last = hit; w.struckAt = game.tick; w.target = []; w.restUntil = game.tick + Math.max(T.PECK_REST_MIN, Math.round(T.PECK_REST_TICKS * Math.pow(T.PECK_HUNGRIER, w.pecks)));
      return;
    }
    if (!w.target.length && game.tick >= w.restUntil) {
      const patch = pickPatch(game);
      if (!patch.length) return;
      w.target = patch;
      w.strikeAt = game.tick + T.PECK_AIM_TICKS;
      let sx = 0, sy = 0;
      for (const k of patch) { sx += k % GRID; sy += Math.floor(k / GRID); }
      w.x = sx / patch.length; w.y = sy / patch.length;
      game.events.push({ type: 'aim', x: Math.round(w.x), y: Math.round(w.y) });
    }
  }

  // A patch for the woodpecker: grown cell by cell from a random start. It
  // keeps clear of everyone while it can: first of every body, all food and
  // PECK_CLEARANCE cells round every head; failing that, of bodies and heads
  // themselves; failing that, anywhere left.
  const PATCH_TRIES = [[true, T.PECK_CLEARANCE], [true, 0], [false, -1]];
  function pickPatch(game) {
    markBodies(game);
    const foodAt = new Set(game.food.map(f => key(f.x, f.y)));
    for (const [clear, gap] of PATCH_TRIES) {
      const ok = k => {
        if (game.holes.has(k)) return false;
        if (!clear) return true;
        if (bodyStamp[k] === stamp || foodAt.has(k)) return false;
        return headGap(game, k % GRID, Math.floor(k / GRID)) > gap;
      };
      for (let t = 0; t < 30; t++) {
        const seed = Math.floor(Math.random() * CELLS);
        if (!ok(seed)) continue;
        const patch = [seed], edge = [seed], inPatch = new Set(patch);
        const chunk = Math.min(T.PECK_CHUNK_MAX, T.PECK_CHUNK + (game.woodpecker?.pecks || 0)); // (a cell bigger each time)
        while (patch.length < chunk && edge.length) {
          const from = edge[Math.floor(Math.random() * edge.length)], x = from % GRID, y = Math.floor(from / GRID);
          const opts = CRAWL.map(d => [x + d.x, y + d.y]).filter(([nx, ny]) => inside(nx, ny) && !inPatch.has(key(nx, ny)) && ok(key(nx, ny)));
          if (!opts.length) { edge.splice(edge.indexOf(from), 1); continue; }
          const [nx, ny] = opts[Math.floor(Math.random() * opts.length)], nk = key(nx, ny);
          patch.push(nk); edge.push(nk); inPatch.add(nk);
        }
        if (patch.length >= Math.ceil(chunk / 2)) return patch;
      }
    }
    return [];
  }

  function snapshot(game) {
    game.history.push({
      snakes: game.snakes.filter(s => s.alive).map(s => ({
        id: s.id, body: s.body.map(c => ({ x: c.x, y: c.y })), dir: s.dir,
        stun: Math.max(0, s.stunUntil - game.tick), leaps: s.leaps, // (all of it shows: stars, a golden ring...)
        dashes: s.dashes, wrap: Math.max(0, s.wrapUntil - game.time), air: s.flight ? 1 : 0,
      })),
      food: game.food.map(f => ({ ...f })),
      holes: game.holes.size,
      // (Fire, crackling, smouldering or burning, and the woodpecker's next patch: keep out.)
      fires: game.fires.size ? [...game.fires.keys()] : NO_FIRES,
      pecks: game.woodpecker?.target.length ? [...game.woodpecker.target] : NO_FIRES,
    });
    if (game.history.length > T.HISTORY) game.history.shift();
  }

  const NO_FIRES = [];

  // What an AI must keep out of in a snapshot: its holes and any fire (as
  // walls). Worked out once per snapshot, shared by every AI.
  function blockedSeen(game, snap) {
    const holes = holesSeen(game, snap.holes);
    if (!snap.fires.length && !snap.pecks.length) return holes;
    if (snap.blocked?.n !== holes.size) {
      const set = new Set(holes);
      for (const k of snap.fires) set.add(k);
      for (const k of snap.pecks) set.add(k);
      snap.blocked = { n: holes.size, set };
    }
    return snap.blocked.set;
  }
  const NO_CELLS = new Set();
  const fireSeen = snap => snap.fires.length ? (snap.fireSet ||= new Set(snap.fires)) : NO_CELLS;

  // The holes as they were in a snapshot (the first `n` pecked; a Set keeps
  // insertion order). Shared by every AI deciding on the same tick.
  function holesSeen(game, n) {
    if (n >= game.holes.size) return game.holes;
    if (game.holesView?.n !== n || game.holesView.of !== game.holes) {
      const set = new Set();
      for (const k of game.holes) { if (set.size === n) break; set.add(k); }
      game.holesView = { n, of: game.holes, set };
    }
    return game.holesView.set;
  }

  // What an AI "sees": its own body now, everything else (holes and fire
  // included) as of its reaction time ago, like a person would. Rivals are just ids and
  // bodies; nothing says which one is human.
  function aiView(game, snake) {
    const delay = Math.max(1, Math.round(T.REACTION_MS / tickMs(game)));
    const idx = Math.max(0, game.history.length - 1 - delay);
    const snap = game.history[idx];
    return {
      grid: GRID,
      me: {
        id: snake.id, body: snake.body, dir: snake.dir, grow: snake.grow, hungerLeft: hungerLeft(game, snake),
        // (its powers: golden leaps and dashes held, how long the edges still wrap for it, how long till it can leap)
        leaps: snake.leaps, dashes: snake.dashes, wrap: Math.max(0, snake.wrapUntil - game.time), leapIn: leapIn(game, snake),
        // (who it just met head-on, if it was in the last 3 s or so: it keeps clear of them for a while)
        bumped: snake.bumpedBy && game.tick - snake.bumpedBy.tick < 30 ? snake.bumpedBy.id : -1,
      },
      others: snap.snakes.filter(o => o.id !== snake.id),
      food: snap.food,
      holes: blockedSeen(game, snap),
      fire: fireSeen(snap), // (among the holes: the cells that are only fire, which it can go through, at a price)
      age: game.history.length - 1 - idx,
      tick: game.tick,
      timeMs: game.time,
      weather: game.weather.kind, // (everyone sees the weather: in winter, apples rot twice as fast)
    };
  }

  // The game can let an AI think ahead of the tick (spread over the frames in
  // between), as long as nothing it looks at can change before the tick:
  // everything in aiView() is fixed between ticks, except a snake about to
  // starve, which shrinks at the start of the tick and must decide after that.
  // (A stunned snake doesn't decide at all until it can move again, nor one in the air.)
  const canThinkAhead = (game, s) => s.alive && (!s.isPlayer || !!s.autopilot) && game.time < s.nextStarve && s.plannedTick !== game.tick && s.stunUntil <= game.tick && !s.flight;

  // A person's snake is handed to an AI (autopilot: a persona) when they leave.
  const brainOf = s => s.autopilot || s.persona;

  // A snake asks to use its power: a person by pressing the way they're
  // going, an AI by saying so when it decides (memory.power: the tick). With
  // golden dashes, it dashes at once; otherwise it leaps (golden, or the
  // plain one when it's ready) as soon as there's something right in front
  // to hop and somewhere to land, waiting a few ticks for that.
  function leap(game, s) {
    if (s?.alive) s.leapArmed = game.tick + T.LEAP_WINDOW;
  }
  // How long until it can leap (ms; 0: now), golden powers included.
  const leapIn = (game, s) => s.leaps > 0 || s.dashes > 0 ? 0 : s.body.length <= T.MIN_LENGTH ? Infinity : Math.max(0, s.leapReadyAt - game.time);

  function thinkAhead(game, s) {
    s.planned = decide(aiView(game, s), brainOf(s), s.memory);
    s.plannedTick = game.tick;
  }

  // Advance one tick. All snakes move at the same time. Returns the snakes that died.
  // game.events lists what happened this tick, for the chatter, sounds and banners:
  // { type: 'eat', snake, kind } | { type: 'death', snake } | { type: 'spawn', kind, x, y }
  // | { type: 'crash', snake, x, y, cause, killer, killerId, lost } (it bounced, lost `lost` segments, and is stunned)
  // | { type: 'leap', snake, x, y, gold, reach } (it took off over the cell x, y; reach: cells it rises over, landing next tick)
  // | { type: 'dash', snake, x, y, n } (it dashed n cells from x, y) | { type: 'douse', x, y } (a dash put a fire out)
  // | { type: 'alight', snake } (crawled into fire) | { type: 'singe', snake } (lost a segment to the flames)
  // | { type: 'starving', snake } | { type: 'woodpecker' } (it came) | { type: 'aim', x, y } | { type: 'peck', x, y, cells } (a patch taken out)
  // | { type: 'cut', snake, x, y, lost, by } (the woodpecker, or a dash (by: who), cut it: its tail fell off) | { type: 'flown', x, y } (a beetle got away)
  // | { type: 'rot', x, y } (an apple rotted away) | { type: 'baked', x, y, kind } | { type: 'ash', x, y, kind } (food in the fire)
  // | { type: 'burrow', x, y } (one cracked open) | { type: 'dive', x, y } | { type: 'emerge', x, y } (a beetle went down one, came out of one)
  // | { type: 'weather', kind } | { type: 'gust', x, y } (x -1 if no apple fell) | { type: 'charge', x, y } (lightning on its way)
  // | { type: 'strike', x, y } | { type: 'rainbow', x, y } (and a golden apple there) | { type: 'ember', x, y, fx, fy } (a burning leaf blown)
  function step(game) {
    game.events = [];

    // Hunger: each overdue snake loses a segment. One already at its minimum
    // length starves this tick, unless its head reaches food first.
    const dying = [], starving = [], drops = [];
    for (const s of game.snakes) {
      if (!s.alive || game.time < s.nextStarve) continue;
      s.nextStarve = game.time + T.STARVE_EVERY_MS;
      if (s.grow > 0) s.grow--;
      else if (s.body.length > T.MIN_LENGTH) s.body.pop();
      else { starving.push(s); continue; }
      if (hungerLeft(game, s) > -T.STARVE_EVERY_MS) game.events.push({ type: 'starving', snake: s });
    }

    const alive = game.snakes.filter(s => s.alive);

    // Everyone decides, except the stunned: they stay put (and can steer meanwhile).
    const moving = [];
    for (const s of alive) {
      s.tailMoves = false; s.air = false; s.landing = false; s.boom = false; s.passed = null;
      if (s.stunUntil > game.tick) { s.next = null; continue; }
      let land = null;
      if (s.flight) { // in the air: it comes down where it was going (turns wait till it's landed)
        s.dir = s.flight.dir;
        land = s.flight.land;
        s.flight = null;
        s.landing = true;
      } else {
        const steered = s.isPlayer && !s.autopilot && s.queue.length > 0;
        if (s.isPlayer && !s.autopilot) {
          if (s.queue.length) s.dir = s.queue.shift();
        } else {
          s.dir = s.plannedTick === game.tick ? s.planned : decide(aiView(game, s), brainOf(s), s.memory);
          if (s.memory.power === game.tick) leap(game, s); // (it asked for its power, as a person would)
        }
        s.planned = null;
        s.plannedTick = -1;
        // Over a crash and still facing what it hit (or the cell it met another
        // head in, while that's shut to it: see shutTo), without having
        // steered: it turns to where there's room. (Two heads that met in an
        // empty cell would otherwise both go for it again, and again, until
        // one of them was too small to bounce.)
        if (s.stunUntil === game.tick) {
          const { x: nx, y: ny } = ahead(game, s, s.body[0].x, s.body[0].y, s.dir), shut = shutTo(game, s);
          if (!steered && !(s.leapArmed >= game.tick) && (blocked(game, nx, ny) || (shut && s.bounce.x === nx && s.bounce.y === ny))) s.dir = recoil(game, s, shut); // (a power asked for counts as steering)
          s.bounce = null;
        }
      }
      s.next = land ? { x: land.x, y: land.y } : ahead(game, s, s.body[0].x, s.body[0].y, s.dir);
      s.tailMoves = s.grow === 0;
      moving.push(s);
    }

    // Cells still occupied by bodies after everyone moves (tails that move
    // away are free; a stunned snake's isn't), and how many heads arrive in
    // each on-board cell.
    stamp++;
    for (const s of alive) {
      const keep = s.tailMoves ? s.body.length - 1 : s.body.length;
      for (let j = 0; j < keep; j++) {
        const k = key(s.body[j].x, s.body[j].y);
        bodyStamp[k] = stamp;
        bodyOwner[k] = s.id;
      }
    }
    // Powers, for a snake that asked (see leap()), in turn: a dash, or a leap.
    // A snake cut in two by a dash, too short to go on, is out (gone).
    const gone = new Set();
    for (const s of moving) {
      if (gone.has(s) || s.landing || !(s.leapArmed >= game.tick)) continue;
      if (s.dashes > 0) dash(game, s, gone, dying, drops);
      else hop(game, s);
    }
    if (gone.size) for (let i = moving.length - 1; i >= 0; i--) if (gone.has(moving[i])) moving.splice(i, 1);
    for (const s of moving) {
      if (s.air || !inside(s.next.x, s.next.y)) continue; // (off-board heads, and heads in the air, never meet anyone)
      const k = key(s.next.x, s.next.y);
      if (headStamp[k] !== stamp) { headStamp[k] = stamp; headCount[k] = 0; headFirst[k] = s.id; }
      headCount[k]++;
    }

    // Who crashes: into the edge, a hole, a body, or head-on. killer: 'wall'
    // (walls and holes), 'self', or the name of the snake that was hit
    // (killerId: its id). Causes use names; the game turns the name of
    // whoever is watching into "you". A snake that crashes stays put, so its
    // tail stays too, and anyone heading into that tail crashes as well.
    const crashes = crashes0 = new Map();
    moving0 = moving;
    const crashOf = s => {
      const { x, y } = s.next;
      const k = key(x, y);
      if (!inside(x, y)) return { cause: s.boom ? 'dashed into the edge and blew up' : 'hit the wall', killer: 'wall', killerId: null };
      if (game.holes.has(k)) return { cause: s.boom ? 'dashed into a woodpecker hole and blew up' : 'fell into a woodpecker hole', killer: 'wall', killerId: null };
      if (bodyStamp[k] === stamp) {
        const other = game.snakes[bodyOwner[k]];
        // Two heads swapping cells met head-on, just as if they'd met in one.
        const swapped = other !== s && x === other.body[0].x && y === other.body[0].y && other.next?.x === s.body[0].x && other.next?.y === s.body[0].y;
        return { cause: other === s ? 'bit itself' : swapped ? `crashed head-on into ${other.name}` : `ran into ${other.name}`, killer: other === s ? 'self' : other.name, killerId: other.id, headOn: swapped };
      }
      if (headStamp[k] === stamp && headCount[k] > 1) {
        const other = moving.find(o => o !== s && !o.air && o.next.x === x && o.next.y === y);
        return { cause: `crashed head-on into ${other.name}`, killer: other.name, killerId: other.id, headOn: true, meet: true };
      }
      return null;
    };
    for (let more = true; more;) {
      more = false;
      for (const s of moving) {
        if (crashes.has(s) || s.air) continue;
        const c = crashOf(s);
        if (!c) continue;
        crashes.set(s, c);
        more = true;
        if (s.tailMoves) { const t = s.body[s.body.length - 1], k = key(t.x, t.y); bodyStamp[k] = stamp; bodyOwner[k] = s.id; }
      }
    }

    // A crash costs CRASH_LOSS segments off the tail (they fall off as food)
    // and a moment's stun. It's the end at MIN_LENGTH, dashing into the edge
    // or a hole, or if there'll be nowhere to turn when the stun's over (see
    // roomAfterStun: the cells its
    // tail breaks off from, cells rivals' tails will have left by then, and
    // a snake that's out count as room). A cell heads met in is room for one
    // of them once every other head that met there is out or has room of its
    // own (that one turns away; see recoil). Worked out until nothing
    // changes, since a snake that's out frees its cells for everyone else;
    // when nothing does, the shortest of those still boxed in are out first
    // (and the rest looked at again): so of two snakes that meet head-on, or
    // run into each other, each with nowhere else to turn, the longer one
    // bounces (the other's body, turned to food, makes room), and the same
    // length, both are out.
    const out = new Set(), live = new Set();
    for (const [s, c] of crashes) {
      if (s.landing && game.holes.has(key(s.body[0].x, s.body[0].y))) { // (a landing that crashed: its head comes down on what it hopped; a hole, and in it goes)
        Object.assign(c, { cause: 'fell into a woodpecker hole', killer: 'wall', killerId: null, headOn: false, meet: false });
        out.add(s);
      }
      if (s.body.length <= T.MIN_LENGTH || s.boom) out.add(s); // (too small to bounce; or blown up)
    }
    const room = s => {
      if (roomAfterStun(game, s, out)) return true;
      const h = s.body[0], back = s.body[1];
      for (const d of CRAWL) { // (a cell heads met in: the others there are out, or have room of their own)
        const { x, y } = ahead(game, s, h.x, h.y, d);
        if ((back && x === back.x && y === back.y) || !inside(x, y)) continue;
        const met = metAt(s, x, y);
        if (met && met.every(o => out.has(o) || roomAfterStun(game, o, out))) return true;
      }
      return false;
    };
    for (let undecided = true; undecided;) {
      let changed = false;
      for (const [s] of crashes) if (!out.has(s) && !live.has(s) && room(s)) { live.add(s); changed = true; }
      if (changed) continue;
      let least = Infinity;
      for (const [s] of crashes) if (!out.has(s) && !live.has(s)) least = Math.min(least, s.body.length);
      undecided = least < Infinity;
      for (const [s] of crashes) if (!out.has(s) && !live.has(s) && s.body.length === least) out.add(s); // (the shortest still boxed in)
    }
    for (const [s, c] of crashes) {
      if (out.has(s)) {
        s.cause = c.cause; s.killer = c.killer; s.killerId = c.killerId;
        dying.push(s);
        continue;
      }
      const lost = Math.min(T.CRASH_LOSS, s.body.length - T.MIN_LENGTH);
      for (let n = 0; n < lost; n++) { const t = s.body.pop(); drops.push({ x: t.x, y: t.y, color: s.color }); }
      s.stunUntil = game.tick + 1 + T.STUN_TICKS;
      if (s.landing && burning(game, key(s.body[0].x, s.body[0].y))) { // (come down on fire: alight)
        if (!(s.burnUntil > game.tick)) { s.burnFrom = game.tick; game.events.push({ type: 'alight', snake: s }); }
        s.burnUntil = game.tick + T.BURN_TICKS;
      }
      s.bounce = c.headOn ? { x: s.next.x, y: s.next.y, by: c.killerId } : null;
      if (c.headOn) s.bumpedBy = { id: c.killerId, tick: game.tick };
      game.events.push({ type: 'crash', snake: s, x: s.next.x, y: s.next.y, cause: c.cause, killer: c.killer, killerId: c.killerId, lost });
    }

    for (const s of moving) {
      if (crashes.has(s)) continue;
      s.body.unshift(s.next);
      if (s.tailMoves) s.body.pop(); else s.grow--;
      if (!s.air && burning(game, key(s.next.x, s.next.y))) { // crawled into the fire: alight (not over it, in the air)
        if (!(s.burnUntil > game.tick)) { s.burnFrom = game.tick; game.events.push({ type: 'alight', snake: s }); }
        s.burnUntil = game.tick + T.BURN_TICKS;
      }
    }
    for (const s of dying) s.alive = false;

    eat(game);
    for (const s of starving) {
      if (!s.alive || s.ateTick === game.tick) continue; // crashed anyway, or reached food in time
      s.cause = 'starved'; s.killer = 'hunger'; s.alive = false;
      dying.push(s);
    }
    singe(game, dying, drops);

    crawl(game);
    peck(game, dying, drops);

    // Dead snakes turn into meat, and broken-off pieces into food (never on
    // food, living bodies, holes or fire).
    if (dying.length || drops.length) {
      markBodies(game);
      for (const f of game.food) bodyStamp[key(f.x, f.y)] = stamp;
      const meat = (x, y, color, cooked) => {
        const k = key(x, y);
        if (bodyStamp[k] === stamp || game.holes.has(k) || game.fires.has(k)) return;
        bodyStamp[k] = stamp;
        game.food.push(cooked ? { x, y, kind: 'pellet', color, cooked: 1 } : { x, y, kind: 'pellet', color });
      };
      for (const s of dying) {
        s.diedAt = game.tick;
        game.events.push({ type: 'death', snake: s });
        for (const c of s.body) meat(c.x, c.y, s.color, s.burnUntil > game.tick);
      }
      for (const d of drops) meat(d.x, d.y, d.color, d.cooked);
    }

    fillFood(game);
    weather(game);
    game.time += tickMs(game);
    game.tick++;
    snapshot(game);
    return dying;
  }

  // Is this cell somewhere a head can't go (off the board, a hole, a body as
  // things stand, or burning)?
  function blocked(game, x, y) {
    if (!inside(x, y)) return true;
    const k = key(x, y);
    if (game.holes.has(k) || burning(game, k)) return true;
    for (const s of game.snakes) if (s.alive && s.body.some(c => c.x === x && c.y === y)) return true;
    return false;
  }

  // Just over a head-on: is the cell it met the other head in shut to it?
  // Only one of the two may go back in, the longer one (the same length:
  // the one that came first), so they can't meet there again; it's open to
  // either once the other is out, still stunned, or no longer beside it.
  function shutTo(game, s) {
    const b = s.bounce, o = b && game.snakes[b.by];
    if (!b || !o || !o.alive || o.stunUntil > game.tick || Math.abs(o.body[0].x - b.x) + Math.abs(o.body[0].y - b.y) !== 1) return false;
    return o.body.length > s.body.length || (o.body.length === s.body.length && o.id < s.id);
  }

  // Just over a crash, facing what it hit: the way to turn, the open side
  // with the most room round it (counted a short way), or straight on if
  // there's none. Never the cell it met another head in while that's shut
  // to it, and, if it can help it, not a cell another head could step into
  // this tick too (two heads side by side across a corner would otherwise
  // both turn into the corner they share, and meet again; the head it met,
  // if that cell's its own to take, won't).
  function recoil(game, s, shut) {
    const h = s.body[0], back = s.body[1], b = s.bounce;
    let best = s.dir, most = -Infinity;
    for (const d of CRAWL) {
      const { x, y } = ahead(game, s, h.x, h.y, d), met = b && b.x === x && b.y === y;
      if ((back && x === back.x && y === back.y) || blocked(game, x, y) || (met && shut)) continue;
      let room = roomFrom(game, x, y, 24);
      for (const o of game.snakes) if (o !== s && o.alive && !(met && o.id === b.by) && Math.abs(o.body[0].x - x) + Math.abs(o.body[0].y - y) === 1) room -= 100;
      if (room > most) { most = room; best = d; }
    }
    return best;
  }
  function roomFrom(game, x0, y0, cap) {
    const seen = new Set([key(x0, y0)]), queue = [[x0, y0]];
    while (queue.length && seen.size < cap) {
      const [x, y] = queue.shift();
      for (const d of CRAWL) {
        const nx = x + d.x, ny = y + d.y, k = key(nx, ny);
        if (seen.has(k) || blocked(game, nx, ny)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
    return seen.size;
  }

  // After a crash: will there be anywhere to turn when the stun's over (not
  // counting a cell heads met in: see the verdict in step)? A neighbouring
  // cell (not back into its own neck), on the board and not a hole, that's
  // free by the tick it moves again: free now; a cell another head arrives
  // in, or a body cell, that'll have been left by then (see freeBy); its own
  // tail that breaks off in the crash (or its tail end, leaving as it moves);
  // or a body that's out this tick (it turns to food). Fire counts as room:
  // you can go through fire. (out: snakes found to be out this tick.)
  function roomAfterStun(game, s, out) {
    const h = s.body[0], back = s.body[1], keep = s.body.length - Math.min(T.CRASH_LOSS, s.body.length - T.MIN_LENGTH);
    for (const d of CRAWL) {
      const { x, y } = ahead(game, s, h.x, h.y, d), k = key(x, y);
      if ((back && x === back.x && y === back.y) || !inside(x, y) || game.holes.has(k)) continue;
      const by = arrivalAt(x, y); // (a head that gets there this tick, on the ground or in the air: the cell's its head now...)
      if (by && !out.has(by) && !freeBy(game, by, -1)) continue;
      if (!by && headStamp[k] === stamp && headCount[k] > 0 && metAt(s, x, y)) continue; // (only heads that crashed there: a cell they met in)
      // (...and a body there, under one in the air, counts as well)
      if (bodyStamp[k] !== stamp) return true;
      const o = game.snakes[bodyOwner[k]];
      if (!o || out.has(o)) return true;
      const j = o.body.findIndex(c => c.x === x && c.y === y);
      if (j < 0) return true;
      if (o === s) { if (j >= keep - (s.grow > 0 ? 0 : 1)) return true; continue; } // (its own: the tail that breaks off, or the tail end, leaving as it moves)
      if (freeBy(game, o, j)) return true;
    }
    return false;
  }
  // Will cell j of snake o (-1: the cell its head's arriving in) be free by
  // the tick a snake that crashed this tick moves again (1 + STUN_TICKS
  // ticks after this one)? It's left on o's (length - j + growth)th move
  // (a head may take a cell on the tick a tail leaves it), and o's moves
  // start this tick, or once its stun's over (stunned, or crashed this tick:
  // then its tail breaks off now, as food).
  function freeBy(game, o, j) {
    let L = o.body.length, wait = 0;
    if (crashes0.has(o)) {
      const lost = Math.min(T.CRASH_LOSS, L - T.MIN_LENGTH);
      if (j >= L - lost) return true;
      L -= lost;
      wait = 1 + T.STUN_TICKS;
    } else wait = Math.max(0, o.stunUntil - game.tick);
    return wait + L - j + o.grow <= 2 + T.STUN_TICKS;
  }
  // A head that gets to (x, y) this tick (it doesn't crash), if one does.
  function arrivalAt(x, y) {
    for (const o of moving0) if (o.next && o.next.x === x && o.next.y === y && !crashes0.has(o)) return o;
    return null;
  }
  // The other heads that met in (x, y) this tick (an empty cell where heads
  // arrived and crashed), or null if no heads met there.
  function metAt(s, x, y) {
    let met = null;
    for (const o of moving0) {
      if (!o.next || o.next.x !== x || o.next.y !== y || !crashes0.has(o)) continue;
      if (!crashes0.get(o).meet) return null;
      if (o !== s) (met ||= []).push(o);
    }
    return met;
  }
  let crashes0 = new Map(), moving0 = []; // (this tick's crashes and moving snakes, for roomAfterStun)

  // A snake on fire loses a segment every BURN_EVERY ticks (they fall off,
  // roasted) until it goes out; rain and snow put it out sooner. At
  // MIN_LENGTH, the flames finish it.
  function singe(game, dying, drops) {
    const wet = game.weather.kind === 'rain' || game.weather.kind === 'snow';
    for (const s of game.snakes) {
      if (!s.alive || !(s.burnUntil > game.tick)) continue;
      if (wet) s.burnUntil = Math.min(s.burnUntil, game.tick + T.BURN_RAIN_TICKS);
      if (!(s.burnUntil > game.tick) || (game.tick - s.burnFrom) % T.BURN_EVERY !== T.BURN_EVERY - 1) continue;
      if (s.body.length <= T.MIN_LENGTH) {
        s.cause = 'burned up'; s.killer = 'fire'; s.killerId = null; s.alive = false;
        dying.push(s);
        continue;
      }
      const t = s.body.pop();
      drops.push({ x: t.x, y: t.y, color: s.color, cooked: true });
      game.events.push({ type: 'singe', snake: s });
    }
  }

  // ------------------------------------------------------------- powers

  // A leap: up over the cell in front (a golden leap: over the two in front,
  // the first of them this tick), its head in the air over the last, landing
  // beyond it next tick. Only if there's something to hop (a body, a hole or
  // fire) and somewhere to land (none of those). The plain leap costs the tip
  // of its tail (it needs more than MIN_LENGTH) and needs a moment before the
  // next; golden ones are free.
  function hop(game, s) {
    if (s.leaps > 0 && leapOver(game, s, true)) return; // (golden, if it can; if not, the plain one, if that's ready)
    if (game.time >= s.leapReadyAt && s.body.length > T.MIN_LENGTH) leapOver(game, s, false);
  }
  function leapOver(game, s, golden) {
    const reach = golden ? 2 : 1, path = [];
    for (let c = s.body[0], i = 0; i <= reach; i++) {
      c = ahead(game, s, c.x, c.y, s.dir);
      if (!inside(c.x, c.y)) return false; // (never off the board)
      path.push(c);
    }
    const hurdle = c => { const k = key(c.x, c.y); return bodyStamp[k] === stamp || game.holes.has(k) || burning(game, k); };
    if (!path.slice(0, reach).some(hurdle) || hurdle(path[reach])) return false;
    if (golden) s.leaps--;
    else {
      s.leapReadyAt = game.time + T.LEAP_COOLDOWN_MS;
      for (let n = 0; n < T.LEAP_COST; n++) trim(s);
    }
    for (let i = 0; i < reach - 1; i++) advance(s, path[i]);
    s.next = path[reach - 1];
    s.air = true;
    s.flight = { dir: s.dir, land: path[reach] };
    s.leapArmed = -1;
    game.events.push({ type: 'leap', snake: s, x: path[0].x, y: path[0].y, gold: golden ? 1 : 0, reach });
    return true;
  }

  // A dash: DASH_LENGTH cells this tick, along the ground. A snake lying
  // across the way (one cell thick: not two of it in a row) is cut in two
  // there (everything behind the cut falls off as food; out, if less than
  // MIN_LENGTH is left in front of it); fire is put out; food on the way is
  // eaten. The edge or a hole: it blows up. Anything else (a head, a snake
  // two thick, its own body): it gets that far and crashes into it.
  function dash(game, s, gone, dying, drops) {
    s.dashes--;
    s.leapArmed = -1;
    const from = s.body[0];
    let n = 0;
    for (let c = from, i = 1; i <= T.DASH_LENGTH; i++) {
      c = ahead(game, s, c.x, c.y, s.dir);
      s.next = c;
      const k = key(c.x, c.y);
      if (!inside(c.x, c.y) || game.holes.has(k)) { s.boom = true; break; }
      if (bodyStamp[k] === stamp) {
        const o = game.snakes[bodyOwner[k]], j = o ? o.body.findIndex(b => b.x === c.x && b.y === c.y) : -1;
        const past = ahead(game, s, c.x, c.y, s.dir), pk = key(past.x, past.y);
        const thick = inside(past.x, past.y) && bodyStamp[pk] === stamp && bodyOwner[pk] === bodyOwner[k];
        if (!o || o === s || j <= 0 || thick) break; // (it crashes into that)
        cutAt(game, o, j, s, gone, dying, drops);
      }
      const fire = game.fires.get(k);
      if (fire && !(fire.strike && game.tick < fire.from)) douse(game, k); // (not lightning still on its way)
      if (i === T.DASH_LENGTH) break; // (its head goes here, with everyone else's)
      advance(s, c);
      n++;
      (s.passed ||= []).push(c); // (food on the way: eaten after everyone's moved, with what its head finds)
    }
    game.events.push({ type: 'dash', snake: s, x: from.x, y: from.y, n: n + 1 });
  }
  // A dash cuts o at body index j (by: the dasher).
  function cutAt(game, o, j, by, gone, dying, drops) {
    if (j < T.MIN_LENGTH) { // (too little left in front of the cut: out)
      for (const b of o.body) unstamp(o, b);
      o.cause = `got cut in two by ${by.name}`; o.killer = by.name; o.killerId = by.id;
      dying.push(o);
      gone.add(o);
      return;
    }
    const cut = o.body.splice(j);
    for (const b of cut) unstamp(o, b);
    for (let i = 1; i < cut.length; i++) drops.push({ x: cut[i].x, y: cut[i].y, color: o.color });
    if (o.tailMoves) unstamp(o, o.body[o.body.length - 1]); // (its new tail moves on this tick)
    game.events.push({ type: 'cut', snake: o, x: cut[0].x, y: cut[0].y, lost: cut.length, by: by.id });
  }
  function douse(game, k) {
    const f = game.fires.get(k);
    game.fires.delete(k);
    const left = (game.fireGroups.get(f.group) || 1) - 1;
    if (left > 0) game.fireGroups.set(f.group, left); else game.fireGroups.delete(f.group);
    game.events.push({ type: 'douse', x: k % GRID, y: Math.floor(k / GRID) });
  }
  // Mid-tick, for the cells a leap or a dash passes on the way: its head on a
  // cell (now part of its body), and the tail end moving up after it.
  function advance(s, c) {
    s.body.unshift({ x: c.x, y: c.y });
    const k = key(c.x, c.y);
    bodyStamp[k] = stamp; bodyOwner[k] = s.id;
    trim(s);
  }
  // Its tail end gone (pending growth first), as the stamps go: if its new
  // tail will move on this tick, that cell's free.
  function trim(s) {
    if (s.grow > 0) s.grow--; else s.body.pop();
    s.tailMoves = s.grow === 0;
    if (s.tailMoves) unstamp(s, s.body[s.body.length - 1]);
  }
  function unstamp(s, c) {
    const k = key(c.x, c.y);
    if (bodyStamp[k] === stamp && bodyOwner[k] === s.id) bodyStamp[k] = 0;
  }

  // Every living head on food eats it (not in the air), and a dash eats
  // what was on the cells it passed.
  function eat(game) {
    for (const s of game.snakes) {
      if (!s.alive || s.air) continue;
      for (const c of s.passed ? [...s.passed, s.body[0]] : [s.body[0]]) {
        const i = game.food.findIndex(f => f.x === c.x && f.y === c.y);
        if (i >= 0) consume(game, s, game.food.splice(i, 1)[0], c.x, c.y);
      }
    }
  }
  function consume(game, s, f, x, y) {
    game.events.push({ type: 'eat', snake: s, kind: f.kind, x, y, color: f.color, cooked: !!f.cooked, gold: !!f.gold });
    // Golden powers (one golden power at a time: a new one replaces the old).
    if (f.gold) { s.leaps = Math.min(T.LEAP_MAX, s.leaps + T.LEAP_CHARGES); s.dashes = 0; } // (a golden beetle: leaps)
    if (f.kind === 'leaf') { s.dashes = T.DASH_CHARGES; s.leaps = 0; s.leapArmed = -1; } // (a golden leaf: dashes, each when pressed for)
    if (f.kind === 'goldcap') s.wrapUntil = game.time + T.WRAP_MS; // (a golden mushroom: the edges wrap)
    if (f.kind === 'mushroom') {
      // Shrink: cancel pending growth first, then drop tail segments.
      let n = T.SHRINK;
      const fromGrow = Math.min(s.grow, n);
      s.grow -= fromGrow;
      n -= fromGrow;
      while (n-- > 0 && s.body.length > T.MIN_LENGTH) s.body.pop();
    } else {
      const growth = f.kind === 'golden' ? T.GOLDEN_GROWTH : f.kind === 'beetle' ? T.BEETLE_GROWTH : f.cooked ? T.COOKED_GROWTH : 1;
      s.lastAte = game.time;
      s.ateTick = game.tick;
      s.nextStarve = game.time + T.HUNGER_MS;
      s.grow += growth;
      s.eaten += growth;
      if (f.kind === 'pellet') s.pellets++;
    }
  }

  return {
    GRID, PLAYER_COLOR, PERSONAS, DIRS, WEATHER,
    createGame, step, tickMs, hungerLeft, aiView, canThinkAhead, thinkAhead, suddenDeath, leap, leapIn,
  };
})();
