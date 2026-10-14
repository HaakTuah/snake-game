// The game controller: the loop, input, the cards and the HUD. The rules live
// in engine.js, the drawing in render.js, and every feel number in tuning.js.
(() => {
  const T = window.TUNING;
  const E = window.SnakeEngine;
  const { GRID, PLAYER_COLOR, PERSONAS, DIRS } = E;
  const R = window.SnakeRender;
  const Records = window.SnakeRecords;
  const Chatter = window.SnakeChatter;
  const Audio = window.SnakeAudio;
  const Online = window.SnakeOnline;
  const Net = window.SnakeNet;

  // --------------------------------------------------------------- the DOM

  const $ = id => document.getElementById(id);
  const canvas = $('game'), boardEl = document.querySelector('.board'), mainEl = document.querySelector('main'), glowEl = $('frame-glow');
  const scoreEl = $('score'), bestEl = $('best'), tagsEl = $('scoreboard');
  const overlay = $('overlay'), cardTitle = $('overlay-title'), cardText = $('overlay-text');
  const flavorEl = $('overlay-flavor'), badgeEl = $('overlay-badge'), opponentsEl = $('opponents');
  const nameRow = $('name-row'), nameRank = $('name-rank'), nameInput = $('name-input');
  const startBtn = $('start'), watchBtn = $('watch');
  const toastEl = $('toast'), speedEl = $('speed'), announcer = $('announcer'), hintEl = $('hint'), helpEl = $('help');
  const pauseBtn = $('pause'), muteBtn = $('mute'), musicBtn = $('music'), chatterBtn = $('chatter-toggle'), chatlogEl = $('chatlog');
  const recordsEl = $('records'), recordsBody = $('records-body');
  const recordsTabs = [...document.querySelectorAll('#records .tab[data-tab]')];
  const filterEl = $('scores-filter'), filterTabs = [...filterEl.querySelectorAll('.tab')];
  const friendsBtn = $('friends'), lobbyEl = $('lobby'), lobbyName = $('lobby-name'), lobbyShare = $('lobby-share');
  const lobbyLink = $('lobby-link'), lobbyCopy = $('lobby-copy'), lobbyPlayers = $('lobby-players');
  const lobbyJoin = $('lobby-join'), lobbyCode = $('lobby-code'), lobbyStatus = $('lobby-status');

  const touchFirst = matchMedia('(pointer: coarse)').matches;
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(location.search);
  const DEV = params.has('debug') || params.has('perf');

  // ----------------------------------------------------------------- words

  const pick = list => list[Math.floor(Math.random() * list.length)];
  const FLAVOR = {
    intro: 'Three rivals. One mossy log. Last snake wriggling wins.',
    hintStart: 'Arrows or WASD steer · Space naps · Enter starts · H opens the Hall of Fame',
    hintKeys: 'Arrows or WASD steer · Space naps · Enter starts over · H opens the Hall of Fame · M mutes · N toggles the music',
    hintOnline: 'Arrows or WASD steer · M mutes · N toggles the music',
    hintTouch: 'Swipe to steer · Tap ⏸ to nap',
    rivals: ['Your rivals today:', 'Up on the log with you:', 'Sharing your bark:'],
    spectators: ['Tonight on the bark:', 'In the ring today:', 'Place your bets:'],
    go: ['Slither!', 'Off you go.', 'Mind the edges.'],
    goWatch: ['And they’re off.', 'Off they slither.', 'Let the wriggling begin.'],
    pause: ['Snakes need rest too.', 'Curled up in a warm patch of bark.', 'The log will wait.'],
    wake: touchFirst ? 'Tap Wake up when you’re ready.' : 'Space or P to wake up.',
    deathTitle: { wall: ['Bonk!', 'Thwack!'], self: ['Tangled!', 'Knotted!'], rival: ['Squashed!', 'Splat!'], headOn: ['Head-on!', 'Clonk!'], fire: ['Toasted!', 'Scorched!'] },
    wall: ['The log goes on. You don’t.', 'That edge came out of nowhere.', 'Even logs have edges.'],
    self: ['Of all the snakes to bite.', 'You were in your own way.', 'You can’t outrun yourself.'],
    hole: ['The woodpecker sends its regards.', 'Mind the gap.', 'The woodpecker missed you. The hole didn’t.'],
    starved: ['Should have eaten something.', 'Hunger always wins in the end.', 'All slither, no snacks.'],
    fire: ['Too hot to handle.', 'You found the fire. The hard way.', 'Lightning never strikes twice. It didn’t need to.', 'Burned to a crisp. A small crisp.'],
    tiny: ['Too small to take the knock.', 'Nothing left to lose but you.'],
    boxed: ['Nowhere left to turn.', 'Boxed in. The bonk was the last straw.'],
    // The weather, as it turns (no banner when it clears).
    weather: {
      sun: ['Golden hour: golden apples are ripening.', 'The sun’s out. Golden apples love it.'],
      wind: ['The wind’s up. Apples are falling!', 'A blustery spell: windfall apples!'],
      rain: ['Rain! The mushrooms are sprouting.', 'Here comes the rain. Mushrooms love it.'],
      storm: ['A storm’s brewing. Watch for the crackle.', 'Thunder on the bark. Lightning strikes where it crackles.'],
      snow: ['Winter! Less food, and you’ll get hungry faster.', 'Snow on the bark. Lean times: eat while you can.'],
    },
    strike: ['Lightning! The bark’s on fire.', 'Crack! Fire on the bark.'],
    rainbow: ['A rainbow! And at its foot, something golden.', 'After the rain, a rainbow. Follow it to the gold.'],
    burrow: ['A beetle burrow just cracked open.', 'Something’s been digging under the bark.'],
    win: ['King of the log.', 'Last snake wriggling.', 'You outlasted them all.', 'The whole log is yours. For now.'],
    draw: ['Nobody made it out.', 'Everyone loses. How fair.', 'A dead heat. Emphasis on dead.'],
    golden: ['A golden apple! Everyone pretends not to have seen it.', 'Something shiny just dropped onto the log.'],
    // The first time in a round you cross into a rival's force field.
    field: { home: name => `You’re in ${name}’s realm now. It noticed.`, colony: name => `That’s one of ${name}’s colonies. It noticed.` },
    woodpecker: ['The woodpecker is here. Keep out of wherever it’s looking.', 'Rat-a-tat. The woodpecker has come for the log, a patch at a time.'],
    // The new rules, as they first happen to you in a round.
    youCrash: ['Bonk! That cost you your tail. Crash when you’re tiny, or boxed in, and you’re out.', 'Ouch. Three segments gone, a moment’s stars. Small and boxed in, a crash is the end.'],
    youCrashAgain: ['Bonk!', 'Ouch!', 'Mind your head.', 'There goes more tail.'],
    youAlight: ['You’re on fire! It’ll cost you a piece a second. Rain would help.', 'Hot hot hot! You’re burning, and losing bits of you.'],
    youCut: ['The woodpecker took your tail!', 'Snip! The woodpecker had your tail.'],
    baked: ['Something’s baking in the fire. Worth two, if you can take the heat.', 'Baked! Hot food is worth two. Wait for the fire, or don’t.'],
    youGolden: ['Golden! +3.', 'Shiny and delicious. +3.'],
    beetle: ['A beetle is out for a walk. It won’t get far.', 'Something crunchy is crawling about.'],
    youBeetle: ['Crunchy! +2.', 'Caught it! +2.'],
    goldBeetle: ['A golden beetle! Catch it, and you can leap over things.', 'Something golden is scuttling about. Catch it: it’s worth a leap or two.'],
    youGoldBeetle: n => `Golden! You’ve got ${n} leap${n === 1 ? '' : 's'}: press the way you’re going (or swipe forward) to hop over a body or a hole.`,
    youLeap: ['Hup! Over it.', 'Clean over!'],
    youMushroom: ['You feel smaller. And somehow wiser.', 'A little less of you. Sneaky.'],
    youHungry: ['Your tummy is rumbling. Time for a snack.', 'Getting peckish… find food soon.'],
    newBest: n => `New best: ${n}!`,
    friendWin: ['Bragging rights, for now.', 'Rematch?', 'Fair and square. Probably.'],
    friendKill: ['No hard feelings. Well, a few.', 'Friendship is complicated.', 'That calls for a rematch.'],
    friendsIntro: 'Host a game and send your friends the link, or join theirs. Empty seats get AI rivals.',
    hostIntro: location.protocol === 'file:' ? 'Send this code to up to three friends. Empty seats get AI rivals.' : 'Send this link to up to three friends. Empty seats get AI rivals.',
    joining: code => `Knocking on room ${code}…`,
    waiting: (name, next) => `Waiting for ${name} to start the ${next ? 'next ' : ''}round.`,
    roomGone: name => `${name} closed the room.`,
    roomLost: 'Lost the connection to the room.',
    friendLeft: name => `${name} left. An AI takes over their snake.`,
    friendJoined: name => `${name} is on the log. Their best rounds are in your Hall of Fame.`,
    friendAway: name => `${name} went quiet. An AI steers until they’re back.`,
    friendBack: name => `${name} is back.`,
    youAway: 'You went quiet for a moment, so an AI steered for you.',
    takeBack: 'An AI kept your snake going. Steer to take it back.',
    watchingFirst: 'This round’s already going. You’re in from the next one.',
    rivals0: 'Just friends today. No mercy:',
  };

  // "you" for your own snake, the name for everyone else.
  const who = (s, object = false) => isMe(s) ? (object ? 'you' : 'You') : s.name;
  // A death as you see it: causes name names, and yours becomes "you".
  function causeFor(s) {
    const k = s.killerId != null && s.killer !== 'self' ? game.snakes[s.killerId] : null;
    return k && isMe(k) && s.cause.endsWith(k.name) ? s.cause.slice(0, -k.name.length) + 'you' : s.cause;
  }
  // Your death, in the second person.
  const yourCause = p => p.killer === 'self' ? 'bit yourself' : causeFor(p);

  // ---------------------------------------------------------- game state

  // state: 'ready' (start card) | 'lobby' (play with friends) | 'countdown' | 'running' | 'paused' | 'over'
  let game, state = 'ready', speed = 1, watchSpeed = 1;
  // Which snake is yours: an arrow and YOU over its head from the countdown
  // until a few seconds into the round (or just after you first steer).
  let youHideAt = 0;
  // Online play, or null when playing alone:
  // { role: 'host' | 'guest', room, code, seat (yours in this round, -1 if watching),
  //   players: [{ id, name, color }] (host: everyone in the room, seat order),
  //   hostName, lastTickAt, holesSent }
  let online = null;
  const hosting = () => online?.role === 'host';
  const guesting = () => online?.role === 'guest';
  let acc = 0, tickLen = T.OPENING_TICK, lastFrame = 0, drawAlpha = 1, dirty = true;
  // The clock the board's own effects run on (tongues, beetles, particles,
  // weather): the frame clock, but at 2x or 4x when you're watching that fast.
  let boardClock = performance.now();
  let beatsLeft = 0, beatTimer = 0;
  let freezeUntil = 0, pendingCard = null, cardAt = 0; // times on the frame clock (rAF timestamps)
  let shownCard = null, napOver = null; // the card on screen, and the one a nap covered
  let firstCard = true; // (focus on page load goes to the card, not silently to Play)
  let nameInvite = false, nameFocusAt = 0; // the name field is waiting to be offered; when it took focus
  const keysHeld = new Set(), swallowed = new Set(); // keys down now; keys the name field is ignoring until released
  function inviteName() {
    nameInvite = false;
    if (nameRow.hidden || overlay.classList.contains('hidden')) return;
    nameFocusAt = performance.now();
    nameInput.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => keysHeld.add(e.code || e.key), true);
  document.addEventListener('keyup', e => {
    keysHeld.delete(e.code || e.key);
    swallowed.delete(e.code);
    if (nameInvite && !keysHeld.size) setTimeout(() => { if (nameInvite && !keysHeld.size) inviteName(); }, 250);
  }, true);
  window.addEventListener('blur', () => keysHeld.clear());
  let thinkQueue = [];
  let best = Records.getBest();
  let boardPx = 0; // the board's CSS width, kept by a ResizeObserver (no layout reads in the loop)

  // Your snake: the first seat alone, your seat online (none if you're watching).
  const player = () => {
    const s = game.snakes[online ? online.seat : 0];
    return s?.isPlayer ? s : null;
  };
  const isMe = s => !!s && s === player();
  const playerAlive = () => !!player()?.alive;
  const localName = () => (Records.hasName() ? Records.getName() : 'Green');
  const spectating = () => !playerAlive();

  // Which part of the soundtrack fits this moment (see SnakeAudio.music).
  const mood = { intensity: 0, watching: false, paused: false, danger: 0 };
  let dangerNow = 0; // (worked out once a tick)
  function musicStage() {
    if (state !== 'running' && state !== 'paused') return 'title';
    let alive = 0;
    for (const s of game.snakes) if (s.alive) alive++;
    mood.intensity = Math.min(1, game.time / T.RAMP_MS);
    mood.danger = state === 'running' ? dangerNow : 0;
    mood.watching = spectating();
    mood.paused = state === 'paused';
    return alive <= 2 ? 'duel' : E.suddenDeath(game) ? 'sudden' : game.time > T.MUSIC_MID_MS ? 'mid' : 'early';
  }

  // -------------------------------------------------------------- the loop

  // One requestAnimationFrame loop drives everything. The simulation runs on a
  // fixed timestep from an accumulator, and the renderer interpolates between
  // ticks, so motion is smooth at any refresh rate and ticks never drift.
  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }

  function frame(now) {
    const dt = lastFrame ? Math.max(0, Math.min(T.MAX_FRAME_MS, now - lastFrame)) : 16;
    lastFrame = now;
    boardClock += dt * (state === 'running' && spectating() && !online ? speed : 1);
    govern(dt);
    const t0 = performance.now();
    let tickCost = 0;

    if (state === 'countdown' && !guesting()) {
      beatTimer -= dt;
      if (beatTimer <= 0) beat();
      dirty = true;
    }

    if (state === 'running' && guesting()) {
      // A friend's screen doesn't simulate: it glides between the host's ticks.
      showPending(now >= freezeUntil);
      drawAlpha = Math.min(1, (performance.now() - online.lastTickAt) / tickLen);
      dirty = true;
    } else if (state === 'running') {
      // Alone, your death stops the round for a moment. Online it never stops:
      // the round is everyone's, and only your card waits.
      const frozen = () => !online && now < freezeUntil;
      let busy = false; // a frame that ticks or shows a card has done enough: thinking waits a frame
      if (showPending(now >= freezeUntil)) busy = true;
      if (!frozen()) {
        acc += dt;
        let steps = 0;
        while (acc >= tickLen && steps < T.MAX_CATCHUP && state === 'running' && !frozen()) {
          acc -= tickLen;
          const ts = performance.now();
          tick();
          tickCost += performance.now() - ts;
          steps++;
        }
        if (steps === T.MAX_CATCHUP) acc = Math.min(acc, tickLen); // after a long stall, don't race to catch up
        if (!steps && !busy) think(dt);
      }
      // Between the last two cells. While frozen, `acc` stands still, so the
      // board holds the very moment of the crash, with nothing jumping ahead.
      drawAlpha = Math.min(1, acc / tickLen);
      dirty = true;
    } else if (state === 'over') {
      showPending(now >= cardAt);
      // The last move glides like any other, then the board rests.
      if (drawAlpha < 1) {
        drawAlpha = guesting() ? Math.min(1, (performance.now() - online.lastTickAt) / tickLen) : Math.min(1, (acc += dt) / tickLen);
        dirty = true;
      }
      if (R.particles > 0 || R.holding() || pendingCard) dirty = true;
    }

    Audio.music(musicStage(), mood);

    if (youHideAt && (performance.now() > youHideAt || !playerAlive())) { youHideAt = 0; R.showYou(false); }
    if (dirty && !document.hidden) {
      R.frame(drawAlpha, boardClock);
      Chatter.layout(drawAlpha, boardPx, player());
      toastFade();
      dirty = state === 'running' || state === 'countdown' || R.particles > 0 || R.holding();
    }
    perf.record(performance.now() - t0, tickCost);
  }

  // Keep it playable everywhere: if this device keeps dropping frames during
  // a round (over 12% of frames late, two windows of about three seconds in a
  // row), the board draws less, for good: first no canopy shadows and a lower
  // resolution, then the lowest. (Late means half again the shortest frame
  // seen in the window, so 60, 120 and 144 Hz screens are judged alike.)
  const governor = { frames: 0, late: 0, best: Infinity, dts: [], strikes: 0 };
  function govern(dt) {
    if (state !== 'running' || document.hidden || R.quality === 0 || !game || game.time < 1500 || dt <= 0) return;
    governor.dts.push(dt);
    governor.best = Math.min(governor.best, dt);
    if (governor.dts.length < 180) return;
    const late = governor.dts.filter(d => d > Math.max(governor.best * 1.6, 12)).length / governor.dts.length;
    governor.dts.length = 0;
    governor.best = Infinity;
    governor.strikes = late > 0.12 ? governor.strikes + 1 : 0;
    if (governor.strikes < 2) return;
    governor.strikes = 0;
    R.setQuality(R.quality - 1);
    dirty = true;
  }

  // A card waiting for its moment (after the death freeze, or the round's last
  // breath) comes up once `due`. Returns whether it did.
  function showPending(due) {
    if (!pendingCard || !due) return false;
    const c = pendingCard;
    pendingCard = null;
    showCard(c);
    return true;
  }

  // A host's hidden tab still has to run the round for everyone, but browsers
  // stop animation frames there (and slow timers down). A worker's clock keeps
  // ticking, so it stands in while the host's tab is hidden.
  let hiddenClock = null;
  function keepTimeWhileHidden(on) {
    if (on && !hiddenClock) {
      try {
        const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 20);'], { type: 'text/javascript' }));
        hiddenClock = new Worker(url);
        URL.revokeObjectURL(url);
        hiddenClock.onmessage = () => { if (document.hidden && hosting()) frame(performance.now()); };
      } catch { hiddenClock = null; /* the round just waits while the tab is hidden */ }
    } else if (!on && hiddenClock) {
      hiddenClock.terminate();
      hiddenClock = null;
    }
  }

  // Let the AIs think about the next tick in the frames before it (same
  // information, same decisions), spread evenly over the frames that are left:
  // usually one AI per frame, more only when the tick is close (fast speeds).
  function think(dt) {
    if (!thinkQueue.length) return;
    const framesLeft = Math.max(1, Math.floor((tickLen - acc) / Math.max(4, dt)));
    let quota = Math.ceil(thinkQueue.length / framesLeft);
    while (thinkQueue.length && quota > 0) {
      const s = thinkQueue.shift();
      if (E.canThinkAhead(game, s)) { E.thinkAhead(game, s); quota--; }
    }
  }

  // One tick of the rules (alone, or as the host: friends get a copy).
  function tick() {
    const wasAlive = playerAlive();
    for (const s of game.snakes) rememberPrev(s);
    if (hosting()) checkAway();
    const dying = E.step(game);
    tickLen = E.tickMs(game) / (spectating() && !online ? speed : 1);
    if (hosting()) {
      online.room.broadcast(Online.tick(game, { holesFrom: online.holesSent, tickLen }));
      online.holesSent = game.holes.size;
    }
    Chatter.update();
    afterTick(dying, wasAlive);
  }

  // A tick from the host, on a friend's screen.
  function hostTick(msg) {
    if (!game || (state !== 'running' && state !== 'countdown')) return;
    if (state === 'countdown') go();
    const wasAlive = playerAlive();
    for (const s of game.snakes) rememberPrev(s);
    const wasPiloted = !!player()?.autopilot;
    const dying = Online.apply(game, msg, DIRS);
    // If the host had an AI steer for you for a while (your connection
    // hiccupped), say so once you're back.
    const piloted = !!player()?.autopilot;
    if (piloted && !wasPiloted) online.pilotedAt = performance.now();
    if (wasPiloted && !piloted && player() && performance.now() - online.pilotedAt > 2000 && !online.toldAway) toast(FLAVOR.youAway, 2200);
    if (!piloted) online.toldAway = false;
    tickLen = msg.len || E.tickMs(game);
    online.lastTickAt = performance.now();
    afterTick(dying, wasAlive);
  }

  // What follows a tick on every screen: effects, sounds, the HUD, banners, placements.
  function afterTick(dying, wasAlive) {
    dangerNow = dangerOf();
    if (game.woodpecker) placeBoard(); // (once a tick while it's here: the page may have moved)
    R.onTick(game.events);
    sounds(dying, wasAlive);
    updateHud();
    announce(dying);

    // Everyone still alive finished ahead of the snakes that just died; if
    // nobody is, they share first place (a draw).
    const alive = game.snakes.filter(s => s.alive);
    for (const s of dying) finishSnake(s, { place: alive.length + 1, draw: alive.length === 0 });
    thinkQueue = guesting() ? [] : alive.filter(s => !s.isPlayer || s.autopilot);
    const youJustDied = wasAlive && !playerAlive();
    if (youJustDied) deathMoment();
    if (alive.length <= 1) {
      if (alive.length) finishSnake(alive[0], { place: 1, won: true });
      return endRound();
    }
    if (youJustDied) youDied();
  }

  // The moment you die: the board holds still (alone), your snake holds its
  // pose with its eyes screwed shut, then bursts. Also when it ends the round.
  function deathMoment() {
    freezeUntil = lastFrame + (reducedMQ.matches ? T.DEATH_FREEZE / 2 : T.DEATH_FREEZE);
    R.hold(boardClock + (freezeUntil - lastFrame)); // (on the board's clock)
    R.shake(T.SHAKE_PX);
    flashFrame('kill', true);
  }

  // Each segment's previous cell, for interpolation. Reuses the same objects.
  function rememberPrev(s) {
    if (!s.alive) { s.prev = null; return; }
    const prev = s.prev || (s.prev = []);
    prev.length = s.body.length;
    for (let i = 0; i < s.body.length; i++) {
      const c = s.body[i];
      if (prev[i]) { prev[i].x = c.x; prev[i].y = c.y; } else prev[i] = { x: c.x, y: c.y };
    }
  }

  // ---------------------------------------------------------- the round

  // humans: the people in this round, [{ name, color }] (online); alone it's you,
  // or nobody when watching the AIs.
  function newGame({ personas, aiOnly = false, humans = null } = {}) {
    game = E.createGame({ personas, humans: humans || (aiOnly ? [] : [{ name: localName(), color: PLAYER_COLOR }]) });
    R.showYou(false);
    youHideAt = 0;
    acc = 0;
    tickLen = E.tickMs(game);
    drawAlpha = 1;
    thinkQueue = guesting() ? [] : game.snakes.filter(s => s.persona);
    freezeUntil = 0;
    pendingCard = null;
    R.setGame(game);
    R.setViewer(player()?.id ?? -1); // your snake gets the bright outline
    Audio.weather('none');
    streak = 0;
    Chatter.reset(game);
    hideToast();
    buildTags();
    buildOpponents();
    updateHud(true);
    dirty = true;
  }

  // Start a round in the given mode. The round on the start card is used as-is;
  // anything else gets a fresh one.
  function start({ aiOnly = !game.withPlayer } = {}) {
    if (state === 'lobby' && !hosting()) return; // the lobby's own buttons decide
    if (online) {
      // Online, the host starts every round; friends wait for it.
      if (hosting() && (state === 'lobby' || state === 'over')) startOnlineRound();
      return;
    }
    if (state !== 'ready' || aiOnly !== !game.withPlayer) newGame({ aiOnly });
    speed = watchSpeed = 1; // every round starts at normal speed (watching, you can speed it up again)
    state = 'countdown';
    beatsLeft = 3;
    beatTimer = 0;
    game.rivalsLine = pick(game.withPlayer ? FLAVOR.rivals : FLAVOR.spectators);
    updateControls();
    beat();
  }

  function beat() {
    if (beatsLeft === 0) return go();
    if (hosting()) online.room.broadcast({ t: 'phase', s: 'countdown', beat: beatsLeft });
    showBeat(beatsLeft);
    beatsLeft--;
    beatTimer = T.COUNTDOWN_BEAT;
  }

  // Online the countdown can't be skipped (everyone starts together).
  const BEAT = [
    { transform: 'scale(2.6) rotate(-8deg)', opacity: 0 },
    { transform: 'scale(0.86) rotate(3deg)', opacity: 1, offset: 0.55 },
    { transform: 'scale(1.08) rotate(-1deg)', offset: 0.8 },
    { transform: 'scale(1) rotate(0)' },
  ];
  function showBeat(n) {
    R.showYou(playerAlive());
    Audio.play('beat');
    if (n === 1) Audio.play('riser'); // (rising into Go!)
    showCard({ title: String(n), text: game.rivalsLine, primary: online ? null : 'Go!', opponents: true, quiet: true, beat: true });
    if (!reducedMQ.matches) cardTitle.animate?.(BEAT, { duration: 480, easing: 'ease-out' }); // each number slams down
  }

  function go() {
    if (hosting()) online.room.broadcast({ t: 'phase', s: 'go' });
    if (guesting()) online.lastTickAt = performance.now();
    state = 'running';
    hideCard();
    R.showYou(playerAlive());
    youHideAt = performance.now() + 3500;
    Audio.play('go');
    if (guesting() && online.seat < 0) toast(FLAVOR.watchingFirst, 3000);
    else toast(pick(game.withPlayer && online?.seat !== -1 ? FLAVOR.go : FLAVOR.goWatch), 1300, 'go');
    flashFrame('go');
    acc = 0;
    lastFrame = 0;
    updateControls();
    say(game.withPlayer ? 'Go.' : 'And they’re off.');
  }

  function pause() {
    if (state !== 'running' || online) return; // no napping online: the round goes on for everyone
    state = 'paused';
    napOver = !overlay.classList.contains('hidden') && shownCard?.reward ? shownCard : null; // your death card: back on waking
    Chatter.clearBubbles();
    showCard({
      title: 'Napping', text: `${pick(FLAVOR.pause)} ${FLAVOR.wake}`,
      primary: 'Wake up', secondary: touchFirst ? 'Start over' : null,
    });
    updateControls();
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    if (napOver) showCard({ ...napOver, quiet: true });
    else hideCard();
    napOver = null;
    lastFrame = 0;
    updateControls();
  }

  function youDied() {
    const p = player();
    const titles = FLAVOR.deathTitle;
    const title = p.killer === 'hunger' ? 'Starved!' : p.cause === 'fell into a woodpecker hole' ? 'Down the hole!'
      : pick(p.killer === 'fire' ? titles.fire : p.killer === 'wall' ? titles.wall : p.killer === 'self' ? titles.self : p.cause.startsWith('crashed') ? titles.headOn : titles.rival);
    pendingCard = {
      title,
      text: `You ${yourCause(p)} · ${Records.ordinal(game.result.place)} place · score ${p.eaten}`,
      flavor: killLine(p), primary: 'Play again', secondary: 'Keep watching', reward: true,
      ...(online && { primary: 'Keep watching', secondary: hosting() ? 'Close room' : 'Leave room', actions: { primary: hideCard, secondary: leaveRoom } }),
    };
    updateControls();
  }

  function endRound() {
    state = 'over';
    Chatter.clearBubbles();
    flushAiResults();
    const survivors = game.snakes.filter(s => s.alive);
    const winner = survivors[0];
    const title = !winner ? 'Draw' : isMe(winner) ? 'You win!' : `${winner.name} wins`;
    const flavor = !winner ? pick(FLAVOR.draw) : isMe(winner) ? pick(FLAVOR.win) : winner.persona ? winner.persona.win : pick(FLAVOR.friendWin);
    if (isMe(winner)) Audio.play('win');
    if (winner) { R.celebrate(isMe(winner) ? null : winner); flashFrame('win', isMe(winner)); } // confetti: all over for you, from its head for anyone else
    const me = player();
    const r = game.result;
    const yours = !me || !r ? ''
      : r.won ? `Won in ${Records.clock(r.survived)} · score ${me.eaten}`
      : r.draw ? `You shared 1st · lasted ${Records.clock(r.survived)} · score ${me.eaten}`
      : `You finished ${Records.ordinal(r.place)} · lasted ${Records.clock(r.survived)} · score ${me.eaten}`;
    if (online) {
      pendingCard = hosting()
        ? { title, flavor, text: yours, reward: !!me, primary: 'Play again', secondary: 'Close room', lobby: { players: true },
          actions: { primary: startOnlineRound, secondary: leaveRoom } }
        : { title, flavor, text: yours, reward: !!me, primary: null, secondary: 'Leave room', lobby: { status: FLAVOR.waiting(online.hostName, true) },
          actions: { secondary: leaveRoom } };
    } else pendingCard = game.withPlayer
      ? { title, flavor, reward: true, primary: 'Play again', secondary: 'Watch AIs', text: yours }
      : { title, flavor, primary: 'Play', secondary: 'Watch again' };
    cardAt = lastFrame + T.ROUND_END_PAUSE;
    updateControls();
  }

  // A snake's result is known as soon as its placement is. Yours is saved at
  // once; the AIs' are saved when the round actually finishes, so a round you
  // abandon leaves no trace. Watched rounds count too, marked as watched.
  function finishSnake(s, { place, won = false, draw = false }) {
    if (s.result) return;
    s.result = { place, won, draw, eaten: s.eaten, survived: game.time };
    // Online, everyone's result goes in everyone's Hall of Fame (the round id keeps it once).
    if (online && s.isPlayer && !isMe(s) && s.owner) Records.recordFriend(s.result, { name: s.name, color: s.color, owner: s.owner, round: game.roundId });
    if (!isMe(s)) return;
    const before = best;
    game.result = s.result;
    game.entryId = Records.recordPlayer({ ...s.result, killer: s.alive ? null : s.killer, round: game.roundId });
    if (s.eaten > best) { best = s.eaten; Records.setBest(best); bestEl.textContent = best; }
    game.newBest = s.eaten > before && s.eaten > 0;
  }

  // (Online, only your own result is kept: the rivals' places are the host's game.)
  function flushAiResults() {
    if (online) return;
    for (const s of game.snakes) {
      if (s.isPlayer || !s.result || s.result.saved) continue;
      Records.addScore({ ...s.result, name: s.name, color: s.color, ai: true, watched: !game.withPlayer });
      s.result.saved = true;
    }
  }

  // Flavor for the death card: the killer's own line, if an AI got you.
  function killLine(p) {
    const killer = game.snakes.find(s => s !== p && s.name === p.killer);
    if (killer?.persona) return killer.persona.kill;
    if (killer) return pick(FLAVOR.friendKill);
    if (p.cause === 'fell into a woodpecker hole') return pick(FLAVOR.hole);
    // A crash only ends you when you're tiny or boxed in; boxed in, say so.
    if ((p.killer === 'self' || p.killer === 'wall') && p.body.length > T.MIN_LENGTH) return pick(FLAVOR.boxed);
    if (p.killer === 'self') return pick(Math.random() < 0.5 ? FLAVOR.self : FLAVOR.tiny);
    if (p.killer === 'hunger') return pick(FLAVOR.starved);
    if (p.killer === 'fire') return pick(FLAVOR.fire);
    return pick(FLAVOR.wall);
  }

  // ------------------------------------------------------- sounds, banners

  // Sounds come from where they happen on the board, a little left or right.
  const at = x => ({ pan: ((x + 0.5) / GRID * 2 - 1) * 0.8 });
  // Apples eaten in quick succession climb in pitch: a streak you can hear.
  let streak = 0, streakAt = -1e9;
  function sounds(dying, wasAlive) {
    const me = player();
    for (const e of game.events) {
      if (e.type === 'eat' && isMe(e.snake)) {
        if (e.kind !== 'mushroom') { streak = game.time - streakAt < 2600 ? Math.min(streak + 1, 7) : 0; streakAt = game.time; }
        Audio.play(e.kind === 'golden' ? 'golden' : e.kind === 'pellet' ? 'meat' : e.kind === 'mushroom' ? 'mushroom' : e.kind === 'beetle' ? 'crunch' : 'eat', { pitch: e.kind === 'mushroom' ? 0 : streak, ...at(e.x) });
        bump(scoreEl);
      } else if (e.type === 'woodpecker') { Audio.play('call'); Audio.play('riser'); }
      else if (e.type === 'aim') Audio.play('aim', at(e.x));
      else if (e.type === 'peck' && e.cells?.length) { Audio.play('drum', at(e.x)); Audio.play('crash', at(e.x)); }
      else if (e.type === 'spawn' && e.kind === 'beetle') Audio.play('beetle', at(e.x));
      else if (e.type === 'starving' && isMe(e.snake)) Audio.play('hungry');
      else if (e.type === 'charge') Audio.play('crackle', at(e.x));
      else if (e.type === 'strike') Audio.play('thunder', at(e.x));
      else if (e.type === 'gust') Audio.play('gust');
      else if (e.type === 'burrow') Audio.play('burrow', at(e.x));
      else if (e.type === 'dive' || e.type === 'emerge') Audio.play('dig', at(e.x));
      else if (e.type === 'rainbow') Audio.play('rainbow', at(e.x));
      else if (e.type === 'weather' && e.kind === 'rain') Audio.play('rain');
      else if (e.type === 'weather' && e.kind === 'snow') Audio.play('snow');
      else if (e.type === 'ember') Audio.play('ember', at(e.x));
      else if (e.type === 'crash') Audio.play(isMe(e.snake) ? 'bonk' : 'bonked', at(e.x));
      else if (e.type === 'alight') Audio.play('alight', at(e.snake.body[0].x));
      else if (e.type === 'singe' && isMe(e.snake)) Audio.play('singe');
      else if (e.type === 'baked') Audio.play('bake', at(e.x));
      else if (e.type === 'ash') Audio.play('ash', at(e.x));
      else if (e.type === 'cut') Audio.play('snip', at(e.x));
      else if (e.type === 'leap') Audio.play('leap', at(e.x));
    }
    for (const s of dying) {
      if (isMe(s)) continue;
      // You took them out: a knockout punch. Anyone else: a far-off thud.
      Audio.play(me && s.killerId === me.id && s.killer !== 'self' ? 'ko' : 'rivalDeath', at(s.body[0].x));
      flashFrame('kill');
    }
    if (wasAlive && !playerAlive()) Audio.play('death');
    // A near miss: your head right next to a rival's.
    if (me?.alive) {
      const h = me.body[0];
      for (const o of game.snakes) if (o !== me && o.alive && Math.abs(o.body[0].x - h.x) <= 1 && Math.abs(o.body[0].y - h.y) <= 1) { Audio.play('close', at(o.body[0].x)); break; }
    }
    // Crossing into a rival's force field (Sovereign's home, a colony): a
    // hum, and the first time in a round, a word on whose it is.
    if (me?.alive) {
      const h = me.body[0];
      let inside = null;
      for (const o of game.snakes) {
        if (o === me || !o.alive) continue;
        if (o.memory.home && Math.hypot(h.x - o.memory.home.x, h.y - o.memory.home.y) <= o.memory.home.radius + 1) inside = { o, home: true };
        for (const c of o.memory.colonies || []) if (Math.hypot(h.x - c.x, h.y - c.y) <= c.radius + 1) inside ||= { o, home: false };
      }
      if (inside && !inField) {
        Audio.play('field', at(h.x));
        if (!game.toldField && state === 'running') { game.toldField = true; toast(FLAVOR.field[inside.home ? 'home' : 'colony'](inside.o.name), 2400, 'warn'); }
      }
      inField = !!inside;
    }
    Audio.weather(state === 'running' ? game.weather?.kind : 'none');
  }
  let inField = false;

  // How much danger you're in, for the music: a rival's head close to yours,
  // or little room ahead. 0..1.
  function dangerOf() {
    const me = player();
    if (!me?.alive || !game) return 0;
    const h = me.body[0];
    let near = 99;
    for (const o of game.snakes) if (o !== me && o.alive) near = Math.min(near, Math.abs(o.body[0].x - h.x) + Math.abs(o.body[0].y - h.y));
    let danger = near <= 1 ? 1 : near <= 4 ? (5 - near) / 4 : 0;
    // Room ahead: how many of the next three cells straight on are open.
    let open = 0;
    for (let i = 1; i <= 3; i++) {
      const x = h.x + me.dir.x * i, y = h.y + me.dir.y * i;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID || game.holes.has(y * GRID + x)) break;
      if (game.snakes.some(o => o.alive && o.body.some(c => c.x === x && c.y === y))) break;
      open++;
    }
    if (open === 0) danger = Math.max(danger, 0.85); else if (open === 1) danger = Math.max(danger, 0.5);
    return danger;
  }

  // Banners for the big moments of a round (one per tick, most important first).
  function announce(dying) {
    const alive = game.snakes.filter(s => s.alive);
    if (dying.length && !game.firstBlood) {
      game.firstBlood = true;
      const v = dying[0];
      const killer = game.snakes.find(o => o.name === v.killer && o !== v);
      Audio.play('stinger');
      return toast(killer ? `First blood: ${who(killer, true)} got ${who(v, true)}.` : `First out: ${who(v, true)} ${isMe(v) ? yourCause(v) : causeFor(v)}.`, 2800, 'kill');
    }
    for (const e of game.events) if (e.type === 'woodpecker') { flashFrame('bird', true); return toast(pick(FLAVOR.woodpecker), 2800, 'bird'); }
    if (dying.length && alive.length === 2) {
      const [a, b] = isMe(alive[0]) ? [alive[1], alive[0]] : alive;
      Audio.play('riser');
      return toast(`It’s down to ${who(a)} and ${who(b, true)}.`, 2800, 'kill');
    }
    const me = player();
    if (me?.alive) {
      const left = E.hungerLeft(game, me);
      if (left < T.HUNGER_WARN_MS && !game.warnedHunger) { game.warnedHunger = true; return toast(pick(FLAVOR.youHungry), 2800, 'warn'); }
      if (left > T.HUNGER_WARN_MS) game.warnedHunger = false;
    }
    for (const e of game.events) {
      if (e.type === 'strike') flashFrame('storm', true);
      if (e.type === 'strike' && !game.struck) { game.struck = true; return toast(pick(FLAVOR.strike), 2200, 'fire'); }
      if (e.type === 'weather' && FLAVOR.weather[e.kind]) { game.struck = false; flashFrame(e.kind); return toast(pick(FLAVOR.weather[e.kind]), 2800, e.kind); }
      if (e.type === 'rainbow') { flashFrame('gold', true); return toast(pick(FLAVOR.rainbow), 2800, 'gold'); }
      if (e.type === 'burrow' && !game.toldBurrow) { game.toldBurrow = true; return toast(pick(FLAVOR.burrow), 2200, 'beetle'); }
      if (e.type === 'spawn' && e.kind === 'golden') { flashFrame('gold'); return toast(pick(FLAVOR.golden), 2800, 'gold'); }
      if (e.type === 'spawn' && e.kind === 'beetle' && e.gold) { flashFrame('gold'); return toast(pick(FLAVOR.goldBeetle), 2600, 'gold'); }
      if (e.type === 'spawn' && e.kind === 'beetle') { flashFrame('beetle'); return toast(pick(FLAVOR.beetle), 2200, 'beetle'); }
      if (e.type === 'eat' && isMe(e.snake) && e.gold) { flashFrame('gold', true); return toast(FLAVOR.youGoldBeetle(e.snake.leaps), 3400, 'gold'); }
      if (e.type === 'leap' && isMe(e.snake)) return toast(pick(FLAVOR.youLeap), 900, 'gold');
      if (e.type === 'eat' && isMe(e.snake) && e.kind === 'beetle') { flashFrame('beetle'); return toast(pick(FLAVOR.youBeetle), 1500, 'beetle'); }
      if (e.type === 'eat' && isMe(e.snake) && e.kind === 'golden') { flashFrame('gold', true); return toast(pick(FLAVOR.youGolden), 1500, 'gold'); }
      if (e.type === 'eat' && isMe(e.snake) && e.kind === 'mushroom') return toast(pick(FLAVOR.youMushroom), 1800, 'you');
      // The new rules, explained the first time each happens to you in a round.
      if (e.type === 'crash' && isMe(e.snake)) {
        if (!game.toldCrash) { game.toldCrash = true; return toast(pick(FLAVOR.youCrash), 3200, 'warn'); }
        return toast(pick(FLAVOR.youCrashAgain), 1100, 'warn');
      }
      if (e.type === 'alight' && isMe(e.snake)) { flashFrame('kill'); return toast(pick(FLAVOR.youAlight), 2600, 'fire'); }
      if (e.type === 'cut' && isMe(e.snake)) return toast(pick(FLAVOR.youCut), 2000, 'bird');
      if (e.type === 'baked' && !game.toldBaked) { game.toldBaked = true; return toast(pick(FLAVOR.baked), 2600, 'fire'); }
    }
  }

  // A banner fades while a head passes under it, so it never hides the board
  // (its size is estimated from the text, so this reads no layout).
  let toastTimer, toastChars = 0, toastUnder = '';
  function toastFade() {
    let top = false, bottom = false;
    if (!toastEl.hidden && boardPx && game) {
      const cell = boardPx / GRID;
      const rows = Math.ceil(52 / cell), half = Math.min(boardPx - 32, toastChars * 7.6 + 32) / 2 / cell;
      for (const s of game.snakes) {
        const h = s.body[0];
        if (!s.alive || Math.abs(h.x + 0.5 - GRID / 2) >= half + 0.5) continue;
        if (h.y < rows) top = true;
        if (h.y >= GRID - rows) bottom = true;
      }
    }
    const place = !top ? '' : bottom ? 'under' : 'low'; // moved down, or (if a head's there too) faded
    if (place !== toastUnder) {
      toastEl.classList.toggle('low', place === 'low');
      toastEl.classList.toggle('under', place === 'under');
      toastUnder = place;
    }
  }
  // kind styles the banner for its moment: kill, gold, beetle, bird (the
  // woodpecker), warn, you (something you ate), go.
  function toast(text, ms = 2800, kind = '') {
    toastChars = text.length;
    toastEl.classList.remove('settled', 'leaving'); // (a new banner slams in)
    toastEl.dataset.kind = kind;
    toastEl.textContent = text;
    toastEl.hidden = false;
    say(text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideToast(true), ms);
  }
  // Gone at once (a card is coming up), or, when its time is up, faded out.
  function hideToast(fade = false) {
    clearTimeout(toastTimer);
    if (fade && !reducedMQ.matches && !toastEl.hidden) {
      toastEl.classList.add('leaving');
      toastTimer = setTimeout(() => { toastEl.hidden = true; toastEl.classList.remove('leaving'); }, 240);
    } else {
      toastEl.hidden = true;
      toastEl.classList.remove('leaving');
    }
  }
  toastEl.addEventListener('animationend', e => { if (e.animationName === 'slam') toastEl.classList.add('settled'); });

  // Screen reader announcements (a permanently rendered, visually hidden region).
  function say(text) { announcer.textContent = text; }

  // (Pops only scale, so the compositor runs them: no repaint, even on a bite.)
  const BUMP = [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.4 }, { transform: 'scale(1)' }];
  const BUMP_TIMING = { duration: 280, easing: 'ease-out' };
  function bump(el, frames = BUMP) {
    if (!reducedMQ.matches) el.animate?.(frames, BUMP_TIMING);
  }
  // A tag's length when it changes, a tag
  // knocked out of the round, and a tag taking the lead.
  const TAG_BUMP = [{ transform: 'scale(1)' }, { transform: 'scale(1.45)', offset: 0.35 }, { transform: 'scale(1)' }];
  const KNOCK = [
    { transform: 'translateX(0) rotate(0)', backgroundColor: '#fca5a5' },
    { transform: 'translateX(-6px) rotate(-2deg)', offset: 0.18 },
    { transform: 'translateX(5px) rotate(2deg)', offset: 0.4 },
    { transform: 'translateX(-3px) rotate(-1deg)', offset: 0.65 },
    { transform: 'translateX(0) rotate(0)', backgroundColor: 'rgba(246, 236, 210, 0.66)' },
  ];
  const CROWNED = [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'scale(1)' }];
  function knock(el) {
    if (!reducedMQ.matches) el.animate?.(KNOCK, { duration: 480, easing: 'ease-out' });
  }

  // The frame lights up round its edge for the big moments, in the moment's
  // colour (only its opacity animates, so it's cheap).
  const GLOW = { gold: '#fde047', beetle: '#34d399', kill: '#ef4444', bird: '#f97316', go: '#a3e635', win: '#fde68a', sun: '#fbbf24', wind: '#86efac', rain: '#60a5fa', storm: '#c4b5fd', snow: '#e0f2fe' };
  function flashFrame(kind, strong = false) {
    if (reducedMQ.matches || !glowEl?.animate) return;
    glowEl.style.setProperty('--glow', GLOW[kind]);
    glowEl.animate([{ opacity: 0 }, { opacity: strong ? 1 : 0.75, offset: 0.12 }, { opacity: 0 }], { duration: strong ? 1500 : 800, easing: 'ease-out' });
  }

  // ----------------------------------------------------------- the cards

  // card = { title, text, flavor, primary, secondary, opponents, reward, quiet,
  //   friends (show "Play with friends"), lobby (which lobby parts, see renderLobby),
  //   actions: { primary, secondary } (what the buttons do, instead of the usual) }
  let cardActions = null;
  function showCard(card) {
    hideToast();
    shownCard = card;
    cardTitle.textContent = card.title;
    cardText.textContent = card.text || '';
    cardText.hidden = !card.text;
    flavorEl.textContent = card.flavor || '';
    flavorEl.hidden = !card.flavor;
    opponentsEl.hidden = !card.opponents;
    hintEl.hidden = state !== 'ready';
    clearTimeout(blurbTimer);
    cardText.classList.remove('said');
    helpEl.hidden = state === 'ready'; // the start card already shows the controls
    startBtn.hidden = !card.primary;
    if (card.primary) startBtn.textContent = card.primary;
    watchBtn.hidden = !card.secondary;
    if (card.secondary) watchBtn.textContent = card.secondary;
    friendsBtn.hidden = !card.friends;
    // In the lobby the tags would show the solo round behind the card, not who's playing.
    tagsEl.style.visibility = state === 'lobby' ? 'hidden' : '';
    cardActions = card.actions || null;
    renderLobby(card.lobby);

    // The reward: a new best gets its own moment; the Hall of Fame asks for a
    // name only when the round really earned a place there.
    badgeEl.hidden = true;
    nameRow.hidden = true;
    if (card.reward && game.entryId) {
      if (game.newBest && !game.celebrated) {
        game.celebrated = true;
        Audio.play('best');
        R.celebrate();
        flashFrame('win', true);
      }
      if (game.newBest) { badgeEl.textContent = FLAVOR.newBest(best); badgeEl.hidden = false; }
      const rank = yourRank();
      if (rank.overall && (rank.overall <= 3 || game.newBest)) {
        nameRank.textContent = `Hall of Fame #${rank.overall}. Carve your name:`;
        nameRow.hidden = false;
      } else if (rank.personal === 1 && game.newBest) {
        nameRank.textContent = 'Top of your own list. Carve your name:';
        nameRow.hidden = false;
      }
      if (!nameRow.hidden && document.activeElement !== nameInput) nameInput.value = Records.hasName() ? Records.getName() : '';
      if (!nameRow.hidden) namingEntry = game.entryId;
    }

    overlay.querySelector('.card').classList.toggle('beat', !!card.beat); // the countdown: a big number
    overlay.classList.remove('hidden');
    overlay.querySelector('.card').scrollTop = 0;
    if (!card.quiet) say(announcement(card));
    // The name field only takes focus the first time, on a keyboard: once you
    // have a name, Enter and R restart straight away, and phones never get
    // their keyboard popped up over the card.
    if (document.activeElement !== nameInput) {
      const invite = !nameRow.hidden && !touchFirst && !Records.hasName();
      const cardEl = overlay.querySelector('.card');
      (firstCard ? cardEl : card.primary ? startBtn : card.secondary ? watchBtn : cardEl).focus({ preventScroll: true });
      firstCard = false;
      // The name field is offered once your hands are off the keys (someone
      // still steering would otherwise type "dd" into it), and ignores keys
      // for a moment after it takes focus.
      nameInvite = invite;
      if (invite && !keysHeld.size) inviteName();
    }
    updateControls();
  }

  // Your Hall of Fame rank. Before the round is over, the snakes still alive
  // haven't been saved, but they'll all finish ahead of you, so they count.
  function yourRank() {
    const rank = Records.rankOf(game.entryId);
    if (state === 'over' || !rank.overall) return rank;
    let ahead = 0;
    for (const s of game.snakes) if (s.alive && (!online || (s.isPlayer && s.owner))) ahead++;
    const overall = rank.overall + ahead;
    return { overall: overall <= Records.MAX_SCORES ? overall : 0, personal: rank.personal };
  }

  // A card as a screen reader hears it: whole sentences (" · " would be read
  // as "dot"), plus the new-best badge and the name prompt.
  function announcement(card) {
    const sentence = t => (/[.!?…:]$/.test(t) ? t : `${t}.`);
    const parts = [card.title, card.text && card.text.replaceAll(' · ', ', '), card.flavor,
      !badgeEl.hidden && badgeEl.textContent, !nameRow.hidden && nameRank.textContent];
    return parts.filter(Boolean).map(sentence).join(' ');
  }

  function hideCard() {
    overlay.classList.add('hidden');
    shownCard = null;
  }

  // The roll-call on the start and countdown cards: every rival, AIs with a
  // word on how they play, friends tagged as friends.
  function buildOpponents() {
    opponentsEl.textContent = '';
    for (const s of game.snakes) {
      if (isMe(s) || (!s.persona && !online)) continue;
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = dotColor(s);
      const name = document.createElement('strong');
      name.textContent = s.name;
      const blurb = document.createElement('span');
      blurb.className = 'blurb';
      blurb.textContent = s.persona ? s.persona.blurb : 'Your friend. For now.';
      li.append(dot, name, ' ', blurb);
      opponentsEl.append(li);
    }
  }

  // ------------------------------------------------------------- the HUD

  // Each snake's tag (dot, name, length, hunger bar). Values are written only
  // when they change.
  function buildTags() {
    tagsEl.textContent = '';
    for (const s of game.snakes) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="dot"></span><span class="name"></span><span class="sr-only"></span><span class="len"></span><span class="hunger"><i></i></span>';
      li.querySelector('.name').textContent = isMe(s) ? 'You' : s.name;
      li.title = s.persona ? `${s.name}: ${s.persona.blurb}` : isMe(s) ? 'You' : `${s.name}, a friend`;
      if (s.persona) li.dataset.blurb = `${s.name}: ${s.persona.blurb}`; // tapped (phones have no tooltips), it says how it plays
      if (s.personaKey === 'capricious') li.querySelector('.dot').dataset.ring = ''; // its pink ring, as on the board
      const mark = R.markOf(s.color);
      if (s.isPlayer && mark) li.querySelector('.dot').dataset.mark = mark;
      tagsEl.append(li);
      s.tag = { li, dot: li.querySelector('.dot'), state: li.querySelector('.sr-only'), len: li.querySelector('.len'), bar: li.querySelector('.hunger i'), last: {} };
    }
  }

  let blurbTimer = 0;
  tagsEl.addEventListener('click', e => {
    const blurb = e.target.closest?.('li')?.dataset.blurb;
    if (!blurb || state === 'running') return;
    if (overlay.classList.contains('hidden')) return toast(blurb, 3200);
    clearTimeout(blurbTimer);
    cardText.textContent = blurb;
    cardText.hidden = false;
    cardText.classList.add('said');
    say(blurb);
    blurbTimer = setTimeout(restoreText, 3200);
  });
  // The card's own words again, after a rival's line stood in for them.
  function restoreText() {
    clearTimeout(blurbTimer);
    cardText.classList.remove('said');
    cardText.textContent = shownCard?.text || '';
    cardText.hidden = !shownCard?.text;
  }

  function updateHud(force = false) {
    const score = player()?.eaten ?? 0;
    if (force || scoreEl.textContent !== String(score)) scoreEl.textContent = score;
    // Best follows your score live once you pass it (it's saved when your round ends).
    const shownBest = Math.max(best, score);
    if (force || bestEl.textContent !== String(shownBest)) {
      if (!force && score > best && !game.passedBest) { game.passedBest = true; bump(bestEl); }
      bestEl.textContent = shownBest;
    }
    // The leader (the longest snake, if one is longest) wears a crown.
    let lead = null, top = 0;
    for (const s of game.snakes) {
      if (!s.alive) continue;
      if (s.body.length > top) { top = s.body.length; lead = s; } else if (s.body.length === top) lead = null;
    }
    for (const s of game.snakes) {
      const t = s.tag, last = t.last;
      const dot = dotColor(s);
      const leading = s === lead;
      const len = s.alive ? String(s.body.length) : 'out';
      const full = s.alive ? Math.max(0, Math.min(1, E.hungerLeft(game, s) / T.HUNGER_MS)) : 0;
      const bar = Math.round(full * 100);
      const starving = s.alive && full < 0.3;
      if (force || last.dot !== dot) { t.dot.style.background = dot; last.dot = dot; }
      if (force || last.len !== len) {
        t.len.textContent = len;
        if (!force && s.alive && last.len !== undefined) bump(t.len, TAG_BUMP);
        last.len = len;
      }
      const said = !s.alive ? ', ' : `${starving ? ', starving' : ''}${leading ? ', in the lead' : ''}, length `; // (for screen readers)
      if (force || last.said !== said) { t.state.textContent = said; last.said = said; }
      if (force || last.bar !== bar) { t.bar.style.transform = `scaleX(${bar / 100})`; last.bar = bar; }
      if (force || last.alive !== s.alive) {
        t.li.classList.toggle('dead', !s.alive);
        if (!force && !s.alive) knock(t.li);
        last.alive = s.alive;
      }
      if (force || last.leading !== leading) {
        t.li.classList.toggle('leader', leading);
        if (!force && leading) bump(t.li, CROWNED);
        last.leading = leading;
      }
      if (force || last.starving !== starving) { t.li.classList.toggle('starving', starving); last.starving = starving; }
    }
  }

  // The scoreboard dot: the snake's current color,
  // the flag for Wildcard, two-tone for Joker, veined marble for Mason, Mute's
  // mood, and Vulture's pink head (black would vanish).
  function dotColor(s) {
    if (s.personaKey === 'wildcard') return 'linear-gradient(135deg, #3c3b6e 0 42%, #b22234 42% 56%, #fff 56% 70%, #b22234 70% 84%, #fff 84%)';
    if (s.personaKey === 'mute') return R.colorOf(s); // (its mood, as it changes)
    if (s.personaKey === 'joker') return 'linear-gradient(90deg, #a21caf 50%, #f59e0b 50%)';
    if (s.personaKey === 'mason') return 'linear-gradient(135deg, #f5f1e8 0 38%, #8a94a6 40% 45%, #ebe5d9 47% 68%, #c9a227 70% 74%, #ebe5d9 76%)';
    return s.persona?.ink || R.colorOf(s);
  }

  // Pause, mute and speed controls: shown and labelled for the current state.
  function updateControls() {
    const canPause = !online && (state === 'running' || state === 'paused');
    pauseBtn.disabled = !canPause;
    pauseBtn.setAttribute('aria-label', state === 'paused' ? 'Wake up' : 'Nap (pause)');
    pauseBtn.dataset.paused = String(state === 'paused');
    // (Watching, the speed can be set during the countdown too.)
    speedEl.hidden = !(spectating() && !online && (canPause || state === 'countdown'));
    for (const b of speedEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
    // Pressed means off (the icon gets its slash); the names stay put.
    muteBtn.setAttribute('aria-pressed', String(Audio.isMuted()));
    musicBtn.setAttribute('aria-pressed', String(!Audio.isMusicOn()));
    musicBtn.disabled = Audio.isMuted();
    // During a round the page holds still under your fingers (see the swipes).
    document.documentElement.classList.toggle('playing', (state === 'running' || state === 'countdown') && playerAlive());
    document.documentElement.classList.toggle('in-round', state === 'running' || state === 'countdown');
  }

  function setSpeed(n) {
    speed = n;
    if (!game.withPlayer) watchSpeed = n;
    tickLen = E.tickMs(game) / (spectating() ? speed : 1);
    updateControls();
  }

  // ------------------------------------------------------------- input

  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const CODES = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }; // physical keys, so AZERTY works

  // Queue a turn (up to T.QUEUE ahead), checked against the last queued
  // direction so no combo of quick presses can reverse into the neck.
  function turn(name, p = player()) {
    const next = DIRS[name];
    const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    if (next === last) return E.leap(game, p); // (the way you're already going: a leap, if you've got one)
    if (next.x === -last.x && next.y === -last.y) return;
    if (p.queue.length < T.QUEUE) p.queue.push(next);
  }

  // A direction: steers, and on the start card or during the countdown also
  // gets the round going (already turning).
  function steer(name) {
    if (!playerAlive()) return;
    if (state === 'running' && youHideAt) youHideAt = Math.min(youHideAt, performance.now() + 600); // (you've found yourself)
    if (online) {
      // Online the countdown runs its course; turns go to the host's game.
      if (state !== 'countdown' && state !== 'running') return;
      if (guesting()) online.room.send({ t: 'turn', d: name });
      else hostTurn(name);
      return;
    }
    if (state === 'ready') start();
    if (state === 'countdown') { turn(name); go(); }
    else if (state === 'running') turn(name);
  }

  // A friend sees each tick half a round trip late, and their turn takes the
  // other half to arrive. So the host's own turns wait a whole round trip (in
  // the order they were pressed): no one gets a head start.
  let hostTurnAt = 0;
  function hostTurn(name) {
    const me = player();
    if (me.autopilot) me.autopilot = null; // back from a hidden tab: your hands again
    const now = performance.now();
    const at = Math.max(now + Math.min(T.HOST_DELAY_MAX, online.room.rtt()), hostTurnAt);
    hostTurnAt = at;
    if (at - now < 4) return turn(name, me);
    setTimeout(() => { if (me.alive && game.snakes[me.id] === me) turn(name, me); }, at - now);
  }

  function napKey() {
    if (online) return; // no napping online
    if (state === 'running') pause();
    else if (state === 'paused') resume();
    else if (state === 'countdown') go();
    else start();
  }

  document.addEventListener('keydown', e => {
    Audio.unlock();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === nameInput) {
      // (just offered, or a key held down: not typing yet)
      if (performance.now() - nameFocusAt < 400 || (e.repeat && swallowed.has(e.code))) { swallowed.add(e.code); e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); startBtn.focus({ preventScroll: true }); }
      return;
    }
    if (e.key === 'Escape' && state === 'lobby' && !online) { backToStart(); return; } // (even from the name or code field)
    if (e.target.closest?.('input, textarea')) return; // typing a name or a room code
    if (!recordsEl.hidden) {
      if (e.key === 'Escape' || e.key === 'h' || e.key === 'H') { e.preventDefault(); closeRecords(); }
      return;
    }
    const dir = KEYS[e.key] || CODES[e.code];
    if (dir) { e.preventDefault(); steer(dir); return; }
    // A held key repeats nothing, not even a focused button (holding Enter on
    // Play would otherwise start the round and then skip its countdown).
    if (e.repeat) { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); return; }
    // Enter and Space on a focused button belong to the button.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button')) return;
    if (e.key === ' ' || e.key === 'p' || e.key === 'P') { e.preventDefault(); napKey(); }
    else if (e.key === 'Enter' || e.key === 'r' || e.key === 'R') { e.preventDefault(); start(); }
    else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); openRecords(); }
    else if (e.key === 'Escape' && state === 'paused') resume();
    else if (e.key === 'Escape' && state === 'lobby' && !online) backToStart();
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'n' || e.key === 'N') toggleMusic();
    else if ((e.key === '1' || e.key === '2' || e.key === '3') && !speedEl.hidden) setSpeed([1, 2, 4][Number(e.key) - 1]);
    else if (e.key === '`' && DEV) perf.toggle();
  });

  // Swipes: a turn registers as soon as the finger has travelled half a cell,
  // without lifting, and one touch can chain several turns. On the board they
  // always steer; during a round they steer anywhere on the screen (over the
  // countdown card too), and the page never scrolls. Buttons stay buttons.
  let swipe = null;
  const swiping = () => (state === 'running' || state === 'countdown') && playerAlive();
  document.addEventListener('touchstart', e => {
    Audio.unlock();
    if (e.target.closest?.('button, input, a, [role="switch"], #records')) return;
    if (!swiping() && !canvas.contains(e.target)) return;
    const t = e.changedTouches[0];
    if (!swipe) swipe = { id: t.identifier, x: t.clientX, y: t.clientY };
    if (swiping()) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!swipe) return;
    let t = null;
    for (const c of e.changedTouches) if (c.identifier === swipe.id) t = c;
    if (!t) return;
    e.preventDefault();
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    const threshold = Math.max(T.SWIPE_MIN_PX, (boardPx || 320) / GRID * T.SWIPE_CELLS);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe.x = t.clientX;
    swipe.y = t.clientY;
  }, { passive: false });
  const endSwipe = e => { for (const c of e.changedTouches) if (swipe && c.identifier === swipe.id) swipe = null; };
  document.addEventListener('touchend', endSwipe);
  document.addEventListener('touchcancel', endSwipe);

  // Buttons.
  const click = (el, fn) => el.addEventListener('click', e => { Audio.unlock(); Audio.play('ui'); fn(e); });
  // A button clicked with a mouse or a finger doesn't keep the keyboard, so
  // Space and Enter go back to napping and starting over. Card and Hall of
  // Fame buttons keep focus: there, Enter on a focused button is expected.
  document.addEventListener('click', e => {
    const b = e.target.closest?.('button');
    if (b && e.detail > 0 && !b.closest('#overlay, #records')) b.blur();
  });
  click(startBtn, () => {
    if (cardActions?.primary) cardActions.primary();
    else if (state === 'paused') resume();
    else if (state === 'countdown') go();
    else start({ aiOnly: false });
  });
  click(watchBtn, () => {
    if (cardActions?.secondary) cardActions.secondary();
    else if (state === 'running') hideCard();        // keep watching after you died
    else if (state === 'paused') start();            // "Start over" on touch
    else start({ aiOnly: true });
  });
  click(pauseBtn, () => (state === 'paused' ? resume() : pause()));
  click(muteBtn, () => toggleMute());
  click(musicBtn, () => toggleMusic());
  click(speedEl, e => { const b = e.target.closest('button'); if (b) setSpeed(Number(b.dataset.speed)); });
  click(chatterBtn, () => { Chatter.setEnabled(!Chatter.isEnabled()); showChatterState(); });

  function toggleMute() {
    Audio.toggleMuted();
    updateControls();
  }

  function toggleMusic() {
    Audio.unlock();
    Audio.toggleMusic();
    updateControls();
  }

  function showChatterState() {
    const on = Chatter.isEnabled();
    chatterBtn.textContent = on ? 'On' : 'Off';
    chatterBtn.setAttribute('aria-checked', String(on));
    chatlogEl.hidden = !on;
  }

  // Renaming your Hall of Fame entry from the card. Saved when you're done
  // (rivals use the new name from the next round).
  let namingEntry = null; // the round the name field is for (the next may start while you type)
  nameInput.addEventListener('change', () => {
    if (namingEntry) Records.rename(namingEntry, nameInput.value);
  });

  // Nap automatically when the tab is hidden, or when the window loses focus
  // while you're playing (a watched round can keep going on screen). Online the
  // round goes on regardless.
  document.addEventListener('visibilitychange', () => {
    if (online) return awayOnline();
    if (!document.hidden) return;
    napNow();
  });

  // Online the round goes on while your tab is hidden, so an AI steers your
  // snake until you're back and turn again. A friend's tab says so itself: a
  // hidden tab's "still here" slows to once a second, which looks like a
  // flickering connection.
  function awayOnline() {
    if (guesting()) online.room.send({ t: document.hidden ? 'away' : 'back' });
    const me = player();
    if (!me?.alive || (state !== 'countdown' && state !== 'running')) return;
    if (hosting() && document.hidden) { me.autopilot = PERSONAS.drab; me.queue.length = 0; }
    if (!document.hidden && (hosting() ? me.autopilot : true)) {
      toast(FLAVOR.takeBack, 2400);
      if (guesting()) online.toldAway = true; // (then no "you went quiet" when you do)
    }
  }
  window.addEventListener('blur', () => {
    if (online || !playerAlive() || pendingCard) return;
    napNow();
  });

  // Nap right away; from the countdown, the round starts napping.
  function napNow() {
    if (state === 'countdown') state = 'running';
    if (state === 'running') pause();
  }

  // ------------------------------------------------------ Hall of Fame

  let recordsTab = 'scores', scoresFilter = 'all', recordsOpener = null;

  function openRecords() {
    if (online && playerAlive() && (state === 'countdown' || state === 'running')) {
      toast('The Hall of Fame can wait. Eyes on the bark.', 1800); // the round wouldn't
      return;
    }
    if (online) { /* the round goes on behind the dialog */ }
    else if (state === 'countdown' || (state === 'running' && !pendingCard)) napNow();
    recordsOpener = document.activeElement;
    recordsEl.hidden = false;
    mainEl.inert = true;
    renderRecordsSafely();
    $('records-close').focus();
  }

  function closeRecords() {
    recordsEl.hidden = true;
    mainEl.inert = false;
    const back = !overlay.classList.contains('hidden') ? (startBtn.hidden ? watchBtn : startBtn) : recordsOpener;
    back?.focus?.({ preventScroll: true });
  }

  function renderRecordsSafely() {
    recordsBody.textContent = '';
    try { renderRecords(); } catch { recordsBody.textContent = 'The Hall of Fame got scrambled. Clear it below to start afresh.'; }
  }

  function renderRecords() {
    recordsTabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.tab === recordsTab)));
    filterTabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.filter === scoresFilter)));
    filterEl.hidden = recordsTab !== 'scores';
    recordsBody.textContent = '';
    if (recordsTab === 'scores') {
      Records.renderScores(recordsBody, game.entryId, scoresFilter, PLAYER_COLOR);
    } else {
      // Every persona's color, not just this round's, plus old names (Viper, Warden).
      const colors = { self: PLAYER_COLOR, Viper: '#c084fc', Warden: '#3b82f6' };
      for (const p of Object.values(PERSONAS)) colors[p.name] = p.ink || p.color;
      colors.fire = '#f97316';
      Records.renderStats(recordsBody, colors);
    }
  }

  recordsTabs.forEach(t => click(t, () => { recordsTab = t.dataset.tab; renderRecordsSafely(); }));
  filterTabs.forEach(t => click(t, () => { scoresFilter = t.dataset.filter; renderRecordsSafely(); }));
  click($('records-open'), openRecords);
  click($('records-close'), closeRecords);
  recordsEl.addEventListener('click', e => { if (e.target === recordsEl) closeRecords(); });
  click($('records-reset'), () => {
    if (!confirm('Clear every Hall of Fame row, your story and your Best? There’s no undo.')) return;
    Records.reset();
    best = 0;
    bestEl.textContent = 0;
    nameRow.hidden = true;
    renderRecords();
  });

  // -------------------------------------------------- play with friends

  // One browser hosts: it runs the round exactly as when playing alone, sends
  // every tick to the others (online.js) and takes their turns. Friends' screens
  // only draw what the host sends. Connections live in net.js.

  // Which parts of the lobby a card shows: { name, share, players, join, status, trouble }.
  function renderLobby(parts) {
    lobbyEl.hidden = !parts;
    if (!parts) return;
    lobbyName.closest('.lobby-row').hidden = !parts.name;
    lobbyShare.hidden = !parts.share;
    lobbyJoin.hidden = !parts.join;
    lobbyPlayers.hidden = !parts.players;
    if (parts.players) renderPlayers();
    setStatus(parts.status || '', parts.trouble);
  }

  function setStatus(text, trouble = false) {
    lobbyStatus.textContent = text;
    lobbyStatus.classList.toggle('trouble', trouble);
  }

  // Four seats: the people in the room, then the seats AI rivals will take.
  function renderPlayers() {
    lobbyPlayers.textContent = '';
    const people = online?.players || [];
    for (let i = 0; i < Online.MAX_PEOPLE; i++) {
      const p = people[i];
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      const label = document.createElement('span');
      if (p) {
        dot.style.background = p.color;
        if (R.markOf(p.color)) dot.dataset.mark = R.markOf(p.color);
        label.textContent = p.name;
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = [p.host && 'host', p.id === myId() && 'you'].filter(Boolean).join(' · ');
        li.append(dot, label, tag);
      } else {
        dot.style.background = 'var(--parchment-2)';
        label.className = 'open-seat';
        label.textContent = 'An AI rival, unless a friend joins';
        li.append(dot, label);
      }
      lobbyPlayers.append(li);
    }
  }

  const myId = () => (hosting() ? 'host' : online?.room.id);
  const roomLink = code => (location.protocol === 'file:' ? code : `${location.origin}${location.pathname}?join=${code}`);

  // Keep ?join=CODE in the address while you're in a room (a reload rejoins).
  function setUrlCode(code) {
    const p = new URLSearchParams(location.search);
    if (code) p.set('join', code); else p.delete('join');
    const q = p.toString();
    try { history.replaceState(null, '', location.pathname + (q ? `?${q}` : '')); } catch { /* file:// */ }
  }

  function saveLobbyName() {
    const name = Online.cleanName(lobbyName.value);
    if (name) Records.setName(name);
    lobbyName.value = name || '';
  }

  let joinAttempt = 0; // a newer attempt (or Back) makes an older one moot

  function openFriends() {
    joinAttempt++;
    state = 'lobby';
    lobbyName.value = Records.hasName() ? Records.getName() : '';
    lobbyCode.value = '';
    updateControls();
    showCard({
      title: 'Play with friends', text: FLAVOR.friendsIntro, primary: 'Host a game', secondary: 'Back',
      lobby: { name: true, join: true }, actions: { primary: hostRoom, secondary: backToStart },
    });
  }

  function backToStart() {
    joinAttempt++;
    if (online) endOnline();
    ready();
  }

  // ------------- hosting

  async function hostRoom() {
    saveLobbyName();
    const attempt = ++joinAttempt;
    startBtn.disabled = true;
    setStatus('Opening a room…');
    try {
      const room = await Net.host({ newCode: Online.newCode, onLeave: friendLeft, onMessage: fromFriend });
      if (attempt !== joinAttempt) { room.close(); return; }
      online = {
        role: 'host', room, code: room.code, seat: 0, hostName: localName(), holesSent: 0,
        players: [{ id: 'host', name: localName(), color: Online.HUMAN_COLORS[0], host: true, owner: Records.playerId() }],
        shared: new Map([[Records.playerId(), { color: Online.HUMAN_COLORS[0], entries: Records.shareable(localName()) }]]), // owner -> their best rounds
      };
      keepTimeWhileHidden(true);
      setUrlCode(null);
      updateHelp();
      showRoom();
    } catch (err) {
      if (attempt === joinAttempt) setStatus(Net.explain(err), true);
    } finally {
      startBtn.disabled = false;
    }
  }

  function showRoom() {
    lobbyLink.value = roomLink(online.code);
    showCard({
      title: `Room ${online.code}`, text: FLAVOR.hostIntro, primary: 'Start', secondary: 'Close room',
      lobby: { share: true, players: true }, actions: { primary: startOnlineRound, secondary: leaveRoom },
    });
  }

  function sendLobby() {
    online.room.broadcast({ t: 'lobby', players: online.players.map(({ id, name, color, host }) => ({ id, name, color, host: !!host })) });
    if (!lobbyPlayers.hidden) renderPlayers();
  }

  function fromFriend(id, msg) {
    if (!hosting()) return;
    if (msg.t === 'hello') {
      const why = msg.v !== Online.VERSION ? 'version' : online.players.length >= Online.MAX_PEOPLE ? 'full' : null;
      if (why) {
        online.room.send(id, { t: 'reject', why });
        setTimeout(() => online?.room.drop(id), 500);
        return;
      }
      if (online.players.some(p => p.id === id)) return;
      const owner = typeof msg.owner === 'string' ? msg.owner.replace(/[^a-z0-9]/g, '').slice(0, 40) : '';
      online.room.admit(id);
      const taken = new Set(online.players.map(p => p.name));
      const base = Online.cleanName(msg.name) || 'Friend';
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      const color = Online.HUMAN_COLORS.find(c => !online.players.some(p => p.color === c));
      online.players.push({ id, name, color, owner });
      online.room.send(id, { t: 'welcome', name });
      sendLobby();
      // Everyone's best rounds go into everyone's Hall of Fame: kept once per
      // person (a rejoin replaces them), the newcomer gets everyone's, and
      // everyone else just the newcomer's, so messages stay small.
      const entries = owner ? Records.cleanShared(msg.scores, owner) : [];
      if (owner) online.shared.set(owner, { color, entries });
      Records.importShared(entries, color);
      online.room.send(id, { t: 'scores', from: [...online.shared.values()] });
      for (const p of online.players) if (p.id !== 'host' && p.id !== id) online.room.send(p.id, { t: 'scores', from: [{ color, entries }] });
      if (state === 'lobby') setStatus(FLAVOR.friendJoined(name));
      else toast(FLAVOR.friendJoined(name), 1800);
      // A round under way: they watch this one and play from the next.
      if (state === 'countdown' || state === 'running') {
        online.room.send(id, Online.round(game, game.humans, game.rivalsLine, game.roundId));
        if (state === 'running') online.room.send(id, { t: 'phase', s: 'go' });
      }
    } else if (msg.t === 'away' || msg.t === 'back') {
      const p = online.players.find(o => o.id === id);
      if (p) p.away = msg.t === 'away';
    } else if (msg.t === 'turn') {
      const s = game.snakes.find(o => o.peer === id);
      if (!s?.alive || s.left || (state !== 'countdown' && state !== 'running') || !Online.DIR_NAMES.includes(msg.d)) return;
      if (s.autopilot) handBack(s);
      turn(msg.d, s);
    }
  }

  // A friend whose connection goes quiet gets an AI at the wheel until they're
  // back, so a hiccup never drives them into a wall. Their browser says "still
  // here" four times a second, so a quiet spell shows within a moment; any turn
  // they send hands the wheel straight back. Short blips pass without a banner.
  // A friend who switched tabs said so: the AI stays at the wheel until they turn.
  function checkAway() {
    for (const s of game.snakes) {
      if (!s.peer || s.peer === 'host' || !s.alive || s.left) continue;
      const away = online.players.find(p => p.id === s.peer)?.away;
      const quiet = away ? Infinity : online.room.quietFor(s.peer);
      if (quiet > T.AWAY_MS && !s.autopilot) {
        s.autopilot = PERSONAS.drab;
        s.queue.length = 0;
        s.awayPilot = !!away;
      } else if (quiet <= T.AWAY_MS && s.autopilot && !s.awayPilot) handBack(s);
      if (s.autopilot && quiet > T.AWAY_TOAST_MS && !s.awayToast) {
        s.awayToast = true;
        toast(FLAVOR.friendAway(s.name), 2200);
      }
    }
  }

  function handBack(s) {
    s.autopilot = null;
    s.awayPilot = false;
    if (s.awayToast) toast(FLAVOR.friendBack(s.name), 1500);
    s.awayToast = false;
  }

  // A friend left: their seat opens up, and an AI finishes their round for them.
  function friendLeft(id) {
    if (!hosting()) return;
    const i = online.players.findIndex(p => p.id === id);
    if (i < 0) return;
    const [p] = online.players.splice(i, 1);
    if (p.owner) online.shared.delete(p.owner);
    const s = game.snakes.find(o => o.peer === id);
    if (s) s.left = true;
    if (s?.alive && (state === 'countdown' || state === 'running')) {
      s.autopilot = PERSONAS.drab;
      s.queue.length = 0;
      thinkQueue.push(s);
      toast(FLAVOR.friendLeft(p.name), 2400);
    } else if (state === 'lobby') setStatus(`${p.name} left.`);
    sendLobby();
  }

  function startOnlineRound() {
    if (!hosting()) return;
    const humans = online.players.map(p => ({ name: p.name, color: p.color, peer: p.id, owner: p.owner }));
    newGame({ humans });
    game.humans = humans;
    game.roundId = Online.newCode() + Date.now().toString(36);
    game.snakes.forEach((s, i) => { if (humans[i]) { s.peer = humans[i].peer; s.owner = humans[i].owner; } });
    game.rivalsLine = game.snakes.some(s => s.persona) ? pick(FLAVOR.rivals) : FLAVOR.rivals0;
    online.holesSent = game.holes.size;
    online.room.broadcast(Online.round(game, humans, game.rivalsLine, game.roundId));
    state = 'countdown';
    beatsLeft = 3;
    beatTimer = 0;
    updateControls();
    beat();
  }

  // ------------- joining

  // (A pasted invite link works too: its ?join= code is used.)
  const codeIn = text => Online.cleanCode(/join=([a-z0-9]{5})/i.exec(String(text))?.[1] ?? text);
  async function joinRoom(text) {
    const code = codeIn(text);
    if (!Online.isCode(code)) {
      if (state !== 'lobby') openFriends(); // (a bad ?join= link: show where the problem is)
      return setStatus('Room codes are five characters, like K7QXM.', true);
    }
    saveLobbyName();
    const attempt = ++joinAttempt;
    state = 'lobby';
    updateControls();
    showCard({
      title: 'Play with friends', text: FLAVOR.joining(code), secondary: 'Cancel',
      lobby: { status: '' }, actions: { secondary: backToStart },
    });
    try {
      const room = await Net.join(code, { onMessage: fromHost, onLost: hostLost });
      if (attempt !== joinAttempt) { room.close(); return; }
      online = { role: 'guest', room, code, seat: -1, hostName: 'the host', players: [], lastTickAt: 0 };
      room.send({ t: 'hello', v: Online.VERSION, name: localName(), owner: Records.playerId(), scores: Records.shareable(localName()) });
      setUrlCode(code);
      updateHelp();
    } catch (err) {
      if (attempt !== joinAttempt) return;
      showCard({
        title: 'Play with friends', text: err.message, primary: 'Try again', secondary: 'Back',
        lobby: { name: true, join: true }, actions: { primary: () => joinRoom(code), secondary: backToStart },
      });
      lobbyName.value = Records.hasName() ? Records.getName() : '';
      lobbyCode.value = code;
    }
  }

  function showGuestLobby() {
    showCard({
      title: `Room ${online.code}`, text: FLAVOR.waiting(online.hostName), secondary: 'Leave room',
      lobby: { players: true }, actions: { secondary: leaveRoom },
    });
  }

  function fromHost(msg) {
    if (!guesting()) return;
    try { handleHost(msg); } catch { /* a message we can't use (a newer or modified host): ignore it */ }
  }
  function handleHost(msg) {
    switch (msg.t) {
      case 'welcome':
        if (state === 'lobby') showGuestLobby();
        break;
      case 'reject':
        endOnline();
        state = 'lobby';
        showCard({
          title: 'Play with friends', primary: 'Back', actions: { primary: backToStart },
          text: msg.why === 'full' ? 'That room is full: four people already.' : 'That room runs a different version of the game. Reload both pages and try again.',
        });
        break;
      case 'lobby':
        if (!Array.isArray(msg.players)) break;
        online.players = msg.players.slice(0, Online.MAX_PEOPLE).filter(p => p && typeof p.name === 'string');
        online.hostName = msg.players.find(p => p.host)?.name || 'the host';
        if (state === 'lobby') showGuestLobby();
        else if (!lobbyPlayers.hidden) renderPlayers();
        break;
      case 'round': guestRound(msg); break;
      case 'scores':
        for (const f of Array.isArray(msg.from) ? msg.from : []) Records.importShared(f?.entries, f?.color);
        break;
      case 'phase':
        if (msg.s === 'countdown' && state === 'countdown') showBeat(msg.beat);
        else if (msg.s === 'go' && state === 'countdown') go();
        break;
      case 'tick': hostTick(msg); break;
      case 'say': // (the host's last line can arrive after the round ended here)
        if ((state === 'countdown' || state === 'running') && game.snakes[msg.id] && typeof msg.text === 'string') Chatter.replay(game.snakes[msg.id], msg.text.slice(0, 200), msg.reply === true);
        break;
      case 'closed': hostLost('closed'); break;
    }
  }

  // The host's new round, laid out on a friend's screen.
  function guestRound(msg) {
    online.seat = msg.humans.findIndex(h => h.peer === online.room.id);
    newGame({ humans: msg.humans, personas: msg.personas });
    game.roundId = typeof msg.id === 'string' ? msg.id : '';
    game.snakes.forEach((s, i) => { if (msg.humans[i]) s.owner = msg.humans[i].owner; });
    Online.apply(game, msg.first, DIRS);
    for (const s of game.snakes) rememberPrev(s);
    updateHud(true);
    game.rivalsLine = online.seat < 0 ? pick(FLAVOR.spectators) : msg.rivals;
    state = 'countdown';
    updateControls();
    showCard({ title: '…', text: game.rivalsLine, opponents: true, quiet: true, beat: true });
    R.showYou(playerAlive());
  }

  function hostLost(reason) {
    if (!guesting()) return;
    const { hostName: name, code } = online;
    endOnline();
    state = 'lobby';
    updateControls();
    if (reason === 'closed') showCard({ title: 'Room closed', text: FLAVOR.roomGone(name), primary: 'Back', actions: { primary: backToStart } });
    else showCard({ title: 'Connection lost', text: FLAVOR.roomLost, primary: 'Rejoin', secondary: 'Back', actions: { primary: () => joinRoom(code), secondary: backToStart } });
  }

  // ------------- leaving

  function leaveRoom() {
    if (hosting()) online.room.broadcast({ t: 'closed' });
    endOnline();
    ready();
  }

  function endOnline() {
    const { room } = online;
    online = null;
    keepTimeWhileHidden(false);
    setUrlCode(null);
    updateHelp();
    setTimeout(() => room.close(), 300); // let a goodbye get out first
  }

  click(friendsBtn, openFriends);
  click(lobbyCopy, async () => {
    const link = lobbyLink.value;
    if (navigator.share && touchFirst && link.startsWith('http')) {
      try { await navigator.share({ title: 'Bark & Bite', text: 'Come and play snake on a mossy log with me:', url: link }); return; } catch { /* cancelled: copy instead */ }
    }
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Link copied. Send it to your friends.');
    } catch {
      lobbyLink.select();
      setStatus('Select the link and copy it.');
    }
  });
  lobbyCopy.textContent = navigator.share && touchFirst ? 'Share link' : 'Copy link';
  lobbyLink.addEventListener('focus', () => lobbyLink.select());
  lobbyCode.addEventListener('input', () => {
    if (/join=/i.test(lobbyCode.value)) lobbyCode.value = codeIn(lobbyCode.value);
  });
  lobbyJoin.addEventListener('submit', e => {
    e.preventDefault();
    Audio.unlock();
    joinRoom(lobbyCode.value);
  });
  lobbyName.addEventListener('change', saveLobbyName);
  // The host passes the chatter on, so every screen has the same lines.
  Chatter.onSpeak((s, text, reply) => {
    if (hosting() && (state === 'countdown' || state === 'running')) online.room.broadcast({ t: 'say', id: s.id, text, reply });
  });
  // Back from the back/forward cache, a room that was closed on the way out is gone.
  window.addEventListener('pageshow', e => {
    if (!e.persisted || !online) return;
    if (guesting()) hostLost('silent');
    else { endOnline(); ready(); }
  });
  // Closing the tab says goodbye, so friends aren't left waiting.
  window.addEventListener('pagehide', () => {
    if (hosting()) online.room.broadcast({ t: 'closed' });
    if (online) online.room.close();
  });

  // ------------------------------------------------- size and motion

  R.init({ canvas, personas: PERSONAS, birdLayer: $('bird-layer') });
  // Where the board is on the page (the woodpecker perches beside it, on its own layer).
  const placeBoard = () => { const b = canvas.getBoundingClientRect(); R.setBoardRect(b.left, b.top, b.width); };
  window.addEventListener('resize', placeBoard, { passive: true });
  window.addEventListener('scroll', placeBoard, { passive: true });
  Chatter.init({ boardEl, logEl: chatlogEl });

  const sizer = new ResizeObserver(entries => {
    const e = entries[0];
    const w = e.contentRect.width;
    if (!w) return;
    boardPx = w;
    R.resize(w, e.devicePixelContentBoxSize?.[0]?.inlineSize);
    placeBoard();
    Chatter.setCompact(w < 420);
    dirty = true;
  });
  // The device-pixel box also reports browser zoom; older browsers get the CSS box.
  try { sizer.observe(canvas, { box: 'device-pixel-content-box' }); } catch { sizer.observe(canvas); }
  // (Browsers without the device-pixel box don't report a density change on
  // its own, say moving to another monitor, so listen for that too.)
  (function watchDensity() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener?.('change', () => { if (boardPx) { R.resize(boardPx); dirty = true; } watchDensity(); }, { once: true });
  })();

  const applyMotion = () => R.setReducedMotion(reducedMQ.matches);
  reducedMQ.addEventListener?.('change', applyMotion);
  applyMotion();

  // ------------------------------------------- dev: frame-time overlay

  // Behind ?perf or ?debug, toggled with the ` key: average and worst frame
  // time (script + canvas) and tick cost over the last 120 frames.
  const perf = (() => {
    const N = 120;
    const frames = new Float32Array(N), ticks = new Float32Array(N);
    let i = 0, n = 0, el = null, shown = params.has('perf'), lastPaint = 0;
    return {
      record(ms, tickMs) {
        frames[i] = ms; ticks[i] = tickMs; i = (i + 1) % N; n = Math.min(N, n + 1);
        if (!shown) return;
        const now = performance.now();
        if (now - lastPaint < 250) return;
        lastPaint = now;
        let sum = 0, worst = 0, tsum = 0, tworst = 0;
        for (let j = 0; j < n; j++) { sum += frames[j]; worst = Math.max(worst, frames[j]); tsum += ticks[j]; tworst = Math.max(tworst, ticks[j]); }
        el.textContent = `frame ${(sum / n).toFixed(2)} ms avg · ${worst.toFixed(2)} worst\ntick  ${(tsum / n).toFixed(2)} ms avg · ${tworst.toFixed(2)} worst\nparticles ${R.particles}`;
      },
      toggle() {
        shown = !shown;
        if (!el) { el = document.createElement('pre'); el.className = 'perf'; document.body.append(el); }
        el.hidden = !shown;
      },
      stats() {
        const list = Array.from(frames.slice(0, n)).sort((a, b) => a - b);
        return { avg: list.reduce((a, b) => a + b, 0) / (n || 1), p95: list[Math.floor(n * 0.95)] || 0, worst: list[n - 1] || 0 };
      },
      init() { if (shown) { shown = false; this.toggle(); } },
    };
  })();
  perf.init();

  // ---------------------------------------------------------- start

  // The first decision a brain makes runs cold (the JIT hasn't seen its
  // paths yet), so each rival makes one practice decision, on a scratch
  // memory, while the start card is up.
  function warmUp() {
    if (state !== 'ready' || !game) return;
    for (const s of game.snakes) if (s.persona) SnakeAI.decide(E.aiView(game, s), s.persona, {});
  }

  // The start card shows this round's rivals.
  function ready(personas) {
    startBtn.disabled = false; // (a room that never opened left it disabled)
    newGame({ personas });
    state = 'ready';
    showCard({ title: `Ready, ${localName()}?`, text: FLAVOR.intro, primary: 'Play', secondary: 'Watch AIs', opponents: true, friends: true });
    setTimeout(warmUp, 400);
  }

  // The controls under the board (online there's no napping or starting over).
  function updateHelp() {
    if (online) setHint(helpEl, touchFirst ? 'Swipe to steer' : FLAVOR.hintOnline);
    else setHint(helpEl, touchFirst ? FLAVOR.hintTouch : FLAVOR.hintKeys);
  }

  // Hints wrap only between items ("Space naps" never splits across lines).
  function setHint(el, text) {
    el.textContent = '';
    text.split(' · ').forEach((item, i) => {
      if (i) el.append(' · ');
      const span = document.createElement('span');
      span.textContent = item;
      el.append(span);
    });
  }
  setHint(hintEl, touchFirst ? FLAVOR.hintTouch : FLAVOR.hintStart);
  updateHelp();
  showChatterState();
  ready();
  updateControls();
  requestAnimationFrame(loop);
  // A friend's link (?join=CODE) goes straight to their room.
  if (params.get('join')) joinRoom(params.get('join'));

  // Test hooks, only with ?debug. The test pane runs hidden, where browsers
  // pause requestAnimationFrame, so frames(n) drives the loop by hand.
  if (params.has('debug')) {
    let fake = performance.now();
    window.SnakeDebug = {
      game: () => game,
      state: () => state,
      online: () => online && { role: online.role, seat: online.seat, code: online.code, players: online.players, rtt: hosting() ? online.room.rtt() : null },
      setup: ready,
      step: E.step,
      createGame: E.createGame,
      perf: () => perf.stats(),
      frames(count, ms = 1000 / 60) {
        fake = Math.max(fake, lastFrame); // real frames may have run ahead meanwhile
        for (let j = 0; j < count; j++) { fake += ms; frame(fake); }
        return state;
      },
      draw: () => R.frame(drawAlpha, boardClock),
    };
  }
})();
