# Bark & Bite

A snake game on a mossy log: you against three AI rivals on a fallen log in the woods, drawn at random each round from a cast of seventeen. Plays in the browser, on desktop and phone. Plain HTML, CSS and JavaScript, with no build step, no dependencies and no asset files: every picture is drawn and every sound is synthesised in the page.

**Play:** https://haaktuah.github.io/snake-game/

## Rules

- Four snakes share a 24×24 stretch of mossy log: you (green, with a glowing cream outline) and three AI rivals. From the countdown until a few seconds in, a bouncing arrow says **YOU** over your head, with chevrons showing which way you're going (online, each player sees their own, and friends' names). Watch their eyes: each one looks at whatever it's after.
- **Crashes hurt, they don't kill (mostly).** Hit the edge, a hole, any snake's body or another snake's head and your head bounces back: you lose 3 segments off your tail (they break off as beads anyone can eat) and you're stunned for a moment, stars round your head. Steer meanwhile, and you go your way when it's over; if you don't, you turn to where there's room. **You're out** if you crash when you're at your smallest (3), or if there'll be nowhere to turn when the stun's over (a tail that'll have moved on by then counts as room). Two snakes meeting head-on with nowhere to turn: the longer one bounces, the shorter one's out (the same length: both). Everyone starts at 4, so your first crash costs one segment, not the round; after that, every apple is armour: the longer you are, the more knocks you can take.
- When a snake dies, it falls to pieces: glossy beads in its own colours and markings, which anyone can eat.
- The last snake alive wins. If you die first, you can watch the rest of the round or start over.
- The first moves are a little slower, then the game speeds up gently (about 25%) over two minutes.
- **Apples rot:** each lasts about 8 to 16 seconds (less as the round speeds up) (it bruises, browns and gets a fly as it goes), then it rots away and a fresh one drops from the tree above somewhere else.
- **Hunger:** go 20 seconds without eating (mushrooms don't count) and you start shrinking, one segment every 1.5 seconds. Starve at length 3 and you're out, unless your head reaches food that very moment. The bar under each name shows how hungry everyone is.
- **Weather:** after the first 15 seconds, spells of weather come and go, with clear spells between. Everyone, the rivals included, sees all of it coming.
  - **Sun:** golden hour. Golden apples are five times as likely.
  - **Wind:** gusts knock apples loose, up to three more than usual.
  - **Rain:** two more mushrooms sprout, and any fire goes out. Half the time, when the rain stops, a rainbow arches right across the log out of a golden apple.
  - **Storm** (not before 30 s): lightning. Where it's going to strike crackles for about a second first, and it never strikes within 4 cells of a head. It sets the bark alight: fire burns for about 5 seconds and creeps to the odd neighbouring cell (smouldering first, harmlessly, so you see it coming). **Crawl into fire and you catch alight:** for about 2 seconds you lose a segment every 6 ticks, 3 in all, the same as a crash (they fall off roasted), but you keep moving; rain or snow puts you out sooner; at your smallest, it finishes you. Boxed in, the rivals will take the fire over a crash too. **Food in the fire cooks:** an apple or a bead bakes after about 2 seconds (worth 2), and goes to ash if it stays in. Storms are often followed by rain.
- **Burrows:** the first beetle cracks a burrow open in the bark, and later ones open more (up to three). Burrows are safe to cross; cracks spread from them as the round goes on. A scared beetle that reaches one dives in and pops out of a burrow a moment later.
- **Sudden death:** after two minutes no new food appears, the sky clears, and a big woodpecker lands beside the board. Every few seconds it picks a patch of about 7 cells somewhere on the log, eyes it (the patch glows and cracks, faster and faster) for about a second and a half, swoops in and drums it out. It aims clear of everyone while it can (never at a body or food, never within 2 cells of a head), but once it's chosen, whatever's in the patch when it strikes goes: food, fire, and any part of a snake. Caught by the body and you lose everything behind the cut (it falls off as beads); caught by the head and you're out. It gets hungrier as it goes: each rest a little shorter, each patch a cell bigger, so the log shrinks faster and faster. With nothing new to eat and apples rotting away, hunger and the woodpecker finish the round.
- **Winter** (snow, now and then a spell of weather): the lean season. One apple, rotting twice as fast, no new mushrooms, no golden apples, and everyone gets hungry 1.75 times as fast. Snow puts fire out. In **wind**, a fire flings burning leaves downwind: they smoulder first, then burn small.

### Leaping

**Press the way you're already going** (on a phone, swipe that way) to leap: with a body, a hole or fire right in front of you and room beyond, you hop over it, two cells in two ticks. It costs the tip of your tail and needs 4 seconds before the next (the `⤴` on your tag lights up when it's ready). With golden leaps or dashes (below), the same press uses those instead; you hold one of the two at a time (the newest replaces the other). A golden mushroom's wrap is a while, not a press: it comes on top of either, and with only the wrap, pressing forward is the plain leap. Anyone holding one glows faintly gold. The rivals leap, dash and wrap too, by the same rules.

### Food

| Item | Effect |
|------|--------|
| Green apple | +1 length. There are always three on the board. |
| Golden apple | +3 length. Rare, sparkles, and fades before it rots after about 12 seconds. |
| Red mushroom | Poisonous, and it looks it (a violet haze, stink lines, spores). Shrinks you by 3 (never below 3). Withers after about 20 seconds and regrows elsewhere. Being short isn't always bad… |
| Beads | +1 length. What's left of a dead snake, or the tail that broke off in a crash, in its colours. Roasted ones (from a snake on fire) are +2. |
| Baked apple | +2 length. An apple that sat in a fire for about 2 seconds: steaming, glazed and split. |
| Golden beetle | +2 length, and **two golden leaps** (up to three held): three cells in two ticks, hopping up to two, free. About one beetle in three is golden. |
| Golden leaf | Only on the wind, and rare. +1 length and **two dashes**: three cells in one tick, cutting through a snake one cell thick and putting out fire. Dash into the edge or a hole and you blow up. |
| Golden mushroom | Only in the rain, and rarer still. +1 length, and for **12 seconds the edges wrap round** for you: off one side, in at the other. |
| Beetle | +2 length. Now and then one crawls out of a burrow (from 15 s in, not once the woodpecker comes), and a scared one runs for a burrow and dives in. It wanders slowly, and scurries away (at half a snake's speed) when a head gets within 4 cells, so catching one is a short chase. Uncaught, it flies off after about 30 s. |

## Play with friends

Press **Play with friends** on the start screen, then **Host a game** and send the link (or the five-letter code) to up to three friends. When they're in, press **Start**. Empty seats get AI rivals, and you can play round after round in the same room.

- One browser hosts: it runs the game, and friends' browsers connect straight to it (peer to peer). There's no game server and nothing to sign up for. A free public service, PeerJS, only introduces the browsers to each other.
- It's fair: the rivals treat everyone alike, and the host's own turns are held back by the friends' lag, so the host gets no head start.
- **Shared Hall of Fame:** when you connect, your best rounds and your friends' are copied into each other's Hall of Fame (marked "friend"), and every round you play together is recorded for everyone. Your stats and **Only you** stay yours.
- If a friend's connection goes quiet, an AI steers their snake until they're back; if they leave, it finishes the round for them.
- There's no napping online, and the host's tab should stay open (it keeps the round going even in the background).
- On some strict networks (certain mobile carriers and offices) browsers can't connect directly. If a friend can't get in, try another network; for good, a relay (TURN server) can be added in `net.js`.

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Steer | Arrow keys or WASD (turns are queued, so quick double turns work) | Swipe (anywhere on the screen during a round) |
| Nap (pause) | Space or P | ⏸ button |
| Start / start over | Enter or R (or any arrow on the start screen) | Play button |
| Hall of Fame | H | Hall of Fame button |
| Sound / music | M / N | 🔈 / ♪ buttons |
| Watching speed | 1, 2, 3 | 1× 2× 4× buttons |

The game naps by itself when you switch tabs or windows, so you never come back to a dead snake.

## Sound and music

Everything you hear is made live with the Web Audio API, and placed left or right where it happens on the board. Apples climb in pitch as you eat a streak; taking a rival out lands a punch; a near miss with another head whooshes past; first blood gets a dark stab and the last two a riser; the woodpecker calls, ticks as it takes aim, and drums. The weather has its own sound (rain hissing, wind gusting, a storm rumbling, winter's hush). The music follows the round, from a calm loop on the start screen through bass, shaker and bells as it speeds up, a minor key with toms when the woodpecker comes, to a racing duel for the last two, and it feels the danger: when a rival's head is close to yours, or you're boxed in, a heartbeat comes in and the bass drives. Sound and music each have their own switch, and both are remembered.

## Bark chatter

The AI snakes talk. Each one has its own voice: Sovereign uses the royal "we", Colonist is a pompous redcoat, Mason speaks only (dubious) Latin, Ghost mostly says "…", and Copycat repeats whatever it just heard, in Chinese. Some of them talk to each other. Lines pop up in speech bubbles and in a log under the board, which you can switch off.

## Watching the AIs

Press **Watch AIs** on the start screen for a round between four AI snakes, with a 1×/2×/4× speed control. The same control appears when you're watching after dying. Every round starts at 1×, and at 2× or 4× the board's own effects speed up too. Starting over keeps you watching. Watched rounds put the AI snakes in the Hall of Fame, but don't count towards your own stats.

## The rivals

Each round, three of these seventeen are picked at random. The start screen tells you who you're up against and how each one plays. Only you have a real forked tongue: every few seconds each rival flicks out something of its own instead, such as Wildcard's dollar bill, Joker's party blower or Desperado's six-shooter.

| Snake | Look | Style |
|-------|------|-------|
| **Sniper** | blood red, one eye behind a scope | Picks whichever snake it has the best shot at, gets in front of it and squeezes its space. |
| **Gobbler** | orange, puffy cheeks | Eats everything, even a rival's apple. Hates mushrooms. |
| **Ghost** | pale, fading body | Keeps its distance from everyone, and slips through the gaps. |
| **Sovereign** | royal blue, golden crown | Rules its own patch of log, a shimmering force field in royal blue, and attacks anyone who trespasses. Its realm grows as it does, shrinks if it wastes away, and drifts off land the woodpecker or fire takes. You light up in its colour when you go in. |
| **Colonist** | redcoat, tricorn hat | Plants flags all over the board, each colony a force field of its own, and defends every one of them. The first flies the Union Flag, later ones colonial ensigns (blue with the Southern Cross, red with a badge). |
| **Drab** | khaki, sleepy eyes | Plays it safe and sensible. Nothing special. |
| **Vulture** | black, pink bald head, hooked beak, scowl | Hovers near snakes in trouble and feeds on what they leave behind. |
| **Mason** | Caesar in marble, laurel wreath | Walls off the board, then keeps the biggest piece. |
| **Wildcard** | the Stars and Stripes, orange tan, golden combover, long red tie | A random mix of habits, new every round. |
| **Mute** | a mood-ring mime: white greasepaint, beret, a painted tear; its body turns the colour of how it feels | Picks someone and closes an invisible box around them. Never says a word (it mimes). |
| **Creeper** | teal, slit eyes | Sneaks up and rides right behind other snakes' tails. |
| **Metagamer** | cyan, 3D glasses | Watches how each rival plays, then avoids the aggressive ones, shadows the greedy ones and hunts the evasive ones. |
| **Capricious** | changes with its mood | Starts undecided, then switches between sniper, glutton, hermit and builder every few seconds. |
| **Copycat** | pale copy of its model, cat ears | Copies whoever seems to be winning, right alongside them. Party member. |
| **Joker** | jester hat, harlequin diamonds, red nose | Lures chasers into dead ends and swerves away at the last moment. |
| **Desperado** | rust poncho, cowboy hat, bandana | An adrenaline junkie: skims walls, bodies and other heads for the thrill of it. |
| **Ouroboros** | a real snake: dark gold python diamonds, a wedge head, slit eyes, fangs | Chases its own tail: once it's long, it moves as a ring, and whatever's inside is in trouble. Now and then it bites its own tail. |

All of them share the same sense of danger. They plan a few moves ahead, check that they'll still have room to move (or can chase their own tail), don't let themselves be pinned against a wall or a body (or shut in a pocket) where another snake could come round and close the way out, and avoid the space around other snakes' heads. On top of that, each one chases its own goal.

They're also fair. They see the other snakes as they were about a quarter of a second ago, like a human's reaction time, so they can't dodge your sudden turns any faster than you could dodge theirs. And they aren't told which snake is you: you're judged only by how you move, like everyone else.

## Hall of Fame and stats

Everything is saved in your browser only.

- **Hall of Fame:** the top 10 rounds, ranked by finishing place (a win beats any 2nd place), then by how long the snake stayed alive, then by food eaten. The AI snakes get entries too, so you're competing against them on the list. Switch to **Only you** to see your own top 10. When a round makes the top three, or beats your best, you can carve your name on the end screen.
- **Your story:** rounds played, wins, average place and score, how often you finished in each place, and what killed you (including your nemesis, the rival that gets you most often).

## Run locally

Serve the folder with any static server (for example `npx serve` or `python -m http.server`) and open it in a browser. Opening `index.html` directly works too.

- `?perf` shows a frame-time overlay (toggle it with the ` key).
- `?debug` adds `SnakeDebug` to the console, for example `SnakeDebug.setup(['sniper', 'mason', 'ghost'])` to start a round against chosen rivals.
- `node tools/records-test.js` checks that shared and played-together rounds land in each friend's Hall of Fame exactly once.
- `node tools/online-test.js` plays rounds through the online protocol and checks that a friend's screen matches the host's every tick.
- `node tools/simulate.js 200` plays 200 AI-only rounds headlessly with the game's own rules and AI, and prints each personality's win rate, food, kills, how snakes die and so on. Add `--seed 1` to repeat a run exactly (on any machine), `--check` to fail on a stalled round, and `--root <dir>` to play another copy of the game, to compare versions.
- `node tools/rules-test.js` checks the rules on hand-built boards: tails, head-ons, starving, the woodpecker's manners, what the AIs can see.
- `node tools/chatter-test.js` checks that every line the rivals say has its Chinese, for Copycat.
- `node tools/shots.js [dir]` takes the screenshot tour in headless Chrome (title, play, a bite, a nap, a death, the cards, the Hall of Fame, a laptop, a phone both ways), with an autopilot at the wheel. `node tools/bench.js` measures frame times the same way. Both need Chrome (or set `CHROME`); nothing to install.

### How it's put together

| File | What it does |
|------|--------------|
| `tuning.js` | Every number that shapes how the game plays and feels, in one place. |
| `engine.js` | The rules: moving, eating, dying, hunger, the woodpecker. No drawing, so it also runs in Node. |
| `ai.js` | The rivals' brains and personalities. |
| `render.js` | Draws the board on a canvas, with smooth movement between ticks. |
| `audio.js` | Sound effects and the adaptive music, synthesised live. |
| `chatter.js` | The rivals' speech bubbles and chat log. |
| `records.js` | The Hall of Fame and your stats. |
| `online.js` | Play with friends: the messages between host and friends. |
| `net.js` | Play with friends: the connections (PeerJS, loaded only when used). |
| `snake.js` | Ties it together: the game loop, input, the cards, the controls and the lobby. |
