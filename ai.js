// AI brain for the rival snakes.
//
// Fairness: an AI sees the *other* snakes as they were `age` ticks ago (its
// reaction time), so it can't respond to a sudden turn any faster than a
// human could. It treats the cells an opponent might have reached since then
// as risky. It always knows its own body exactly. It is never told which
// snake is the human: every rival is just a snake with an id.
//
// Cleverness: for every move sequence up to `depth` steps it scores the result
// with a timed flood fill (do I still have room? can I get onto my own trail
// and chase my tail? is the room I need only through a narrow neck that a
// rival could get to and shut? most often: am I pinned against a wall or a
// body, with one or two ways on a rival could come round to?), a Voronoi
// split of the board (whose territory is this?) and the food it can reach
// before anyone else.
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
  //   normalFood                    worth of a green apple (default 1); a golden apple is worth 3x
  //   mushroom                      worth of a mushroom, which shrinks you (default -1: avoid)
  //   mushroomLover                 from this length on, seek mushrooms and ignore apples
  //   contested                     how much food a rival reaches first still counts (0-1, true = 1)
  //   hungryBelow, fedFactor        at this length or more, food matters only fedFactor as much
  //   margin, headRisk, zoneRisk    spare room wanted / fear of a rival's next move / of where it might be (required)
  //   distance                      reward per step of distance from the nearest rival head
  //   hunt                          { squeeze, chase, lead }: shrink the victim's room, get in front of it
  //   home                          { radius, leave, grow, max, drift }: stay near a home circle (radius
  //                                   at the start, a cell more for every `grow` segments, up to `max`;
  //                                   it drifts off lost land every `drift` ticks), hunt intruders
  //   lure                          { weight, dist }: hover about `dist` from a chosen snake's head
  //   turn                          penalty for every change of direction
  //   tail                          reward for riding just behind a rival's tail
  //   mimic                         bonus for moving the way the model snake moves
  //   colony, goal                  { radius, max, every }: plant and defend flags; pull per step toward the next site
  //   thrill                        reward for every wall, body or rival head right next to me
  //   coil                          { weight, from }: from this length on, reward for keeping my head
  //                                   close behind my own tail, so I move as a ring
  const DRAB = {
    space: 1.2, territory: 1.5, aggression: 0.3,
    food: 5, eat: 80, pellet: 1.2, foodRange: 60,
    margin: 8, headRisk: 700, zoneRisk: 150,
  };
  const HUNT = { squeeze: 2.5, chase: 6, lead: 4 };

  // Each persona: name, color, look (how it's drawn), driver (stateful
  // behaviour, optional), weights, and flavor text: a blurb for the start
  // screen, a line for when it kills you, and one for when it wins.
  const PERSONAS = {
    sniper: {
      name: 'Sniper', color: '#b91c1c', look: 'sniper', driver: 'sniper',
      blurb: 'Picks whichever snake it has the best shot at and cuts it off.',
      kill: 'Headshot. It had you lined up three moves ago.',
      win: 'Nobody was safe.',
      w: {
        space: 1, territory: 0.8, aggression: 0.3,
        food: 6, eat: 80, pellet: 1.5, foodRange: 40, hungryBelow: 16, fedFactor: 0.3,
        margin: 10, headRisk: 600, zoneRisk: 80, hunt: HUNT,
      },
    },
    gobbler: {
      name: 'Gobbler', color: '#fb923c', look: 'gobbler',
      blurb: 'Eats everything, even a rival’s apple. Hates mushrooms.',
      kill: 'Gobbler didn’t even look up from lunch.',
      win: 'And it’s still hungry.',
      w: {
        space: 1, territory: 0.2,
        food: 10, eat: 300, pellet: 3, foodRange: 60, contested: 0.3, mushroom: -3,
        margin: 6, headRisk: 1500, zoneRisk: 500, // greedy, but it flinches from heads (it used to win only 8%)
      },
    },
    ghost: {
      name: 'Ghost', color: '#f1f5f9', look: 'ghost',
      blurb: 'Keeps its distance from everyone, and slips through the gaps.',
      kill: 'Ghost? You never even saw it.',
      win: 'Was it ever really here?',
      w: {
        space: 2, territory: 0.6,
        food: 3, eat: 30, pellet: 1, foodRange: 15, hungryBelow: 18, fedFactor: 0.4,
        margin: 6, headRisk: 900, zoneRisk: 150, distance: 7,
      },
    },
    sovereign: {
      name: 'Sovereign', color: '#2563eb', look: 'sovereign', driver: 'sovereign',
      blurb: 'Rules its own patch of bark and attacks anyone who trespasses.',
      kill: 'The Sovereign does not share.',
      win: 'Long live the Sovereign.',
      w: {
        space: 1.5, territory: 1, aggression: 0.2,
        food: 5, eat: 70, pellet: 1.2, foodRange: 30,
        margin: 3, headRisk: 500, zoneRisk: 80,
        home: { radius: 4, leave: 30, grow: 8, max: 7, drift: 15 }, hunt: { squeeze: 2.5, chase: 6, lead: 3 },
      },
    },
    colonist: {
      name: 'Colonist', color: '#e11d48', look: 'colonist', driver: 'colonist',
      blurb: 'A redcoat who plants flags all over and defends every one.',
      kill: 'Another patch of bark for the Crown.',
      win: 'The final flag is planted.',
      w: {
        space: 1.2, territory: 1.4, aggression: 0.2,
        food: 5, eat: 70, pellet: 1.2, foodRange: 30,
        margin: 5, headRisk: 700, zoneRisk: 120,
        colony: { radius: 4, max: 3, every: 12000 }, goal: 4,
        hunt: { squeeze: 2, chase: 5, lead: 3 },
      },
    },
    drab: {
      name: 'Drab', color: '#c8bf94', look: 'drab',
      blurb: 'Plays it safe and sensible. Nothing special.',
      kill: 'You lost to Drab. Drab!',
      win: 'Somehow.',
      w: DRAB,
    },
    vulture: {
      name: 'Vulture', color: '#27272a', ink: '#f9a8d4', look: 'vulture', driver: 'vulture',
      blurb: 'Circles snakes in trouble and feasts on what they leave behind.',
      kill: 'Vulture was waiting for this.',
      win: 'Picking over the leftovers.',
      w: {
        space: 1.5, territory: 0.4,
        food: 4, eat: 60, normalFood: 0.15, pellet: 3, foodRange: 40, contested: true,
        margin: 6, headRisk: 900, zoneRisk: 200, lure: { weight: 8, dist: 8 },
      },
    },
    mason: {
      name: 'Mason', color: '#ebe5d9', ink: '#8a8170', look: 'mason', // Caesar in marble (ink: his name, outline and tag, in stone)
      blurb: 'Walls off the board, then keeps the biggest piece.',
      kill: 'Mason had a spot picked out for you.',
      win: 'Veni, vidi, Mason.',
      w: {
        space: 1.5, territory: 2.2,
        food: 3, eat: 40, pellet: 1, foodRange: 30,
        margin: 6, headRisk: 800, zoneRisk: 150, turn: 25,
      },
    },
    wildcard: {
      name: 'Wildcard', color: '#b22234', look: 'wildcard', driver: 'wildcard', // (red, white and blue)
      blurb: 'A random mix of habits, new every round. Great hair.',
      kill: 'Nobody knows how, least of all Wildcard.',
      win: 'Tremendous. Nobody wins like this.',
      w: DRAB, // replaced by a random set on its first move
    },
    creeper: {
      name: 'Creeper', color: '#0d9488', look: 'creeper',
      blurb: 'Sneaks up and rides right behind other snakes’ tails.',
      kill: 'Creeper was never far away.',
      win: 'Quietly.',
      w: {
        space: 1, territory: 0.5,
        food: 3, eat: 50, pellet: 1, foodRange: 30,
        margin: 5, headRisk: 900, zoneRisk: 150, tail: 45,
      },
    },
    metagamer: {
      name: 'Metagamer', color: '#22d3ee', look: 'metagamer', driver: 'metagamer',
      blurb: 'Studies how each rival plays, then counters it.',
      kill: 'Metagamer had you figured out.',
      win: 'The spreadsheet called it.',
      w: { ...DRAB, hunt: HUNT, lure: { weight: 5, dist: 6 } },
    },
    capricious: {
      name: 'Capricious', color: '#ec4899', look: 'capricious', driver: 'capricious',
      blurb: 'Changes its mind every few seconds: sniper, glutton, hermit, builder.',
      kill: 'Capricious felt like it. Just then.',
      win: 'And already wants something else.',
      w: DRAB, // replaced by the current mood's weights
    },
    copycat: {
      name: 'Copycat', color: '#fca5a5', look: 'copycat', driver: 'copycat',
      blurb: 'Copies whoever seems to be winning. Party member.',
      kill: 'It learned that from someone.',
      win: 'Imitation pays.',
      w: { ...DRAB, mimic: 120, lure: { weight: 4, dist: 5 } },
    },
    desperado: {
      name: 'Desperado', color: '#ea580c', look: 'desperado',
      blurb: 'Skims walls, bodies and heads for the thrill of it. Yeehaw.',
      kill: 'Desperado drew first.',
      win: 'Rides off into the sunset.',
      w: {
        space: 1, territory: 0.6,
        food: 6, eat: 80, pellet: 1.5, foodRange: 40, mushroom: 0.5,
        margin: 5, headRisk: 600, zoneRisk: 40, thrill: 25,
      },
    },
    mute: {
      name: 'Mute', color: '#a855f7', look: 'mute', driver: 'sniper', // (a rainbow; violet stands in for it in text)
      blurb: 'A mime. Picks someone and closes an invisible box around them. Never says a word.',
      kill: 'Mute boxed you in. Without a word.',
      win: '*takes a silent bow*',
      w: {
        space: 1.2, territory: 2, aggression: 0.8,
        food: 4, eat: 70, pellet: 1.2, foodRange: 40,
        margin: 6, headRisk: 700, zoneRisk: 120,
        hunt: { squeeze: 4, chase: 2, lead: 1 },
      },
    },
    ouroboros: {
      name: 'Ouroboros', color: '#b8860b', look: 'ouroboros',
      blurb: 'Chases its own tail: once it’s long, it moves as a ring, and whatever’s inside is in trouble.',
      kill: 'Ouroboros came full circle.',
      win: 'And round again.',
      w: {
        space: 1.0, territory: 0.6, aggression: 0.2,
        food: 3, eat: 45, pellet: 1.2, foodRange: 40,
        margin: 3, headRisk: 800, zoneRisk: 150,
        coil: { weight: 20, from: 10 },
      },
    },
    joker: {
      name: 'Joker', color: '#a21caf', look: 'joker', driver: 'joker',
      blurb: 'Lures chasers into dead ends and swerves away at the last moment.',
      kill: 'Joker led you on. You followed.',
      win: 'Who’s laughing now?',
      w: {
        space: 1, territory: 0.6,
        food: 5, eat: 70, pellet: 1.2, foodRange: 40, mushroom: 0.5,
        margin: 4, headRisk: 600, zoneRisk: 40, turn: -12,
        lure: { weight: 6, dist: 3 }, hunt: { squeeze: 3, chase: 0, lead: 2 },
      },
    },
  };
  const POOL = Object.keys(PERSONAS);
  const MOODS = ['sniper', 'gobbler', 'ghost', 'mason'];

  const TUNE = window.TUNING; // (the rules' numbers, so the AI's picture of them stays true)
  const TRAPPED = 5000;
  const NECK = 2000;       // the room I need is through a gap a rival could get to and shut...
  const DAWDLE = 8;        // ...even this many ticks after me (I don't always leave a pocket straight away)...
  // ...and the gap right by my head: pinned against a wall or a body, with one
  // or two ways on that a rival could come round to. This nearest case is
  // most of what the neck test catches (nine in ten), and its allowance is
  // the dial between fewer boxed-in deaths and longer rounds.
  const PINNED_DAWDLE = 8;
  const HOLE = 1 << 30;    // "frees up" never
  const DEAD = -1e6;
  const EMPTY = new Set();
  const ROOM_CAP = 120;    // stop counting a rival's room past this
  const DISTANCE_CAP = 14; // distance-keepers are happy once this far away

  // Scratch buffers, reused between calls (grid size is fixed per page), so the
  // search allocates next to nothing however many positions it scores. Besides
  // the per-cell grids: `nbr` lists each cell's neighbours in DIR_LIST order
  // (-1 off the board), and `queue` holds a breadth-first search, one distance
  // after another. No search visits a cell twice, so N * N is always enough.
  let bufN = 0, mineFree, otherFree, ownFree, risk, seen, owner, claimT, ownerStamp;
  let foodValue, foodGrow, foodCells, queue, nbr, necks, reach;
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
    foodValue = new Float64Array(size); // what eating a cell is worth
    foodGrow = new Int8Array(size);     // what eating a cell does to my length
    foodCells = new Int32Array(size);   // food never shares a cell
    queue = new Int32Array(size);
    necks = new Int32Array(size * 4); // (a neck: its one or two cells, the room before it, and how far it is)
    reach = new Int32Array(size);     // the soonest any rival could be in a cell (ticks from now)
    nbr = new Int32Array(size * 4);
    for (let i = 0; i < size; i++) {
      const x = i % N, y = (i - x) / N;
      DIR_LIST.forEach((d, k) => {
        const nx = x + d.x, ny = y + d.y;
        nbr[4 * i + k] = nx >= 0 && ny >= 0 && nx < N && ny < N ? ny * N + nx : -1;
      });
    }
  }

  // Territory per snake and where its search starts, for up to `n` snakes.
  let ownersCap = 0, counts, srcI, srcT, srcOwn;
  function ensureOwners(n) {
    if (n <= ownersCap) return;
    ownersCap = n;
    counts = new Int32Array(n);
    srcI = new Int32Array(n);
    srcT = new Int32Array(n);
    srcOwn = new Int8Array(n);
  }

  // Bodies for the search, one buffer per step: a move at step s writes the
  // new body into bodies[s] and reads only bodies[s - 1]. A buffer holds at
  // least `cells` cells, and the length in use is passed alongside it.
  const bodies = [];
  function ensureBodies(steps, cells) {
    for (let s = 1; s <= steps; s++) {
      const b = (bodies[s] ||= []);
      while (b.length < cells) b.push({ x: 0, y: 0 });
    }
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
  //          food: [{ x, y, kind }], holes: Set of cell indexes, age, tick, timeMs }
  // memory: an object kept for this snake for the whole round.
  function decide(view, persona, memory = {}) {
    const N = view.grid;
    const { me, others, food, age } = view;
    const holes = view.holes || new Set();
    const depth = persona.depth ?? 3;
    ensureBuffers(N);
    ensureOwners(others.length + 1);
    const steps = Math.max(1, depth); // even a depth-0 search makes one move
    ensureBodies(steps, me.body.length + steps); // a body grows at most one cell a step
    mineFree.fill(0); otherFree.fill(0); risk.fill(0);

    const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const myHead = me.body[0];

    // Woodpecker holes never close: treat them like walls.
    for (const i of holes) otherFree[i] = HOLE;

    // Opponent bodies as last seen. A segment j from the head leaves its cell
    // after (len - j) ticks; we ignore the time that has passed since the
    // snapshot, which is conservative in case they ate something.
    // (A rival I saw stunned stays put that much longer: its stars show.)
    const stunLeft = o => Math.max(0, (o.stun || 0) - age);
    for (const o of others) {
      const L = o.body.length, still = stunLeft(o);
      o.body.forEach((c, j) => {
        const i = c.y * N + c.x;
        otherFree[i] = Math.max(otherFree[i], L - j + still);
      });
    }
    mineFree.set(otherFree);

    // Where is each opponent now? Assume it kept going straight for `age`
    // ticks and treat that path as occupied (for me only).
    const heads = [];
    for (const o of others) {
      const L = o.body.length;
      let hx = o.body[0].x, hy = o.body[0].y;
      for (let s = Math.min(age, o.stun || 0) + 1; s <= age; s++) { // (stunned, it didn't move)
        let nx = hx + o.dir.x, ny = hy + o.dir.y;
        if (o.wrap > 0) { nx = (nx + N) % N; ny = (ny + N) % N; } // (the edges wrap for it a while)
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
      queue[0] = start;
      // queue[read, write) is still to expand; it holds one distance at a time.
      let read = 0, write = 1, room = 0;
      for (let d = 1; read < write && room < ROOM_CAP; d++) {
        const levelEnd = write;
        while (read < levelEnd) {
          const i = queue[read++];
          for (let n = 4 * i; n < 4 * i + 4; n++) {
            const ni = nbr[n];
            if (ni < 0 || seen[ni] === stampS || otherFree[ni] > d || (ownFree[ni] && ownFree[ni] > d - blockT)) continue; // (a cell that isn't my body is free of me)
            seen[ni] = stampS;
            room++;
            queue[write++] = ni;
          }
        }
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
      body0ToOwnFree(me.body, me.body.length, 0);
      let best = -1, bestScore = Infinity, currentScore = Infinity;
      for (const k of candidates) {
        const tgt = targetOf(k, hunt.lead);
        const s = manhattan(myHead, tgt) + roomOf(k) / 6 - others[k].body.length / 4;
        if (s < bestScore) { bestScore = s; best = k; }
        if (others[k].id === memory.victimId) currentScore = s;
      }
      clearOwnFree(me.body, me.body.length);
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
      sniper() { pickVictim(all, ctx.w.hunt); },

      // Its realm: a circle round where it started, that grows as it does
      // (and shrinks again if it wastes away), and drifts a cell at a time
      // off land that's been lost (holes, fire). Anyone in it gets hunted.
      sovereign() {
        const H = ctx.w.home, len = me.body.length;
        memory.home ||= { x: myHead.x, y: myHead.y, radius: H.radius };
        const home = ctx.home = memory.home;
        const needs = R => 3 + H.grow * (R - H.radius); // (the length it takes to hold a realm of radius R)
        if (home.radius < H.max && len >= needs(home.radius + 1)) home.radius++;
        else if (home.radius > H.radius && len < needs(home.radius) - 2) home.radius--;
        const fit = v => Math.min(N - home.radius - 2, Math.max(home.radius + 1, v));
        home.x = fit(home.x);
        home.y = fit(home.y);
        if (view.tick >= (memory.driftAt ?? 0)) {
          memory.driftAt = view.tick + H.drift;
          const land = (cx, cy) => {
            let n = 0;
            for (let y = cy - home.radius; y <= cy + home.radius; y++) {
              for (let x = cx - home.radius; x <= cx + home.radius; x++) {
                if (inside(x, y) && Math.hypot(x - cx, y - cy) <= home.radius && !holes.has(y * N + x)) n++;
              }
            }
            return n;
          };
          let best = null, most = land(home.x, home.y) + 2; // (only for clearly better land)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = fit(home.x + dx), y = fit(home.y + dy);
            if (x === home.x && y === home.y) continue;
            const n = land(x, y);
            if (n > most) { most = n; best = { x, y }; }
          }
          if (best) { home.x = best.x; home.y = best.y; }
        }
        const intruders = all.filter(k => Math.hypot(heads[k].x - ctx.home.x, heads[k].y - ctx.home.y) <= ctx.home.radius + 1);
        if (intruders.length) pickVictim(intruders, ctx.w.hunt);
        else memory.victimId = null;
      },

      // Plant a flag where it starts, then every so often travel to the open
      // spot furthest from rivals and plant another (oldest flag goes when it
      // has too many). Anyone near any flag gets hunted.
      colonist() {
        const col = ctx.w.colony;
        const clamp = v => Math.min(N - 2, Math.max(1, v));
        // (n: which colony it is, first, second, ...: each flies its own flag.)
        memory.colonies ||= [{ x: clamp(myHead.x), y: clamp(myHead.y), radius: col.radius, n: 1 }];
        if (memory.site && manhattan(myHead, memory.site) <= 1) {
          memory.planted = (memory.planted || 0) + 1;
          memory.colonies.push({ ...memory.site, radius: col.radius, n: memory.planted + 1 });
          if (memory.colonies.length > col.max) memory.colonies.shift();
          memory.site = null;
          memory.nextSiteAt = view.timeMs + col.every;
        }
        memory.nextSiteAt ??= view.timeMs + col.every;
        if (!memory.site && view.timeMs >= memory.nextSiteAt) {
          let best = null, bestScore = -Infinity;
          for (let y = 2; y < N - 2; y += 2) {
            for (let x = 2; x < N - 2; x += 2) {
              if (holes.has(y * N + x) || otherFree[y * N + x]) continue;
              if (memory.colonies.some(c => Math.hypot(c.x - x, c.y - y) < c.radius * 2)) continue;
              const p = { x, y };
              const away = Math.min(DISTANCE_CAP, ...heads.map(h => manhattan(h, p)));
              const s = away - 0.4 * manhattan(myHead, p);
              if (s > bestScore) { bestScore = s; best = p; }
            }
          }
          memory.site = best;
          if (!best) memory.nextSiteAt = view.timeMs + col.every;
        }
        const intruders = all.filter(k => memory.colonies.some(c => Math.hypot(heads[k].x - c.x, heads[k].y - c.y) <= c.radius + 1));
        if (intruders.length) pickVictim(intruders, ctx.w.hunt);
        else {
          memory.victimId = null;
          ctx.goal = memory.site;
        }
      },

      // Get the attention of the nearest rival heading my way, stay just in
      // front of it, and steer so its room shrinks behind me: bait it into a
      // dead end it can't see coming.
      joker() {
        let best = -1, bestD = Infinity;
        for (const k of all) {
          const o = others[k], h = heads[k];
          const toMe = { x: myHead.x - h.x, y: myHead.y - h.y };
          const d = manhattan(h, myHead);
          const chasing = o.dir.x * toMe.x + o.dir.y * toMe.y > 0;
          const score = d - (chasing ? 4 : 0);
          if (score < bestD) { bestD = score; best = k; }
        }
        if (best < 0) return;
        ctx.lure = best;
        ctx.victim = best;
        ctx.target = heads[best];
        memory.victimId = others[best].id;
      },

      // Hover near the snake most likely to die soon (least room for its length).
      vulture() {
        body0ToOwnFree(me.body, me.body.length, 0);
        let best = -1, bestScore = Infinity, currentScore = Infinity;
        for (const k of all) {
          const s = roomOf(k) / Math.max(4, others[k].body.length);
          if (s < bestScore) { bestScore = s; best = k; }
          if (others[k].id === memory.lureId) currentScore = s;
        }
        clearOwnFree(me.body, me.body.length);
        const current = indexOf(memory.lureId);
        ctx.lure = current >= 0 && currentScore <= bestScore * 1.5 ? current : best;
        memory.lureId = ctx.lure >= 0 ? others[ctx.lure].id : null;
      },

      wildcard() {
        memory.w ||= randomWeights();
        ctx.w = memory.w;
        if (ctx.w.hunt) pickVictim(all, ctx.w.hunt);
      },

      // Mood swings. It starts each round undecided (its own self, playing it
      // safe) for a few seconds, then every 8-15 s takes up another persona's
      // weights, dithering for a moment in between.
      capricious() {
        memory.moodUntil ??= view.timeMs + rand(3500, 5500);
        if (view.timeMs >= memory.moodUntil) {
          if (memory.mood) { // over it: a moment of not knowing what next
            memory.lastMood = memory.mood;
            memory.mood = null;
            memory.moodUntil = view.timeMs + rand(1200, 2000);
          } else {
            const options = MOODS.filter(m => m !== memory.lastMood);
            memory.mood = options[Math.floor(Math.random() * options.length)];
            memory.moodUntil = view.timeMs + rand(8000, 15000);
          }
          memory.moodChangedAt = view.timeMs;
        }
        if (!memory.mood) return; // (undecided: its own, safe weights)
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

    // A body is its first `len` cells (search bodies live in longer buffers).
    function body0ToOwnFree(body, len, grow) {
      for (let j = 0; j < len; j++) ownFree[body[j].y * N + body[j].x] = len - j + grow;
    }
    function clearOwnFree(body, len) {
      for (let j = 0; j < len; j++) ownFree[body[j].y * N + body[j].x] = 0;
    }

    if (persona.driver && others.length) drivers[persona.driver]();
    const w = ctx.w;

    // Risk: cells each rival could step into next tick (head-on), and its
    // wider reach since I last saw it (soft zone).
    // (A rival still stunned next tick can't strike; one I just met head-on,
    // I give twice the berth for a while, so we don't go for the same cell again.)
    others.forEach((o, k) => {
      const strike = stunLeft(o) > 1 ? 0 : w.headRisk * (o.id === me.bumped ? 2 : 1);
      const wrapO = o.wrap > 0, at = v => wrapO ? (v + N) % N : v; // (the edges wrap for it a while)
      for (const d of DIR_LIST) {
        const nx = at(heads[k].x + d.x), ny = at(heads[k].y + d.y);
        if (inside(nx, ny)) risk[ny * N + nx] += strike;
      }
      // (Its powers reach further straight on: a dash three cells, a golden
      // leap three, anyone's leap two if there's something in front to hop.)
      const fx = at(heads[k].x + o.dir.x), fy = at(heads[k].y + o.dir.y);
      const far = o.dashes > 0 || o.leaps > 0 ? 3 : inside(fx, fy) && otherFree[fy * N + fx] > 1 ? 2 : 1;
      for (let i = 2; i <= far; i++) {
        const nx = at(heads[k].x + o.dir.x * i), ny = at(heads[k].y + o.dir.y * i);
        if (inside(nx, ny)) risk[ny * N + nx] += strike * 0.5;
      }
      const stampZ = ++stamp;
      queue[0] = o.body[0].y * N + o.body[0].x;
      seen[queue[0]] = stampZ;
      let read = 0, write = 1;
      for (let s = 1; s <= age + 1; s++) {
        const levelEnd = write;
        while (read < levelEnd) {
          const i = queue[read++];
          for (let n = 4 * i; n < 4 * i + 4; n++) {
            const ni = nbr[n];
            if (ni < 0 || seen[ni] === stampZ || otherFree[ni] > s) continue;
            seen[ni] = stampZ;
            risk[ni] += w.zoneRisk;
            queue[write++] = ni;
          }
        }
      }
    });

    // Reach: the soonest (in ticks from now) any rival could be in each cell,
    // spreading a cell a tick from where I last saw its head (once its stun
    // is over), round bodies and my own body as they are now. A gap I need
    // that a rival can reach first is a gap it could shut.
    reach.fill(HOLE);
    body0ToOwnFree(me.body, me.body.length, me.grow);
    for (const o of others) {
      const stampR = ++stamp, t0 = (o.stun || 0) - age; // (when it moved, or moves, again)
      queue[0] = o.body[0].y * N + o.body[0].x;
      seen[queue[0]] = stampR;
      reach[queue[0]] = Math.min(reach[queue[0]], t0);
      let read = 0, write = 1;
      for (let s = t0 + 1; read < write; s++) {
        const levelEnd = write, mine = Math.max(0, s); // (my body is all there until now)
        while (read < levelEnd) {
          const i = queue[read++];
          for (let n = 4 * i; n < 4 * i + 4; n++) {
            const ni = nbr[n];
            if (ni < 0 || seen[ni] === stampR || otherFree[ni] > s + age || ownFree[ni] > mine) continue;
            seen[ni] = stampR;
            if (s < reach[ni]) reach[ni] = s;
            queue[write++] = ni;
          }
        }
      }
    }
    clearOwnFree(me.body, me.body.length);

    // How much food matters right now, given how long I already am. A
    // mushroom lover past its length limit wants mushrooms instead. Hunger
    // trumps all of that: with under 10 s before I start starving, everyone
    // goes looking for food, harder the closer it gets.
    const myLen = me.body.length + me.grow;
    const hunger = me.hungerLeft == null ? 0 : Math.min(1, Math.max(0, (TUNE.AI_HUNGRY_MS - me.hungerLeft) / TUNE.AI_HUNGRY_MS));
    // (Once the woodpecker's here nothing new grows: nobody can afford to be picky.)
    const lean = view.timeMs >= TUNE.SUDDEN_DEATH_MS;
    const shrinking = !hunger && !lean && w.mushroomLover != null && myLen >= w.mushroomLover;
    const fed = !hunger && !lean && myLen >= (w.hungryBelow ?? Infinity);
    const foodW = shrinking ? Math.max(3, w.food) : fed ? w.food * w.fedFactor : Math.max(w.food, 8 * hunger) * (1 + 2 * hunger);
    const eatW = shrinking ? Math.max(40, w.eat) : fed ? w.eat * w.fedFactor : Math.max(w.eat, 150 * hunger) * (1 + 2 * hunger);

    // How many ticks an apple I saw has left (in winter it rots twice as
    // fast, and has done since I saw it).
    const winter = view.weather === 'snow';
    const applesLeft = f => winter && !f.cooked ? (f.expires - view.tick - age) / 2 : f.expires - view.tick; // (baked, it keeps)

    // Food worth by kind. Negative means "avoid eating".
    const apple = w.normalFood ?? 1;
    const worth = {
      food: shrinking ? 0 : Math.max(apple, hunger),
      golden: shrinking ? 0 : TUNE.GOLDEN_GROWTH * Math.max(apple, hunger),
      beetle: shrinking ? 0 : TUNE.BEETLE_GROWTH * Math.max(apple, hunger), // it moves, but it's worth what it's worth
      pellet: shrinking ? 0 : (w.pellet ?? 1),
      mushroom: shrinking ? 2 : (w.mushroom ?? -1),
      leaf: 2 * Math.max(apple, hunger, 0.5), // (golden powers: worth it for what they do)
      goldcap: 1.5 * Math.max(apple, hunger, 0.5),
    };
    // Per cell: foodValue is what eating it is worth (0 if nothing), foodGrow
    // what it does to my length (a mushroom takes off up to SHRINK). foodCells
    // lists the cells worth something.
    foodValue.fill(0); foodGrow.fill(0);
    let foodCount = 0;
    for (const f of food) foodGrow[f.y * N + f.x] = f.kind === 'mushroom' ? -TUNE.SHRINK : f.kind === 'golden' ? TUNE.GOLDEN_GROWTH : f.kind === 'beetle' ? TUNE.BEETLE_GROWTH : f.cooked ? TUNE.COOKED_GROWTH : 1;
    for (const f of food) {
      let v = worth[f.kind] ?? 0;
      if (!v) continue;
      if (f.cooked && v > 0) v *= TUNE.COOKED_GROWTH; // (baked: worth more)
      if (f.gold && v > 0) v *= 1.5; // (a golden beetle: leaps too)
      if (f.kind === 'food' && f.expires != null && applesLeft(f) < Math.abs(f.x - myHead.x) + Math.abs(f.y - myHead.y)) continue; // (it'll have rotted)
      const i = f.y * N + f.x;
      foodValue[i] += v;
      foodCells[foodCount++] = i;
    }

    // Can my head step into cell (x, y) as move number `step` from now?
    function canEnter(body, len, grow, x, y, step) {
      if (!inside(x, y) || mineFree[y * N + x] > step) return false;
      const keep = grow > 0 ? len : len - 1;
      for (let j = 0; j < keep; j++) if (body[j].x === x && body[j].y === y) return false;
      return true;
    }

    function evaluate(body, len, grow, t) {
      const L = len + grow;
      const head = body[0];
      const headI = head.y * N + head.x;
      body0ToOwnFree(body, len, grow);
      // A cell can be entered at absolute time T (ticks from now) once its
      // occupant has left: mineFree (or otherFree, for a rival) <= T, and my
      // own body, placed at time t, needs ownFree <= T - t.

      // 1. Room: timed flood fill from my head (tail cells open up as I move).
      //    It also finds the best food by distance alone, ignoring rivals.
      //    queue[read, write) is still to expand; it holds one distance at a time.
      //    Two more things it notes, for the trap tests at the end:
      //    - how soon I can get onto my own trail (a cell my body leaves
      //      before I get there): from there I can chase my tail round and
      //      round, so I'm not trapped however little room there is;
      //    - necks: a distance the fill gets through only one or two cells
      //      wide, while the room before it is less than I need. Everything
      //      beyond is through that gap (its cells, the room before it and
      //      its distance go in `necks`).
      const cap = L * 2 + 20;
      const need = L + w.margin;
      const stampF = ++stamp;
      seen[headI] = stampF;
      queue[0] = headI;
      let read = 0, write = 1, space = 0, anyFood = 0, trail = HOLE, neckCount = 0;
      // A contested-food eater keeps searching past the room cap until it sees food.
      for (let d = 1; read < write && (space < cap || (w.contested && !anyFood && d <= w.foodRange)); d++) {
        const levelEnd = write;
        while (read < levelEnd) {
          const i = queue[read++];
          for (let n = 4 * i; n < 4 * i + 4; n++) {
            const ni = nbr[n];
            if (ni < 0 || seen[ni] === stampF || mineFree[ni] > t + d || ownFree[ni] > d) continue;
            seen[ni] = stampF;
            space++;
            if (ownFree[ni] && d < trail) trail = d;
            const v = foodValue[ni];
            if (v > 0) anyFood = Math.max(anyFood, v * Math.max(0, w.foodRange - d));
            queue[write++] = ni;
          }
        }
        const width = write - levelEnd;
        if (width && width <= 2 && levelEnd - 1 < need) {
          necks[neckCount++] = queue[levelEnd];
          necks[neckCount++] = queue[write - 1];
          necks[neckCount++] = levelEnd - 1;
          necks[neckCount++] = d;
        }
      }
      space = Math.min(space, cap);

      // 2. Territory: multi-source BFS, opponents start at their last seen
      //    head `age` ticks in the past, I start at my head at time t.
      //    Sources go in time order: the rivals all start at -age, and on a
      //    tie I go first.
      const stampV = ++stamp;
      const owners = others.length + 1;
      counts.fill(0, 0, owners);
      let ns = 0;
      const meFirst = t <= -age;
      if (meFirst) { srcI[ns] = headI; srcT[ns] = t; srcOwn[ns++] = 0; }
      for (let k = 0; k < others.length; k++) {
        const h = others[k].body[0];
        srcI[ns] = h.y * N + h.x; srcT[ns] = -age; srcOwn[ns++] = k + 1;
      }
      if (!meFirst) { srcI[ns] = headI; srcT[ns] = t; srcOwn[ns++] = 0; }
      let si = 0;
      let T = srcT[0];
      read = write = 0; // queue[read, write) now holds the cells claimed at time T
      while (read < write || si < ns) {
        while (si < ns && srcT[si] === T) {
          const i = srcI[si], own = srcOwn[si++];
          if (ownerStamp[i] !== stampV) {
            ownerStamp[i] = stampV; owner[i] = own; claimT[i] = T; counts[own]++;
            queue[write++] = i;
          }
        }
        const levelEnd = write;
        while (read < levelEnd) {
          const i = queue[read++];
          const own = owner[i];
          if (own < 0) continue; // became contested
          const free = own === 0 ? mineFree : otherFree;
          for (let n = 4 * i; n < 4 * i + 4; n++) {
            const ni = nbr[n];
            if (ni < 0) continue;
            if (ownerStamp[ni] === stampV) {
              if (claimT[ni] === T + 1 && owner[ni] >= 0 && owner[ni] !== own) {
                counts[owner[ni]]--;
                owner[ni] = -1;
              }
              continue;
            }
            if (free[ni] > T + 1 || ownFree[ni] > T + 1 - t) continue;
            ownerStamp[ni] = stampV; owner[ni] = own; claimT[ni] = T + 1; counts[own]++;
            queue[write++] = ni;
          }
        }
        T = read < write || si >= ns ? T + 1 : srcT[si];
      }

      // 3. Food: a steady pull of foodW per step closer. Normally only food I
      //    reach before any rival counts; a contested eater counts all of it.
      let foodScore = 0;
      for (let k = 0; k < foodCount; k++) {
        const i = foodCells[k], v = foodValue[i];
        if (v > 0 && ownerStamp[i] === stampV && owner[i] === 0) {
          foodScore = Math.max(foodScore, v * Math.max(0, w.foodRange - (claimT[i] - t)));
        }
      }
      if (w.contested) foodScore = Math.max(foodScore, Number(w.contested) * anyFood);
      // Nothing uncontested: drift toward the nearest food anyway, more weakly.
      else if (foodScore === 0) foodScore = 0.3 * anyFood;

      let othersTerritory = 0;
      for (let k = 1; k < owners; k++) othersTerritory += counts[k];

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
        for (let k = 0; k < heads.length; k++) score += ctx.avoid[k] * Math.min(DISTANCE_CAP, manhattan(head, heads[k]));
      }

      // 6. Hovering about `dist` from a chosen snake's head.
      if (ctx.lure >= 0) score -= w.lure.weight * Math.abs(manhattan(head, heads[ctx.lure]) - w.lure.dist);

      // Heading for a spot (Colonist's next flag).
      if (ctx.goal) score -= w.goal * manhattan(head, ctx.goal);

      // Desperado: the closer to danger, the better.
      if (w.thrill) {
        let edge = 0;
        for (let n = 4 * headI; n < 4 * headI + 4; n++) {
          const ni = nbr[n];
          if (ni < 0 || mineFree[ni] > t + 1 || ownFree[ni] > 1) edge++;
        }
        for (const h of heads) if (manhattan(head, h) <= 3) edge++;
        score += w.thrill * edge;
      }

      // 7. Staying home.
      if (ctx.home) {
        const out = Math.hypot(head.x - ctx.home.x, head.y - ctx.home.y) - ctx.home.radius;
        if (out > 0) score -= w.home.leave * out;
      }

      // 8. Coiling: once long enough, keeping my head close behind my own tail,
      //    so I move as a ring (anything inside it is boxed in).
      if (w.coil && len >= w.coil.from) score += w.coil.weight * Math.max(0, 5 - manhattan(head, body[len - 1]));

      // 9. Riding just behind a rival's tail.
      if (w.tail) {
        let best = 0;
        for (const o of others) {
          if (o.body.length < 8) continue; // short snakes' heads are too close to their tails
          best = Math.max(best, 4 - manhattan(head, o.body[o.body.length - 1]));
        }
        score += w.tail * best;
      }

      clearOwnFree(body, len);

      // Trapped: less room than I need, and no way onto my own trail.
      if (space < need && trail === HOLE) return score - TRAPPED - 100 * (need - space);
      // Nearly as bad: the room I need is through a neck that a rival could
      // get to and shut before I'm through, leaving me only the pocket on my
      // side of it. (Necks nearest first; one I'd get through well before
      // any rival could get there is mine to pass, and a pocket with my own
      // trail in it I can circle.)
      for (let k = 0; k < neckCount; k += 4) {
        const d = necks[k + 3], slack = d === 1 ? PINNED_DAWDLE : DAWDLE;
        if (trail < d) break;
        if (reach[necks[k]] > t + d + slack || reach[necks[k + 1]] > t + d + slack) continue;
        return score - Math.min(NECK + 50 * (need - necks[k + 2]), TRAPPED - 1); // (never worse than a sure trap, however long I am)
      }
      return score;
    }

    // While the edges wrap for me (a golden mushroom): how many steps ahead
    // that still holds (ticks are about 110 ms), and a step across an edge
    // (a neck on the far side) read as the one step it is.
    const wrapSteps = Math.floor((me.wrap || 0) / 130);
    const unit = v => v > 1 ? -1 : v < -1 ? 1 : v;

    // Score of moving `d` as step t + 1, then playing on for `depth - 1` more steps.
    // `body` is the first `len` cells; the moved body goes into bodies[t + 1].
    function move(body, len, grow, d, depth, t, bonus) {
      let nx = body[0].x + d.x, ny = body[0].y + d.y;
      if (t < wrapSteps) { nx = (nx + N) % N; ny = (ny + N) % N; } // (the edges wrap for me a while yet)
      if (!canEnter(body, len, grow, nx, ny, t + 1)) return null;
      const i = ny * N + nx;
      const turning = d.x !== unit(body[0].x - body[1].x) || d.y !== unit(body[0].y - body[1].y);
      // New head in front; the tail moves up unless I'm still growing.
      let g = grow, nlen = len + 1;
      if (g > 0) g--; else nlen--;
      // Eating must beat the pull that food had on us, plus a bonus for eating sooner.
      const v = foodValue[i];
      const change = foodGrow[i];
      if (change < 0) { // a mushroom: pending growth goes first, then the tail
        let n = -change;
        const fromGrow = Math.min(g, n);
        g -= fromGrow;
        n -= fromGrow;
        for (; n > 0 && nlen > TUNE.MIN_LENGTH; n--) nlen--;
      } else g += change;
      const nb = bodies[t + 1];
      nb[0].x = nx; nb[0].y = ny;
      for (let j = 1; j < nlen; j++) { nb[j].x = body[j - 1].x; nb[j].y = body[j - 1].y; }
      if (v) foodValue[i] = 0;
      let gain = v * (foodW * w.foodRange + eatW * Math.pow(0.85, t)) - risk[i] * Math.pow(0.6, t);
      if (turning && w.turn) gain -= w.turn * Math.pow(0.9, t);
      const score = depth <= 1
        ? evaluate(nb, nlen, g, t + 1) + bonus + gain
        : search(nb, nlen, g, depth - 1, t + 1, bonus + gain);
      if (v) foodValue[i] = v;
      return score;
    }

    function search(body, len, grow, depth, t, bonus) {
      const backX = unit(body[1].x - body[0].x), backY = unit(body[1].y - body[0].y);
      let best = -Infinity;
      for (const d of DIR_LIST) {
        if (d.x === backX && d.y === backY) continue;
        const s = move(body, len, grow, d, depth, t, bonus);
        if (s !== null) best = Math.max(best, s);
      }
      // Dead end: dying later beats dying sooner.
      return best === -Infinity ? DEAD + t * 1000 : best;
    }

    // A move that looks fatal: a wall, a hole or my own body certainly is, but
    // a rival's cell may already be free (I see rivals as they were a moment
    // ago), so if it comes to that, the one that frees up soonest is the best bet.
    // Better than any crash, though, is going through fire: it costs as much
    // as a crash, but I keep moving (never just as a shortcut: only when
    // every other way is a crash or worse).
    const fire = view.fire || EMPTY;
    function throughFire(x, y) {
      if (!inside(x, y) || !fire.has(y * N + x)) return false;
      const keep = me.grow > 0 ? me.body.length : me.body.length - 1;
      for (let j = 0; j < keep; j++) if (me.body[j].x === x && me.body[j].y === y) return false;
      for (const o of others) for (const c of o.body) if (c.x === x && c.y === y) return false;
      return true;
    }
    function maybeFree(x, y) {
      if (!inside(x, y) || holes.has(y * N + x)) return 0;
      const keep = me.grow > 0 ? me.body.length : me.body.length - 1;
      for (let j = 0; j < keep; j++) if (me.body[j].x === x && me.body[j].y === y) return 0;
      return 1000 - Math.min(999, mineFree[y * N + x]);
    }

    let bestDir = me.dir, bestScore = -Infinity;
    for (const d of DIR_LIST) {
      if (d.x === -me.dir.x && d.y === -me.dir.y) continue;
      let s = move(me.body, me.body.length, me.grow, d, depth, 0, 0);
      if (s === null) {
        const nx = myHead.x + d.x, ny = myHead.y + d.y;
        s = throughFire(nx, ny) ? 1.5 * DEAD : 2 * DEAD + maybeFree(nx, ny);
      }
      else if (ctx.mimicDir && sameDir(d, ctx.mimicDir)) s += w.mimic;
      s += Math.random() * 1e-3; // tie-break
      if (s > bestScore) { bestScore = s; bestDir = d; }
    }
    // Powers. With nothing better than a crash every way, a leap over what's
    // in front (golden leaps, or the plain leap when it's ready), if there's
    // somewhere free to land: it asks for it just as a person presses.
    if (bestScore < DEAD / 2 && !me.dashes && (me.leaps > 0 || me.leapIn === 0)) {
      const reach = me.leaps > 0 ? 2 : 1, keep = me.grow > 0 ? me.body.length : me.body.length - 1;
      const mine = (x, y) => { for (let j = 0; j < keep; j++) if (me.body[j].x === x && me.body[j].y === y) return true; return false; };
      const hurdle = (x, y) => holes.has(y * N + x) || fire.has(y * N + x) || mineFree[y * N + x] > 1 || mine(x, y);
      for (const d of [bestDir, ...DIR_LIST]) {
        if (d.x === -me.dir.x && d.y === -me.dir.y) continue;
        let over = false, ok = true;
        for (let i = 1; i <= reach + 1 && ok; i++) {
          const x = myHead.x + d.x * i, y = myHead.y + d.y * i;
          if (!inside(x, y)) ok = false;
          else if (i <= reach) over ||= hurdle(x, y);
          else ok = !hurdle(x, y);
        }
        if (ok && over) { bestDir = d; memory.power = view.tick; break; }
      }
    }
    // Golden dashes: three cells at once along the ground. Worth one to cut a
    // rival in two (out, if it's cut right behind its head; otherwise for a
    // good length off it, more so the more aggressive it is), to grab
    // something golden first, or as the way out. Never into the edge or a
    // hole (it'd blow up), never where it would crash, and only landing
    // somewhere with room.
    if (me.dashes > 0 && memory.power !== view.tick) {
      const d = bestDash(bestScore < DEAD / 2);
      if (d) { bestDir = d; memory.power = view.tick; }
    }
    return bestDir;

    function bestDash(trapped) {
      const L = TUNE.DASH_LENGTH, keep = me.grow > 0 ? me.body.length : me.body.length - 1, wrap = me.wrap > 0;
      const own = new Set();
      for (let j = 0; j < keep; j++) own.add(me.body[j].y * N + me.body[j].x);
      const wall = i => holes.has(i) && !fire.has(i); // (a hole, or where the woodpecker's about to strike; fire's put out)
      const bodyAt = (x, y) => { // a rival's body there, and how far down it, as it'll be by the dash (it's moved on since I saw it, unless stunned)
        for (const o of others) for (let j = 0; j < o.body.length; j++) if (o.body[j].x === x && o.body[j].y === y) return { o, j0: j, j: j + Math.max(0, age - (o.stun || 0)) };
        return null;
      };
      const gold = new Set(); // (food worth dashing for: golden things)
      for (const f of food) if (f.kind === 'golden' || f.kind === 'leaf' || f.kind === 'goldcap' || f.gold) gold.add(f.y * N + f.x);
      const cutW = 0.5 + (w.aggression || 0);
      let best = null, bestV = 5.5;
      for (const d of DIR_LIST) {
        if (d.x === -me.dir.x && d.y === -me.dir.y) continue;
        let x = myHead.x, y = myHead.y, v = trapped ? 100 : 0, ok = true;
        for (let i = 1; i <= L && ok; i++) {
          x += d.x; y += d.y;
          if (wrap) { x = (x + N) % N; y = (y + N) % N; }
          const k = y * N + x;
          if (!inside(x, y) || wall(k) || own.has(k)) { ok = false; break; }
          if (fire.has(k)) { /* (fire: it's put out) */ } else if (mineFree[k] > 1) { // (a rival's body that'll still be there)
            const b = bodyAt(x, y), px = x + d.x, py = y + d.y;
            const thick = b && inside(px, py) && b.o.body.some(c => c.x === px && c.y === py);
            if (!b || b.j0 === 0 || thick) { ok = false; break; } // (a head, or two thick: a crash)
            v += b.j < TUNE.MIN_LENGTH ? 60 : (b.o.body.length - b.j) * cutW;
          }
          if (gold.has(k)) v += 3 * Math.max(1, foodValue[k]); // (something golden, first)
          if (i === L && risk[k] > 0) v -= 4; // (landing by a rival's head)
        }
        if (!ok || v <= bestV) continue;
        const room = roomAt(y * N + x, own, Math.min(40, myLen + 4));
        if (room < Math.min(40, myLen + 4)) continue;
        best = d; bestV = v;
      }
      return best;
    }
    function roomAt(i0, own, cap) {
      const z = ++stamp;
      queue[0] = i0; seen[i0] = z;
      let read = 0, write = 1;
      while (read < write && write < cap) {
        const i = queue[read++];
        for (let n = 4 * i; n < 4 * i + 4; n++) {
          const ni = nbr[n];
          if (ni < 0 || seen[ni] === z || (holes.has(ni) && !fire.has(ni)) || mineFree[ni] > 2 || own.has(ni)) continue;
          seen[ni] = z;
          queue[write++] = ni;
        }
      }
      return write;
    }
  }

  return { DIRS, PERSONAS, POOL, decide };
})();
