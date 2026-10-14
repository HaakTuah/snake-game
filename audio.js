// Sound for Bark & Bite: a tiny Web Audio synthesiser with no audio files.
// Every cue is built from three soft, woody ingredients: a marimba-like mallet
// note, a wood-block knock, and a pinch of filtered noise. Envelopes are short,
// and everything runs through one gentle compressor so nothing ever gets harsh.
//
//   SnakeAudio.unlock()           call from a key press or tap (browsers keep sound locked until then)
//   SnakeAudio.play(name, opts)   opts = { pitch: semitones, volume: 0..1, pan: -1..1 (left..right) }; never throws
//   SnakeAudio.setMuted(b) / isMuted() / toggleMuted()   remembered in this browser
//   SnakeAudio.music(stage, mood)  the adaptive track (see the music section below)
//   SnakeAudio.weather(kind)       the weather you can hear: 'rain', 'wind', 'storm', 'snow' or anything else for none
//   SnakeAudio.setMusicOn(b) / isMusicOn() / toggleMusic()  remembered in this browser
window.SnakeAudio = (() => {
  // ---- Tuning ---------------------------------------------------------------
  const MASTER_VOLUME = 0.5;   // overall loudness, before the compressor
  const MAX_VOICES = 6;        // cues sounding at once; a new cue past this is dropped...
  const PRIORITY = { death: true, best: true, win: true, ko: true, stinger: true }; // ...except these, which always play
  // Shortest gap in ms between two plays of the same cue, so bursts don't stack up.
  const MIN_INTERVAL = {
    eat: 40, golden: 60, meat: 60, mushroom: 80, crunch: 80, beetle: 3000,
    rivalDeath: 120, death: 250, best: 400, win: 600,
    beat: 80, go: 80, woodpecker: 400, peck: 340, hungry: 1200, ui: 30, // peck: never more than 3 in any second
    crackle: 300, thunder: 900, gust: 1500, burrow: 1000, dig: 250, rainbow: 1500, rain: 1500,
    ko: 200, close: 1400, field: 800, bonk: 150, bonked: 300, leap: 200, dash: 150, douse: 300, wrap: 1500, boom: 300, ready: 600, alight: 400, singe: 200, bake: 400, ash: 400, snip: 300, drum: 300, crash: 300, aim: 400, call: 2000, snow: 1500, ember: 250, riser: 1500, stinger: 1500,
  };
  const RESUME_GRACE = 300;    // ms after unlock() in which cues may queue on a context still waking up
  const NOISE_SECONDS = 0.5;   // length of the one shared noise buffer
  const MUTED_KEY = 'barkbite-muted';
  const MUSIC_KEY = 'barkbite-music';
  const MUSIC_VOLUME = 0.55;   // the track, relative to the sound effects
  // ---------------------------------------------------------------------------

  let ctx = null;              // the one AudioContext, made on the first unlock()
  let master = null;           // master gain -> compressor -> speakers
  let musicBus = null;         // the track's own gain, into master
  let musicOn = readFlag(MUSIC_KEY, true);
  let noiseBuf = null, airBuf = null;
  let unsupported = false;
  let primed = false;
  let resumeAskedAt = -Infinity;
  let graceArmed = false;      // the wake-up grace is offered once per suspension...
  let graceCues = 0;           // ...and lets a single cue through
  let muted = readMuted();

  let voices = 0;              // cues still sounding
  let generation = 0;          // bumped when the voice count is reset, so late 'ended' events can't skew it
  let lastEnd = 0;             // context time when the last scheduled sound stops
  let building = null;         // the cue being scheduled right now: { pending }
  const lastPlayed = {};       // cue name -> ms timestamp

  // The pitch and volume of the cue being built; tone() and noise() apply them.
  let pitchMul = 1;
  let volMul = 1;
  let out = null; // where the cue being built goes: the master, or a panner placing it left or right

  const now = () => (window.performance && window.performance.now ? window.performance.now() : Date.now());
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function readFlag(key, fallback) {
    try { const v = window.localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
  }

  function readMuted() {
    try { return window.localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; }
  }

  function saveMuted() {
    try { window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
  }

  // ---- Setup ----------------------------------------------------------------

  function unlock() {
    if (unsupported) return false;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { unsupported = true; return false; }
        // Build everything first, and only keep the context once it's all there.
        const c = new AC();

        // A soft compressor catches the odd pile-up (four snakes eating at once) before it can clip.
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 18;
        comp.ratio.value = 4;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        comp.connect(c.destination);

        const m = c.createGain();
        m.gain.value = muted ? 0 : MASTER_VOLUME;
        m.connect(comp);

        const mb = c.createGain();
        mb.gain.value = musicOn ? MUSIC_VOLUME : 0;
        mb.connect(m);

        // White noise, made once and shared by every cue that needs a "tok" or a puff.
        const len = Math.floor(c.sampleRate * NOISE_SECONDS);
        const nb = c.createBuffer(1, len, c.sampleRate);
        const data = nb.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        // A longer noise loop for the weather beds (long enough not to sound like a loop).
        const alen = Math.floor(c.sampleRate * 2.5);
        const ab = c.createBuffer(1, alen, c.sampleRate);
        const ad = ab.getChannelData(0);
        for (let i = 0; i < alen; i++) ad[i] = Math.random() * 2 - 1;

        ctx = c; master = m; musicBus = mb; noiseBuf = nb; airBuf = ab; out = m;
        ctx.onstatechange = () => { if (ctx.state === 'running') graceArmed = false; };
      }

      // iOS only opens the speakers once something has played inside a gesture: one silent sample.
      if (!primed) {
        primed = true;
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.onended = () => src.disconnect();
        src.start(0);
      }

      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        if (!graceArmed) { graceArmed = true; graceCues = 0; resumeAskedAt = now(); }
        try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* old Safari */ }
      }
      return true;
    } catch {
      return false;
    }
  }

  // Sound is allowed once unlocked; a context still waking from unlock() counts for a moment,
  // so the very key press that unlocked it can still make its sound.
  function ready() {
    if (!ctx || muted) return false;
    if (ctx.state === 'running') return true;
    return ctx.state === 'suspended' && graceCues < 1 && now() - resumeAskedAt < RESUME_GRACE;
  }

  // ---- Building blocks ------------------------------------------------------

  // Stop a started source at `end` and unplug its little chain when it finishes.
  // The cue it belongs to stops counting as a voice when its last source ends.
  function finish(src, end, a, b) {
    const owner = building;
    owner.pending++;
    if (end > lastEnd) lastEnd = end;
    src.onended = () => {
      try { src.disconnect(); if (a) a.disconnect(); if (b) b.disconnect(); } catch { /* already gone */ }
      if (--owner.pending === 0 && owner.gen === generation) voices = Math.max(0, voices - 1);
    };
    src.stop(end);
  }

  // Quick rise to `peak`, then an exponential fall to silence: the shape of anything struck.
  function envelope(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // One oscillator through an envelope, optionally sliding to `toFreq` and softened by a lowpass.
  function tone(t, type, freq, dur, peak, attack, toFreq, lowpass) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitchMul, t);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq * pitchMul, t + dur);
    envelope(g, t, peak * volMul, attack, dur);
    let f = null;
    if (lowpass) {
      f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass * pitchMul;
      f.Q.value = 0.5;
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(out || master);
    osc.start(t);
    finish(osc, t + dur + 0.03, g, f);
    return osc;
  }

  // A slice of the shared noise through one filter: the "tok" of wood, a crunch, a puff of air.
  function noise(t, dur, peak, type, freq, q) {
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq * pitchMul;
    f.Q.value = q;
    envelope(g, t, peak * volMul, 0.003, dur);
    src.connect(f);
    f.connect(g);
    g.connect(out || master);
    src.start(t, Math.random() * Math.max(0, NOISE_SECONDS - dur - 0.05));
    finish(src, t + dur + 0.03, f, g);
  }

  // Marimba-ish note: a sine plus the quiet, slightly flat 4th-harmonic "bar" overtone,
  // which dies first. That overtone is what makes it sound like wood instead of a beep.
  function mallet(t, freq, dur, peak) {
    tone(t, 'sine', freq, dur, peak, 0.004);
    tone(t, 'sine', freq * 3.93, dur * 0.3, peak * 0.2, 0.002);
  }

  // Wood block: a short triangle that drops in pitch as it dies, plus a tick of bandpassed noise.
  function knock(t, freq, peak) {
    tone(t, 'triangle', freq * 1.4, 0.07, peak, 0.001, freq, freq * 3);
    noise(t, 0.02, peak * 0.45, 'bandpass', freq * 2.2, 4);
  }

  // Wobble an oscillator's pitch, fading the wobble out over `dur`.
  function vibrato(osc, t, dur, rate, depth) {
    const lfo = ctx.createOscillator();
    const g = ctx.createGain();
    lfo.frequency.value = rate;
    g.gain.setValueAtTime(depth * pitchMul, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lfo.connect(g);
    g.connect(osc.frequency);
    lfo.start(t);
    finish(lfo, t + dur + 0.03, g);
  }

  // ---- The cues ---------------------------------------------------------------

  const WIN_RUN = [[67, 0], [72, 0.1], [76, 0.2], [74, 0.3], [76, 0.4], [79, 0.5]]; // G4 C5 E5 D5 E5 G5
  const WIN_CHORD = [72, 76, 79, 84];                                               // C major, landing

  const CUES = {
    // Green apple: one bright marimba pluck around E5, nudged a hair up or down each time
    // so a long run of apples doesn't grate, with a crisp little bite of noise on top.
    eat(t) {
      mallet(t, mtof(76 + (Math.random() - 0.5) * 1.2), 0.12, 0.24);
      noise(t, 0.018, 0.07, 'highpass', 3500, 0.7);
    },

    // Golden apple: a quick rising G-B-D sparkle with a faint high shimmer hanging after it.
    golden(t) {
      mallet(t, mtof(79), 0.14, 0.26);
      mallet(t + 0.055, mtof(83), 0.14, 0.26);
      mallet(t + 0.11, mtof(86), 0.26, 0.28);
      tone(t + 0.11, 'sine', mtof(98), 0.32, 0.04, 0.03);
    },

    // Meat: a low, round "nom": a lowpassed triangle that sags in pitch over a soft sub,
    // with a muffled fleshy thump of noise.
    meat(t) {
      tone(t, 'triangle', 196, 0.16, 0.42, 0.006, 130, 900);
      tone(t, 'sine', 98, 0.14, 0.22, 0.006, 70);
      noise(t, 0.05, 0.1, 'lowpass', 900, 0.7);
    },

    // A beetle caught: a dry double crunch, a shell giving way, then a happy pluck.
    crunch(t) {
      noise(t, 0.035, 0.32, 'bandpass', 2600, 1.4);
      noise(t + 0.055, 0.04, 0.26, 'bandpass', 1900, 1.4);
      knock(t + 0.01, 1350, 0.12);
      mallet(t + 0.1, mtof(81), 0.14, 0.16);
    },

    // A beetle comes out: a tiny skittering of feet across the bark.
    beetle(t) {
      for (let i = 0; i < 5; i++) noise(t + i * 0.035, 0.012, 0.07 - i * 0.008, 'highpass', 5200, 0.8);
    },

    // Mushroom (shrink): a soft "boing" that wobbles downward like a spring settling.
    mushroom(t) {
      const osc = tone(t, 'sine', 620, 0.34, 0.3, 0.01, 210);
      vibrato(osc, t, 0.34, 13, 25);
      tone(t, 'triangle', 310, 0.3, 0.07, 0.01, 105, 700);
    },

    // A rival dies somewhere on the trunk: a muffled, far-off thud. Quiet on purpose.
    rivalDeath(t) {
      tone(t, 'triangle', 140, 0.2, 0.16, 0.008, 70, 400);
      noise(t, 0.08, 0.05, 'lowpass', 350, 0.7);
    },

    // Your snake dies: a soft impact, then two falling notes, a sigh from G3 down to D3,
    // over a sub and a low puff of noise. It thuds and lands; it never cracks. About 400 ms.
    death(t) {
      noise(t, 0.09, 0.2, 'lowpass', 900, 0.8); // the impact first...
      tone(t, 'sine', 90, 0.3, 0.32, 0.003, 38);
      tone(t, 'triangle', mtof(55), 0.2, 0.4, 0.006, mtof(53), 1100);
      tone(t + 0.15, 'triangle', mtof(50), 0.27, 0.44, 0.008, mtof(46), 800);
      tone(t + 0.15, 'sine', mtof(38), 0.26, 0.28, 0.01, mtof(34));
      noise(t + 0.13, 0.22, 0.09, 'lowpass', 700, 0.6);
    },

    // New personal best: a warm marimba fanfare climbing C-E-G to a held C6, the last note
    // doubled an octave below for warmth. About 600 ms.
    best(t) {
      mallet(t, mtof(72), 0.16, 0.34);
      mallet(t + 0.09, mtof(76), 0.16, 0.34);
      mallet(t + 0.18, mtof(79), 0.18, 0.36);
      mallet(t + 0.3, mtof(84), 0.32, 0.4);
      mallet(t + 0.3, mtof(72), 0.32, 0.18);
    },

    // Round won: a bouncier phrase that climbs, steps back, then lands on a soft rolled chord.
    win(t) {
      for (let i = 0; i < WIN_RUN.length; i++) mallet(t + WIN_RUN[i][1], mtof(WIN_RUN[i][0]), 0.16, 0.32);
      for (let i = 0; i < WIN_CHORD.length; i++) mallet(t + 0.64 + i * 0.018, mtof(WIN_CHORD[i]), 0.5, 0.2);
    },

    // Countdown tick: a plain wood block "tok".
    beat(t) {
      knock(t, 780, 0.32);
    },

    // The last countdown beat: a higher block with a small pluck on top, so it says "go".
    go(t) {
      knock(t, 1170, 0.36);
      mallet(t, mtof(79), 0.14, 0.16);
    },

    // The woodpecker lands: knock-knock-knock, quick and a little uneven like a real beak.
    woodpecker(t) {
      knock(t, 1400, 0.28);
      knock(t + 0.07, 1450, 0.24);
      knock(t + 0.135, 1380, 0.22);
    },

    // One pecked hole: a tiny tick that's more felt than heard (and rate-limited above).
    peck(t) {
      knock(t, 1500 + Math.random() * 200, 0.08);
    },

    // Starving: a soft, low tummy gurgle, two slow wobbles under a lowpass with a little air.
    hungry(t) {
      const a = tone(t, 'triangle', 95, 0.32, 0.22, 0.06, 68, 380);
      vibrato(a, t, 0.32, 7, 10);
      const b = tone(t + 0.26, 'triangle', 115, 0.36, 0.18, 0.06, 74, 380);
      vibrato(b, t + 0.26, 0.36, 9, 12);
      noise(t, 0.45, 0.04, 'lowpass', 260, 0.8);
    },

    // Lightning on its way: a dry, irregular crackle, high and quiet.
    crackle(t) {
      for (let i = 0; i < 9; i++) noise(t + i * 0.035 + Math.random() * 0.02, 0.012, 0.09, 'bandpass', 3200 + Math.random() * 2400, 2);
    },

    // The strike: a bright crack, then thunder rolling away (overlapping low puffs
    // of noise, each quieter, over a falling sub). Soft-edged, never a bang.
    thunder(t) {
      noise(t, 0.05, 0.22, 'highpass', 1800, 0.7);
      noise(t, 0.12, 0.2, 'bandpass', 900, 0.8);
      const rolls = [[0.04, 0.34, 320], [0.22, 0.28, 240], [0.48, 0.22, 200], [0.78, 0.16, 160], [1.1, 0.1, 130]];
      for (const [at, peak, f] of rolls) noise(t + at, 0.42, peak, 'lowpass', f, 0.7);
      tone(t + 0.03, 'sine', 62, 1.3, 0.2, 0.04, 38);
    },

    // A gust of wind: three puffs of air, the middle one highest.
    gust(t) {
      noise(t, 0.4, 0.06, 'bandpass', 520, 0.9);
      noise(t + 0.18, 0.42, 0.08, 'bandpass', 820, 0.9);
      noise(t + 0.4, 0.4, 0.05, 'bandpass', 600, 0.9);
    },

    // A burrow cracks open: bark giving way with a low creak, and a crumble.
    burrow(t) {
      knock(t, 420, 0.22);
      noise(t + 0.02, 0.09, 0.14, 'bandpass', 1300, 1.2);
      const creak = tone(t + 0.05, 'triangle', 190, 0.28, 0.08, 0.02, 130, 700);
      vibrato(creak, t + 0.05, 0.28, 23, 9);
      for (let i = 0; i < 3; i++) noise(t + 0.16 + i * 0.05, 0.02, 0.05, 'lowpass', 1100, 0.8);
    },

    // A beetle scrabbling into (or out of) its burrow.
    dig(t) {
      for (let i = 0; i < 4; i++) noise(t + i * 0.045, 0.025, 0.08 - i * 0.012, 'lowpass', 1000, 0.8);
    },

    // A rainbow: a soft shimmer climbing up a major arpeggio.
    rainbow(t) {
      [72, 76, 79, 83, 86, 91].forEach((m, i) => mallet(t + i * 0.06, mtof(m), 0.22, 0.14));
      tone(t + 0.3, 'sine', mtof(103), 0.5, 0.03, 0.08);
    },

    // The rain starts: a patter of drops.
    rain(t) {
      for (let i = 0; i < 14; i++) noise(t + Math.random() * 0.42, 0.01, 0.03 + Math.random() * 0.03, 'highpass', 3000 + Math.random() * 3000, 0.7);
    },

    // You took a rival out: a low punch, a crack, and two bright notes, up.
    ko(t) {
      tone(t, 'sine', 140, 0.22, 0.45, 0.003, 46);
      noise(t, 0.05, 0.22, 'bandpass', 1800, 1.1);
      mallet(t + 0.06, mtof(79), 0.14, 0.26);
      mallet(t + 0.14, mtof(84), 0.26, 0.3);
    },

    // Your crash: a hollow wooden bonk, a spring's boing as you bounce back, and
    // a little stars-round-your-head twinkle.
    bonk(t) {
      tone(t, 'sine', 210, 0.16, 0.5, 0.002, 90);
      noise(t, 0.05, 0.2, 'lowpass', 900, 0.8);
      tone(t + 0.04, 'triangle', 330, 0.3, 0.14, 0.01, 520);
      mallet(t + 0.16, mtof(88), 0.12, 0.08);
      mallet(t + 0.24, mtof(91), 0.12, 0.07);
      mallet(t + 0.32, mtof(88), 0.14, 0.06);
    },
    // A leap: a springy boing up and a whoosh of air.
    leap(t) {
      tone(t, 'triangle', 300, 0.22, 0.14, 0.005, 760);
      noise(t + 0.02, 0.18, 0.06, 'bandpass', 1800, 1.2);
      mallet(t + 0.18, mtof(84), 0.12, 0.07);
    },
    // A dash: a zip, rising fast, and a rush of air.
    dash(t) {
      tone(t, 'sawtooth', 260, 0.16, 0.08, 0.004, 1400, 2400);
      noise(t, 0.2, 0.12, 'bandpass', 2600, 0.9);
      mallet(t + 0.12, mtof(91), 0.1, 0.06);
    },
    // A fire put out: a hiss of steam.
    douse(t) {
      noise(t, 0.4, 0.1, 'highpass', 3600, 0.7);
      noise(t + 0.03, 0.25, 0.05, 'bandpass', 1200, 1.4);
    },
    // A golden mushroom: the edges open, a shimmer of bells going up and round.
    wrap(t) {
      [72, 79, 84, 88, 91, 96].forEach((n, i) => mallet(t + i * 0.06, mtof(n), 0.3, 0.07));
      tone(t, 'sine', 440, 0.6, 0.04, 0.05, 880);
    },
    // Blown up (a dash into the edge or a hole): a bang and a rumble.
    boom(t) {
      noise(t, 0.6, 0.35, 'lowpass', 500, 0.7);
      tone(t, 'sine', 120, 0.5, 0.4, 0.002, 38);
      noise(t + 0.02, 0.18, 0.15, 'bandpass', 1600, 0.8);
    },
    // Your leap's ready again: a soft tick.
    ready(t) {
      mallet(t, mtof(86), 0.12, 0.05);
    },
    // Someone else's crash: a dull thud off to the side.
    bonked(t) {
      tone(t, 'sine', 170, 0.12, 0.22, 0.002, 80);
      noise(t, 0.04, 0.08, 'lowpass', 700, 0.8);
    },
    // You catch fire: a whoosh of flame and a crackle.
    alight(t) {
      noise(t, 0.45, 0.2, 'bandpass', 700, 0.7);
      noise(t + 0.05, 0.3, 0.08, 'highpass', 3000, 0.7);
      tone(t, 'sawtooth', 90, 0.35, 0.05, 0.05, 140, 500);
    },
    // A piece of you falls off in the flames: a hiss and a pop.
    singe(t) {
      noise(t, 0.14, 0.09, 'highpass', 2500, 0.8);
      tone(t + 0.02, 'sine', 600, 0.05, 0.08, 0.002, 300);
    },
    // Something's done in the fire: a sizzle and a pop.
    bake(t) {
      noise(t, 0.3, 0.06, 'bandpass', 4200, 1.2);
      tone(t + 0.12, 'sine', 900, 0.06, 0.08, 0.002, 500);
    },
    // Gone to ash: a soft puff.
    ash(t) {
      noise(t, 0.25, 0.07, 'lowpass', 600, 0.7);
    },
    // The woodpecker takes your tail: a sharp snap.
    snip(t) {
      noise(t, 0.04, 0.25, 'bandpass', 2400, 2);
      tone(t, 'square', 1200, 0.04, 0.05, 0.001, 600, 3000);
    },

    // Into a rival's force field: an electric hum swelling, a shimmer over it.
    field(t) {
      tone(t, 'sawtooth', 110, 0.5, 0.045, 0.1, null, 800);
      tone(t, 'sawtooth', 111.6, 0.5, 0.04, 0.1, null, 800);
      tone(t, 'sine', 1760, 0.4, 0.025, 0.06, 2350);
      noise(t, 0.3, 0.025, 'bandpass', 3200, 2);
    },

    // A near miss (your head right by a rival's): air tearing past, and a gasp of a tick.
    close(t) {
      noise(t, 0.16, 0.13, 'bandpass', 2600, 1.6);
      noise(t + 0.07, 0.2, 0.1, 'bandpass', 1100, 1.4);
      tone(t, 'triangle', 1900, 0.05, 0.05, 0.001, 1500);
    },

    // The woodpecker drumming a chunk out: a burst of knocks, fast then slowing, like the real thing.
    drum(t) {
      let at = t;
      for (let i = 0; i < 14; i++) { knock(at, 1250 + (i % 3) * 60, 0.2 - i * 0.008); at += 0.034 + i * 0.003; }
    },

    // The chunk giving way: a woody crunch over a low thud.
    crash(t) {
      noise(t, 0.16, 0.26, 'bandpass', 850, 0.9);
      noise(t + 0.03, 0.22, 0.14, 'lowpass', 400, 0.7);
      tone(t, 'triangle', 110, 0.3, 0.3, 0.004, 55, 500);
    },

    // It takes aim: two rising ticks over a low pulse (and the music tightens).
    aim(t) {
      knock(t, 900, 0.14);
      knock(t + 0.12, 1180, 0.16);
      tone(t, 'sine', 70, 0.35, 0.16, 0.02, 62);
    },

    // It arrives: a woodpecker's sharp "kik! kik! kik!" and a beat of wings.
    call(t) {
      for (let i = 0; i < 3; i++) {
        tone(t + i * 0.13, 'triangle', 2350, 0.07, 0.16, 0.002, 1900, 5000);
        tone(t + i * 0.13, 'sine', 4700, 0.04, 0.04, 0.002);
      }
      for (let i = 0; i < 3; i++) noise(t + 0.45 + i * 0.09, 0.07, 0.07, 'lowpass', 700, 0.8);
    },

    // Winter arrives: glassy bells, high and slow, over a breath of cold air.
    snow(t) {
      [88, 91, 93, 96, 98].forEach((m, i) => mallet(t + i * 0.11 + (i % 2) * 0.03, mtof(m), 0.6, 0.06));
      noise(t, 0.45, 0.03, 'highpass', 5000, 0.7);
    },

    // A burning leaf blown off: a whoosh and a crackle.
    ember(t) {
      noise(t, 0.18, 0.06, 'bandpass', 900, 1);
      for (let i = 0; i < 4; i++) noise(t + 0.05 + i * 0.03, 0.01, 0.05, 'bandpass', 3600, 2);
    },

    // Tension building: rising air and a rising tone (the countdown's last beat, the last two snakes).
    riser(t) {
      tone(t, 'sine', 220, 0.9, 0.08, 0.6, 660);
      tone(t, 'triangle', 330, 0.9, 0.04, 0.6, 990, 2000);
      noise(t, 0.45, 0.04, 'bandpass', 1500, 0.8);
      noise(t + 0.4, 0.45, 0.06, 'bandpass', 3200, 0.8);
    },

    // First blood: a dark stab (a low minor chord struck together) with a hit of noise.
    stinger(t) {
      for (const m of [45, 48, 52, 57]) mallet(t, mtof(m), 0.6, 0.12);
      tone(t, 'sine', 55, 0.5, 0.25, 0.005, 40);
      noise(t, 0.08, 0.14, 'lowpass', 1200, 0.8);
    },

    // Buttons and toggles: a barely-there wood tap.
    ui(t) {
      knock(t, 1250, 0.06);
    },
  };

  // ---- Playing --------------------------------------------------------------

  function play(name, opts) {
    const cue = CUES[name];
    if (!cue || !ready()) return;

    const ms = now();
    if (ms - (lastPlayed[name] ?? -Infinity) < (MIN_INTERVAL[name] || 0)) return;

    // If onended never arrived (it can go missing), the clock still tells us everything has stopped.
    if (voices > 0 && ctx.currentTime > lastEnd + 0.5) { voices = 0; generation++; }
    if (voices >= MAX_VOICES && !PRIORITY[name]) return;

    const pitch = opts && Number.isFinite(opts.pitch) ? Math.max(-24, Math.min(24, opts.pitch)) : 0;
    const volume = opts && Number.isFinite(opts.volume) ? Math.min(1, Math.max(0, opts.volume)) : 1;
    if (volume <= 0) return;

    lastPlayed[name] = ms;
    pitchMul = Math.pow(2, pitch / 12);
    volMul = volume;
    out = master;
    if (opts && Number.isFinite(opts.pan) && ctx.createStereoPanner) {
      try { out = ctx.createStereoPanner(); out.pan.value = Math.max(-1, Math.min(1, opts.pan)); out.connect(master); } catch { out = master; }
    }
    building = { pending: 0, gen: generation };
    voices++;
    if (ctx.state !== 'running') graceCues++;
    try {
      cue(ctx.currentTime + 0.005);
    } catch {
      /* a half-built cue just plays what it managed to schedule */
    } finally {
      if (building.pending === 0) voices = Math.max(0, voices - 1);
      building = null;
    }
  }

  // ---- Music ----------------------------------------------------------------
  //
  // An adaptive track, written note by note on the audio clock. The game calls
  // music(stage, mood) every frame; this schedules the next quarter second of
  // sixteenth notes and moves between arrangements at bar lines, so changes
  // always land on the beat.
  //
  //   stage: 'title'   a slow, calm marimba loop (start screen, round over)
  //          'early'   the loop plus a soft bass
  //          'mid'     a light shaker joins, and the tempo creeps up with the game
  //          'sudden'  the woodpecker is here: a minor key, wood-block knocks
  //          'duel'    the last two snakes: faster, tense, a heartbeat kick
  //          'off'     silence
  //   mood:  { intensity: 0..1, watching: bool, paused: bool, danger: 0..1 }
  //
  // Danger (your head close to a rival's, or boxed in) brings in a heartbeat,
  // drives the bass, and lets a dissonant high note creep into the tune.
  //
  // Everything is quiet and round: sine and triangle tones, short envelopes,
  // through its own bus so the music can be switched off on its own.

  const ARRANGEMENTS = {
    // bpm, the chord roots for the 4-bar loop (MIDI), the scale degrees of each
    // chord, and which layers play.
    title: { bpm: 84, roots: [48, 45, 41, 43], minor: false, arp: 'quarter', bass: false, shaker: false, knocks: false, kick: false, pad: true },
    early: { bpm: 94, roots: [48, 45, 41, 43], minor: false, arp: 'eighth', bass: true, shaker: false, knocks: false, kick: false, pad: true },
    mid: { bpm: 102, roots: [48, 45, 41, 43], minor: false, arp: 'eighth', bass: true, shaker: true, knocks: false, kick: false, pad: true, bells: true },
    sudden: { bpm: 108, roots: [45, 41, 48, 40], minor: true, arp: 'eighth', bass: true, shaker: true, knocks: true, kick: false, pad: true, toms: true },
    duel: { bpm: 124, roots: [45, 41, 43, 40], minor: true, arp: 'sixteenth', bass: true, shaker: true, knocks: true, kick: true, hats: true },
  };
  // Chord shapes over each root: major-ish for the calm loops, minor for the tense ones.
  const SHAPE_MAJOR = [[0, 4, 7, 12], [0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 11]]; // C  Am  F  G(maj7-ish)
  const SHAPE_MINOR = [[0, 3, 7, 12], [0, 4, 7, 12], [0, 4, 7, 12], [0, 4, 7, 10]]; // Am F  C  E7
  const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3];
  const LOOKAHEAD = 0.25;      // seconds of music scheduled ahead of the audio clock

  let stageNow = 'off', stageWanted = 'off';
  let step = 0;                // sixteenth-note counter within the 4-bar loop (0..63)
  let nextAt = 0;              // audio-clock time of the next sixteenth
  let tempo = 90;
  let musicLevel = 1;          // ducking for watching / paused, eased

  function setMusicOn(value) {
    musicOn = !!value;
    try { window.localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'); } catch { /* storage unavailable */ }
    if (musicBus) {
      try { musicBus.gain.setTargetAtTime(musicOn ? MUSIC_VOLUME * musicLevel : 0, ctx.currentTime, 0.08); } catch { /* ignore */ }
    }
    return musicOn;
  }
  const isMusicOn = () => musicOn;
  const toggleMusic = () => setMusicOn(!musicOn);

  // One music note straight to the music bus: no voice counting, it ends itself.
  function mtone(t, type, freq, dur, peak, attack, toFreq, lowpass) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    envelope(g, t, peak, attack, dur);
    let f = null;
    if (lowpass) {
      f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      osc.connect(f);
      f.connect(g);
    } else osc.connect(g);
    g.connect(musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); if (f) f.disconnect(); } catch { /* gone */ } };
  }

  function mnoise(t, dur, peak, type, freq, q) {
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    envelope(g, t, peak, 0.002, dur);
    src.connect(f);
    f.connect(g);
    g.connect(musicBus);
    src.start(t, Math.random() * Math.max(0, NOISE_SECONDS - dur - 0.05));
    src.stop(t + dur + 0.03);
    src.onended = () => { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }

  // A soft marimba note for the track (the cue mallet, quieter and voice-free).
  function mmallet(t, midi, dur, peak) {
    const f = mtof(midi);
    mtone(t, 'sine', f, dur, peak, 0.004);
    mtone(t, 'sine', f * 3.93, dur * 0.3, peak * 0.15, 0.002);
  }

  // Schedule one sixteenth of the current arrangement at audio time t.
  function scheduleStep(a, s, t, watching) {
    const bar = Math.floor(s / 16) % 4, inBar = s % 16;
    const root = a.roots[bar];
    const shape = (a.minor ? SHAPE_MINOR : SHAPE_MAJOR)[bar];
    const quiet = watching ? 0.6 : 1;

    // Bells, high and sparse, answering the tune in the middle of the round.
    if (a.bells && bar % 2 === 1 && (inBar === 6 || inBar === 14)) mmallet(t, root + 24 + shape[inBar === 6 ? 2 : 3], 0.5, 0.035 * quiet);
    // The marimba line: chord tones an octave and a half up, in a rocking order.
    const every = a.arp === 'quarter' ? 4 : a.arp === 'eighth' ? 2 : 1;
    if (inBar % every === 0) {
      const i = ARP_ORDER[(inBar / every) % ARP_ORDER.length];
      const accent = inBar % 4 === 0 ? 1 : 0.75;
      mmallet(t, root + 12 + shape[i], a.arp === 'quarter' ? 0.5 : 0.22, 0.09 * accent * quiet);
    }
    // A long, low note on the downbeat of each bar under the calm loop.
    if (!a.bass && inBar === 0) mtone(t, 'sine', mtof(root - 12), 1.8, 0.05 * quiet, 0.08);

    // Bass: root on beats 1 and 3, fifth as a pickup.
    if (a.bass) {
      if (inBar === 0 || inBar === 8) mtone(t, 'triangle', mtof(root - 12), 0.32, 0.12 * quiet, 0.008, null, 600);
      else if (inBar === 14) mtone(t, 'triangle', mtof(root - 5), 0.14, 0.07 * quiet, 0.008, null, 600);
    }
    if (watching) return; // watching: just the tune, no percussion

    // Shaker on the off-beats.
    if (a.shaker && inBar % 4 === 2) mnoise(t, 0.04, 0.035, 'highpass', 6000, 0.7);
    // Wood-block knocks on beats 2 and 4, an extra one before the bar line.
    if (a.knocks && (inBar === 4 || inBar === 12 || inBar === 15)) {
      mtone(t, 'triangle', inBar === 15 ? 1500 : 1150, 0.06, 0.07, 0.001, inBar === 15 ? 1100 : 820, 3000);
    }
    // A soft heartbeat kick for the duel.
    if (a.kick && (inBar === 0 || inBar === 3 || inBar === 8 || inBar === 11)) {
      mtone(t, 'sine', 110, 0.16, 0.16, 0.004, 48);
    }
    // Sudden death: low toms rolling round the bar.
    if (a.toms && (inBar === 6 || inBar === 7 || inBar === 14)) mtone(t, 'sine', inBar === 7 ? 150 : 120, 0.2, 0.1, 0.004, 70);
    // The duel: closed hats on every sixteenth, accented on the beat.
    if (a.hats) mnoise(t, 0.025, inBar % 4 === 0 ? 0.03 : 0.015, 'highpass', 8000, 0.7);
  }

  // A soft pad under the calm loops: the bar's chord, held, swelling in.
  function schedulePad(a, s, t, watching) {
    if (s % 16 !== 0 || !a.pad) return;
    const bar = Math.floor(s / 16) % 4, root = a.roots[bar], shape = (a.minor ? SHAPE_MINOR : SHAPE_MAJOR)[bar];
    const len = 16 * 60 / tempo / 4;
    for (const i of [0, 1, 2]) {
      mtone(t, 'triangle', mtof(root + 12 + shape[i]), len, (watching ? 0.016 : 0.022), len * 0.35, null, 900);
      mtone(t, 'sine', mtof(root + 12 + shape[i]) * 1.004, len, 0.016, len * 0.35); // (a hair detuned: it breathes)
    }
  }

  // The danger layer: a heartbeat (lub-dub on the beat), a driven bass, a
  // dissonance creeping in on top. danger: 0..1.
  function scheduleDanger(a, s, t, danger) {
    if (danger < 0.25) return;
    const inBar = s % 16, bar = Math.floor(s / 16) % 4, root = a.roots[bar];
    if (inBar % 4 === 0) {
      mtone(t, 'sine', 62, 0.14, 0.22 * danger, 0.004, 42);
      mtone(t + 0.13, 'sine', 56, 0.12, 0.15 * danger, 0.004, 40);
    }
    if (inBar % 2 === 1) mtone(t, 'triangle', mtof(root - 12), 0.1, 0.07 * danger, 0.004, null, 500);
    if (danger > 0.6 && (inBar === 2 || inBar === 10)) mmallet(t, root + 25, 0.18, 0.05 * danger); // a minor second, uneasy
  }

  // Called every frame by the game. Cheap when nothing is due.
  function music(stage, mood) {
    if (!ctx || ctx.state !== 'running' || !musicOn || muted) { stageWanted = stage; return; }
    stageWanted = stage;
    const intensity = mood && Number.isFinite(mood.intensity) ? Math.max(0, Math.min(1, mood.intensity)) : 0;
    const watching = !!(mood && mood.watching);
    const danger = mood && Number.isFinite(mood.danger) ? Math.max(0, Math.min(1, mood.danger)) : 0;
    const level = mood && mood.paused ? 0.35 : watching ? 0.7 : 1;
    if (Math.abs(level - musicLevel) > 0.01) {
      musicLevel = level;
      try { musicBus.gain.setTargetAtTime(MUSIC_VOLUME * musicLevel, ctx.currentTime, 0.25); } catch { /* ignore */ }
    }
    if (stageNow === 'off' && stageWanted !== 'off') { stageNow = stageWanted; step = 0; nextAt = ctx.currentTime + 0.05; }
    if (stageNow === 'off') return;
    // Fell behind (the tab was asleep): skip ahead rather than play a burst of notes.
    if (nextAt < ctx.currentTime - 0.1) nextAt = ctx.currentTime + 0.05;

    while (nextAt < ctx.currentTime + LOOKAHEAD) {
      // Arrangement changes wait for the next bar line.
      if (step % 16 === 0 && stageWanted !== stageNow) {
        stageNow = stageWanted;
        if (stageNow === 'off') return;
      }
      const a = ARRANGEMENTS[stageNow] || ARRANGEMENTS.title;
      tempo = a.bpm * (stageNow === 'early' || stageNow === 'mid' ? 1 + 0.15 * intensity : 1);
      try {
        scheduleStep(a, step, nextAt, watching);
        schedulePad(a, step, nextAt, watching);
        if (!watching) scheduleDanger(a, step, nextAt, danger);
      } catch { /* a dropped note is fine */ }
      nextAt += 60 / tempo / 4;
      step = (step + 1) % 64;
    }
  }

  // ---- The weather ----------------------------------------------------------
  //
  // Beds of filtered noise that loop under the music (on the music bus, so the
  // music switch silences them too): rain hisses, wind gusts (its loudness
  // swells and falls), a storm rumbles low under a little rain, snow is a
  // high, airy hush. A new kind fades in as the old one fades out.
  const BEDS = {
    rain: [['bandpass', 1800, 0.6, 0.05], ['highpass', 5000, 0.7, 0.02]],
    wind: [['lowpass', 520, 0.9, 0.08, true]],
    storm: [['lowpass', 140, 0.8, 0.14], ['bandpass', 1500, 0.6, 0.02]],
    snow: [['highpass', 6000, 0.7, 0.012], ['lowpass', 300, 0.7, 0.02, true]],
  };
  let bedKind = 'none', bedNodes = [];
  function weather(kind) {
    kind = BEDS[kind] ? kind : 'none';
    if (kind === bedKind || !ctx || unsupported) return;
    bedKind = kind;
    const t = ctx.currentTime;
    for (const n of bedNodes) { // the old bed fades
      try { n.g.gain.setTargetAtTime(0, t, 0.6); n.src.stop(t + 3); } catch { /* gone */ }
    }
    bedNodes = [];
    if (kind === 'none' || !airBuf || !musicBus) return;
    for (const [type, freq, q, level, gusty] of BEDS[kind]) {
      try {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = airBuf; src.loop = true;
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.value = 0;
        g.gain.setTargetAtTime(level, t, 0.8);
        src.connect(f); f.connect(g); g.connect(musicBus);
        if (gusty) { // the wind swells and falls
          const lfo = ctx.createOscillator(), depth = ctx.createGain();
          lfo.frequency.value = 0.13; depth.gain.value = level * 0.8;
          lfo.connect(depth); depth.connect(g.gain);
          lfo.start(t);
          src.onended = () => { try { lfo.stop(); lfo.disconnect(); depth.disconnect(); } catch { /* gone */ } };
        }
        src.start(t, Math.random() * 2);
        const prev = src.onended;
        src.onended = () => { try { prev?.(); src.disconnect(); f.disconnect(); g.disconnect(); } catch { /* gone */ } };
        bedNodes.push({ src, g });
      } catch { /* the weather stays quiet */ }
    }
  }

  // ---- Mute -----------------------------------------------------------------

  function setMuted(value) {
    muted = !!value;
    saveMuted();
    // Fade anything already sounding rather than cutting it with a click.
    if (master) {
      try { master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02); } catch { /* ignore */ }
    }
    return muted;
  }

  const isMuted = () => muted;
  const toggleMuted = () => setMuted(!muted);

  return { unlock, play, setMuted, isMuted, toggleMuted, music, weather, setMusicOn, isMusicOn, toggleMusic };
})();
