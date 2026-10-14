#!/usr/bin/env node
// Rule checks on hand-built boards: node tools/rules-test.js
// Loads tuning.js, ai.js and engine.js unchanged, the way the game does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ window: {}, console, Math });
for (const f of ['tuning.js', 'ai.js', 'engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { SnakeEngine: E, SnakeAI: AI, TUNING: T } = ctx.window;
const D = E.DIRS;

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) failed++;
}

// Two people steered by their queues, with nothing else on the board.
function board(bodies, { food = [], time = 0 } = {}) {
  const g = E.createGame({ humans: bodies.map((b, i) => ({ name: `P${i}` })), personas: [] });
  g.snakes = g.snakes.slice(0, bodies.length);
  bodies.forEach(([cells, dir], i) => {
    const s = g.snakes[i];
    s.body = cells.map(([x, y]) => ({ x, y }));
    s.dir = D[dir];
  });
  g.food = food.map(([x, y, kind = 'food']) => ({ x, y, kind }));
  g.given = new Set(g.food.map(f => f.y * T.GRID + f.x));
  g.time = time;
  return g;
}

{ // Moving into the cell a tail is leaving is fine.
  const g = board([[[[5, 5], [4, 5], [4, 6], [5, 6]], 'down'], [[[10, 10], [9, 10], [8, 10]], 'right']]);
  E.step(g);
  check('a head may take the cell a tail is leaving', g.snakes[0].alive);
}

{ // Two heads swapping cells is a head-on, for both.
  const g = board([[[[5, 5], [4, 5], [3, 5]], 'right'], [[[6, 5], [7, 5], [8, 5]], 'left']]);
  const dying = E.step(g);
  check('swapping heads is a head-on (at their smallest, both out)', dying.length === 2 && dying.every(s => s.cause.startsWith('crashed head-on')), dying.map(s => s.cause).join(' / '));
}

// ---------------------------------------------------------------- crashes
const line = (x0, y, n, dx = -1) => Array.from({ length: n }, (_, i) => [x0 + dx * i, y]);
const K = (x, y) => y * T.GRID + x;
const feed = g => { for (const o of g.snakes) { o.lastAte = g.time; o.nextStarve = g.time + T.HUNGER_MS; } };

{ // A crash into the edge: the head bounces, three segments break off as food, a stun; then it goes on.
  const g = board([[line(23, 5, 8), 'right'], [line(5, 20, 3), 'right']]);
  const s = g.snakes[0], tail = s.body.slice(-3).map(c => [c.x, c.y]);
  const dying = E.step(g);
  const crash = g.events.find(e => e.type === 'crash');
  check('a crash is not the end', s.alive && !dying.includes(s));
  check('...it costs three segments', s.body.length === 5, s.body.length);
  check('...which fall off as food', tail.every(([x, y]) => g.food.some(f => f.kind === 'pellet' && f.x === x && f.y === y)), JSON.stringify(g.food));
  check('...and says what it hit', crash && crash.snake === s && crash.killer === 'wall' && crash.lost === 3, JSON.stringify(crash && { k: crash.killer, lost: crash.lost }));
  const head = { ...s.body[0] };
  for (let t = 0; t < T.STUN_TICKS; t++) { feed(g); E.step(g); }
  check('...it stays put while stunned', s.body[0].x === head.x && s.body[0].y === head.y);
  feed(g);
  E.step(g);
  check("...then turns to where there's room and goes on", s.alive && (s.body[0].x !== head.x || s.body[0].y !== head.y) && s.dir !== D.right, JSON.stringify(s.body[0]));
}

{ // Every snake starts one longer than the least, so its first crash costs a segment, not the round.
  const g = E.createGame({ withPlayer: true });
  check('snakes start at START_LENGTH', g.snakes.every(o => o.body.length === T.START_LENGTH), g.snakes.map(o => o.body.length).join());
  const me = g.snakes[0];
  me.body = line(23, 12, T.START_LENGTH).map(([x, y]) => ({ x, y })); me.dir = D.right; me.queue = [];
  g.snakes.slice(1).forEach((o, i) => { o.body = line(3, 2 + i * 4, T.START_LENGTH).map(([x, y]) => ({ x, y })); o.dir = D.right; o.isPlayer = true; o.persona = null; o.queue = []; });
  const dying = E.step(g);
  check('...and survives its first crash, one segment down', me.alive && !dying.includes(me) && me.body.length === T.MIN_LENGTH, me.body.length);
}

{ // Boxed in, an AI goes through fire rather than crash (it costs the same, and it keeps moving).
  // Me heading up at the top edge: up is the edge, right a rival's body, left is burning.
  const fireCell = K(4, 0);
  const view = {
    grid: T.GRID,
    me: { id: 0, body: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 }], dir: D.up, grow: 0, hungerLeft: 99999 },
    others: [{ id: 1, body: [{ x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }, { x: 11, y: 0 }, { x: 12, y: 0 }, { x: 13, y: 0 }, { x: 14, y: 0 }, { x: 15, y: 0 }], dir: D.left }],
    food: [], holes: new Set([fireCell]), fire: new Set([fireCell]), age: 2, tick: 10, timeMs: 1000,
  };
  const picks = {};
  for (let i = 0; i < 100; i++) { const d = AI.decide(view, AI.PERSONAS.drab, {}); const n = Object.keys(D).find(k => D[k] === d); picks[n] = (picks[n] || 0) + 1; }
  check('a boxed-in AI goes through fire rather than crash', picks.left === 100, JSON.stringify(picks));
  // ...but with an open way, it keeps out of fire.
  const open = { ...view, others: [] };
  const picks2 = {};
  for (let i = 0; i < 100; i++) { const d = AI.decide(open, AI.PERSONAS.drab, {}); const n = Object.keys(D).find(k => D[k] === d); picks2[n] = (picks2[n] || 0) + 1; }
  check('...but never as a shortcut', !picks2.left, JSON.stringify(picks2));
}

// ---------------------------------------------------------------- golden beetles and leaps
{ // A golden beetle gives leaps.
  const g = board([[line(5, 5, 4), 'right'], [line(5, 20, 3), 'right']]);
  g.food = [{ x: 6, y: 5, kind: 'beetle', gold: 1, expires: 999, dir: D.up, movedAt: g.tick }];
  E.step(g);
  check('a golden beetle gives leaps', g.snakes[0].leaps === T.LEAP_CHARGES && g.snakes[0].eaten === T.BEETLE_GROWTH, g.snakes[0].leaps);
}

// What an AI sees, as things stand now (a board built by hand has no history yet).
const look = g => {
  g.history = [{
    snakes: g.snakes.filter(o => o.alive).map(o => ({ id: o.id, body: o.body.map(c => ({ ...c })), dir: o.dir, stun: 0, leaps: o.leaps, dashes: o.dashes, wrap: 0, air: 0 })),
    food: g.food.map(f => ({ ...f })), holes: g.holes.size, fires: [...g.fires.keys()], pecks: [],
  }];
};
const joined = b => b.every((c, i) => !i || Math.abs(c.x - b[i - 1].x) + Math.abs(c.y - b[i - 1].y) === 1);
const wall = (x, y0 = 8, n = 5) => [Array.from({ length: n }, (_, i) => [x, y0 + i]), 'up']; // (a snake across row 10, heading up)

// (A step with only the food a test put there: nothing that grows mid-test lands in the way.)
const quiet = g => { if (g.given) g.food = g.food.filter(f => g.given.has(f.y * T.GRID + f.x)); return E.step(g); };

{ // Anyone can leap: pressing the way you're going hops the body in front, two cells in two ticks, for the tip of its tail.
  const g = board([[line(5, 10, 5), 'right'], wall(6)]);
  const me = g.snakes[0];
  E.leap(g, me);
  quiet(g);
  check('a leap: up over the body in front', me.alive && me.body[0].x === 6 && me.body[0].y === 10 && !!me.flight && g.events.some(e => e.type === 'leap' && !e.gold), JSON.stringify(me.body[0]));
  check('...for the tip of its tail', me.body.length === 5 - T.LEAP_COST, me.body.length);
  me.queue = [D.down]; // (a turn while it's in the air waits till it lands)
  quiet(g);
  check('...and down on the far side next tick', me.alive && me.body[0].x === 7 && me.body[0].y === 10 && me.body[1].x === 6 && !me.flight, JSON.stringify(me.body.slice(0, 2)));
  check('...its body still joined up, and the one hopped is fine', joined(me.body) && g.snakes[1].alive);
  quiet(g);
  check('...then the turn', me.body[0].x === 7 && me.body[0].y === 11, JSON.stringify(me.body[0]));
  check('...and it needs a moment before the next', E.leapIn(g, me) > 0 && E.leapIn(g, me) <= T.LEAP_COOLDOWN_MS, E.leapIn(g, me));
}

{ // ...not again until it's ready: a crash instead.
  const g = board([[line(5, 10, 6), 'right'], wall(6), wall(8, 4, 12)]);
  const me = g.snakes[0];
  E.leap(g, me); quiet(g); quiet(g); // (over the first, landing at 7)
  E.leap(g, me); quiet(g);
  check('a leap needs a moment before the next', !g.events.some(e => e.type === 'leap') && g.events.some(e => e.type === 'crash' && e.snake === me));
  const g2 = board([[line(5, 10, 6), 'right'], wall(6), wall(8, 4, 12)]);
  const m2 = g2.snakes[0];
  E.leap(g2, m2); quiet(g2); quiet(g2);
  g2.time += T.LEAP_COOLDOWN_MS;
  feed(g2);
  E.leap(g2, m2); quiet(g2);
  check('...and then it can again', g2.events.some(e => e.type === 'leap') && m2.body[0].x === 8);
}

{ // Never at its smallest (it costs a segment), never off the board, never onto a body; it waits for something to hop.
  const g = board([[line(5, 10, T.MIN_LENGTH), 'right'], wall(6)]);
  E.leap(g, g.snakes[0]);
  quiet(g);
  check('no leap at its smallest', !g.events.some(e => e.type === 'leap'));
  const g2 = board([[line(22, 10, 5), 'right'], wall(23)]);
  E.leap(g2, g2.snakes[0]); quiet(g2);
  check('...never off the board', !g2.events.some(e => e.type === 'leap') && g2.events.some(e => e.type === 'crash'));
  const g3 = board([[line(5, 10, 5), 'right'], wall(6), wall(7)]);
  E.leap(g3, g3.snakes[0]); quiet(g3);
  check('...never onto a body', !g3.events.some(e => e.type === 'leap') && g3.events.some(e => e.type === 'crash'));
  const g4 = board([[line(5, 10, 5), 'right'], wall(7, 9)]);
  const me = g4.snakes[0];
  E.leap(g4, me);
  quiet(g4); // (open ground ahead: no leap yet)
  const waited = !g4.events.some(e => e.type === 'leap');
  g4.snakes[1].queue = [D.up];
  quiet(g4); // (the body's right in front now)
  check('...it waits a moment for something to hop', waited && g4.events.some(e => e.type === 'leap') && me.body[0].x === 7, JSON.stringify(me.body[0]));
}

{ // A golden leap: three cells in two ticks, hopping up to two, free.
  const g = board([[line(5, 10, 5), 'right'], wall(6), wall(7)]);
  const me = g.snakes[0];
  me.leaps = 2;
  E.leap(g, me);
  quiet(g);
  check('a golden leap: two cells up and over at once', me.body[0].x === 7 && me.body[1].x === 6 && !!me.flight && me.leaps === 1 && g.events.some(e => e.type === 'leap' && e.gold), JSON.stringify(me.body.slice(0, 2)));
  quiet(g);
  check('...landing on the third next tick', me.alive && me.body[0].x === 8 && joined(me.body) && g.snakes.every(o => o.alive), JSON.stringify(me.body[0]));
  check('...free, and ready again at once', me.body.length === 5 && me.leapReadyAt === 0, me.body.length);
}

{ // An AI asks for its power the way a person does: boxed in, with a leap, it hops instead of crashing.
  // At the top edge, heading right: up is the edge, down its own body, right a rival's body (and beyond it, room).
  for (const golden of [true, false]) {
    const g = E.createGame({ withPlayer: false, personas: ['drab', 'drab'] });
    g.snakes = g.snakes.slice(0, 2);
    const [a, b] = g.snakes;
    a.body = [[5, 0], [4, 0], [4, 1], [5, 1], [5, 2], [4, 2]].map(([x, y]) => ({ x, y })); a.dir = D.right; a.leaps = golden ? 1 : 0;
    b.body = [...Array.from({ length: 13 }, (_, i) => ({ x: 6, y: 12 - i })), { x: 7, y: 0 }]; b.dir = D.down;
    b.isPlayer = true; b.persona = null; b.queue = [];
    g.food = [];
    look(g);
    quiet(g);
    look(g);
    quiet(g);
    check(`a boxed-in AI with a ${golden ? 'golden' : 'plain'} leap hops instead of crashing`, a.alive && g.snakes.every(o => o.alive) && a.body[0].x === (golden ? 8 : 7) && a.body[0].y === 0 && a.leaps === 0, JSON.stringify(a.body[0]));
  }
}

{ // A golden leaf's dash: three cells in one tick, eating what's on the way.
  const g = board([[line(5, 10, 5), 'right'], [line(5, 20, 3), 'right']], { food: [[6, 10], [8, 10]] });
  const me = g.snakes[0];
  me.dashes = 2;
  E.leap(g, me);
  quiet(g);
  check('a dash: three cells in one tick', me.body[0].x === 8 && me.body[0].y === 10 && joined(me.body) && me.dashes === 1 && g.events.some(e => e.type === 'dash' && e.n === 3), JSON.stringify(me.body.slice(0, 4)));
  check('...eating what was on the way', me.eaten === 2 && !g.food.some(f => f.y === 10 && (f.x === 6 || f.x === 8)), me.eaten);
  const g2 = board([[line(5, 10, 5), 'right'], [line(5, 20, 3), 'right']]);
  g2.fires.set(K(7, 10), { from: 0, until: 99, group: 1, strike: false }); g2.fireGroups.set(1, 1);
  g2.snakes[0].dashes = 1;
  E.leap(g2, g2.snakes[0]); quiet(g2);
  check('...putting out fire on the way', !g2.fires.size && !(g2.snakes[0].burnUntil > g2.tick) && g2.events.some(e => e.type === 'douse'));
}

{ // A dash cuts through a snake lying across its way, one cell thick: the rest of it falls off as food.
  const across = [Array.from({ length: 13 }, (_, i) => [7, 4 + i]), 'up']; // (7,4) to (7,16), (7,10) six from its head
  const g = board([[line(5, 10, 5), 'right'], across]);
  const [me, o] = g.snakes;
  me.dashes = 1;
  E.leap(g, me); quiet(g);
  check('a dash cuts a snake in two', me.alive && me.body[0].x === 8 && o.alive && o.body.length === 6 && g.events.some(e => e.type === 'cut' && e.snake === o && e.by === me.id), o.body.length);
  check('...the rest falls off as food', [11, 12, 13, 14, 15, 16].every(y => g.food.some(f => f.kind === 'pellet' && f.x === 7 && f.y === y)), JSON.stringify(g.food.map(f => [f.x, f.y])));
  const g2 = board([[line(5, 10, 5), 'right'], [Array.from({ length: 8 }, (_, i) => [7, 9 + i]), 'up']]); // (cut right behind its head)
  E.leap(g2, Object.assign(g2.snakes[0], { dashes: 1 }));
  const dying = quiet(g2);
  check('...too near its head, and it\'s out', dying.includes(g2.snakes[1]) && g2.snakes[1].cause === 'got cut in two by P0' && g2.snakes[0].alive, g2.snakes[1].cause);
}

{ // An AI with a dash uses it to cut a rival in two right behind its head.
  const g = E.createGame({ withPlayer: false, personas: ['drab', 'drab'] });
  g.snakes = g.snakes.slice(0, 2);
  const [a, b] = g.snakes;
  a.body = line(5, 10, 5).map(([x, y]) => ({ x, y })); a.dir = D.right; a.dashes = 1;
  b.body = Array.from({ length: 12 }, (_, i) => ({ x: 7, y: 9 + i })); b.dir = D.up; // (its head at 7,9: cut at 7,10, right behind it)
  b.isPlayer = true; b.persona = null; b.queue = [];
  g.food = [];
  look(g);
  const dying = quiet(g);
  check('an AI with a dash cuts a rival in two', dying.includes(b) && a.alive && a.dashes === 0, b.cause);
}

{ // A dash crashes into anything it can't cut: a snake two thick (it gets that far first).
  const along = [[[12, 10], [11, 10], [10, 10], [9, 10], [8, 10], [7, 10]], 'right']; // (its tail at 7 moves on)
  const g = board([[line(5, 10, 8), 'right'], along]);
  const me = g.snakes[0];
  me.dashes = 1;
  E.leap(g, me); quiet(g);
  const crash = g.events.find(e => e.type === 'crash' && e.snake === me);
  check('a dash into a snake two thick: it gets that far and crashes', me.alive && me.body[0].x === 7 && crash && crash.x === 8, JSON.stringify(me.body[0]));
}

{ // Dashing into the edge, or a hole: it blows up.
  const g = board([[line(22, 10, 8), 'right'], [line(5, 20, 3), 'right']]);
  E.leap(g, Object.assign(g.snakes[0], { dashes: 1 }));
  const dying = quiet(g);
  check('a dash into the edge blows up', dying.includes(g.snakes[0]) && g.snakes[0].cause === 'dashed into the edge and blew up', g.snakes[0].cause);
  const g2 = board([[line(5, 10, 8), 'right'], [line(5, 20, 3), 'right']]);
  g2.holes.add(K(7, 10));
  E.leap(g2, Object.assign(g2.snakes[0], { dashes: 1 }));
  check('...and into a hole', quiet(g2).includes(g2.snakes[0]) && g2.snakes[0].cause === 'dashed into a woodpecker hole and blew up', g2.snakes[0].cause);
}

{ // A golden mushroom: for a while the edges wrap round.
  const g = board([[line(5, 10, 5), 'right'], [line(5, 20, 3), 'right']], { food: [[6, 10, 'goldcap']] });
  const me = g.snakes[0];
  quiet(g);
  check('a golden mushroom: the edges wrap', me.wrapUntil > g.time && me.wrapUntil <= g.time + T.WRAP_MS);
  me.body = line(23, 10, 5).map(([x, y]) => ({ x, y }));
  quiet(g);
  check('...off one side, in at the other', me.alive && me.body[0].x === 0 && me.body[0].y === 10 && !g.events.some(e => e.type === 'crash'), JSON.stringify(me.body[0]));
  me.wrapUntil = g.time;
  me.body = line(23, 10, 5).map(([x, y]) => ({ x, y }));
  feed(g); quiet(g);
  check('...for a while', g.events.some(e => e.type === 'crash' && e.snake === me && e.killer === 'wall'));
}

{ // An AI whose edges wrap goes through one when that's the way out.
  // At the right edge heading down: below a hole, left a rival's body, behind its own; right, the edge.
  const g = E.createGame({ withPlayer: false, personas: ['drab', 'drab'] });
  g.snakes = g.snakes.slice(0, 2);
  const [a, b] = g.snakes;
  a.body = [[23, 5], [23, 4], [23, 3], [23, 2], [23, 1]].map(([x, y]) => ({ x, y })); a.dir = D.down; a.wrapUntil = g.time + 5000;
  b.body = Array.from({ length: 9 }, (_, i) => ({ x: 22, y: 12 - i })); b.dir = D.down; // (22,12) up to (22,4)
  b.isPlayer = true; b.persona = null; b.queue = [];
  g.holes.add(K(23, 6));
  g.food = [];
  look(g);
  quiet(g);
  check("an AI whose edges wrap goes through one when that's the way out", a.alive && a.body[0].x === 0 && a.body[0].y === 5 && !g.events.some(e => e.type === 'crash' && e.snake === a), JSON.stringify(a.body[0]));
}

{ // Golden leaps wait for something to hop too, and aren't spent on open ground; one that can't land falls back on the plain leap.
  const g = board([[line(5, 10, 5), 'right'], wall(8, 9)]);
  const me = g.snakes[0];
  me.leaps = 1;
  E.leap(g, me); quiet(g);
  check('a golden leap isn\'t spent on open ground', me.leaps === 1 && !g.events.some(e => e.type === 'leap'));
  const g2 = board([[line(5, 10, 5), 'right'], wall(6), wall(8)]); // (over 6, but 8 is no place to land: the plain leap lands on 7)
  const m2 = g2.snakes[0];
  m2.leaps = 1;
  E.leap(g2, m2); quiet(g2); quiet(g2);
  check('...one that can\'t land falls back on the plain leap', m2.leaps === 1 && m2.alive && m2.body[0].x === 7 && m2.leapReadyAt > g2.time, JSON.stringify(m2.body[0]));
}

{ // In the air: no eating, no catching fire, and nothing arriving under you meets you.
  const g = board([[line(5, 10, 5), 'right'], wall(6), wall(9, 9)], { food: [[7, 10]] }); // (an apple on the golden leap's mid-air cell)
  const me = g.snakes[0];
  me.leaps = 1;
  E.leap(g, me); quiet(g);
  check('in the air, it doesn\'t eat', me.body[0].x === 7 && me.eaten === 0 && g.food.some(f => f.x === 7 && f.y === 10), me.eaten);
  const g2 = board([[line(5, 10, 5), 'right'], [[[5, 20], [4, 20], [3, 20]], 'right']]);
  g2.fires.set(K(6, 10), { from: 0, until: 999, group: 1, strike: false }); g2.fireGroups.set(1, 1);
  E.leap(g2, g2.snakes[0]); quiet(g2); quiet(g2);
  check('...leaps over fire without catching it', g2.snakes[0].body[0].x === 7 && !(g2.snakes[0].burnUntil > g2.tick) && g2.events.length >= 0, g2.snakes[0].burnUntil);
}

{ // A dash crashes into a head, or its own body, like anything it can't cut.
  const g = board([[line(5, 10, 6), 'right'], [[[7, 10], [7, 11], [7, 12], [7, 13], [7, 14]], 'up']]); // (a head in the way)
  E.leap(g, Object.assign(g.snakes[0], { dashes: 1 }));
  quiet(g);
  check('a dash into a head crashes', g.snakes[0].alive && g.snakes[1].alive && g.events.some(e => e.type === 'crash' && e.snake === g.snakes[0]) && !g.events.some(e => e.type === 'cut'));
  const coil = [[5, 10], [5, 11], [6, 11], [7, 11], [7, 10], [7, 9], [6, 9], [5, 9], [4, 9], [3, 9]]; // ((7,10), two ahead, is its own body)
  const g2 = board([[coil, 'right'], [[[5, 20], [4, 20], [3, 20]], 'right']]);
  E.leap(g2, Object.assign(g2.snakes[0], { dashes: 1 }));
  quiet(g2);
  check('...and into its own body', g2.snakes[0].alive && g2.events.some(e => e.type === 'crash' && e.snake === g2.snakes[0] && e.killer === 'self'), JSON.stringify(g2.events.map(e => e.type)));
}

{ // Rain schedules a golden mushroom now and then (and no other weather does).
  const g = board([[line(5, 5, 4), 'right'], [line(5, 15, 4), 'right']]);
  for (const o of g.snakes) o.stunUntil = 1e9;
  let rains = 0, capsInRain = 0, capsElse = 0;
  for (let t = 0; t < 4000; t++) {
    g.time = 0; g.weather = { kind: 'clear', since: 0, until: 0, nextGust: 1e12, nextStrike: 1e12 }; feed(g); quiet(g);
    if (g.weather.kind === 'rain') { rains++; if (g.weather.goldcapAt != null) capsInRain++; } else if (g.weather.goldcapAt != null) capsElse++;
  }
  const rate = capsInRain / rains;
  check('rain schedules a golden mushroom now and then (and nothing else does)', rains > 300 && Math.abs(rate - T.GOLDCAP_CHANCE) < 0.06 && capsElse === 0, `${capsInRain}/${rains} rains, ${capsElse} otherwise`);
}

{ // The woodpecker gets hungrier: each rest shorter than the last, each patch a cell bigger.
  const g = board([[line(3, 2, 3), 'right'], [line(3, 21, 3), 'right']], { time: T.SUDDEN_DEATH_MS });
  for (const o of g.snakes) o.stunUntil = 1e9;
  const pecks = [];
  for (let t = 0; t < 1200 && pecks.length < 6; t++) { feed(g); quiet(g); for (const e of g.events) if (e.type === 'peck') pecks.push({ at: g.tick, n: e.cells.length }); }
  const rests = pecks.slice(1).map((p, i) => p.at - pecks[i].at);
  check('the woodpecker gets hungrier: shorter rests', pecks.length === 6 && rests.every((r, i) => !i || r <= rests[i - 1]) && rests[rests.length - 1] < rests[0], JSON.stringify(rests));
  check('...and bigger patches', pecks[pecks.length - 1].n > T.PECK_CHUNK && pecks[pecks.length - 1].n <= T.PECK_CHUNK_MAX, JSON.stringify(pecks.map(p => p.n)));
}

{ // One golden power at a time: a new one replaces the old.
  const g = board([[line(5, 10, 5), 'right'], [line(5, 20, 3), 'right']], { food: [[6, 10, 'leaf']] });
  g.snakes[0].leaps = 2;
  E.step(g);
  check('one golden power at a time (a leaf for leaps: dashes)', g.snakes[0].dashes === T.DASH_CHARGES && g.snakes[0].leaps === 0);
}

{ // Golden leaves come on the wind, golden mushrooms in the rain, and never otherwise.
  const still = () => {
    const g = board([[line(5, 5, 4), 'right'], [line(5, 15, 4), 'right']]);
    for (const o of g.snakes) o.stunUntil = 1e9; // (nobody moves)
    return g;
  };
  const kinds = (g, kind, ticks) => {
    let n = 0;
    for (let t = 0; t < ticks; t++) { feed(g); E.step(g); n += g.events.filter(e => e.type === 'spawn' && e.kind === kind).length; g.food = g.food.filter(f => f.kind !== kind); }
    return n;
  };
  const wind = still();
  let leaves = 0;
  for (let t = 0; t < 400; t++) { wind.weather = { kind: 'wind', since: 0, until: 1e12, nextGust: 0, nextStrike: 1e12 }; leaves += kinds(wind, 'leaf', 1); }
  const rain = still();
  rain.weather = { kind: 'rain', since: 0, until: 1e12, nextGust: 0, nextStrike: 1e12, goldcapAt: 0 };
  const caps = kinds(rain, 'goldcap', 5);
  let other = 0;
  for (const kind of ['clear', 'sun', 'storm', 'snow', 'rain']) {
    const g = still();
    g.weather = { kind, since: 0, until: 1e12, nextGust: 0, nextStrike: 1e12 };
    other += kinds(g, 'leaf', 300) + (kind === 'rain' ? 0 : kinds(g, 'goldcap', 300));
  }
  check('golden leaves come on the wind', leaves > 5 && leaves < 80, leaves);
  check('...golden mushrooms in the rain', caps === 1, caps);
  check('...and never otherwise', other === 0, other);
}

{ // Two heads that meet in an empty cell bounce, and don't go for it (or each other) again when the stun's over.
  for (const [a0, a1, label] of [[['right', 10, 10], ['left', 12, 10], 'face to face'], [['down', 16, 15], ['right', 15, 16], 'across a corner']]) {
    const mk = ([dir, x, y]) => [Array.from({ length: 8 }, (_, i) => [x - D[dir].x * i, y - D[dir].y * i]), dir];
    const g = board([mk(a0), mk(a1)]);
    let headOns = 0;
    for (let t = 0; t < 1 + T.STUN_TICKS + 4; t++) { feed(g); for (const o of g.snakes) o.queue = []; E.step(g); headOns += g.events.filter(e => e.type === 'crash' && e.cause.startsWith('crashed head-on')).length; }
    check(`heads that meet (${label}) bounce once, not again and again`, headOns === 2 && g.snakes.every(o => o.alive), `${headOns / 2} head-ons`);
  }
}

{ // Head-on, both boxed in: the longer bounces, the shorter's out; the same length, both out.
  // A heads right into (6,5), boxed by its own coils above and below; B heads left into it, boxed the same way.
  const A = [[5, 5], [4, 5], [4, 6], [5, 6], [6, 6], [6, 7], [5, 7], [4, 7], [3, 7], [3, 6], [3, 5], [3, 4], [4, 4], [5, 4], [5, 3], [5, 2], [5, 1], [5, 0]];
  const B = [[7, 5], [8, 5], [8, 4], [7, 4], [7, 3], [8, 3], [9, 3], [9, 4], [9, 5], [9, 6], [8, 6], [7, 6], [7, 7], [8, 7], [9, 7], [9, 8], [9, 9], [9, 10]];
  const g = board([[A, 'right'], [B.slice(0, 16), 'left']]);
  const dying = E.step(g);
  check('head-on, both boxed in: the longer bounces', g.snakes[0].alive && g.snakes[0].stunUntil > g.tick, g.snakes[0].cause);
  check('...and the shorter is out', dying.includes(g.snakes[1]) && g.snakes[1].cause.startsWith('crashed head-on'), g.snakes[1].cause);
  const g2 = board([[A, 'right'], [B, 'left']]);
  check('...the same length: both out', E.step(g2).length === 2);
  // Against one at its smallest (out anyway), the long one bounces too.
  const g3 = board([[A, 'right'], [[[7, 5], [8, 5], [9, 5]], 'left']]);
  const d3 = E.step(g3);
  check('...and against one at its smallest', g3.snakes[0].alive && d3.includes(g3.snakes[1]), g3.snakes[0].cause);
}

{ // Head-on where only one is boxed in: the other has room of its own and turns away, so the cell they met in is the boxed one's way out.
  const A = [[10, 10], [9, 10], [9, 9], [10, 9], [11, 9], [11, 8], [10, 8], [9, 8], [8, 8], [8, 9], [8, 10], [8, 11], [9, 11], [10, 11], [11, 11], [11, 12], [11, 13], [11, 14], [11, 15]];
  const g = board([[A, 'right'], [[[12, 10], [13, 10], [14, 10], [15, 10], [16, 10]], 'left']]);
  const [a, b] = g.snakes;
  const dying = E.step(g);
  check('head-on, only one boxed in: both bounce', !dying.length && a.alive && b.alive && a.stunUntil > g.tick && b.stunUntil > g.tick, a.cause);
  for (let t = 0; t < T.STUN_TICKS + 1; t++) { feed(g); E.step(g); }
  check('...the other turns away, the boxed one takes the cell they met in', a.alive && b.alive && a.body[0].x === 11 && a.body[0].y === 10 && b.body[0].x === 12 && b.body[0].y !== 10, JSON.stringify([a.body[0], b.body[0]]));
}

{ // After a head-on, the longer one may go back into the cell they met in (the other may not): it isn't turned into a dead end.
  const A = [[10, 10], [9, 10], [8, 10], [8, 11], [9, 11], [10, 11], [11, 11], [11, 12], [11, 13], [11, 14], [11, 15], [11, 16]];
  const g = board([[A, 'right'], [[[12, 10], [13, 10], [14, 10], [15, 10], [16, 10]], 'left']]);
  for (const [x, y] of [[10, 8], [9, 9], [11, 9]]) g.holes.add(K(x, y)); // ((10,9), above A's head: a dead end)
  const [a, b] = g.snakes;
  E.step(g);
  let again = 0;
  for (let t = 0; t < T.STUN_TICKS + 1; t++) { feed(g); E.step(g); again += g.events.filter(e => e.type === 'crash').length; }
  check('after a head-on the longer one takes the cell they met in, not a dead end', a.alive && b.alive && !again && a.body[0].x === 11 && a.body[0].y === 10 && b.body[0].x === 12 && b.body[0].y !== 10, JSON.stringify([a.body[0], b.body[0]]));
}

{ // An AI doesn't chase an apple that'll have rotted before it gets there.
  const g = E.createGame({ withPlayer: false, personas: ['gobbler', 'drab'] });
  g.snakes = g.snakes.slice(0, 2);
  const [a, b] = g.snakes;
  a.body = line(5, 10, 4).map(([x, y]) => ({ x, y })); a.dir = D.right;
  b.body = line(20, 22, 4).map(([x, y]) => ({ x, y })); b.dir = D.right;
  g.food = [{ x: 5, y: 4, kind: 'food', expires: g.tick + 3 }, { x: 5, y: 17, kind: 'food', expires: g.tick + 999 }];
  g.history = [{ snakes: g.snakes.map(o => ({ id: o.id, body: o.body.map(c => ({ ...c })), dir: o.dir, stun: 0, leaps: 0 })), food: g.food.map(f => ({ ...f })), holes: 0, fires: [], pecks: [] }]; // (what it sees: the board as built)
  E.step(g);
  check("an AI skips an apple that'll rot before it gets there", a.body[0].x === 5 && a.body[0].y === 11, JSON.stringify(a.body[0]));
}

{ // Boxed in only if there'll be nowhere to turn when the stun's over: a rival's tail moving on in time counts as room.
  // A hits the right edge at (23,5): below is its own body, above a rival's body that's leaving.
  const A = [[23, 5], [22, 5], [22, 6], [23, 6], [23, 7], [23, 8], [23, 9], [23, 10], [23, 11]];
  const near = [[19, 4], [20, 4], [21, 4], [22, 4], [23, 4], [23, 3], [23, 2]];                      // (23,4) is left in 3 ticks
  const just = [[19, 4], [20, 4], [21, 4], [22, 4], [23, 4], [23, 3], [23, 2], [23, 1], [23, 0], [22, 0]]; // ...in 6: the tick A moves again
  const late = [...just, [21, 0]];                                                                       // ...in 7: too late
  const g = board([[A, 'right'], [near, 'left']]);
  check('a rival\'s tail moving on before the stun ends counts as room', !E.step(g).includes(g.snakes[0]) && g.snakes[0].alive);
  const g1 = board([[A, 'right'], [just, 'left']]);
  check('...even on the very tick it moves again', !E.step(g1).includes(g1.snakes[0]));
  const g2 = board([[A, 'right'], [late, 'left']]);
  check('...one that won\'t, doesn\'t', E.step(g2).includes(g2.snakes[0]));
  // Its own tail breaking off can open the way too: coiled so the cell above is its own tail end.
  const coiled = [[23, 5], [22, 5], [22, 6], [23, 6], [23, 7], [22, 7], [21, 7], [21, 6], [21, 5], [21, 4], [22, 4], [23, 4]];
  const g3 = board([[coiled, 'right'], [[[5, 20], [4, 20], [3, 20]], 'right']]);
  check('...and so does its own tail breaking off', !E.step(g3).includes(g3.snakes[0]));
  // The cell it ran into counts too, if that tail's gone by then (heading up into (23,4): a hole to its left, the edge to its right).
  const up = [[23, 5], [23, 6], [23, 7], [23, 8], [23, 9], [23, 10], [23, 11]];
  const g4 = board([[up, 'up'], [near, 'left']]);
  g4.holes.add(K(22, 5));
  check('...and so does the tail it ran into', !E.step(g4).includes(g4.snakes[0]), g4.snakes[0].cause);
  // A rival that crashes this tick too: the tail that breaks off it is room at once (it's food).
  const R = [[19, 3], [20, 3], [21, 3], [22, 3], [23, 3], [23, 4], [22, 4]]; // ((23,4) is its sixth cell; a hole ahead of it)
  const g5 = board([[A, 'right'], [R, 'left']]);
  g5.holes.add(K(18, 3));
  check('...and so does a rival\'s tail breaking off in a crash', !E.step(g5).includes(g5.snakes[0]), g5.snakes[0].cause);
  const g6 = board([[A, 'right'], [R, 'left']]);
  g6.snakes[1].stunUntil = 50; // (stunned, not crashing: its tail stays)
  check('...not a stunned one\'s', E.step(g6).includes(g6.snakes[0]));
}

{ // Winter is the lean season: one apple, rotting twice as fast, and no golden apples.
  const g = board([[line(5, 5, 4), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g.weather = { kind: 'snow', since: 0, until: 1e9, nextGust: 0, nextStrike: 0 };
  g.food = [];
  let golden = 0;
  for (let t = 0; t < 400; t++) { feed(g); for (const o of g.snakes) o.queue = [t % 8 < 4 ? D.down : D.up]; E.step(g); golden += g.food.filter(f => f.kind === 'golden').length; if (t === 2) break; }
  const apple = g.food.find(f => f.kind === 'food');
  check('winter: one apple', g.food.filter(f => f.kind === 'food').length === T.SNOW_APPLES && T.SNOW_APPLES === 1);
  const left = apple.expires - g.tick;
  feed(g); E.step(g);
  check('...rotting twice as fast', apple.expires - g.tick === left - 2, `${left} then ${apple.expires - g.tick}`);
  // (Nobody moves, for a long while, the clock held back so sudden death never comes: in clear weather golden apples come; in winter, none.)
  const goldens = kind => {
    const g2 = board([[line(5, 5, 4), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
    for (const o of g2.snakes) o.stunUntil = 1e9;
    let n = 0;
    for (let t = 0; t < 3000; t++) { g2.time = 0; g2.weather = { kind, since: 0, until: 1e12, nextGust: 1e12, nextStrike: 1e12 }; feed(g2); E.step(g2); n += g2.events.filter(e => e.type === 'spawn' && e.kind === 'golden').length; g2.food = g2.food.filter(f => f.kind !== 'golden'); }
    return n;
  };
  golden = goldens('snow');
  const clear = goldens('clear');
  check('...and no golden apples', golden === 0 && clear > 3, `${golden} in winter, ${clear} in clear weather`);
}

{ // Steering while stunned: it goes your way when the stun's over.
  const g = board([[line(23, 5, 8), 'right'], [line(5, 20, 3), 'right']]);
  const s = g.snakes[0];
  E.step(g);
  s.queue = [D.up];
  for (let t = 0; t <= T.STUN_TICKS; t++) { feed(g); E.step(g); }
  check('a stunned snake can steer for when it moves again', s.dir === D.up && s.body[0].y === 4, JSON.stringify(s.body[0]));
}

{ // At its smallest, a crash is the end; and so is a crash with nowhere to turn.
  const g = board([[line(23, 5, 3), 'right'], [line(5, 20, 3), 'right']]);
  check('a crash at the smallest size is the end', E.step(g).includes(g.snakes[0]));
  // In the top-right corner, facing the edge, its own body wrapped round it: nowhere to go.
  const g2 = board([[[[23, 0], [22, 0], [22, 1], [23, 1], [23, 2], [22, 2], [21, 2], [21, 1], [21, 0]], 'up'], [line(5, 20, 3), 'right']]);
  const dying = E.step(g2);
  check('a crash with nowhere to turn is the end', dying.includes(g2.snakes[0]) && g2.snakes[0].killer === 'wall', g2.snakes[0].cause);
}

{ // Into a long rival's body: the one who ran into it pays; the rival's fine.
  const g = board([[line(5, 6, 6), 'right'], [[[6, 9], [6, 8], [6, 7], [6, 6], [6, 5], [6, 4]], 'down']]);
  E.step(g);
  const [a, b] = g.snakes;
  check('running into a body costs you, not them', a.alive && a.body.length === 3 && b.alive && b.body.length === 6 && b.body[0].y === 10, `${a.body.length} / ${b.body.length}`);
}

{ // A crashed snake's tail doesn't move, so a head heading for it crashes too.
  // P0 hits the edge going right along row 5; P1 comes down column 18 into P0's tail cell (18, 5).
  const g = board([[line(23, 5, 6), 'right'], [[[18, 4], [18, 3], [18, 2]], 'down']]);
  const dying = E.step(g);
  const p1 = g.snakes[1];
  check("a crashed snake's tail stays put, and is in the way", dying.includes(p1) && p1.cause === 'ran into P0', p1.cause);
}

{ // A snake out of time reaches food on the very tick: it eats instead of starving.
  const g = board([[[[5, 5], [4, 5], [3, 5]], 'right'], [[[15, 15], [14, 15], [13, 15]], 'right']], { food: [[6, 5]] });
  const s = g.snakes[0];
  s.nextStarve = 0; s.lastAte = -T.HUNGER_MS; // overdue, at minimum length
  const dying = E.step(g);
  check('reaching food saves a starving snake', s.alive && !dying.includes(s) && s.eaten === 1);
  const g2 = board([[[[5, 5], [4, 5], [3, 5]], 'right'], [[[15, 15], [14, 15], [13, 15]], 'right']]);
  g2.snakes[0].nextStarve = 0;
  check('without food it starves', E.step(g2).some(d => d.killer === 'hunger'));
}

{ // People can't take the names that mean walls, self-bites and hunger.
  const g = E.createGame({ humans: [{ name: 'wall' }, { name: 'self' }, { name: 'hunger' }] });
  check('reserved names are made unique', g.snakes.slice(0, 3).every(s => !['wall', 'self', 'hunger'].includes(s.name)), g.snakes.map(s => s.name).join(', '));
  check('unknown and inherited persona keys are ignored', E.createGame({ personas: ['constructor', 'toString', 'drab'], withPlayer: false }).snakes.every(s => s.color));
}

{ // The woodpecker aims at patches clear of everyone (while there's room), and warns before it strikes.
  let near = 0, early = 0, underBody = 0, underFood = 0, strikes = 0, cells = 0;
  for (let r = 0; r < 12; r++) {
    const g = E.createGame({ withPlayer: false });
    g.time = T.SUDDEN_DEATH_MS;
    for (const s of g.snakes) { s.lastAte = g.time; s.nextStarve = g.time + T.HUNGER_MS; } // (fed, so they last)
    let aimedAt = -1;
    for (let t = 0; t < 500 && g.snakes.filter(s => s.alive).length > 1; t++) {
      const foodCells = new Set(g.food.map(f => f.y * T.GRID + f.x));
      E.step(g);
      const heads = g.snakes.filter(s => s.alive).map(s => s.body[0]); // (as they were when it took aim)
      const bodies = new Set(g.snakes.filter(s => s.alive).flatMap(s => s.body.map(c => c.y * T.GRID + c.x)));
      for (const e of g.events) {
        if (e.type === 'aim') {
          aimedAt = g.tick;
          for (const k of g.woodpecker.target) {
            if (heads.some(h => Math.abs(h.x - k % T.GRID) + Math.abs(h.y - Math.floor(k / T.GRID)) <= T.PECK_CLEARANCE)) near++;
            if (foodCells.has(k)) underFood++;
            if (bodies.has(k)) underBody++;
          }
        }
        if (e.type === 'peck') {
          strikes++;
          cells += e.cells.length;
          if (g.tick - aimedAt < T.PECK_AIM_TICKS) early++;
        }
      }
    }
  }
  check('the woodpecker strikes in patches', strikes > 20 && cells / strikes > T.PECK_CHUNK / 2, `${strikes} strikes, ${(cells / Math.max(1, strikes)).toFixed(1)} cells each`);
  check('the woodpecker aims well away from heads', near === 0, `${near} cells too close`);
  check('the woodpecker gives warning', early === 0, `${early} without`);
  check('the woodpecker aims clear of bodies and food', underBody + underFood === 0, `${underBody} bodies, ${underFood} food`);
}

{ // Whatever's in the patch when it strikes goes: a body there is cut (its tail falls off as food), a head there is out.
  const g = board([[line(12, 10, 9), 'right'], [line(12, 16, 4), 'right']]);
  g.time = T.SUDDEN_DEATH_MS;
  feed(g);
  // P0 (head at 12,10, nine long) has its fifth segment on (8, 10); P1's head and neck sit in the patch below.
  g.woodpecker = { x: 8, y: 10, at: g.time, target: [K(8, 10), K(8, 9), K(8, 11), K(13, 16), K(12, 16)], strikeAt: g.tick, last: [], struckAt: -1, restUntil: 0 };
  for (const o of g.snakes) o.queue = [D.up];
  const dying = E.step(g);
  const [a, b] = g.snakes;
  check('the woodpecker cuts a body in its patch', a.alive && a.body.length === 5 && g.events.some(e => e.type === 'cut' && e.snake === a), a.body.length);
  check('...and the tail behind the cut falls off as food', [[7, 10], [6, 10], [5, 10]].every(([x, y]) => g.food.some(f => f.kind === 'pellet' && f.x === x && f.y === y)), JSON.stringify(g.food.filter(f => f.kind === 'pellet')));
  check('...a head in its patch is out', dying.includes(b) && b.cause === 'fell into a woodpecker hole', b.cause);
}

{ // An AI sees a new hole only after its reaction time, like a person.
  const g = E.createGame({ withPlayer: false });
  for (let t = 0; t < 10; t++) E.step(g);
  const k = 12 * T.GRID + 12;
  g.holes.add(k);
  E.step(g);
  const seen = () => { const o = g.snakes.find(s => s.alive); return o ? E.aiView(g, o).holes.has(k) : true; };
  const early = seen();
  for (let t = 0; t < 8; t++) E.step(g);
  check('holes reach the AI with its reaction delay', !early && seen(), `at once: ${early}`);
}

{ // Boxed in, an AI prefers a cell a rival may have left over a wall or its own body.
  // Me heading up along the left wall at (0, 5); above is a rival's old tail cell, right is my body.
  const view = {
    grid: T.GRID,
    me: { id: 0, body: [{ x: 0, y: 5 }, { x: 0, y: 6 }, { x: 1, y: 6 }, { x: 1, y: 5 }, { x: 1, y: 4 }], dir: D.up, grow: 0, hungerLeft: 99999 },
    others: [{ id: 1, body: [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }], dir: D.right }],
    food: [], holes: new Set(), age: 2, tick: 10, timeMs: 1000,
  };
  const picks = {};
  for (let i = 0; i < 200; i++) { const d = AI.decide(view, AI.PERSONAS.drab, {}); const n = Object.keys(D).find(k => D[k] === d); picks[n] = (picks[n] || 0) + 1; }
  check('a cornered AI takes the cell that may be free', picks.up === 200, JSON.stringify(picks));
}

// ---------------------------------------------------------------- fire, weather and burrows


{ // Crawling into fire sets you alight: a segment lost every so often, roasted, until it goes out; smouldering bark doesn't.
  const g = board([[line(9, 5, 10), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g.fires.set(K(10, 5), { from: 0, until: 3, group: 1, strike: true });
  g.fires.set(K(6, 15), { from: 5, until: 100, group: 2, strike: false });
  g.fireGroups.set(1, 99); g.fireGroups.set(2, 99); // (no spreading)
  const s = g.snakes[0];
  E.step(g);
  check('a head that crawls into fire catches alight', s.alive && s.burnUntil > g.tick && g.events.some(e => e.type === 'alight' && e.snake === s));
  check('smouldering bark is still safe', g.snakes[1].alive && !(g.snakes[1].burnUntil > g.tick));
  // (round and round a square, away from the fire)
  const loop = 'DDDDLLLLUUUURRRR', way = c => ({ D: D.down, L: D.left, U: D.up, R: D.right })[c];
  let singed = 0, roasted = false;
  for (let t = 0; t < T.BURN_TICKS + 2; t++) { feed(g); g.food = []; for (const o of g.snakes) o.queue = [way(loop[t % 16])]; E.step(g); singed += g.events.filter(e => e.type === 'singe').length; roasted ||= g.food.some(f => f.kind === 'pellet' && f.cooked); }
  check('...it loses segments while it burns', singed === Math.floor(T.BURN_TICKS / T.BURN_EVERY) && s.body.length === 10 - singed, `${singed} singes, ${s.body.length} long`);
  check('...which fall off roasted', roasted);
  check('...and then it goes out', !(s.burnUntil > g.tick));
  // At its smallest, the flames finish it.
  const g2 = board([[line(5, 5, 3), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g2.fires.set(K(6, 5), { from: 0, until: 100, group: 1, strike: true });
  const dead = [];
  for (let t = 0; t < T.BURN_EVERY + 1; t++) { feed(g2); g2.food = []; if (t) g2.snakes[0].queue = [D.down]; dead.push(...E.step(g2)); }
  check('...at its smallest, it burns up', dead.includes(g2.snakes[0]) && g2.snakes[0].killer === 'fire', g2.snakes[0].cause);
  // Rain puts a burning snake out sooner.
  const g3 = board([[line(9, 5, 10), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g3.fires.set(K(10, 5), { from: 0, until: 100, group: 1, strike: true });
  g3.weather = { kind: 'rain', since: 0, until: 1e9, nextGust: 0, nextStrike: 0 };
  E.step(g3);
  for (let t = 0; t < T.BURN_RAIN_TICKS + 1; t++) { feed(g3); g3.snakes[0].queue = [D.down]; E.step(g3); }
  check('...rain puts it out sooner', !(g3.snakes[0].burnUntil > g3.tick));
}

{ // Food in the fire bakes (worth more), then goes to ash.
  const g = board([[line(5, 5, 3), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']], { food: [[18, 3]] });
  g.fires.set(K(18, 3), { from: 0, until: 999, group: 1, strike: false });
  g.fireGroups.set(1, 99); // (it doesn't spread)
  const apple = g.food.find(f => f.x === 18 && f.y === 3);
  let baked = false, ash = false;
  for (let t = 0; t < T.ASH_TICKS + 2; t++) {
    feed(g);
    for (const o of g.snakes) o.queue = [t % 2 ? D.right : D.down];
    E.step(g);
    if (g.events.some(e => e.type === 'baked' && e.x === 18)) baked = apple.cooked === 1;
    if (g.events.some(e => e.type === 'ash' && e.x === 18)) ash = !g.food.includes(apple);
  }
  check('an apple in the fire bakes', baked);
  check('...and burns to ash if it stays in', ash);
  const g2 = board([[line(5, 5, 3), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g2.food = [{ x: 6, y: 5, kind: 'food', cooked: 1 }];
  E.step(g2);
  check('a baked apple is worth two', g2.snakes[0].eaten === T.COOKED_GROWTH, g2.snakes[0].eaten);
}

{ // Apples rot away (and another drops somewhere).
  const g = board([[line(5, 5, 3), 'right'], [[[5, 15], [4, 15], [3, 15]], 'right']]);
  g.food = [];
  E.step(g);
  const apples = g.food.filter(f => f.kind === 'food');
  check('apples come with a time to rot', apples.length === T.APPLES && apples.every(f => f.expires > g.tick && f.expires <= g.tick + T.APPLE_TICKS * 1.25 + 1), JSON.stringify(apples.map(f => f.expires)));
  const first = apples[0];
  first.expires = g.tick + 1;
  let rotted = false;
  for (let t = 0; t < 3; t++) { feed(g); for (const o of g.snakes) o.queue = [t % 2 ? D.down : D.right]; E.step(g); rotted ||= g.events.some(e => e.type === 'rot' && e.x === first.x && e.y === first.y); }
  check('...rot away', rotted && !g.food.includes(first));
  check('...and another drops', g.food.filter(f => f.kind === 'food').length === T.APPLES);
}

{ // Lightning never lands near a head, crackles first, and only then burns.
  let near = 0, early = 0, strikes = 0;
  for (let r = 0; r < 30; r++) {
    const g = E.createGame({ withPlayer: false });
    g.time = 50000;
    g.weather = { kind: 'storm', since: 50000, until: 1e9, nextGust: 0, nextStrike: 0 };
    for (let t = 0; t < 120 && g.snakes.some(s => s.alive); t++) {
      E.step(g);
      const heads = g.snakes.filter(s => s.alive).map(s => s.body[0]); // (where they were when the lightning chose its spot)
      for (const e of g.events) {
        if (e.type === 'charge') {
          strikes++;
          if (heads.some(h => Math.abs(h.x - e.x) + Math.abs(h.y - e.y) <= T.STRIKE_CLEARANCE)) near++;
          const f = g.fires.get(K(e.x, e.y));
          if (!f || f.from - g.tick < T.STRIKE_WARN_TICKS - 1) early++;
        }
      }
    }
  }
  check('storms strike', strikes > 20, `${strikes} strikes`);
  check('lightning keeps its distance from heads', near === 0, `${near} too close`);
  check('lightning crackles before it burns', early === 0, `${early} without warning`);
}

{ // Fire reaches an AI with its reaction delay, and then it keeps out like it keeps out of holes.
  const g = E.createGame({ withPlayer: false });
  const s = g.snakes[0];
  for (let t = 0; t < 3; t++) E.step(g);
  const k = K(12, 12);
  g.fires.set(k, { from: g.tick, until: g.tick + 99, group: 9, strike: true });
  check('fire is unseen at first', !E.aiView(g, s).holes.has(k));
  for (let t = 0; t < 8; t++) { g.snakes.forEach(o => { o.body = o.body.slice(0, 3); }); E.step(g); if (!g.fires.has(k)) g.fires.set(k, { from: 0, until: g.tick + 99, group: 9, strike: false }); }
  check('fire reaches the AI after its reaction time', E.aiView(g, g.snakes.find(o => o.alive)).holes.has(k));
}

{ // Rain puts fire out, and the sky clears for the woodpecker.
  const g = E.createGame({ withPlayer: false });
  g.fires.set(K(1, 1), { from: 0, until: 500, group: 1, strike: true });
  g.weather = { kind: 'rain', since: 0, until: 1e9, nextGust: 0, nextStrike: 0 };
  for (let t = 0; t < T.RAIN_DOUSE_TICKS + 2; t++) E.step(g);
  check('rain puts fire out', !g.fires.has(K(1, 1)));
  g.time = T.SUDDEN_DEATH_MS;
  E.step(g);
  check('the sky clears for the woodpecker', g.weather.kind === 'clear', g.weather.kind);
}

{ // Winter: snow puts fire out, there's less food, and hunger runs faster.
  const g = E.createGame({ withPlayer: false });
  g.fires.set(K(1, 1), { from: 0, until: 500, group: 1, strike: true });
  g.weather = { kind: 'snow', since: 0, until: 1e9, nextGust: 0, nextStrike: 0 };
  g.food = g.food.filter(f => f.kind !== 'food');
  const before = g.snakes.map(s => E.hungerLeft(g, s));
  for (let t = 0; t < 10; t++) E.step(g);
  // (Measured on a snake that ate nothing meanwhile: a bite resets the clock.)
  const s = g.snakes.find(o => o.ateTick < 0) || g.snakes[0];
  const ran = before[g.snakes.indexOf(s)] - E.hungerLeft(g, s);
  check('snow puts fire out', !g.fires.has(K(1, 1)));
  check('winter brings fewer apples', g.food.filter(f => f.kind === 'food').length <= T.SNOW_APPLES, g.food.filter(f => f.kind === 'food').length + ' apples');
  check('hunger runs faster in winter', !s.alive || ran > g.time * 1.3 * (10 / 11), `${Math.round(ran)} ms of hunger in ${Math.round(g.time)} ms`);
}

{ // Wind blows burning leaves downwind; they smoulder first, then burn small, and don't spread.
  let embers = 0, upwind = 0, early = 0, spread = 0;
  for (let r = 0; r < 40; r++) {
    const g = board([[[[2, 2], [1, 2], [0, 2]], 'right'], [[[2, 20], [1, 20], [0, 20]], 'right']]);
    g.weather = { kind: 'wind', since: 0, until: 1e9, nextGust: 1e9, nextStrike: 0 };
    g.fires.set(K(8, 10), { from: 0, until: 400, group: 1, strike: false });
    g.fireGroups.set(1, 1);
    g.fireGroup = 1; // (its own group: leaves start their own)
    for (let t = 0; t < 120; t++) {
      for (const s of g.snakes) { s.lastAte = g.time; s.nextStarve = g.time + T.HUNGER_MS; s.body = s.body.slice(0, 3); }
      E.step(g);
      for (const e of g.events) {
        if (e.type !== 'ember') continue;
        embers++;
        if (e.x <= e.fx + 1) upwind++;
        const f = g.fires.get(K(e.x, e.y));
        if (!f || f.from - g.tick < T.EMBER_SMOLDER_TICKS) early++;
      }
      for (const f of g.fires.values()) if (f.ember && (g.fireGroups.get(f.group) || 0) > 1) spread++;
    }
  }
  check('wind blows burning leaves', embers > 5, `${embers} leaves`);
  check('...downwind', upwind === 0, `${upwind} upwind`);
  check('...that smoulder first', early === 0, `${early} without warning`);
  check('...and burn small, without spreading', spread === 0, `${spread} spread`);
}

{ // A scared beetle on a burrow dives in and comes out of a burrow a while later; food never sits on a burrow.
  const g = board([[[[10, 5], [9, 5], [8, 5]], 'right'], [[[20, 20], [19, 20], [18, 20]], 'left']]);
  g.burrows = [{ x: 12, y: 6, at: 0 }, { x: 2, y: 20, at: 0 }];
  g.food = [{ x: 11, y: 6, kind: 'beetle', expires: 999, dir: D.right, movedAt: -10 }];
  let dived = false, emerged = null;
  for (let t = 0; t < 40; t++) {
    E.step(g);
    for (const e of g.events) { if (e.type === 'dive') dived = true; if (e.type === 'emerge') emerged = e; }
    if (g.food.some(f => f.kind !== 'beetle' && g.burrows.some(b => b.x === f.x && b.y === f.y))) break;
  }
  check('a scared beetle dives into its burrow', dived);
  check('...and comes out of the other one', emerged && emerged.x === 2 && emerged.y === 20, JSON.stringify(emerged));
  check('nothing grows on a burrow', !g.food.some(f => f.kind !== 'beetle' && g.burrows.some(b => b.x === f.x && b.y === f.y)));
}

console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
