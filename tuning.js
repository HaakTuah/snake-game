// Every number that controls how Bark & Bite plays and feels, in one place.
// Rules are read by engine.js (and by the headless simulator); feel and juice
// by snake.js and render.js. Times are in milliseconds unless noted.
window.TUNING = Object.freeze({
  // ------------------------------------------------------------- the board
  GRID: 24,                 // cells per side
  OPPONENTS: 3,             // AI rivals in a normal round (an AI-only round has one more)

  // ------------------------------------------------------------------ food
  APPLES: 3,                // green apples on the board at all times (+1)
  APPLE_TICKS: 110,         // an apple rots away after about this many ticks (give or take a quarter: about 8-16 s), and another drops somewhere
  MUSHROOMS: 2,             // red mushrooms on the board at all times
  MUSHROOM_TICKS: 180,      // a mushroom withers (and regrows elsewhere) after this many ticks
  GOLDEN_CHANCE: 0.004,     // chance per tick of a golden apple, while there is none
  GOLDEN_TICKS: 120,        // a golden apple rots after this many ticks
  GOLDEN_GROWTH: 3,         // a golden apple is worth this much
  BEETLE_FIRST_MS: 15000,   // beetles start coming out after this long...
  BEETLE_CHANCE: 0.006,     // ...with this chance per tick, while there is none (and no woodpecker)
  BEETLE_TICKS: 260,        // a beetle nobody catches flies off after this many ticks
  BEETLE_EVERY: 3,          // it crawls one cell every this many ticks...
  BEETLE_SCARED_EVERY: 2,   // ...or every 2, scurrying away (half a snake's speed: a chase you can win)...
  BEETLE_FEAR: 4,           // ...from any head within this many cells
  BEETLE_GROWTH: 2,         // a beetle is worth this much
  // Powers. Everyone can leap: press the way you're going and you hop one
  // cell (a body, a hole or fire) and land on the next, two cells in two
  // ticks, for the tip of your tail; then it needs a moment.
  LEAP_COST: 1,             // a leap costs this many segments off the tail (and needs more than MIN_LENGTH)...
  LEAP_COOLDOWN_MS: 4000,   // ...and can't be done again for this long
  LEAP_WINDOW: 3,           // pressing the way you're going: the power waits this many ticks for something to hop
  GOLD_BEETLE_CHANCE: 0.3,  // a beetle coming out is a golden one this often: catch it for golden leaps (three cells in two ticks, hopping up to two; free)...
  LEAP_CHARGES: 2,          // ...this many (up to LEAP_MAX held at once)
  LEAP_MAX: 3,
  LEAF_CHANCE: 0.07,        // wind: each gust might blow a golden leaf onto the log (one at a time): dashes...
  LEAF_TICKS: 90,           // ...it blows away after this many ticks
  DASH_CHARGES: 2,          // ...this many: three cells in one tick, cutting through a snake one cell thick and putting out fire (the edge or a hole: you blow up)
  DASH_LENGTH: 3,
  GOLDCAP_CHANCE: 0.12,     // rain: once in a while a golden mushroom comes up (one a spell, at most)...
  GOLDCAP_TICKS: 120,       // ...and withers after this many ticks
  WRAP_MS: 12000,           // ...eat it, and for this long the edges wrap round (off one side, in at the other)
  SHRINK: 3,                // a mushroom takes this many segments off...
  MIN_LENGTH: 3,            // ...but never below this
  START_LENGTH: 4,          // every snake starts this long: one more than the least, so a first crash costs a segment, not the round

  // --------------------------------------------------------------- crashes
  // A crash (into the edge, a hole, a body, or head-on) isn't the end: your
  // head bounces back, the tail breaks off as food, and you're stunned a
  // moment. You're out if you crash at MIN_LENGTH, or with nowhere to turn.
  CRASH_LOSS: 3,            // segments a crash knocks off your tail (never below MIN_LENGTH)...
  STUN_TICKS: 4,            // ...and how long it stuns you (you can steer meanwhile)

  // ---------------------------------------------------------- fire and food
  BURN_TICKS: 18,           // crawl into fire and you burn this long (3 segments: like a crash, but you keep moving)...
  BURN_EVERY: 6,            // ...losing a segment this often (out, at MIN_LENGTH)...
  BURN_RAIN_TICKS: 6,       // ...though rain or snow puts you out within this many ticks
  COOK_TICKS: 18,           // food in the fire bakes after burning this long (a baked apple, a roast)...
  ASH_TICKS: 45,            // ...and goes to ash after this long
  COOKED_GROWTH: 2,         // baked food is worth this much

  // ---------------------------------------------------------------- hunger
  HUNGER_MS: 20000,         // this long without food (mushrooms don't count) and you start shrinking
  STARVE_EVERY_MS: 1500,    // ...one segment this often, starving at MIN_LENGTH
  HUNGER_WARN_MS: 6000,     // warn you when this much time is left

  // ----------------------------------------------------------------- speed
  OPENING_TICK: 170,        // the first ticks of a round are slower, so the start is forgiving...
  OPENING_TICKS: 3,         // ...for this many ticks, easing down to START_TICK
  START_TICK: 120,          // ms per tick once the round is underway
  MIN_TICK: 90,             // the fastest it ever gets...
  RAMP_MS: 120000,          // ...reached after this much game time (a gentle 25% speed-up)
  MUSIC_MID_MS: 45000,      // the soundtrack picks up (shaker, faster) after this much game time

  // ---------------------------------------------------------- sudden death
  SUDDEN_DEATH_MS: 120000,  // the woodpecker arrives after two minutes; no new food after that
  PECK_ARRIVE_TICKS: 12,    // it lands, has a look round...
  PECK_CHUNK: 7,            // ...then takes out a patch of this many cells somewhere on the log...
  PECK_AIM_TICKS: 17,       // ...eyeing it this long first (everyone sees where: about a second and a half)...
  PECK_REST_TICKS: 36,      // ...and resting this long after its first strike (about 3.5 s)...
  PECK_HUNGRIER: 0.85,      // ...but it gets hungrier: each rest this much of the one before (down to PECK_REST_MIN)...
  PECK_REST_MIN: 12,
  PECK_CHUNK_MAX: 14,       // ...and each patch a cell bigger than the last (up to this)
  PECK_CLEARANCE: 2,        // it aims clear of every body and food, this far from every head, while there's such a spot

  // --------------------------------------------------------------- burrows
  BURROW_MAX: 3,            // beetle burrows that crack open in the bark over a round (harmless to cross)
  BURROW_NEW_CHANCE: 0.5,   // a beetle coming out opens a new burrow this often (always, if none is free)
  BEETLE_UNDER_MIN: 8,      // a scared beetle that reaches a burrow dives in, and comes out of one after this many ticks...
  BEETLE_UNDER_MAX: 16,     // ...up to this many

  // --------------------------------------------------------------- weather
  WEATHER_FIRST_MS: 15000,  // the first spell of weather comes after this long...
  CLEAR_MIN_MS: 8000,       // ...and a clear spell between the others lasts this long...
  CLEAR_MAX_MS: 16000,
  SPELL_MIN_MS: 12000,      // ...a spell of weather this long
  SPELL_MAX_MS: 18000,
  WEATHER_ODDS: Object.freeze({ sun: 2, wind: 3, rain: 3, storm: 3, snow: 2 }), // how likely each spell is...
  STORM_FROM_MS: 30000,     // ...(no storms before this)
  SUN_GOLDEN: 5,            // sun: golden hour, golden apples this many times as likely
  GUST_EVERY_MS: 3500,      // wind: a gust this often, knocking an apple loose...
  WINDFALL_MAX: 3,          // ...up to this many apples more than usual
  RAIN_MUSHROOMS: 2,        // rain: this many more mushrooms sprout
  RAINBOW_CHANCE: 0.5,      // when rain stops: a rainbow, with a golden apple at its end
  SNOW_APPLES: 1,           // winter, the lean season: one apple (rotting twice as fast), no new mushrooms, no golden apples...
  SNOW_HUNGER: 1.75,        // ...and everyone gets hungry this many times as fast (it's cold)
  AFTER_STORM_RAIN: 0.6,    // a storm is often followed by rain
  STRIKE_MIN_MS: 2000,      // storm: lightning this often...
  STRIKE_MAX_MS: 4000,
  STRIKE_WARN_TICKS: 10,    // ...crackling where it will strike for this many ticks first (about a second)...
  STRIKE_CLEARANCE: 4,      // ...never within this many cells of a head
  FIRE_TICKS: 50,           // a burning cell burns this long (about 5 s) and sets alight a head that enters it...
  FIRE_SMOLDER_TICKS: 4,    // ...after smouldering (harmless) this long when fire spreads to it
  FIRE_SPREAD: 0.1,         // each tick, each burning cell catches a neighbour with this chance...
  FIRE_MAX: 6,              // ...but one strike's fire covers at most this many cells...
  FIRE_BOARD_MAX: 30,       // ...and the whole board at most this many
  RAIN_DOUSE_TICKS: 6,      // rain (or snow) puts a fire out within this many ticks
  EMBER_CHANCE: 0.025,      // wind (and storms): each tick, a burning cell flings a burning leaf with this chance...
  EMBER_REACH: 4,           // ...up to this many cells downwind (2 at least)...
  EMBER_SMOLDER_TICKS: 8,   // ...where it smoulders this long (a jump is a surprise, so more warning)...
  EMBER_FIRE_TICKS: 22,     // ...then burns this long, a small fire that doesn't spread

  // --------------------------------------------------------------------- AI
  REACTION_MS: 240,         // how stale every AI's view of the other snakes is
  HISTORY: 8,               // board snapshots kept for that delay
  AI_HUNGRY_MS: 10000,      // with this long left before starving, an AI starts looking for food, harder as it gets closer

  // ------------------------------------------------------------- the round
  COUNTDOWN_BEAT: 350,      // 3, 2, 1: each beat this long (any direction skips it)
  DEATH_FREEZE: 350,        // freeze-frame when you die, before the card rises
  ROUND_END_PAUSE: 600,     // let the last moment breathe before the round-over card
  MAX_FRAME_MS: 250,        // after a stall (a busy machine, a debugger), the round moves on at most this much...
  MAX_CATCHUP: 4,           // ...and catches up at most this many ticks in one frame

  // ----------------------------------------------------------------- input
  QUEUE: 3,                 // turns you can queue ahead
  SWIPE_CELLS: 0.5,         // a swipe registers after the finger travels this many cells...
  SWIPE_MIN_PX: 12,         // ...and at least this far (about 3 mm), so a jittery finger doesn't turn

  // ---------------------------------------------------------------- online
  HOST_DELAY_MAX: 150,      // the host's turns wait a friend's round trip, but never longer than this
  AWAY_MS: 750,             // a friend silent this long gets an AI at the wheel...
  AWAY_TOAST_MS: 2000,      // ...and a banner if it lasts this long

  // ------------------------------------------------------------------ juice
  PARTICLES_EAT: 10,        // particles in an eating pop
  PARTICLES_DEATH: 26,      // particles when a snake dies
  PARTICLE_LIFE: 520,       // how long a particle lives
  SHAKE_PX: 4,              // board shake when you die (none with reduced motion)
  SHAKE_MS: 220,
  BLINK_MIN: 2600,          // snakes blink every BLINK_MIN..BLINK_MAX ms...
  BLINK_MAX: 6000,
  BLINK_MS: 130,            // ...for this long
  TONGUE_EVERY: 2800,       // every snake flicks its tongue about this often (each at its own rate; more near food for you and Gobbler)
  TONGUE_MS: 260,
  GLANCE_EASE: 0.18,        // how quickly eyes turn toward what a snake is looking at (per frame, 0..1)
  GULP: 0.2,                // a bite's bulge travelling down the body (cells added to the radius)...
  GULP_LENGTH: 1.3,         // ...and how many segments it spans
  GOBBLE: 0.34,             // Gobbler wolfs it down: a bigger, longer gulp
  GOBBLE_LENGTH: 2,
  BITE_MS: 240,             // the head's little squash at the moment of a bite
  CHEW_MS: 420,             // and the mouth's chewing after it
  CHEEKS_MS: 900,           // Gobbler's cheeks puff up at a bite and go down over this long
  FLOAT_MS: 700,            // a "+1" rises and fades over this long
  MOOD_RING_MS: 900,        // Capricious's ring flashing out when its mood changes
  GOLDEN_DIM_TICKS: 30,     // a golden apple dims (calmly) over its last this-many ticks
  CORPSE_FADE_MS: 250,      // with reduced motion, a dead snake fades over this long instead of bursting
});
