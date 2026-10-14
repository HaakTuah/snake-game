#!/usr/bin/env node
// Checks the online protocol: plays rounds on a "host" game, sends every tick
// through JSON to a "guest" game, and checks after every tick that the guest
// sees exactly the host's board (bodies, food, holes, the woodpecker, deaths).
// Every message must fit PeerJS's 16 KB limit, and a guest must shrug off a
// malformed one.
//
//   node tools/online-test.js [rounds]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ window: {}, console, Math });
for (const f of ['tuning.js', 'ai.js', 'engine.js', 'records.js', 'online.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { SnakeEngine: E, SnakeOnline: O, SnakeRecords: Rec } = ctx.window;
const rounds = Number(process.argv[2]) || 20;
// What a data channel would deliver (PeerJS refuses JSON messages of 16,300 bytes or more).
const LIMIT = 16000;
let biggest = 0;
const wire = msg => {
  const text = JSON.stringify(msg);
  biggest = Math.max(biggest, text.length);
  if (text.length >= LIMIT) { console.error(`a ${msg.t} message is ${text.length} bytes`); process.exit(1); }
  return JSON.parse(text);
};

let ticks = 0, checks = 0;
const fail = (round, tick, what, a, b) => {
  console.error(`round ${round}, tick ${tick}: ${what} differs\n  host:  ${JSON.stringify(a)}\n  guest: ${JSON.stringify(b)}`);
  process.exit(1);
};
const same = (round, tick, what, a, b) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(round, tick, what, a, b);
};

for (let r = 0; r < rounds; r++) {
  // Two to four people, the rest AI; names that clash with rivals get numbered.
  const people = 2 + (r % 3);
  const humans = Array.from({ length: people }, (_, i) => ({ name: i === 1 ? 'Sniper' : `Friend ${i}`, color: O.HUMAN_COLORS[i], peer: `p${i}` }));
  const host = E.createGame({ humans });
  // People steer like an AI would (so rounds last), through their input queues.
  for (const s of host.snakes) if (s.isPlayer) s.autopilot = E.PERSONAS.drab;

  const roundMsg = wire(O.round(host, humans, 'Up the tree with you:'));
  const guest = E.createGame({ humans: roundMsg.humans, personas: roundMsg.personas });
  O.apply(guest, roundMsg.first, E.DIRS);
  same(r, 0, 'names', host.snakes.map(s => s.name), guest.snakes.map(s => s.name));

  let holesSent = 0;
  while (host.snakes.filter(s => s.alive).length > 1 && host.time < 400000) {
    const dyingHost = E.step(host);
    const msg = wire(O.tick(host, { holesFrom: holesSent, tickLen: E.tickMs(host) }));
    holesSent = host.holes.size;
    const dyingGuest = O.apply(guest, msg, E.DIRS);
    ticks++;
    const k = host.tick;
    same(r, k, 'tick/time', [host.tick, host.time], [guest.tick, guest.time]);
    same(r, k, 'bodies', host.snakes.map(s => s.alive ? s.body : null), guest.snakes.map(s => s.alive ? s.body : null));
    same(r, k, 'alive', host.snakes.map(s => s.alive), guest.snakes.map(s => s.alive));
    same(r, k, 'dirs', host.snakes.map(s => s.dir), guest.snakes.map(s => s.dir));
    same(r, k, 'hunger', host.snakes.map(s => [s.eaten, s.lastAte, s.nextStarve]), guest.snakes.map(s => [s.eaten, s.lastAte, s.nextStarve]));
    const powers = g => g.snakes.map(s => [s.stunUntil, s.burnUntil, s.burnFrom, s.leaps, s.leapArmed, s.dashes, s.leapReadyAt, s.wrapUntil, s.flight ? s.flight.dir : null]);
    same(r, k, 'stuns, burns and powers', powers(host), powers(guest));
    const food = g => g.food.map(f => [f.x, f.y, f.kind, f.expires, f.color, f.dir && f.kind === 'beetle' ? f.dir : null, f.px ?? null, f.py ?? null, f.movedAt ?? null, !!f.scared, f.heat || 0, !!f.cooked, !!f.gold]);
    same(r, k, 'food', food(host), food(guest));
    same(r, k, 'holes', [...host.holes], [...guest.holes]);
    same(r, k, 'woodpecker', host.woodpecker, guest.woodpecker);
    same(r, k, 'burrows', host.burrows, guest.burrows);
    same(r, k, 'fire', [...host.fires].map(([c, f]) => [c, f.from, f.until, f.strike, f.group, !!f.ember]), [...guest.fires].map(([c, f]) => [c, f.from, f.until, f.strike, f.group, !!f.ember]));
    same(r, k, 'weather', [host.weather.kind, host.weather.since, host.weather.until], [guest.weather.kind, guest.weather.since, guest.weather.until]);
    same(r, k, 'deaths', dyingHost.map(s => [s.id, s.cause, s.killer, s.killerId]), dyingGuest.map(s => [s.id, s.cause, s.killer, s.killerId]));
    const ev = g => g.events.map(e => [e.type, e.snake?.id, e.kind, e.x, e.y, e.gold ? 1 : 0, e.reach ?? null, e.n ?? null, e.by ?? null]); // (powers' payloads too)
    same(r, k, 'events', ev(host), ev(guest));
    const look = g => g.snakes.map(s => ['home', 'colonies', 'mood', 'moodChangedAt', 'modelId'].map(f => s.memory[f] ?? null));
    same(r, k, 'looks', look(host), look(guest));
  }
}

// The biggest scores message: four people, each with ten rounds under long names.
const owner = i => 'owner' + i + 'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 28);
const rows = i => Array.from({ length: 12 }, (_, n) => ({
  id: 'id' + n + 'x'.repeat(40), name: 'Ünïcødé Ñame ' + i + n + '😀', place: 1 + (n % 4), won: n % 4 === 0, draw: false,
  eaten: 99 + n, survived: 123456 + n, date: Date.now() - n * 1000, round: 'ROUND' + n + 'y'.repeat(40), owner: owner(i),
}));
wire({ t: 'scores', from: [0, 1, 2, 3].map(i => ({ color: O.HUMAN_COLORS[i], entries: Rec.cleanShared(rows(i), owner(i)) })) });
if (Rec.cleanShared(rows(0), owner(1)).length) { console.error("a friend's rows can't speak for someone else"); process.exit(1); }

// A malformed tick from a modified host: odd memory is ignored, nothing throws.
const g = E.createGame({ humans: [{ name: 'A', color: O.HUMAN_COLORS[0], peer: 'p0' }] });
const bad = wire(O.tick(g, { holesFrom: 0, tickLen: 120 }));
bad.s[1][6] = { mood: 'constructor', colonies: 'not a list', home: 5, victimId: 'x' };
O.apply(g, bad, E.DIRS);
if (g.snakes[1].memory.mood || g.snakes[1].memory.colonies || g.snakes[1].memory.home || g.snakes[1].memory.victimId) { console.error('malformed memory got through'); process.exit(1); }

console.log(`ok: ${rounds} rounds, ${ticks} ticks, ${checks} checks, guest matched the host every tick; biggest message ${biggest} bytes`);
