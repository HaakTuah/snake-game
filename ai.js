// AI brain for the rival snakes.
//
// Fairness: an AI sees the *other* snakes as they were `age` ticks ago (its
// reaction time), so it can't respond to a sudden turn any faster than a
// human could. It treats the cells an opponent might have reached since then
// as risky. It always knows its own body exactly. It is never told which
// snake is the human: every rival is just a snake with an id.
//
// Cleverness: for every move sequence up to `depth` steps it scores the result
// with a timed flood fill (do I still have room?), a Voronoi split of the board
// (whose territory is this?) and the food it can reach before anyone else.
//
// Personality: on top of that shared sense, each persona adds its own goal
// terms, and some have a "driver" that runs once per decision with a memory
// that lasts the whole round (who to hunt, where home is, current mood, ...).
window.SnakeAI = (() => {
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const DIR_LIST = Object.values(DIRS);

  // Weights (w), all optional unless noted:
  //   space, territory, aggression  room / board share / shrinking everyone else
  //   food, eat, pellet, foodRange  pull per step toward food, eating bonus, pellet worth, reach (required)
  //   normalFood                    worth of ordinary food (default 1)
  //   contested                     how much food a rival reaches first still counts (0-1, true = 1)
  //   hungryBelow, fedFactor        at this length or more, food matters only fedFactor as much
  //   margin, headRisk, zoneRisk    spare room wanted / fear of a rival's next move / of where it might be (required)
  //   distance                      reward per step of distance from the nearest rival head
  //   hunt                          { squeeze, chase, lead }: shrink the victim's room, get in front of it
  //   home                          { radius, leave }: stay in a home circle, hunt intruders
  //   lure                          { weight, dist }: hover about `dist` from a chosen snake's head
  //   turn                          penalty for every change of direction
  //   tail                          reward for riding just behind a rival's tail
  //   mimic                         bonus for moving the way the model snake moves
  const DRAB = {
    space: 1, territory: 1.2, aggression: 0.3,
    food: 5, eat: 80, pellet: 1.2, foodRange: 60,
    margin: 3, headRisk: 600, zoneRisk: 150,
  };
  const HUNT = { squeeze: 2.5, chase: 6, lead: 4 };

  const PERSONAS = {
    hunter: {
      name: 'Hunter', color: '#dc2626', look: 'hunter', driver: 'hunter',
      blurb: 'Picks whichever snake it has the best shot at and cuts it off.',
      w: {
        space: 1, territory: 0.8, aggression: 0.3,
        food: 6, eat: 80, pellet: 1.5, foodRange: 40, hungryBelow: 16, fedFactor: 0.3,
        margin: 10, headRisk: 600, zoneRisk: 80, hunt: HUNT,
      },
    },
    gobbler: {
      name: 'Gobbler', color: '#fb923c', look: 'gobbler',
      blurb: 'Eats everything, even food a rival is closer to.',
      w: {
        space: 1, territory: 0.2,
        food: 14, eat: 300, pellet: 3, foodRange: 60, contested: 0.3,
        margin: 6, headRisk: 800, zoneRisk: 200,
      },
    },
    ghost: {
      name: 'Ghost', color: '#e2e8f0', look: 'ghost',
      blurb: 'Keeps away from everyone, stays small and waits you out.',
      w: {
        space: 2, territory: 0.6,
        food: 3, eat: 30, pellet: 1, foodRange: 15, hungryBelow: 8, fedFactor: 0,
        margin: 10, headRisk: 1200, zoneRisk: 400, distance: 25,
      },
    },
    warden: {
      name: 'Warden', color: '#3b82f6', look: 'warden', driver: 'warden',
      blurb: 'Guards its home turf and attacks anyone who comes in.',
      w: {
        space: 1.5, territory: 1, aggression: 0.2,
        food: 5, eat: 70, pellet: 1.2, foodRange: 30,
        margin: 6, headRisk: 700, zoneRisk: 100,
        home: { radius: 6, leave: 30 }, hunt: { squeeze: 2.5, chase: 6, lead: 3 },
      },
    },
    drab: {
      name: 'Drab', color: '#a8a29e', look: 'drab',
      blurb: 'Plays it safe and sensible. Nothing special.',
      w: DRAB,
    },
    vulture: {
      name: 'Vulture', color: '#78716c', look: 'vulture', driver: 'vulture',
      blurb: 'Circles snakes in trouble and feeds on what they leave behind.',
      w: {
        space: 1.5, territory: 0.4,
        food: 4, eat: 60, normalFood: 0.15, pellet: 3, foodRange: 40, contested: true,
        margin: 6, headRisk: 900, zoneRisk: 200, lure: { weight: 8, dist: 8 },
      },
    },
    mason: {
      name: 'Mason', color: '#d6a76c', look: 'mason',
      blurb: 'Builds long straight walls to fence off a big piece of the board.',
      w: {
        space: 1.5, territory: 2.2,
        food: 3, eat: 40, pellet: 1, foodRange: 30,
        margin: 6, headRisk: 800, zoneRisk: 150, turn: 25,
      },
    },
    wildcard: {
      name: 'Wildcard', color: '#f472b6', look: 'wildcard', driver: 'wildcard',
      blurb: 'A random mix of habits, different every round.',
      w: DRAB, // replaced by a random set on its first move
    },
    creeper: {
      name: 'Creeper', color: '#8b5cf6', look: 'creeper',
      blurb: 'Sneaks up behind other snakes and rides their tail.',
      w: {
        space: 1, territory: 0.5,
        food: 3, eat: 50, pellet: 1, foodRange: 30,
        margin: 5, headRisk: 900, zoneRisk: 150, tail: 45,
      },
    },
    metagamer: {
      name: 'Metagamer', color: '#facc15', look: 'metagamer', driver: 'metagamer',
      blurb: 'Studies how each rival plays, then counters it.',
      w: { ...DRAB, hunt: HUNT, lure: { weight: 5, dist: 6 } },
    },
    capricious: {
      name: 'Capricious', color: '#ec4899', look: 'capricious', driver: 'capricious',
      blurb: 'Changes its mind every few seconds: hunter, glutton, hermit, builder.',
      w: DRAB, // replaced by the current mood's weights
    },
    copycat: {
      name: 'Copycat', color: '#cbd5e1', look: 'copycat', driver: 'copycat',
      blurb: 'Copies whoever looks like they are winning, right alongside them.',
      w: { ...DRAB, mimic: 120, lure: { weight: 4, dist: 5 } },
    },
  };
  const POOL = Object.keys(PERSONAS);
  const MOODS = ['hunter', 'gobbler', 'ghost', 'mason'];

  const TRAPPED = 5000;
  const DEAD = -1e6;
  const ROOM_CAP = 120;    // stop counting a rival's room past this
  const DISTANCE_CAP = 14; // distance-keepers are happy once this far away

  // Scratch buffers, reused between calls (grid size is fixed per page).
  let bufN = 0, mineFree, otherFree, ownFree, risk, seen, owner, claimT, ownerStamp;
  let stamp = 0;
  function ensureBuffers(N) {
    if (bufN === N) return;
    bufN = N;
    const size = N * N;
    mineFree = new Int32Array(size);
    otherFree = new Int32Array(size);
    ownFree = new Int32Array(size);
    risk = new Float32Array(size);
    seen = new Int32Array(size);
    owner = new Int8Array(size);
    claimT = new Int32Array(size);
    ownerStamp = new Int32Array(size);
  }

  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const sameDir = (a, b) => a.x === b.x && a.y === b.y;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Wildcard: a random but sensible set of weights, drawn once per round.
  function randomWeights() {
    const chance = p => Math.random() < p;
    const w = {
      space: rand(0.8, 2), territory: rand(0.2, 1.8), aggression: rand(0, 0.5),
      food: rand(2, 12), eat: rand(30, 300), pellet: rand(1, 3), foodRange: Math.round(rand(15, 60)),
      contested: chance(0.4), margin: Math.round(rand(2, 10)),
      headRisk: rand(500, 1200), zoneRisk: rand(30, 400),
    };
    if (chance(0.4)) w.distance = rand(5, 25);
    if (chance(0.3)) w.turn = rand(5, 30);
    if (chance(0.3)) w.tail = rand(10, 40);
    if (chance(0.4)) w.hunt = HUNT;
    return w;
  }

  // view = { grid, me: { id, body, dir, grow }, others: [{ id, body, dir }],
  //          food: [{ x, y, kind }], age, tick, timeMs }
  // memory: an object kept for this snake for the whole round.
  function decide(view, persona, memory = {}) {
    const N = view.grid;
    const { me, others, food, age } = view;
    ensureBuffers(N);
    mineFree.fill(0); otherFree.fill(0); risk.fill(0);

    const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const myHead = me.body[0];

    // Opponent bodies as last seen. A segment j from the head leaves its cell
    // after (len - j) ticks; we ignore the time that has passed since the
    // snapshot, which is conservative in case they ate something.
    for (const o of others) {
      const L = o.body.length;
      o.body.forEach((c, j) => {
        const i = c.y * N + c.x;
        otherFree[i] = Math.max(otherFree[i], L - j);
      });
    }
    mineFree.set(otherFree);

    // Where is each opponent now? Assume it kept going straight for `age`
    // ticks and treat that path as occupied (for me only).
    const heads = [];
    for (const o of others) {
      const L = o.body.length;
      let hx = o.body[0].x, hy = o.body[0].y;
      for (let s = 1; s <= age; s++) {
        const nx = hx + o.dir.x, ny = hy + o.dir.y;
        if (!inside(nx, ny) || otherFree[ny * N + nx] > s) break;
        hx = nx; hy = ny;
        mineFree[hy * N + hx] = Math.max(mineFree[hy * N + hx], L);
      }
      heads.push({ x: hx, y: hy });
    }

    // How much room snake k has from its predicted head. `blockT` > 0 means my
    // body (as placed in ownFree for a search state at time blockT) is in the way.
    function roomOf(k, blockT = 0) {
      const h = heads[k];
      const start = h.y * N + h.x;
      const stampS = ++stamp;
      seen[start] = stampS;
      let frontier = [start], room = 0;
      for (let d = 1; frontier.length && room < ROOM_CAP; d++) {
        const next = [];
        for (const i of frontier) {
          const x = i % N, y = (i - x) / N;
          for (const dd of DIR_LIST) {
            const nx = x + dd.x, ny = y + dd.y;
            if (!inside(nx, ny)) continue;
            const ni = ny * N + nx;
            if (seen[ni] === stampS || otherFree[ni] > d || ownFree[ni] > d - blockT) continue;
            seen[ni] = stampS;
            room++;
            next.push(ni);
          }
        }
        frontier = next;
      }
      return Math.min(room, ROOM_CAP);
    }

    // ------------------------------------------------------------- drivers
    // ctx: the effective weights for this decision plus who to hunt / lure
    // toward / keep away from. Drivers fill it in from the game state.
    const ctx = { w: persona.w, victim: -1, target: null, lure: -1, avoid: null, home: null, mimicDir: null };
    const indexOf = id => others.findIndex(o => o.id === id);

    // Choose the rival I have the best shot at: little room, I can get in
    // front of it quickly, and long (more pellets). Stick with the current
    // victim unless another is clearly better.
    function pickVictim(candidates, hunt) {
      if (!candidates.length) { memory.victimId = null; return; }
      body0ToOwnFree(me.body, 0);
      let best = -1, bestScore = Infinity, currentScore = Infinity;
      for (const k of candidates) {
        const tgt = targetOf(k, hunt.lead);
        const s = manhattan(myHead, tgt) + roomOf(k) / 6 - others[k].body.length / 4;
        if (s < bestScore) { bestScore = s; best = k; }
        if (others[k].id === memory.victimId) currentScore = s;
      }
      clearOwnFree(me.body);
      const current = indexOf(memory.victimId);
      const k = current >= 0 && candidates.includes(current) && currentScore <= bestScore + 5 ? current : best;
      memory.victimId = others[k].id;
      ctx.victim = k;
      ctx.target = targetOf(k, hunt.lead);
    }

    function targetOf(k, lead) {
      const d = others[k].dir, h = heads[k];
      return {
        x: Math.min(N - 1, Math.max(0, h.x + d.x * lead)),
        y: Math.min(N - 1, Math.max(0, h.y + d.y * lead)),
      };
    }

    const all = others.map((_, k) => k);

    const drivers = {
      hunter() { pickVictim(all, ctx.w.hunt); },

      warden() {
        const R = ctx.w.home.radius;
        memory.home ||= {
          x: Math.min(N - R - 2, Math.max(R + 1, myHead.x)),
          y: Math.min(N - R - 2, Math.max(R + 1, myHead.y)),
          radius: R,
        };
        // After two minutes the home grows a cell every 15 s, up to most of the board.
        memory.home.radius = Math.min(14, R + Math.max(0, Math.floor((view.timeMs - 120000) / 15000)));
        ctx.home = memory.home;
        const intruders = all.filter(k => Math.hypot(heads[k].x - ctx.home.x, heads[k].y - ctx.home.y) <= ctx.home.radius + 1);
        if (intruders.length) pickVictim(intruders, ctx.w.hunt);
        else memory.victimId = null;
      },

      // Hover near the snake most likely to die soon (least room for its length).
      vulture() {
        body0ToOwnFree(me.body, 0);
        let best = -1, bestScore = Infinity, currentScore = Infinity;
        for (const k of all) {
          const s = roomOf(k) / Math.max(4, others[k].body.length);
          if (s < bestScore) { bestScore = s; best = k; }
          if (others[k].id === memory.lureId) currentScore = s;
        }
        clearOwnFree(me.body);
        const current = indexOf(memory.lureId);
        ctx.lure = current >= 0 && currentScore <= bestScore * 1.5 ? current : best;
        memory.lureId = ctx.lure >= 0 ? others[ctx.lure].id : null;
      },

      wildcard() {
        memory.w ||= randomWeights();
        ctx.w = memory.w;
        if (ctx.w.hunt) pickVictim(all, ctx.w.hunt);
      },

      // Mood swings: every 8-15 s switch to another persona's weights.
      capricious() {
        if (!memory.mood || view.timeMs >= memory.moodUntil) {
          const options = MOODS.filter(m => m !== memory.mood);
          memory.mood = options[Math.floor(Math.random() * options.length)];
          memory.moodUntil = view.timeMs + rand(8000, 15000);
          memory.moodChangedAt = view.timeMs;
        }
        const mood = PERSONAS[memory.mood];
        ctx.w = mood.w;
        if (mood.driver) drivers[mood.driver]();
      },

      // Watch every rival's behaviour and counter it: keep away from the
      // aggressive ones, shadow the greedy ones for their pellets, and once
      // I'm grown, hunt the evasive ones.
      metagamer() {
        memory.obs ||= {};
        const allHeads = [myHead, ...heads];
        const labels = {};
        others.forEach((o, k) => {
          const ob = (memory.obs[o.id] ||= { len0: o.body.length, samples: 0, near: 0 });
          ob.samples++;
          if (allHeads.some(h => h !== heads[k] && manhattan(h, heads[k]) <= 4)) ob.near++;
          const eatRate = (o.body.length - ob.len0) / (ob.samples + 30);
          labels[o.id] = ob.near / ob.samples > 0.25 ? 'aggressive' : eatRate > 0.04 ? 'greedy' : 'evasive';
        });
        memory.labels = labels;
        ctx.avoid = others.map(o => labels[o.id] === 'aggressive' ? 20 : 0);
        const greedy = all.filter(k => labels[others[k].id] === 'greedy');
        if (greedy.length) ctx.lure = greedy.reduce((a, b) => manhattan(myHead, heads[a]) <= manhattan(myHead, heads[b]) ? a : b);
        const grown = me.body.length + me.grow >= 14;
        if (grown) pickVictim(all.filter(k => labels[others[k].id] === 'evasive'), ctx.w.hunt);
      },

      // Copy the longest snake: move the way it moves, a few cells away.
      copycat() {
        let best = -1;
        for (const k of all) if (best < 0 || others[k].body.length > others[best].body.length) best = k;
        const current = indexOf(memory.modelId);
        const k = current >= 0 && others[current].body.length + 3 > others[best].body.length ? current : best;
        memory.modelId = k >= 0 ? others[k].id : null;
        if (k < 0) return;
        ctx.lure = k;
        ctx.mimicDir = others[k].dir;
      },
    };

    function body0ToOwnFree(body, grow) {
      body.forEach((c, j) => { ownFree[c.y * N + c.x] = body.length - j + grow; });
    }
    function clearOwnFree(body) {
      body.forEach(c => { ownFree[c.y * N + c.x] = 0; });
    }

    if (persona.driver && others.length) drivers[persona.driver]();
    const w = ctx.w;

    // Risk: cells each rival could step into next tick (head-on), and its
    // wider reach since I last saw it (soft zone).
    others.forEach((o, k) => {
      for (const d of DIR_LIST) {
        const nx = heads[k].x + d.x, ny = heads[k].y + d.y;
        if (inside(nx, ny)) risk[ny * N + nx] += w.headRisk;
      }
      const stampZ = ++stamp;
      let frontier = [o.body[0].y * N + o.body[0].x];
      seen[frontier[0]] = stampZ;
      for (let s = 1; s <= age + 1; s++) {
        const next = [];
        for (const i of frontier) {
          const x = i % N, y = (i - x) / N;
          for (const d of DIR_LIST) {
            const nx = x + d.x, ny = y + d.y;
            if (!inside(nx, ny)) continue;
            const ni = ny * N + nx;
            if (seen[ni] === stampZ || otherFree[ni] > s) continue;
            seen[ni] = stampZ;
            risk[ni] += w.zoneRisk;
            next.push(ni);
          }
        }
        frontier = next;
      }
    });

    // Food worth. A home-keeper ignores food outside its home.
    const foodValue = new Map();
    for (const f of food) {
      if (ctx.home && Math.hypot(f.x - ctx.home.x, f.y - ctx.home.y) > ctx.home.radius) continue;
      const v = f.kind === 'pellet' ? (w.pellet ?? 1) : (w.normalFood ?? 1);
      const i = f.y * N + f.x;
      foodValue.set(i, (foodValue.get(i) || 0) + v);
    }

    // How much food matters right now, given how long I already am.
    const myLen = me.body.length + me.grow;
    const fed = myLen >= (w.hungryBelow ?? Infinity);
    const foodW = fed ? w.food * w.fedFactor : w.food;
    const eatW = fed ? w.eat * w.fedFactor : w.eat;

    // Can my head step into cell (x, y) as move number `step` from now?
    function canEnter(body, grow, x, y, step) {
      if (!inside(x, y) || mineFree[y * N + x] > step) return false;
      const keep = grow > 0 ? body.length : body.length - 1;
      for (let j = 0; j < keep; j++) if (body[j].x === x && body[j].y === y) return false;
      return true;
    }

    function evaluate(body, grow, t) {
      const L = body.length + grow;
      const head = body[0];
      const headI = head.y * N + head.x;
      body0ToOwnFree(body, grow);
      // Absolute time T (ticks from now) at which a cell can be entered.
      const passMine = (i, T) => mineFree[i] <= T && ownFree[i] <= T - t;
      const passOther = (i, T) => otherFree[i] <= T && ownFree[i] <= T - t;

      // 1. Room: timed flood fill from my head (tail cells open up as I move).
      //    It also finds the best food by distance alone, ignoring rivals.
      const cap = L * 2 + 20;
      const stampF = ++stamp;
      seen[headI] = stampF;
      let frontier = [headI], space = 0, anyFood = 0;
      // A contested-food eater keeps searching past the room cap until it sees food.
      for (let d = 1; frontier.length && (space < cap || (w.contested && !anyFood && d <= w.foodRange)); d++) {
        const next = [];
        for (const i of frontier) {
          const x = i % N, y = (i - x) / N;
          for (const dd of DIR_LIST) {
            const nx = x + dd.x, ny = y + dd.y;
            if (!inside(nx, ny)) continue;
            const ni = ny * N + nx;
            if (seen[ni] === stampF || !passMine(ni, t + d)) continue;
            seen[ni] = stampF;
            space++;
            const v = foodValue.get(ni);
            if (v) anyFood = Math.max(anyFood, v * Math.max(0, w.foodRange - d));
            next.push(ni);
          }
        }
        frontier = next;
      }
      space = Math.min(space, cap);

      // 2. Territory: multi-source BFS, opponents start at their last seen
      //    head `age` ticks in the past, I start at my head at time t.
      const stampV = ++stamp;
      const counts = new Array(others.length + 1).fill(0);
      const sources = [{ i: headI, T: t, own: 0 }];
      others.forEach((o, k) => sources.push({ i: o.body[0].y * N + o.body[0].x, T: -age, own: k + 1 }));
      sources.sort((a, b) => a.T - b.T);
      let si = 0;
      let T = sources[0].T;
      let level = [];
      const claim = (i, own, at) => {
        ownerStamp[i] = stampV; owner[i] = own; claimT[i] = at; counts[own]++;
      };
      while (level.length || si < sources.length) {
        while (si < sources.length && sources[si].T === T) {
          const s = sources[si++];
          if (ownerStamp[s.i] !== stampV) { claim(s.i, s.own, T); level.push(s.i); }
        }
        const next = [];
        for (const i of level) {
          const own = owner[i];
          if (own < 0) continue; // became contested
          const x = i % N, y = (i - x) / N;
          const pass = own === 0 ? passMine : passOther;
          for (const dd of DIR_LIST) {
            const nx = x + dd.x, ny = y + dd.y;
            if (!inside(nx, ny)) continue;
            const ni = ny * N + nx;
            if (ownerStamp[ni] === stampV) {
              if (claimT[ni] === T + 1 && owner[ni] >= 0 && owner[ni] !== own) {
                counts[owner[ni]]--;
                owner[ni] = -1;
              }
              continue;
            }
            if (!pass(ni, T + 1)) continue;
            claim(ni, own, T + 1);
            next.push(ni);
          }
        }
        level = next;
        T = level.length || si >= sources.length ? T + 1 : sources[si].T;
      }

      // 3. Food: a steady pull of foodW per step closer. Normally only food I
      //    reach before any rival counts; a contested eater counts all of it.
      let foodScore = 0;
      for (const [i, v] of foodValue) {
        if (ownerStamp[i] === stampV && owner[i] === 0) {
          foodScore = Math.max(foodScore, v * Math.max(0, w.foodRange - (claimT[i] - t)));
        }
      }
      if (w.contested) foodScore = Math.max(foodScore, Number(w.contested) * anyFood);
      // Nothing uncontested: drift toward the nearest food anyway, more weakly.
      else if (foodScore === 0) foodScore = 0.3 * anyFood;

      let othersTerritory = 0;
      others.forEach((o, k) => { othersTerritory += counts[k + 1]; });

      let score = w.space * space
        + w.territory * counts[0]
        - (w.aggression || 0) * othersTerritory
        + foodW * foodScore;

      // 4. Hunting: shrink the victim's room and get in front of it.
      if (ctx.victim >= 0) {
        score -= w.hunt.squeeze * roomOf(ctx.victim, t);
        score -= w.hunt.chase * manhattan(head, ctx.target);
      }

      // 5. Distance from rivals: from the nearest head (Ghost), or per rival.
      if (w.distance) {
        let nearest = DISTANCE_CAP;
        for (const h of heads) nearest = Math.min(nearest, manhattan(head, h));
        score += w.distance * nearest;
      }
      if (ctx.avoid) {
        heads.forEach((h, k) => { score += ctx.avoid[k] * Math.min(DISTANCE_CAP, manhattan(head, h)); });
      }

      // 6. Hovering about `dist` from a chosen snake's head.
      if (ctx.lure >= 0) score -= w.lure.weight * Math.abs(manhattan(head, heads[ctx.lure]) - w.lure.dist);

      // 7. Staying home.
      if (ctx.home) {
        const out = Math.hypot(head.x - ctx.home.x, head.y - ctx.home.y) - ctx.home.radius;
        if (out > 0) score -= w.home.leave * out;
      }

      // 8. Riding just behind a rival's tail.
      if (w.tail) {
        let best = 0;
        for (const o of others) {
          if (o.body.length < 8) continue; // short snakes' heads are too close to their tails
          best = Math.max(best, 4 - manhattan(head, o.body[o.body.length - 1]));
        }
        score += w.tail * best;
      }

      clearOwnFree(body);

      const need = L + w.margin;
      if (space < need) score -= TRAPPED + 100 * (need - space);
      return score;
    }

    // Score of moving `d` as step t + 1, then playing on for `depth - 1` more steps.
    function move(body, grow, d, depth, t, bonus) {
      const nx = body[0].x + d.x, ny = body[0].y + d.y;
      if (!canEnter(body, grow, nx, ny, t + 1)) return null;
      const i = ny * N + nx;
      const turning = !sameDir(d, { x: body[0].x - body[1].x, y: body[0].y - body[1].y });
      const nb = [{ x: nx, y: ny }, ...body];
      let g = grow;
      if (g > 0) g--; else nb.pop();
      // Eating must beat the pull that food had on us, plus a bonus for eating sooner.
      const v = foodValue.get(i) || 0;
      if (v) { g++; foodValue.delete(i); }
      let gain = v * (foodW * w.foodRange + eatW * Math.pow(0.85, t)) - risk[i] * Math.pow(0.6, t);
      if (turning && w.turn) gain -= w.turn * Math.pow(0.9, t);
      const score = depth <= 1
        ? evaluate(nb, g, t + 1) + bonus + gain
        : search(nb, g, depth - 1, t + 1, bonus + gain);
      if (v) foodValue.set(i, v);
      return score;
    }

    function search(body, grow, depth, t, bonus) {
      const back = { x: body[1].x - body[0].x, y: body[1].y - body[0].y };
      let best = -Infinity;
      for (const d of DIR_LIST) {
        if (sameDir(d, back)) continue;
        const s = move(body, grow, d, depth, t, bonus);
        if (s !== null) best = Math.max(best, s);
      }
      // Dead end: dying later beats dying sooner.
      return best === -Infinity ? DEAD + t * 1000 : best;
    }

    let bestDir = me.dir, bestScore = -Infinity;
    for (const d of DIR_LIST) {
      if (d.x === -me.dir.x && d.y === -me.dir.y) continue;
      let s = move(me.body, me.grow, d, persona.depth ?? 3, 0, 0);
      if (s === null) s = 2 * DEAD;
      else if (ctx.mimicDir && sameDir(d, ctx.mimicDir)) s += w.mimic;
      s += Math.random() * 1e-3; // tie-break
      if (s > bestScore) { bestScore = s; bestDir = d; }
    }
    return bestDir;
  }

  return { DIRS, PERSONAS, POOL, decide };
})();
