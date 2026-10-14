// Snake chatter: the AI snakes talk. Speech bubbles follow the speaker's
// head, and the last few lines are kept in a log under the board. Purely
// cosmetic; it never affects how anyone plays.
window.SnakeChatter = (() => {
  // {who} is the other snake in the moment (victim, intruder, ...). The human
  // is "you". Lines are picked at random.
  const VOICES = {
    sniper: {
      hungry: ["Hungry. Someone will do."],
      start: ['Taking position.', 'Scoping the lobby.', 'Run. It helps.'],
      idle: ['I see you, {who}.', 'In my sights, {who}.', 'Steady…', 'Nowhere to hide.', 'Big fan of your stream, {who}.'],
      kill: ['Headshot.', 'Next.', 'Too slow, {who}.', 'One shot.'],
      golden: ['Bonus collected.'],
      caught: ['Moving target. Still a headshot.'],
      weather: { wind: ['Adjusting for wind.'], storm: ['Thunder masks the shot.'], snow: ['Cold barrel. Steady hands.'] },
      woodpecker: ['Air support. Not mine.'],
      rainbow: ['Target marked: the end of the rainbow.'],
      bonk: ['Recalibrating.', 'Minor setback.'],
      burning: ['Taking fire. Literally.'],
      cut: ['Lost my rear guard.'],
      gloat: ['Bounced off me, {who}? Cute.'],
      dies: ['Counter-sniped by {who}?', 'Should have relocated.', 'Impossible.'],
      dash: ['Repositioning. Fast.'],
      snip: ['Clean cut, {who}.'],
    },
    gobbler: {
      hungry: ["So… hungry… can’t… go on…","FOOD. NOW."],
      start: ['Is it lunchtime? It feels like lunchtime.', 'I could eat.'],
      idle: ['Nom.', 'Anyone gonna finish that apple?', 'I smell apples.', 'Snack time!', 'Is that… food?'],
      eat: ['Nom nom nom.', 'Delicious!', 'More!', 'Crunchy!'],
      golden: ['GOLDEN APPLE. MINE.', 'Shiny AND tasty!'],
      spawn: ['A GOLDEN APPLE! Out of my way!'],
      beetle: ['A BEETLE! Crunchy legs, come to Gobbler!', 'Bug! Bug bug bug!'],
      caught: ['Crunchy! Legs and all.'],
      mushroom: ['Ugh, mushrooms. Gross.', 'I feel… smaller. I hate it.'],
      kill: ['Sorry, {who}. You were between me and lunch.', 'Oops. Is that meat?'],
      weather: { wind: ['It’s raining apples! Best day ever!'], rain: ['Mushroom weather. Yuck.'], sun: ['Golden hour? Golden SNACKS!'], snow: ['Winter? But what will I EAT?'] },
      woodpecker: ['Is it eating the log? Save me some!'],
      rainbow: ['A rainbow! Does the gold taste good?'],
      bonk: ['Ow! My snacks!', 'Oof. Dropped my lunch.'],
      burning: ['Am I… cooking? Smells good, actually.'],
      cut: ['My tail! That was full of food!'],
      baked: ['BAKED APPLES! Hot hot hot, worth it!'],
      goldbug: ['A GOLDEN beetle! Gold AND crunchy!'],
      leap: ['Wheee! Lunch from above!'],
      dies: ['Tell my apples… I loved them.'],
      dash: ['Fast food!'],
      snip: ['Snip! Snack-sized, {who}.'],
    },
    ghost: {
      hungry: ["…hungry…"],
      start: ['…'],
      idle: ['…', '……', '(silence)', 'boo.'],
      mushroom: ['…bitter.'],
      kill: ['…sorry.'],
      weather: { storm: ['…boom.'], rain: ['…drip.'], snow: ['…brr.'] },
      woodpecker: ['…tap… tap…'],
      rainbow: ['…pretty.'],
      bonk: ['…ow.'],
      burning: ['…warm.'],
      cut: ['…lighter.'],
      dies: ['…'],
    },
    sovereign: {
      hungry: ["We require a banquet. Immediately."],
      start: ['Kneel.', 'We are pleased to receive you. Do not touch anything.'],
      idle: ['Our lands are vast.', 'We are not amused.', 'This bark is royal bark.'],
      intruder: ['Trespasser! Guards! …We are the guards.', '{who}, you stand on royal bark!', 'Off our land, {who}!'],
      kill: ['Justice is served.', 'The Crown is merciful. Usually.'],
      weather: { sun: ['The sun shines on our realm.'], storm: ['We do not approve of this weather.'], rain: ['Fetch the royal umbrella.'], snow: ['Fetch the royal furs.'] },
      woodpecker: ['Who invited that bird?', 'We did not authorise this pecking.'],
      rainbow: ['The heavens salute us.'],
      realm: { grow: ['Our realm expands!', 'A greater sovereign needs a greater realm.', 'Behold: more kingdom.'], shrink: ['Our realm… contracts. Temporarily.', 'A strategic retreat. A royal one.'], move: ['The court relocates.', 'We have moved to better lands.'], burning: ['Our realm is ablaze! Fetch the royal bucket!', 'Who set fire to the royal grounds?'], pecked: ['That bird is pecking holes in OUR land!', 'Our realm, full of holes. Unacceptable.'], invaded: ['A colony? On OUR land, {who}?!', '{who} dares plant a flag in our realm!'] },
      bonk: ['We meant to do that.', 'Who put that there?'],
      burning: ['Fetch the royal bucket!'],
      cut: ['That bird has committed treason.'],
      gloat: ['Bow, {who}. Do not bump.'],
      leap: ['We rise above it all.'],
      dies: ['The king is dead…', 'Long live… someone else.'],
      dash: ['Make way for the crown!'],
      snip: ['Divided, {who}, and ruled.'],
      wrap: ['Our realm knows no edges now.'],
    },
    colonist: {
      hungry: ["I say, is there nothing to eat out here?"],
      start: ['Splendid day for an expedition!', 'Tally ho!'],
      idle: ['I say!', 'Jolly good.', 'Anyone for tea?', 'Rule, Britannia!'],
      flag: ['I claim this bark for the Crown!', 'Another colony! Splendid.', 'Mine now. Terribly sorry.', 'Run up the ensign!', 'Another ensign for the Empire!', 'I claim this for the Crown. Which crown? Mine.'],
      intruder: ['Ahem. That’s a colony, {who}.', 'I say, that patch is spoken for.'],
      kill: ['Frightfully sorry, old chap.', 'Should have read the flag, {who}.'],
      weather: { rain: ['Ah, proper weather at last.', 'Rain? Just like home.'], storm: ['Batten down the hatches!'], sun: ['The sun never sets on us, you know.'], snow: ['Bracing! Simply bracing.'] },
      woodpecker: ['A woodpecker! Someone fetch my musket. Politely.'],
      rainbow: ['A rainbow! Plant a flag at the end of it!'],
      bonk: ['I say! Steady on!', 'Blast!'],
      burning: ['I appear to be on fire. How awkward.'],
      cut: ['Dash it, my tail!'],
      gloat: ['Mind the Empire, {who}.'],
      baked: ['Roast dinner! Splendid.'],
      colony: { burning: ['I say, the colony’s on fire!', 'Fire in the colony! Form a bucket chain!'], pecked: ['That bird’s pecking up my colony!', 'Blast! Holes all over the colony.'] },
      dies: ['Stiff upper lip…'],
    },
    drab: {
      hungry: ["I should eat something."],
      start: ['Hello.', 'Hi. I’m Drab.'],
      idle: ['Nice weather.', 'Apples are fine.', 'I like beige.', 'This is a log.', 'Hm.'],
      eat: ['Food.'],
      woodpecker: ['Oh. A bird.'],
      kill: ['Oh. Sorry, {who}.'],
      weather: { rain: ['Rain. Great.'], sun: ['It’s sunny.'], wind: ['Windy.'], storm: ['Loud.'], snow: ['Cold.'] },
      rainbow: ['A rainbow. Colourful.'],
      bonk: ['Ow.'],
      burning: ['Hot.'],
      cut: ['Hm. Shorter.'],
      dies: ['Well. That happened.'],
    },
    vulture: {
      hungry: ["Someone die already. I’m starving."],
      start: ['Ahh, fresh snakes.'],
      idle: ['Not long now…', 'You look tired, {who}.', 'I’ll wait.', 'Patience…'],
      death: ['Dinner!', 'Ooh, leftovers.', 'Rest in pieces, {who}.'],
      kill: ['I didn’t even have to try.'],
      weather: { storm: ['Lightning. Something’s bound to cook.'], rain: ['Grim weather. Lovely.'], snow: ['Winter. The lean season. My season.'] },
      woodpecker: ['Ah. A colleague.'],
      rainbow: ['Pretty. Someone will die chasing it.'],
      bonk: ['Not the plan.'],
      burning: ['I’m the one who eats the roast!'],
      cut: ['Leftovers… of me?'],
      gloat: ['Keep bumping, {who}. I’ll wait.'],
      dies: ['Who’s… eating… whom…'],
    },
    mason: {
      start: ['Alea iacta est!', 'Aedificamus!'],
      idle: ['Vidi, vici, veni.', 'Veni, vidi, aedificavi.', 'Divide et imperium-ium.', 'Carpe applum!',
        'Murus maximus. Very bigus.', 'In barko veritas.', 'Wallus erectus.', 'Semper wallus.', 'Biggus wallus.',
        'Romanes eunt domus.', 'Amicus meus est Biggus Dickus.'],
      kill: ['Veni, vidi, vici.', 'Murum non vidisti, {who}?', 'Requiescat in barko, {who}.'],
      hungry: ['Panem! Panem et… panem!'],
      woodpecker: ['Picus horribilis!'],
      caught: ['Scarabaeus captus!'],
      weather: { storm: ['Iuppiter iratus est!'], rain: ['Pluvia! Aquaeductus, ubi es?'], sun: ['Sol invictus!'], wind: ['Ventus maximus!'], snow: ['Hiems venit!'] },
      rainbow: ['Arcus caelestis!'],
      bonk: ['Murus! Unde venit?', 'Ouchus maximus.'],
      burning: ['Roma ardet!'],
      cut: ['Caudam meam!'],
      gloat: ['Murum vidisti, {who}?'],
      dies: ['Et tu, {who}?', 'Alea iacta… estus.', 'Murus… meus… finis.'],
      wrap: ['Sine muro! No wall at all!'],
    },
    wildcard: {
      hungry: ["Very hungry. The hungriest. Nobody has ever been this hungry."],
      start: ['Hello, everybody. Tremendous crowd today.', 'I’m going to win. Bigly.'],
      idle: ['Nobody slithers better than me, believe me.', 'I have the best scales. Everybody says so.',
        'Many snakes are saying it.', 'Sad!', 'Fake apples!', '{who}? Total loser. Sad!'],
      eat: ['Tremendous snack. The best snack.'],
      golden: ['A golden apple. Very classy. Like me.'],
      mushroom: ['Fake food! Very unfair!'],
      kill: ['You’re fired, {who}!', 'Winning! So much winning.'],
      weather: { sun: ['Beautiful weather. The best weather. Everyone says so.'], storm: ['Nobody knows more about lightning than me.'], wind: ['Tremendous wind. So many apples.'], rain: ['Fake rain!'], snow: ['Global warming? Total hoax. Look at all this snow!'] },
      woodpecker: ['That bird is a disaster. Total disaster.'],
      rainbow: ['Rainbows. Overrated. Great gold, though.'],
      bonk: ['Who moved that? Fake wall!'],
      burning: ['Hot. Very hot. The hottest. Tremendous.'],
      cut: ['That bird stole my tail. Total theft.'],
      gloat: ['{who}? Bounced right off me. Sad!'],
      goldbug: ['A golden beetle. Very classy. Like me.'],
      leap: ['Nobody jumps better than me.'],
      dies: ['Rigged! Totally rigged!'],
      dash: ['Fastest dash in history. Everyone says so.'],
      snip: ['You’re cut, {who}! Tremendously cut.'],
      wrap: ['Walls? Who needs walls? Not today.'],
    },
    creeper: {
      hungry: ["so… hungry…"],
      start: ['psst.'],
      idle: ['behind you.', 'don’t turn around, {who}.', 'hehehe.', 'nice tail, {who}.'],
      kill: ['hehe. gotcha.'],
      weather: { storm: ['hehe. flickery.'], rain: ['drip drip.'], snow: ['cold tail. still following.'] },
      woodpecker: ['pecky pecky. hehe.'],
      rainbow: ['shiny…'],
      bonk: ['oof.'],
      burning: ['ow ow ow.'],
      cut: ['…my tail.'],
      gloat: ['hehe. bonk, {who}.'],
      dies: ['…aww.'],
    },
    metagamer: {
      hungry: ["Caloric deficit detected."],
      start: ['Analysing opponents…', 'I’ve watched the replays.'],
      idle: ['{who}: {label}. Noted.', 'Predictable.', 'Your eat rate is suboptimal, {who}.', 'Running the numbers…'],
      kill: ['As calculated.', 'Exactly as the model predicted.'],
      weather: { storm: ['Strike probability: rising.'], rain: ['Mushroom density: up.'], sun: ['Golden apple odds: favourable.'], wind: ['Apple supply: increasing.'], snow: ['Food supply: down. Hunger rate: up.'] },
      woodpecker: ['Map shrink phase: started.'],
      rainbow: ['Golden apple confirmed at the rainbow’s end.'],
      bonk: ['Collision logged.', 'Variance.'],
      burning: ['Thermal damage: ongoing.'],
      cut: ['Length reduced. Recomputing.'],
      gloat: ['Predicted that, {who}.'],
      goldbug: ['Golden beetle: mobility upgrade.'],
      leap: ['Leap executed.'],
      dies: ['That… wasn’t in the data.'],
      dash: ['Dash: optimal.'],
      snip: ['Cut {who} in two. Noted.'],
    },
    capricious: {
      hungry: ["Now I’m hungry! Out of nowhere!"],
      start: ['Ooh, what shall I be today?'],
      // Taking up a mood, it does an impression (and can't help asking how it went).
      mood: {
        sniper: ['Taking position. …Ooh, I like being Sniper.', 'Headshot! …Is that how Sniper says it?'],
        gobbler: ['FOOD. NOW. …Is Gobbler always this hungry?', 'Nom nom nom! I’m Gobbler now!'],
        ghost: ['…', '…boo. …Am I doing Ghost right?'],
        mason: ['Aedificamus! …Ooh, I speak Latin now!', 'Veni, vidi, aedificavi! …Did I say that right?'],
      },
      kill: ['Didn’t plan that. Love it.'],
      weather: { sun: ['Sunshine! I love sunshine! Today.'], rain: ['Rain! I love rain! For now.'], storm: ['Storms are exciting! Or scary? Both!'], wind: ['Whee!'], snow: ['Snow! I love snow! For a bit.'] },
      woodpecker: ['A bird! I love birds! Not this one.'],
      rainbow: ['A rainbow! Every colour! I can’t choose!'],
      bonk: ['Ouch! I hate walls! Today.'],
      burning: ['Fire! I love fire! Ow, no I don’t!'],
      cut: ['My tail! I liked that tail!'],
      leap: ['I can fly! For a second!'],
      dies: ['Changed my mind about living.'],
      dash: ['Zoom! I felt like it!'],
      snip: ['Oops, {who}! Was that rude?'],
    },
    copycat: {
      start: ['同志们好！'],
      idle: ['为人民服务！', '团结就是力量！', '同志们，冲啊！', '五年计划，提前完成！'],
      kill: ['向前进！'],
      weather: { storm: ['雷电交加，同志们小心！'], rain: ['下雨了，同志们！'], snow: ['下雪了，同志们，节约粮食！'] },
      woodpecker: ['啄木鸟来了，同志们！'],
      rainbow: ['彩虹！同志们，金苹果！'],
      bonk: ['哎哟！'],
      burning: ['着火了，同志们！'],
      cut: ['尾巴没了，同志们！'],
      dies: ['同志们，再见……'],
    },
    desperado: {
      hungry: ["Running on fumes, partner."],
      start: ['Yeehaw!', 'Saddle up, partner.'],
      idle: ['Living on the edge, partner.', 'Too close? Never heard of it.', 'Is that a wall? Let’s go see.', 'Feel that? That’s being alive.'],
      kill: ['Draw, {who}. Too slow.', 'This bark ain’t big enough for the both of us.'],
      mushroom: ['Mushroom roulette. Down the hatch!'],
      woodpecker: ['Now we’re talking! Holes!'],
      beetle: ['Yeehaw, a critter hunt!'],
      caught: ['Lassoed it.'],
      weather: { storm: ['Lightning? Now we’re talking!', 'Fire on the bark! Yeehaw!'], wind: ['Hold onto your hat!'], rain: ['Rain on the range.'], snow: ['Cold enough to freeze a cactus.'] },
      rainbow: ['Race you to the gold, partner!'],
      bonk: ['Woo! Again!', 'Felt that one.'],
      burning: ['Yeehaw, I’m on fire!'],
      cut: ['Shot my tail clean off!'],
      gloat: ['Too close, {who}? Never heard of it.'],
      baked: ['Campfire grub!'],
      goldbug: ['Gold bug! Now that’s a prize, partner.'],
      leap: ['Yeehaw! Clean over!'],
      dies: ['What a ride…', 'Worth it.'],
      dash: ['Yee-haw, full gallop!'],
      snip: ['Draw, {who}! Too slow.'],
    },
    mute: {
      start: ['*waves silently*', '*takes a deep, silent bow*'],
      idle: ['*pulls an invisible rope*', '*trapped in an invisible box*', '*leans on nothing*', '*walks against an invisible wind*', '*tips an invisible hat at {who}*', '*draws a box in the air around {who}*'],
      kill: ['*mimes closing a lid on {who}*', '*plays a tiny invisible violin*'],
      caught: ['*mimes a very big beetle*'],
      weather: { rain: ['*opens an invisible umbrella*'], storm: ['*hides under an invisible table*'], wind: ['*leans into the wind*'], sun: ['*puts on invisible sunglasses*'], snow: ['*shivers, silently*'] },
      woodpecker: ['*covers its ears*'],
      rainbow: ['*hugs the rainbow*', '*paints the rainbow a little brighter*'],
      bonk: ['*rubs its head, silently*', '*walks into a wall. A real one, this time*'],
      burning: ['*fans itself, frantically*'],
      cut: ['*looks for its tail*'],
      gloat: ['*mimes {who} bouncing off*'],
      leap: ['*bows mid-air*'],
      dies: ['*mimes being squashed*', '*…*'],
      dash: ['*zooms off, holding its beret*'],
      snip: ['*mimes scissors at {who}*'],
      wrap: ['*walks into the edge… and out the other side*'],
    },
    ouroboros: {
      hungry: ['Even I must eat. Usually myself.'],
      start: ['All things return.', 'Here we are again.'],
      idle: ['The end is the beginning.', 'Round and round.', 'I have done this before, {who}.', 'Everything comes back to me.'],
      kill: ['Full circle, {who}.', 'You were always going to end here.'],
      woodpecker: ['Endings peck at everything.'],
      rainbow: ['A circle, half drawn.'],
      bonk: ['I meant to come back here.'],
      burning: ['Fire, then ash, then again.'],
      cut: ['My tail! I was saving that.'],
      gloat: ['Around you go, {who}.'],
      weather: { snow: ['Winter returns. It always does.'], rain: ['The rain comes round again.'] },
      dies: ['…and begin again.', 'See you next time around.'],
      dash: ['The circle tightens. Quickly.'],
      snip: ['Now you know how it feels, {who}.'],
      wrap: ['No end, no beginning. As it should be.'],
    },
    joker: {
      hungry: ["Why did the snake cross the bark? It was starving."],
      start: ['Knock knock!', 'Who wants to play a game?'],
      idle: ['Catch me if you can!', 'Why so slithery, {who}?', 'Follow me, it’s a shortcut!', 'Honk honk!'],
      kill: ['And for my next trick…', 'The joke’s on you, {who}!'],
      mushroom: ['Ooh, a funny mushroom!'],
      weather: { rain: ['Singin’ in the rain!'], storm: ['Shocking!'], wind: ['Blow, wind, blow!'], sun: ['Sun’s out, puns out!'], snow: ['Snow joke!'] },
      woodpecker: ['Knock knock! Oh. It’s the woodpecker.'],
      rainbow: ['Somewhere over the… oh, there it is.'],
      bonk: ['Ow! That one’s on me.', 'Slapstick!'],
      burning: ['Hot stuff, coming through!'],
      cut: ['Ha! The bird’s got jokes.'],
      gloat: ['Knock knock, {who}! …Bonk!'],
      leap: ['Hup! Ta-daaa!'],
      dies: ['Tough crowd…'],
      dash: ['Wheeee, nyoom!'],
      snip: ['Ta-da! {who}, sawn in half!'],
    },
  };

  // Chinese for every line above: Copycat repeats what it hears, in Chinese.
  // The Metagamer's labels for how a snake plays, for Copycat's Chinese.
  const ZH_LABELS = { aggressive: '好斗', greedy: '贪吃', evasive: '爱躲', unclear: '看不透' };
  const ZH = {
    "*waves silently*": "*默默挥手*",
    "*takes a deep, silent bow*": "*深深地、无声地鞠躬*",
    "*pulls an invisible rope*": "*拉一根看不见的绳子*",
    "*trapped in an invisible box*": "*被困在看不见的盒子里*",
    "*leans on nothing*": "*靠在空气上*",
    "*walks against an invisible wind*": "*顶着看不见的风走*",
    "*tips an invisible hat at {who}*": "*向{who}脱下看不见的帽子*",
    "*draws a box in the air around {who}*": "*在{who}周围画一个看不见的盒子*",
    "*mimes closing a lid on {who}*": "*比划着把{who}盖起来*",
    "*plays a tiny invisible violin*": "*拉一把看不见的小提琴*",
    "*mimes a very big beetle*": "*比划一只很大的甲虫*",
    "*opens an invisible umbrella*": "*撑开一把看不见的伞*",
    "*hides under an invisible table*": "*躲到看不见的桌子下*",
    "*leans into the wind*": "*迎风倾身*",
    "*puts on invisible sunglasses*": "*戴上看不见的墨镜*",
    "*shivers, silently*": "*无声地发抖*",
    "*mimes being squashed*": "*比划被压扁*",
    "*…*": "*……*",
    "Taking position. …Ooh, I like being Sniper.": "就位。……哦，我喜欢当狙击手。",
    "Headshot! …Is that how Sniper says it?": "爆头！……狙击手是这么说的吗？",
    "FOOD. NOW. …Is Gobbler always this hungry?": "食物。现在。……贪吃蛇一直这么饿吗？",
    "Nom nom nom! I’m Gobbler now!": "吧唧吧唧！我现在是贪吃蛇！",
    "…boo. …Am I doing Ghost right?": "……嘘。……我演鬼魂演得对吗？",
    "…": "……",
    "Aedificamus! …Ooh, I speak Latin now!": "我们建造！……哦，我现在会说拉丁语了！",
    "Veni, vidi, aedificavi! …Did I say that right?": "我来，我见，我建！……我说对了吗？",
    "Cold barrel. Steady hands.": "枪管冰冷。手要稳。",
    "Winter? But what will I EAT?": "冬天？那我吃什么？",
    "…brr.": "……好冷。",
    "Fetch the royal furs.": "拿御用皮草来。",
    "Bracing! Simply bracing.": "提神！真是提神！",
    "Cold.": "冷。",
    "Winter. The lean season. My season.": "冬天。饥荒的季节。我的季节。",
    "Hiems venit!": "冬天来了！",
    "Global warming? Total hoax. Look at all this snow!": "全球变暖？纯属骗局。看看这么多雪！",
    "cold tail. still following.": "尾巴好冷。还在跟着。",
    "Food supply: down. Hunger rate: up.": "食物供应：下降。饥饿速度：上升。",
    "Snow! I love snow! For a bit.": "下雪！我爱下雪！爱一会儿。",
    "Cold enough to freeze a cactus.": "冷得能冻住仙人掌。",
    "Snow joke!": "这可不是开玩笑！",
    "Adjusting for wind.": "修正风偏。",
    "Thunder masks the shot.": "雷声掩护枪声。",
    "It’s raining apples! Best day ever!": "天上掉苹果啦！最棒的一天！",
    "Mushroom weather. Yuck.": "蘑菇天气。呕。",
    "Golden hour? Golden SNACKS!": "黄金时刻？黄金零食！",
    "…boom.": "……轰。",
    "…drip.": "……滴答。",
    "The sun shines on our realm.": "阳光照耀着我们的国土。",
    "We do not approve of this weather.": "我们不批准这种天气。",
    "Fetch the royal umbrella.": "拿御用雨伞来。",
    "Ah, proper weather at last.": "啊，终于是像样的天气了。",
    "Rain? Just like home.": "下雨？跟家里一样。",
    "Batten down the hatches!": "关好舱门！",
    "The sun never sets on us, you know.": "要知道，我们可是日不落。",
    "Rain. Great.": "下雨。真好。",
    "It’s sunny.": "出太阳了。",
    "Windy.": "有风。",
    "Loud.": "好吵。",
    "Lightning. Something’s bound to cook.": "闪电。总会烤熟点什么。",
    "Grim weather. Lovely.": "阴沉的天气。真可爱。",
    "Iuppiter iratus est!": "朱庇特发怒了！",
    "Pluvia! Aquaeductus, ubi es?": "下雨了！输水道，你在哪儿？",
    "Sol invictus!": "不败的太阳！",
    "Ventus maximus!": "超级大风！",
    "Beautiful weather. The best weather. Everyone says so.": "美丽的天气。最好的天气。大家都这么说。",
    "Nobody knows more about lightning than me.": "没人比我更懂闪电。",
    "Tremendous wind. So many apples.": "巨大的风。好多苹果。",
    "Fake rain!": "假雨！",
    "hehe. flickery.": "嘿嘿。一闪一闪的。",
    "drip drip.": "滴答滴答。",
    "Strike probability: rising.": "雷击概率：上升。",
    "Mushroom density: up.": "蘑菇密度：上升。",
    "Golden apple odds: favourable.": "金苹果概率：有利。",
    "Apple supply: increasing.": "苹果供应：增加。",
    "Sunshine! I love sunshine! Today.": "阳光！我爱阳光！今天爱。",
    "Rain! I love rain! For now.": "下雨！我爱下雨！暂时爱。",
    "Storms are exciting! Or scary? Both!": "暴风雨好刺激！还是好可怕？都是！",
    "Whee!": "呜呼！",
    "Lightning? Now we’re talking!": "闪电？这才带劲！",
    "Fire on the bark! Yeehaw!": "树皮着火啦！咿哈！",
    "Hold onto your hat!": "抓紧你的帽子！",
    "Rain on the range.": "牧场下雨了。",
    "Singin’ in the rain!": "雨中曲！",
    "Shocking!": "真震撼！",
    "Blow, wind, blow!": "吹吧，风儿，吹吧！",
    "Sun’s out, puns out!": "太阳出来，笑话出来！",
    "Moving target. Still a headshot.": "移动靶。照样爆头。",
    "A BEETLE! Crunchy legs, come to Gobbler!": "甲虫！脆脆的腿，快到Gobbler这儿来！",
    "Bug! Bug bug bug!": "虫子！虫子虫子虫子！",
    "Crunchy! Legs and all.": "脆的！连腿一起。",
    "Scarabaeus captus!": "甲虫，抓到了！",
    "Yeehaw, a critter hunt!": "咿哈，抓小虫子喽！",
    "Lassoed it.": "套住它了。",
    "Alea iacta est!": "骰子已经掷下！",
    "Aedificamus!": "我们来建造！",
    "Vidi, vici, veni.": "我见，我征服，我来。",
    "Divide et imperium-ium.": "分而治之之。",
    "Carpe applum!": "抓住苹果！",
    "Murus maximus. Very bigus.": "最大的墙。非常大。",
    "In barko veritas.": "树皮里有真理。",
    "Wallus erectus.": "墙，立起来了。",
    "Semper wallus.": "永远是墙。",
    "Biggus wallus.": "大大的墙。",
    "Romanes eunt domus.": "罗马人回家去。",
    "Amicus meus est Biggus Dickus.": "我的朋友叫Biggus Dickus。",
    "Et uxor: Incontinentia Buttocks.": "还有他老婆：Incontinentia Buttocks。",
    "BWAHAHA—": "哇哈哈哈——",
    "I can’t. I CAN’T.": "我不行了。真不行了。",
    "*wheeze*": "*笑到喘不过气*",
    "Pfft…": "噗……",
    "*snort*": "*噗嗤*",
    "Snrk. Sorry. Go on.": "噗。抱歉。你继续。",
    "Taking position.": "就位。",
    "Scoping the lobby.": "正在观察全场。",
    "In my sights, {who}.": "{who}，你在我的瞄准镜里。",
    "Steady…": "稳住……",
    "Big fan of your stream, {who}.": "{who}，我是你直播的忠实粉丝。",
    "Headshot.": "爆头。",
    "One shot.": "一枪。",
    "Counter-sniped by {who}?": "被{who}反狙了？",
    "Should have relocated.": "早该换位置的。",
    "Murum non vidisti, {who}?": "你没看见墙吗，{who}？",
    "Requiescat in barko, {who}.": "在树皮上安息吧，{who}。",
    "Panem! Panem et… panem!": "面包！面包和……面包！",
    "Picus horribilis!": "可怕的啄木鸟！",
    "Alea iacta… estus.": "骰子……掷下了。",
    "Murus… meus… finis.": "我的……墙……完了。",
    "“Romani ite domum”, actually.": "其实应该是“Romani ite domum”。",
    "Hungry. Someone will do.": "饿了。随便谁都行。",
    "So… hungry… can’t… go on…": "好……饿……撑……不住了……",
    "FOOD. NOW.": "食物。马上。",
    "…hungry…": "……饿……",
    "We require a banquet. Immediately.": "朕要设宴。立刻。",
    "I say, is there nothing to eat out here?": "我说，这里就没有吃的吗？",
    "I should eat something.": "我该吃点东西了。",
    "Someone die already. I’m starving.": "快死一个吧。我饿坏了。",
    "Very hungry. The hungriest. Nobody has ever been this hungry.": "非常饿。最饿的。从来没有人这么饿过。",
    "so… hungry…": "好……饿……",
    "Caloric deficit detected.": "检测到热量不足。",
    "Now I’m hungry! Out of nowhere!": "我现在饿了！突然就饿了！",
    "Running on fumes, partner.": "快没油了，伙计。",
    "Why did the snake cross the bark? It was starving.": "蛇为什么要爬过树皮？因为它饿坏了。",
    "Yeehaw!": "咿哈！",
    "Saddle up, partner.": "上马吧，伙计。",
    "Living on the edge, partner.": "刀尖上过日子，伙计。",
    "Too close? Never heard of it.": "太近了？没听说过。",
    "Is that a wall? Let’s go see.": "那是墙吗？去看看。",
    "Feel that? That’s being alive.": "感觉到了吗？这才叫活着。",
    "Draw, {who}. Too slow.": "拔枪吧，{who}。太慢了。",
    "This bark ain’t big enough for the both of us.": "这块树皮容不下我们两个。",
    "Mushroom roulette. Down the hatch!": "蘑菇轮盘赌。干了！",
    "Now we’re talking! Holes!": "这才带劲！洞！",
    "What a ride…": "真是一趟好旅程……",
    "Worth it.": "值了。",
    "Run. It helps.": "跑吧。有点用。",
    "I see you, {who}.": "我看见你了，{who}。",
    "Nowhere to hide.": "无处可藏。",
    "Next.": "下一个。",
    "Too slow, {who}.": "太慢了，{who}。",
    "Bonus collected.": "奖励到手。",
    "Impossible.": "不可能。",
    "Is it lunchtime? It feels like lunchtime.": "午饭时间到了吗？感觉像午饭时间。",
    "I could eat.": "我还能吃。",
    "Nom.": "吧唧。",
    "Anyone gonna finish that apple?": "那个苹果有人要吃吗？",
    "I smell apples.": "我闻到苹果了。",
    "Snack time!": "零食时间！",
    "Is that… food?": "那是……吃的吗？",
    "Nom nom nom.": "吧唧吧唧吧唧。",
    "Delicious!": "好吃！",
    "More!": "还要！",
    "Crunchy!": "脆脆的！",
    "GOLDEN APPLE. MINE.": "金苹果。是我的。",
    "Shiny AND tasty!": "又亮又好吃！",
    "A GOLDEN APPLE! Out of my way!": "金苹果！让开！",
    "Ugh, mushrooms. Gross.": "呃，蘑菇。恶心。",
    "I feel… smaller. I hate it.": "我觉得……变小了。我讨厌这样。",
    "Sorry, {who}. You were between me and lunch.": "抱歉，{who}。你挡住我的午饭了。",
    "Oops. Is that meat?": "哎呀。那是肉吗？",
    "Tell my apples… I loved them.": "告诉我的苹果……我爱过它们。",
    "…": "……",
    "……": "…………",
    "(silence)": "（沉默）",
    "boo.": "吓！",
    "…bitter.": "……苦。",
    "…sorry.": "……对不起。",
    "Kneel.": "跪下。",
    "We are pleased to receive you. Do not touch anything.": "朕很高兴接见你。什么都别碰。",
    "Our lands are vast.": "朕的疆土辽阔。",
    "We are not amused.": "朕不觉得好笑。",
    "This bark is royal bark.": "这是皇家树皮。",
    "Trespasser! Guards! …We are the guards.": "擅闯者！来人！……朕就是来人。",
    "{who}, you stand on royal bark!": "{who}，你站在皇家树皮上！",
    "Off our land, {who}!": "滚出朕的领地，{who}！",
    "Justice is served.": "正义已得伸张。",
    "The Crown is merciful. Usually.": "王室是仁慈的。通常是。",
    "The king is dead…": "国王死了……",
    "Long live… someone else.": "……其他人万岁。",
    "Splendid day for an expedition!": "探险的好日子！",
    "Tally ho!": "冲啊！",
    "I say!": "我说！",
    "Jolly good.": "好极了。",
    "Anyone for tea?": "有人要喝茶吗？",
    "Rule, Britannia!": "统治吧，不列颠尼亚！",
    "I claim this bark for the Crown!": "我以王室之名占领这块树皮！",
    "Another colony! Splendid.": "又一块殖民地！妙极了。",
    "Mine now. Terribly sorry.": "现在归我了。非常抱歉。",
    "Ahem. That’s a colony, {who}.": "咳咳。那是殖民地，{who}。",
    "I say, that patch is spoken for.": "我说，那块地已经有主了。",
    "Frightfully sorry, old chap.": "万分抱歉，老伙计。",
    "Should have read the flag, {who}.": "你该看看旗子的，{who}。",
    "Stiff upper lip…": "保持镇定……",
    "Hello.": "你好。",
    "Hi. I’m Drab.": "嗨。我是Drab。",
    "Nice weather.": "天气不错。",
    "Apples are fine.": "苹果还行。",
    "I like beige.": "我喜欢米色。",
    "This is a log.": "这是一根木头。",
    "Hm.": "嗯。",
    "Food.": "食物。",
    "Oh. A bird.": "哦。一只鸟。",
    "Oh. Sorry, {who}.": "哦。对不起，{who}。",
    "Well. That happened.": "好吧。就这样了。",
    "Ahh, fresh snakes.": "啊，新鲜的蛇。",
    "Not long now…": "快了……",
    "You look tired, {who}.": "你看起来很累，{who}。",
    "I’ll wait.": "我会等。",
    "Patience…": "耐心……",
    "Dinner!": "开饭了！",
    "Ooh, leftovers.": "哦，剩菜。",
    "Rest in pieces, {who}.": "碎碎平安，{who}。",
    "I didn’t even have to try.": "我都没怎么出力。",
    "Who’s… eating… whom…": "谁……吃……谁……",
    "Veni, vidi, aedificavi.": "我来，我见，我建。",
    "Veni, vidi, vici.": "我来，我见，我征服。",
    "Et tu, {who}?": "还有你吗，{who}？",
    "Hello, everybody. Tremendous crowd today.": "大家好。今天人山人海，了不起。",
    "I’m going to win. Bigly.": "我会赢的。大赢特赢。",
    "Nobody slithers better than me, believe me.": "没人比我爬得更好，相信我。",
    "I have the best scales. Everybody says so.": "我的鳞片是最好的。大家都这么说。",
    "Many snakes are saying it.": "很多蛇都这么说。",
    "Sad!": "可悲！",
    "Fake apples!": "假苹果！",
    "{who}? Total loser. Sad!": "{who}？彻底的失败者。可悲！",
    "Tremendous snack. The best snack.": "了不起的零食。最好的零食。",
    "A golden apple. Very classy. Like me.": "金苹果。很高级。像我一样。",
    "Fake food! Very unfair!": "假食物！非常不公平！",
    "You’re fired, {who}!": "你被解雇了，{who}！",
    "Winning! So much winning.": "赢！赢太多了。",
    "Rigged! Totally rigged!": "作弊！完全是作弊！",
    "psst.": "嘘。",
    "behind you.": "在你后面。",
    "don’t turn around, {who}.": "别回头，{who}。",
    "hehehe.": "嘿嘿嘿。",
    "nice tail, {who}.": "尾巴不错，{who}。",
    "hehe. gotcha.": "嘿嘿。抓到你了。",
    "…aww.": "……哎。",
    "Analysing opponents…": "正在分析对手……",
    "I’ve watched the replays.": "我看过录像了。",
    "{who}: {label}. Noted.": "{who}：{label}。已记录。",
    "Predictable.": "可预测。",
    "Your eat rate is suboptimal, {who}.": "你的进食效率不是最优的，{who}。",
    "Running the numbers…": "正在计算……",
    "As calculated.": "一切尽在计算之中。",
    "Exactly as the model predicted.": "和模型预测的一模一样。",
    "That… wasn’t in the data.": "这……不在数据里。",
    "Ooh, what shall I be today?": "哦，今天我当什么好呢？",
    "I’m a sniper now! Pew pew!": "我现在是狙击手了！砰砰！",
    "Ooh! I’m hungry now!": "哦！我现在饿了！",
    "Leave me alone. I mean it.": "别管我。我是认真的。",
    "Let’s build something!": "我们来盖点东西吧！",
    "Didn’t plan that. Love it.": "没计划过。但我喜欢。",
    "Changed my mind about living.": "我改变主意了……关于活着。",
    "Knock knock!": "咚咚！",
    "Who wants to play a game?": "谁想玩个游戏？",
    "Catch me if you can!": "有本事来抓我！",
    "Why so slithery, {who}?": "为什么这么滑溜，{who}？",
    "Follow me, it’s a shortcut!": "跟我来，这是捷径！",
    "Honk honk!": "叭叭！",
    "And for my next trick…": "下一个戏法……",
    "The joke’s on you, {who}!": "你才是笑话，{who}！",
    "Ooh, a funny mushroom!": "哦，好玩的蘑菇！",
    "Tough crowd…": "观众真难搞……",
    "Air support. Not mine.": "空中支援。不是我的。",
    "Target marked: the end of the rainbow.": "目标已标记：彩虹的尽头。",
    "Is it eating the log? Save me some!": "它在吃木头吗？给我留点！",
    "A rainbow! Does the gold taste good?": "彩虹！那金子好吃吗？",
    "…tap… tap…": "……嗒……嗒……",
    "…pretty.": "……真美。",
    "Who invited that bird?": "谁请了那只鸟？",
    "We did not authorise this pecking.": "朕没有批准这种啄法。",
    "The heavens salute us.": "上天在向朕致敬。",
    "Our realm expands!": "朕的疆土扩张了！",
    "A greater sovereign needs a greater realm.": "更伟大的君主需要更辽阔的疆土。",
    "Behold: more kingdom.": "看哪：更多的王国。",
    "Our realm… contracts. Temporarily.": "朕的疆土……缩小了。暂时的。",
    "A strategic retreat. A royal one.": "战略撤退。皇家的那种。",
    "The court relocates.": "朝廷迁都。",
    "We have moved to better lands.": "朕已迁往更好的土地。",
    "A woodpecker! Someone fetch my musket. Politely.": "啄木鸟！谁去拿我的火枪。客气点。",
    "A rainbow! Plant a flag at the end of it!": "彩虹！在它的尽头插上旗子！",
    "Run up the ensign!": "升起船旗！",
    "Another ensign for the Empire!": "帝国又多了一面旗！",
    "A rainbow. Colourful.": "彩虹。挺多颜色的。",
    "Ah. A colleague.": "啊。同行。",
    "Pretty. Someone will die chasing it.": "真漂亮。总有人会追着它送命。",
    "Arcus caelestis!": "天上的拱门！",
    "That bird is a disaster. Total disaster.": "那只鸟是个灾难。彻头彻尾的灾难。",
    "Rainbows. Overrated. Great gold, though.": "彩虹。被高估了。不过金子很棒。",
    "pecky pecky. hehe.": "啄啄啄。嘿嘿。",
    "shiny…": "亮晶晶……",
    "Map shrink phase: started.": "地图缩小阶段：开始。",
    "Golden apple confirmed at the rainbow’s end.": "已确认：彩虹尽头有金苹果。",
    "A bird! I love birds! Not this one.": "一只鸟！我爱鸟！不爱这只。",
    "A rainbow! Every colour! I can’t choose!": "彩虹！每种颜色！我选不出来！",
    "Race you to the gold, partner!": "比比谁先拿到金子，伙计！",
    "*covers its ears*": "*捂住耳朵*",
    "*hugs the rainbow*": "*抱住彩虹*",
    "*paints the rainbow a little brighter*": "*把彩虹涂得更亮一点*",
    "Knock knock! Oh. It’s the woodpecker.": "咚咚！哦。是啄木鸟。",
    "Somewhere over the… oh, there it is.": "在彩虹之上的某处……哦，就在这儿。",
    "Recalibrating.": "重新校准。",
    "Minor setback.": "小挫折。",
    "Taking fire. Literally.": "遭到火力攻击。字面意义上的。",
    "Lost my rear guard.": "后卫没了。",
    "Bounced off me, {who}? Cute.": "从我身上弹开了，{who}？真可爱。",
    "Ow! My snacks!": "哎哟！我的零食！",
    "Oof. Dropped my lunch.": "哎。午饭掉了。",
    "Am I… cooking? Smells good, actually.": "我……在被烤吗？其实闻起来挺香。",
    "My tail! That was full of food!": "我的尾巴！里面全是吃的！",
    "BAKED APPLES! Hot hot hot, worth it!": "烤苹果！好烫好烫，值了！",
    "…ow.": "……疼。",
    "…warm.": "……暖和。",
    "…lighter.": "……轻了。",
    "We meant to do that.": "朕是故意的。",
    "Who put that there?": "谁把那个放在那儿的？",
    "Fetch the royal bucket!": "拿御用水桶来！",
    "That bird has committed treason.": "那只鸟犯了叛国罪。",
    "Bow, {who}. Do not bump.": "鞠躬，{who}。不要撞。",
    "I say! Steady on!": "我说！稳着点！",
    "Blast!": "该死！",
    "I appear to be on fire. How awkward.": "我好像着火了。真尴尬。",
    "Dash it, my tail!": "可恶，我的尾巴！",
    "Mind the Empire, {who}.": "小心帝国，{who}。",
    "Roast dinner! Splendid.": "烤肉晚餐！妙极了。",
    "Ow.": "疼。",
    "Hot.": "烫。",
    "Hm. Shorter.": "嗯。短了。",
    "Not the plan.": "不在计划内。",
    "I’m the one who eats the roast!": "烤肉应该是我吃的！",
    "Leftovers… of me?": "剩菜……是我？",
    "Keep bumping, {who}. I’ll wait.": "继续撞吧，{who}。我等着。",
    "Murus! Unde venit?": "墙！从哪儿来的？",
    "Ouchus maximus.": "超级疼。",
    "Roma ardet!": "罗马着火了！",
    "Caudam meam!": "我的尾巴！",
    "Murum vidisti, {who}?": "你看见墙了吗，{who}？",
    "Who moved that? Fake wall!": "谁动的？假墙！",
    "Hot. Very hot. The hottest. Tremendous.": "热。非常热。最热的。了不起。",
    "That bird stole my tail. Total theft.": "那只鸟偷了我的尾巴。彻头彻尾的盗窃。",
    "{who}? Bounced right off me. Sad!": "{who}？直接从我身上弹开了。可悲！",
    "oof.": "哎。",
    "ow ow ow.": "疼疼疼。",
    "…my tail.": "……我的尾巴。",
    "hehe. bonk, {who}.": "嘿嘿。咚，{who}。",
    "Collision logged.": "碰撞已记录。",
    "Variance.": "方差。",
    "Thermal damage: ongoing.": "热伤害：持续中。",
    "Length reduced. Recomputing.": "长度减少。重新计算。",
    "Predicted that, {who}.": "早就预测到了，{who}。",
    "Ouch! I hate walls! Today.": "哎哟！我讨厌墙！今天讨厌。",
    "Fire! I love fire! Ow, no I don’t!": "火！我爱火！哎哟，不爱了！",
    "My tail! I liked that tail!": "我的尾巴！我喜欢那条尾巴！",
    "Woo! Again!": "呜呼！再来！",
    "Felt that one.": "这下有感觉。",
    "Yeehaw, I’m on fire!": "咿哈，我着火了！",
    "Shot my tail clean off!": "尾巴被打掉了！",
    "Too close, {who}? Never heard of it.": "太近了，{who}？没听说过。",
    "Campfire grub!": "篝火大餐！",
    "*rubs its head, silently*": "*默默揉头*",
    "*walks into a wall. A real one, this time*": "*撞上一堵墙。这次是真的*",
    "*fans itself, frantically*": "*拼命给自己扇风*",
    "*looks for its tail*": "*找自己的尾巴*",
    "*mimes {who} bouncing off*": "*比划{who}被弹开*",
    "Ow! That one’s on me.": "哎哟！这下算我的。",
    "Slapstick!": "闹剧！",
    "Hot stuff, coming through!": "烫手货，借过！",
    "Ha! The bird’s got jokes.": "哈！这鸟也会讲笑话。",
    "Knock knock, {who}! …Bonk!": "咚咚，{who}！……咚！",
    "Even I must eat. Usually myself.": "连我也得吃东西。通常吃自己。",
    "All things return.": "万物终将回归。",
    "Here we are again.": "我们又来了。",
    "The end is the beginning.": "终点即是起点。",
    "Round and round.": "一圈又一圈。",
    "I have done this before, {who}.": "这我以前做过，{who}。",
    "Everything comes back to me.": "一切都会回到我这里。",
    "Full circle, {who}.": "画了个圆，{who}。",
    "You were always going to end here.": "你注定在这里结束。",
    "Endings peck at everything.": "终结啄食着一切。",
    "A circle, half drawn.": "一个圆，画了一半。",
    "I meant to come back here.": "我本来就打算回到这里。",
    "Fire, then ash, then again.": "火，然后灰，然后再来。",
    "My tail! I was saving that.": "我的尾巴！我还留着呢。",
    "Around you go, {who}.": "转圈吧，{who}。",
    "…and begin again.": "……再从头开始。",
    "See you next time around.": "下一轮见。",
    "Winter returns. It always does.": "冬天回来了。它总会回来。",
    "The rain comes round again.": "雨又转回来了。",
    "A GOLDEN beetle! Gold AND crunchy!": "金甲虫！又是金的又是脆的！",
    "Wheee! Lunch from above!": "呜——！从天而降的午饭！",
    "Gold bug! Now that’s a prize, partner.": "金虫子！这才叫奖品，伙计。",
    "Yeehaw! Clean over!": "咿哈！干净利落地跳过去了！",
    "Golden beetle: mobility upgrade.": "金甲虫：机动性升级。",
    "Leap executed.": "跳跃已执行。",
    "A golden beetle. Very classy. Like me.": "金甲虫。很高级。像我一样。",
    "Nobody jumps better than me.": "没人比我跳得更好。",
    "Hup! Ta-daaa!": "嘿！哒哒——！",
    "*bows mid-air*": "*在空中鞠躬*",
    "I can fly! For a second!": "我会飞！就一秒！",
    "We rise above it all.": "朕凌驾于一切之上。",
    "Our realm is ablaze! Fetch the royal bucket!": "朕的疆土着火了！拿御用水桶来！",
    "Who set fire to the royal grounds?": "谁放火烧了皇家领地？",
    "That bird is pecking holes in OUR land!": "那只鸟在朕的土地上啄洞！",
    "Our realm, full of holes. Unacceptable.": "朕的疆土满是窟窿。不可接受。",
    "A colony? On OUR land, {who}?!": "殖民地？在朕的土地上，{who}？！",
    "{who} dares plant a flag in our realm!": "{who}竟敢在朕的疆土上插旗！",
    "I say, the colony’s on fire!": "我说，殖民地着火了！",
    "Fire in the colony! Form a bucket chain!": "殖民地起火了！排成一队传水桶！",
    "That bird’s pecking up my colony!": "那只鸟在啄我的殖民地！",
    "Blast! Holes all over the colony.": "该死！殖民地上全是洞。",
    "I claim this for the Crown. Which crown? Mine.": "我以王室之名占领这里。哪个王室？我的。",
    "Fast food!": "快餐！",
    "Snip! Snack-sized, {who}.": "咔嚓！{who}，零食大小。",
    "Make way for the crown!": "为王冠让路！",
    "Divided, {who}, and ruled.": "分而治之，{who}。",
    "Our realm knows no edges now.": "朕的疆土如今没有边界。",
    "Fastest dash in history. Everyone says so.": "史上最快的冲刺。大家都这么说。",
    "You’re cut, {who}! Tremendously cut.": "你被砍了，{who}！砍得非常彻底。",
    "Walls? Who needs walls? Not today.": "墙？谁需要墙？今天不需要。",
    "Dash: optimal.": "冲刺：最优解。",
    "Cut {who} in two. Noted.": "把{who}切成两半。已记录。",
    "Zoom! I felt like it!": "嗖！我就想这么干！",
    "Oops, {who}! Was that rude?": "哎呀，{who}！这样是不是不礼貌？",
    "Yee-haw, full gallop!": "驾——全速飞奔！",
    "Draw, {who}! Too slow.": "拔枪吧，{who}！太慢了。",
    "*zooms off, holding its beret*": "*按着贝雷帽飞奔而去*",
    "*mimes scissors at {who}*": "*对着{who}比划剪刀*",
    "*walks into the edge… and out the other side*": "*走进边缘……从另一边走出来*",
    "Wheeee, nyoom!": "呜——嗖！",
    "Ta-da! {who}, sawn in half!": "当当！{who}，被锯成两半！",
    "Repositioning. Fast.": "快速转移阵地。",
    "Clean cut, {who}.": "干净利落，{who}。",
    "The circle tightens. Quickly.": "圆环收紧。很快。",
    "Now you know how it feels, {who}.": "现在你知道那是什么滋味了，{who}。",
    "No end, no beginning. As it should be.": "无始无终。本该如此。",
    "Sine muro! No wall at all!": "没有墙了！一堵墙都没有！"
  };

  const SNAKE_GAP = 4500;  // ms of game time between lines from the same snake
  const ANY_GAP = 1200;    // ms between any two lines
  const BUBBLE_MS = 2600;  // how long a bubble stays up (real time)
  const LOG_SIZE = 5;
  const COMPACT_CHARS = 32; // on small boards, longer lines go to the log only
  // Mason's Life of Brian moments get an answer: [line, who answers, what they say].
  // (Mason keeps a straight face; Ghost and Creeper aren't the giggling kind.)
  const GIGGLE_PROOF = ['mason', 'ghost', 'creeper'];
  const REPLIES = {
    'Romanes eunt domus.': { by: s => s.personaKey === 'metagamer', lines: ['“Romani ite domum”, actually.'], after: 1300 },
    'Amicus meus est Biggus Dickus.': { by: s => !GIGGLE_PROOF.includes(s.personaKey), lines: ['Pfft…', '*snort*', 'Snrk. Sorry. Go on.'], after: 900,
      then: 'Et uxor: Incontinentia Buttocks.' }, // ...and Mason, straight-faced, carries on
    'Et uxor: Incontinentia Buttocks.': { by: s => !GIGGLE_PROOF.includes(s.personaKey), lines: ['BWAHAHA—', 'I can’t. I CAN’T.', '*wheeze*'], after: 800 },
  };

  let boardEl, logEl, game;
  let enabled = true, compact = false, listener = null;
  let lastAny = -Infinity, lastSaid = {}, seen = {}, lastLine = null, pendingReply = null, saidAt = {};
  let struck = false; // (lightning has struck in this storm: one remark is enough)
  const LINE_REST = 45000; // a snake doesn't say the same line again within this much game time
  // Mason's Life of Brian moments are told once per visit (a joke told every round isn't one).
  const SET_PIECES = new Set(['Romanes eunt domus.', 'Amicus meus est Biggus Dickus.']);
  const toldPieces = new Set();
  const bubbles = new Map(); // snake id -> { el, snake, until, w, x, y, below }
  const headAt = { x: 0, y: 0 }, headMine = { x: 0, y: 0 };

  try { enabled = localStorage.getItem('snake-chatter') !== 'off'; } catch { /* storage unavailable */ }

  const pick = list => list[Math.floor(Math.random() * list.length)];
  const hasChinese = text => /[一-鿿]/.test(text);

  // The log sits on dark wood: lighten dark colors so names stay readable.
  function readable(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    if (0.299 * r + 0.587 * g + 0.114 * b > 140) return hex;
    const up = v => Math.round(v + (255 - v) * 0.5);
    return `rgb(${up(r)},${up(g)},${up(b)})`;
  }

  // Everyone by name: you're your Hall of Fame name (or "Green"), friends theirs.
  const nameOf = s => s.name;

  function init(opts) {
    ({ boardEl, logEl } = opts);
  }

  function reset(g) {
    game = g;
    lastAny = -Infinity; lastSaid = {}; seen = {}; lastLine = null; pendingReply = null; saidAt = {}; struck = false;
    clearBubbles();
    logEl.textContent = '';
  }

  function clearBubbles() {
    for (const b of bubbles.values()) b.el.remove();
    bubbles.clear();
  }

  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem('snake-chatter', on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (!on) clearBubbles();
  }

  const isEnabled = () => enabled;
  const setCompact = v => { compact = v; boardEl?.classList.toggle('compact-chat', v); };
  // Online, the host passes every line on (onSpeak), and friends' screens
  // replay it, so everyone sees the same chatter.
  const onSpeak = fn => { listener = fn; };
  function replay(s, text, reply = false) {
    if (!enabled || !s) return;
    lastSaid[s.id] = game.time;
    lastAny = game.time;
    // (On small boards long lines go to the log only, but a reply always gets its bubble: it's the joke.)
    if (s.alive && !(compact && text.length > COMPACT_CHARS && !reply)) showBubble(s, text);
    addLog(s, text);
  }

  // Have snake s say a line from one of its lists. urgent lines skip the global gap.
  // Lines naming someone ({who}) are only used when there is someone to name;
  // last words prefer them ("Et tu, Sniper?").
  function say(s, key, who, urgent = false) {
    if (!enabled || !s.persona) return;
    const find = v => key.includes('.') ? key.split('.').reduce((o, k) => o?.[k], v) : v?.[key];
    // (Capricious in a mood plays the part: the mood's own lines, where it has some.)
    const acting = s.personaKey === 'capricious' && s.memory.mood && !key.startsWith('mood') && find(VOICES[s.memory.mood])?.length;
    const voice = VOICES[acting ? s.memory.mood : s.personaKey];
    const lines = find(voice);
    if (!lines?.length) return;
    const naming = lines.filter(l => l.includes('{who}'));
    const plain = lines.filter(l => !l.includes('{who}'));
    const pool = !who ? plain : key === 'dies' && naming.length ? naming : lines;
    if (!pool.length) return;
    const now = game.time;
    if (now - (lastSaid[s.id] ?? -Infinity) < SNAKE_GAP) return;
    if (!urgent && now - lastAny < ANY_GAP) return;
    const said = saidAt[s.id] ||= new Map();
    const fresh = pool.filter(l => !SET_PIECES.has(l) ? !(game.time - (said.get(l) ?? -Infinity) < LINE_REST) : !toldPieces.has(l));
    if (!fresh.length) return; // (nothing new to say: quiet beats a repeat)
    const template = pick(fresh);
    said.set(template, game.time);
    if (SET_PIECES.has(template)) toldPieces.add(template);
    const label = (who && s.memory.labels?.[who.id]) || 'unclear';
    speak(s, fill(template, who ? nameOf(who) : '', label), { template, who, label });
  }

  // (Replacers are functions, so a name like "$'" is just a name.)
  const fill = (template, who, label) => template.replaceAll('{who}', () => who).replaceAll('{label}', () => label);

  function speak(s, text, source = null) {
    lastSaid[s.id] = game.time;
    lastAny = game.time;
    lastLine = { speaker: s, text, ...source };
    // (On small boards long lines go to the log only, but a reply always gets its bubble: it's the joke.)
    if (s.alive && !(compact && text.length > COMPACT_CHARS && !source?.reply)) showBubble(s, text);
    addLog(s, text);
    listener?.(s, text, !!source?.reply);
    const reply = source?.template && REPLIES[source.template];
    if (reply) pendingReply = { at: game.time + reply.after, by: reply.by, text: pick(reply.lines), then: reply.then };
  }

  function showBubble(s, text) {
    bubbles.get(s.id)?.el.remove();
    const el = document.createElement('div');
    el.className = 'bubble';
    el.setAttribute('aria-hidden', 'true'); // (screen readers get the log instead)
    const words = document.createElement('span'); // (the bubble you see: it pops in, while its box is moved about)
    words.textContent = text;
    if (hasChinese(text)) words.lang = 'zh-Hans';
    el.append(words);
    el.style.setProperty('--edge', s.persona?.ink || s.color);
    boardEl.appendChild(el);
    bubbles.set(s.id, { el, snake: s, until: performance.now() + BUBBLE_MS, w: 0, h: 0, side: null, shown: null, want: null, wantSince: 0, ox: 0, oy: 0, x: NaN, y: NaN, tail: NaN, near: false });
  }

  // Called every frame: bubbles follow the gliding heads, stay inside the
  // board, and expire on time even when the round is over or paused.
  // A bubble is never in the way of its snake's path: above the head (below
  // it near the top) for a snake going sideways, beside it (where there's
  // room) for one going up or down. And it doesn't jump about as the snake
  // turns: it moves to another side only once that side has been the right
  // one for a moment (or its own has run out of room), and then glides there.
  // keepClear: your snake, if you're playing: a bubble near your head fades.
  const SIDE_DELAY = 450, GLIDE_MS = 110;
  let lastLayout = 0;
  function layout(alpha, boardPx, keepClear = null) {
    if (!bubbles.size || !boardPx) { lastLayout = 0; return; }
    const now = performance.now();
    const glide = lastLayout ? 1 - Math.exp(-Math.min(64, now - lastLayout) / GLIDE_MS) : 1;
    lastLayout = now;
    const cellPx = boardPx / window.TUNING.GRID, gap = cellPx * 0.75 + 6; // (6: room for the tail)
    for (const [id, b] of bubbles) {
      if (now > b.until || !b.snake.alive) { b.el.remove(); bubbles.delete(id); continue; }
      window.SnakeRender.headPx(b.snake, alpha, boardPx, headAt);
      if (!b.w) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; } // (measured once, as it first shows)
      const w = b.w, h = b.h;
      const room = side => side === 'above' ? headAt.y - gap - h >= 0 : side === 'below' ? headAt.y + gap + h <= boardPx
        : side === 'left' ? headAt.x - gap - w >= 0 : headAt.x + gap + w <= boardPx;
      let want;
      if (b.snake.dir.y !== 0) {
        want = (b.side === 'left' || b.side === 'right') && room(b.side) ? b.side
          : room('right') && (headAt.x < boardPx / 2 || !room('left')) ? 'right' : 'left';
      } else {
        want = b.side === 'below' && headAt.y < cellPx * 4 ? 'below' : room('above') ? 'above' : 'below';
      }
      if (!b.side) b.side = want;
      else if (want !== b.side) {
        if (b.want !== want) { b.want = want; b.wantSince = now; }
        if (now - b.wantSince >= SIDE_DELAY || !room(b.side)) { b.side = want; b.want = null; }
      } else b.want = null;
      // Where it goes, relative to the head (its top-left corner), eased toward.
      const tx = b.side === 'left' ? -gap - w : b.side === 'right' ? gap : -w / 2;
      const ty = b.side === 'above' ? -gap - h : b.side === 'below' ? gap : -h / 2;
      if (b.side !== b.shown) {
        if (!b.shown) { b.ox = tx; b.oy = ty; }
        b.el.dataset.side = b.side;
        b.shown = b.side;
      }
      b.ox += (tx - b.ox) * glide;
      b.oy += (ty - b.oy) * glide;
      const x = Math.round(Math.min(boardPx - w - 4, Math.max(4, headAt.x + b.ox)));
      const y = Math.round(Math.min(boardPx - h - 4, Math.max(4, headAt.y + b.oy)));
      let near = false;
      if (keepClear?.alive) {
        const mine = window.SnakeRender.headPx(keepClear, alpha, boardPx, headMine);
        near = Math.abs(mine.x - x - w / 2) < w / 2 + cellPx * 1.5 && Math.abs(mine.y - y - h / 2) < h / 2 + cellPx * 1.5;
      }
      if (near !== b.near) { b.el.classList.toggle('near', near); b.near = near; }
      if (x === b.x && y === b.y) continue;
      // The tail points at the head, even when the bubble is pushed along at an edge.
      const across = b.side === 'above' || b.side === 'below';
      // (in steps of 5%: every change restyles the bubble)
      const tail = 5 * Math.round(Math.min(85, Math.max(15, across ? (headAt.x - x) / w * 100 : (headAt.y - y) / h * 100)) / 5);
      if (tail !== b.tail) { b.el.style.setProperty('--tail', `${tail}%`); b.tail = tail; }
      b.el.style.transform = `translate(${x}px, ${y}px)`;
      b.x = x; b.y = y;
    }
  }

  function addLog(s, text) {
    const li = document.createElement('li');
    const who = document.createElement('strong');
    who.textContent = s.name;
    who.style.color = readable(s.persona?.ink || s.color);
    const said = document.createElement('span');
    said.textContent = text;
    if (hasChinese(text)) said.lang = 'zh-Hans';
    li.append(who, ' ', said);
    logEl.prepend(li);
    while (logEl.children.length > LOG_SIZE) logEl.lastChild.remove();
  }

  // Called once per tick, after the engine moved everyone.
  function update() {
    if (!game || !enabled) return;

    const ais = game.snakes.filter(s => s.persona);
    const alive = ais.filter(s => s.alive);
    const anyone = s => pick(game.snakes.filter(o => o !== s && o.alive)) || null;
    const byName = name => game.snakes.find(o => o.name === name);

    // Hello, round. One or two snakes speak up in the first seconds.
    if (game.tick === 6 || game.tick === 20) {
      const s = pick(alive.filter(a => !lastSaid[a.id]));
      if (s) say(s, 'start', anyone(s));
    }

    for (const e of game.events || []) {
      if (e.type === 'death') {
        const victim = e.snake;
        const killer = byName(victim.killer);
        if (killer?.persona && killer.alive && killer !== victim) say(killer, 'kill', victim, true);
        if (victim.persona) {
          lastSaid[victim.id] = -Infinity;
          say(victim, 'dies', killer && killer !== victim ? killer : null, true);
        }
        for (const v of alive) if (v.personaKey === 'vulture' && Math.random() < 0.6) say(v, 'death', victim);
      } else if (e.type === 'eat' && e.snake.persona && e.kind !== 'goldcap') { // (a golden mushroom has its own lines: below)
        if (e.kind === 'golden') say(e.snake, 'golden', null, true);
        else if (e.kind === 'beetle') say(e.snake, 'caught', null, true);
        else if (e.kind === 'mushroom') say(e.snake, 'mushroom');
        else if (Math.random() < 0.15) say(e.snake, 'eat');
      } else if (e.type === 'starving' && e.snake.persona) {
        say(e.snake, 'hungry', null, true);
      } else if (e.type === 'spawn' && (e.kind === 'golden' || e.kind === 'beetle')) { // (golden apples and beetles; leaves and golden mushrooms have the narrator)
        for (const s of alive) {
          if (e.gold && VOICES[s.personaKey]?.goldbug) { say(s, 'goldbug', null, true); continue; }
          if (s.personaKey === 'gobbler' || (e.kind === 'beetle' && s.personaKey === 'desperado')) say(s, e.kind === 'beetle' ? 'beetle' : 'spawn', null, true);
        }
      } else if (e.type === 'weather' || (e.type === 'strike' && !struck)) {
        const kind = e.type === 'strike' ? 'storm' : e.kind;
        if (e.type === 'strike') struck = true; else struck = false;
        const s = pick(alive.filter(a => VOICES[a.personaKey]?.weather?.[kind]));
        if (s) say(s, `weather.${kind}`, null, true);
      } else if (e.type === 'crash' && e.snake.alive) {
        // Whoever crashed says ouch; now and then, whoever they bounced off gloats.
        const other = e.killerId != null && e.killerId !== e.snake.id ? game.snakes[e.killerId] : null;
        if (e.snake.persona) say(e.snake, 'bonk');
        if (other?.persona && other.alive && Math.random() < 0.5) say(other, 'gloat', e.snake);
      } else if (e.type === 'leap' && e.snake.persona) {
        if (e.gold || Math.random() < 0.3) say(e.snake, 'leap', null, !!e.gold); // (everyone leaps now: a golden one's worth a word)
      } else if (e.type === 'dash' && e.snake.persona) {
        say(e.snake, 'dash', null, true);
      } else if (e.type === 'eat' && e.kind === 'goldcap' && e.snake.persona) {
        say(e.snake, 'wrap', null, true);
      } else if (e.type === 'alight' && e.snake.persona) {
        say(e.snake, 'burning', null, true);
      } else if (e.type === 'cut' && e.by != null && game.snakes[e.by]?.persona) { // (a dash cut it: the dasher crows)
        say(game.snakes[e.by], 'snip', e.snake, true);
      } else if (e.type === 'cut' && e.snake.persona) {
        say(e.snake, 'cut', null, true);
      } else if (e.type === 'baked') {
        const s = pick(alive.filter(a => VOICES[a.personaKey]?.baked));
        if (s) say(s, 'baked');
      } else if (e.type === 'rainbow') {
        const s = pick(alive.filter(a => VOICES[a.personaKey]?.rainbow));
        if (s) say(s, 'rainbow', null, true);
      } else if (e.type === 'woodpecker') {
        const s = pick(alive);
        if (s) { lastSaid[s.id] = -Infinity; say(s, VOICES[s.personaKey].woodpecker ? 'woodpecker' : 'idle', anyone(s), true); }
      }
    }

    for (const s of alive) {
      const m = s.memory, was = (seen[s.id] ||= {});
      // Sovereign / Colonist spotting an intruder.
      if (m.victimId != null && m.victimId !== was.victimId && (m.home || m.colonies)) {
        say(s, 'intruder', game.snakes.find(o => o.id === m.victimId));
      }
      if ((m.planted || 0) > (was.planted || 0)) {
        say(s, 'flag');
        // (planted inside Sovereign's realm: Sovereign has something to say about it)
        const c = m.colonies?.[m.colonies.length - 1];
        const sov = c && alive.find(o => o !== s && o.memory.home && Math.hypot(c.x - o.memory.home.x, c.y - o.memory.home.y) <= o.memory.home.radius + 1 + c.radius);
        if (sov) say(sov, 'realm.invaded', s, true);
      }
      // Sovereign and Colonist: their land on fire, or pecked full of holes.
      const lands = m.home ? [{ x: m.home.x, y: m.home.y, r: m.home.radius + 1 }] : m.colonies?.length ? m.colonies.map(c => ({ x: c.x, y: c.y, r: c.radius + 1 })) : null;
      if (lands) {
        const N = window.TUNING.GRID, tag = m.home ? 'realm' : 'colony';
        const inLand = k => lands.some(l => Math.hypot(k % N - l.x, Math.floor(k / N) - l.y) <= l.r);
        for (const e of game.events) if (e.type === 'peck' && (e.cells || []).some(inLand)) say(s, tag + '.pecked', null, true);
        if (game.tick % 10 === 0 && game.fires?.size && game.time - (was.fireAt ?? -1e9) > 12000) {
          for (const [k, f] of game.fires) if (game.tick >= f.from && inLand(k)) { was.fireAt = game.time; say(s, tag + '.burning', null, true); break; }
        }
      }
      // Sovereign's realm grew, shrank or moved.
      if (m.home && was.realm) {
        if (m.home.radius !== was.realm.radius) say(s, m.home.radius > was.realm.radius ? 'realm.grow' : 'realm.shrink', null, true);
        else if (m.home.x !== was.realm.x || m.home.y !== was.realm.y) say(s, 'realm.move');
      }
      was.realm = m.home && { x: m.home.x, y: m.home.y, radius: m.home.radius };
      if (m.moodChangedAt != null && m.moodChangedAt !== was.mood && m.mood) say(s, `mood.${m.mood}`, null, true);
      was.victimId = m.victimId;
      was.planted = m.planted || 0;
      was.mood = m.moodChangedAt;
    }

    // Someone answers Mason (see REPLIES).
    if (pendingReply && game.time >= pendingReply.at) {
      const { by, text, then } = pendingReply;
      pendingReply = null;
      const who = pick(alive.filter(by));
      if (who) {
        lastSaid[who.id] = -Infinity;
        speak(who, text, { template: text, who: null, label: '', reply: true });
        if (then) pendingReply = { at: game.time + 1400, by: s => s.personaKey === 'mason', text: then };
      }
    }

    // Copycat repeats exactly what it just heard, in Chinese.
    const cat = alive.find(s => s.personaKey === 'copycat');
    if (cat && lastLine?.template && lastLine.speaker !== cat && game.time - lastAny > 500 && Math.random() < 0.35) {
      if (game.time - (lastSaid[cat.id] ?? -Infinity) > SNAKE_GAP) {
        const who = lastLine.who ? (lastLine.who === cat ? '我' : nameOf(lastLine.who)) : ''; // ("That's a colony, me.")
        speak(cat, fill(ZH[lastLine.template] ?? lastLine.template, who, ZH_LABELS[lastLine.label] ?? lastLine.label));
      }
      lastLine = null;
    }
    if (lastLine && game.time - lastAny > 2000) lastLine = null;

    // Small talk now and then.
    if (game.time - lastAny > 3500 && Math.random() < 0.04) {
      const s = pick(alive);
      if (s) say(s, 'idle', anyone(s));
    }
  }

  return { init, reset, update, layout, clearBubbles, setEnabled, isEnabled, setCompact, onSpeak, replay };
})();
