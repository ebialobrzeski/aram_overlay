/**
 * Hand-written champion pair combos with execution tips. Aliases are Data Dragon ids; order in `pair` doesn't
 * matter. If one of the generic rules in synergies.ts already detects the pair, only the tip is used; otherwise
 * the pair is added as its own synergy with a small bonus. Add your own freely.
 */
export interface ComboTip { pair: [string, string]; label: string; tip: string }

export const comboKey = (a: string, b: string) => [a, b].sort().join('+');

export const COMBO_TIPS: ComboTip[] = [
  // Yasuo / Yone knock-up chains
  { pair: ['Yasuo', 'Malphite'], label: 'Malphite R → Yasuo R', tip: 'Malphite R knocks up the whole team. Yasuo: ult instantly off it for a 5-man lockdown.' },
  { pair: ['Yasuo', 'Alistar'], label: 'Alistar W-Q → Yasuo R', tip: 'Alistar headbutt → pulverize (W→Q) knocks up; Yasuo follows with Last Breath.' },
  { pair: ['Yasuo', 'Gragas'], label: 'Gragas knock-ups → Yasuo R', tip: 'Gragas E or R knocks up; Gragas R can blast enemies into a clump first.' },
  { pair: ['Yasuo', 'Diana'], label: 'Diana R pull → Yasuo R', tip: 'Diana R pulls them together; Yasuo Q3 tornado through the clump → R.' },
  { pair: ['Yasuo', 'MonkeyKing'], label: 'Wukong R → Yasuo R', tip: 'Wukong R knocks up twice; Yasuo can ult on either spin.' },
  { pair: ['Yasuo', 'Ornn'], label: 'Ornn R → Yasuo R', tip: 'Ornn: headbutt the returning ram (second R) to knock up a line; Yasuo cleans up.' },
  { pair: ['Yasuo', 'Rell'], label: 'Rell slam → Yasuo R', tip: 'Rell W crash-down knocks up and R magnetizes the group; Yasuo ults when they fly.' },
  { pair: ['Yasuo', 'Janna'], label: 'Janna tornado → Yasuo R', tip: 'Janna Q tornado knocks up a whole lane: free Yasuo ult setup from range.' },
  { pair: ['Yasuo', 'Gnar'], label: 'Gnar R → Yasuo R', tip: 'Mega Gnar R knocks back several enemies; Yasuo can ult the knock-back.' },
  { pair: ['Yasuo', 'Zac'], label: 'Zac bounces → Yasuo R', tip: 'Zac E lands as a knock-up and R bounces enemies repeatedly: lots of ult windows.' },
  { pair: ['Yone', 'Malphite'], label: 'Malphite R + Yone R', tip: 'Chain Malphite R and Yone R back to back for a very long knock-up.' },
  { pair: ['Yone', 'Diana'], label: 'Diana R pull + Yone R', tip: 'Diana R pulls them into a clump; Yone R dashes through all of them.' },

  // Orianna ball delivery
  { pair: ['Orianna', 'Malphite'], label: 'Malphite R carries the Orianna ball', tip: 'Ball on Malphite (E) before he ults in, then Shockwave the whole team on landing.' },
  { pair: ['Orianna', 'JarvanIV'], label: 'J4 carries the Orianna ball', tip: 'Ball on J4: he E-Q in and Cataclysms, you Shockwave everyone trapped inside.' },
  { pair: ['Orianna', 'Sejuani'], label: 'Sejuani carries the Orianna ball', tip: 'Ball on Sejuani; her R stun plus your Shockwave layers two AoE CCs.' },
  { pair: ['Orianna', 'Hecarim'], label: 'Hecarim carries the Orianna ball', tip: 'Ball on Hecarim as he charges in at speed, then R as he arrives.' },
  { pair: ['Orianna', 'Rakan'], label: 'Rakan carries the Orianna ball', tip: 'Ball on Rakan while he charms through their team with ult.' },
  { pair: ['Orianna', 'Sett'], label: 'Sett carries the Orianna ball', tip: 'Ball on Sett before he suplexes into their group; Shockwave on the slam.' },

  // lovers and Kalista throws
  { pair: ['Xayah', 'Rakan'], label: 'Xayah + Rakan lovers', tip: 'Longer joint jumps. Rakan engages; Xayah recalls feathers to root the CC\'d targets.' },
  { pair: ['Kalista', 'Blitzcrank'], label: 'Kalista R → Blitz hook', tip: 'Bind Blitz, R him toward them: he can Rocket Grab from his landing spot.' },
  { pair: ['Kalista', 'Alistar'], label: 'Kalista R throws Alistar', tip: 'Kalista R throws Alistar in; he lands with a knock-up and follows with W-Q.' },
  { pair: ['Kalista', 'Rell'], label: 'Kalista R throws Rell', tip: 'Kalista R → Rell W slam from a flank angle: huge surprise engage.' },
  { pair: ['Kalista', 'Sion'], label: 'Kalista R throws Sion', tip: 'Fling Sion so he lands near their backline, then he charges with R.' },
  { pair: ['Kalista', 'Nautilus'], label: 'Kalista R throws Nautilus', tip: 'R Nautilus in; he knocks up on landing and chains his own CC.' },
  { pair: ['Kalista', 'Taric'], label: 'Kalista R throws Taric', tip: 'R Taric in with E stun ready, then he ults so the whole team follows invulnerable.' },

  // protect the carry
  { pair: ['Lulu', 'KogMaw'], label: "Lulu W/R + Kog'Maw", tip: 'Lulu W (speed + AS) and E shield on Kog; save R for when divers jump him.' },
  { pair: ['Lulu', 'Twitch'], label: 'Lulu + Twitch', tip: 'Lulu W on Twitch as he ults from stealth; save R for when he gets caught.' },
  { pair: ['Lulu', 'MasterYi'], label: 'Lulu + Master Yi', tip: 'W, E shield and R knock-up all on a diving Yi.' },
  { pair: ['Lulu', 'Jinx'], label: 'Lulu + Jinx', tip: 'Keep Jinx alive through the first kill: her passive then snowballs the fight.' },
  { pair: ['Yuumi', 'MasterYi'], label: 'Yuumi on Master Yi', tip: 'Ride Yi into fights: you untarget with him during Q. Heal and speed him through the dive.' },
  { pair: ['Yuumi', 'Zeri'], label: 'Yuumi on Zeri', tip: 'Attach to Zeri: she E-dashes over walls and you come along.' },
  { pair: ['Taric', 'MasterYi'], label: 'Taric R makes Master Yi invulnerable', tip: 'Taric R as Yi goes in: 2.5 s of invulnerable reset spam.' },
  { pair: ['Taric', 'Kayle'], label: 'Taric R + Kayle R', tip: 'Stagger invulnerabilities: Kayle R first, Taric R as it ends.' },
  { pair: ['Zilean', 'MasterYi'], label: 'Zilean backs Master Yi', tip: 'Zilean R as backup for a diving Yi; double-bomb stun picks for him to reset on.' },
  { pair: ['Kayle', 'MasterYi'], label: 'Kayle R on Master Yi', tip: 'Kayle R on Yi mid-dive: he resets freely through the invulnerability.' },
  { pair: ['Ivern', 'KogMaw'], label: "Ivern protects Kog'Maw", tip: 'Ivern shield on Kog and keep Daisy next to him as a bodyguard.' },
  { pair: ['Janna', 'Twitch'], label: 'Janna + Twitch', tip: 'Janna E shield (bonus AD) on Twitch R; tornado anyone who finds him.' },
  { pair: ['Milio', 'Aphelios'], label: 'Milio + Aphelios', tip: 'Milio E/range buff on Aphelios, and his R cleanse when Aphelios gets caught.' },
  { pair: ['Renata', 'Twitch'], label: 'Renata W keeps Twitch R going', tip: 'Renata W on Twitch: if he gets a takedown before it expires, he survives.' },

  // lockdown into big ults
  { pair: ['Amumu', 'MissFortune'], label: 'Amumu R → MF R', tip: 'Amumu R holds them still; MF channels Bullet Time immediately after.' },
  { pair: ['Amumu', 'Karthus'], label: 'Amumu R → Karthus', tip: 'Amumu R stuns the group; Karthus walks in with E and casts R.' },
  { pair: ['Malphite', 'MissFortune'], label: 'Malphite R → MF R', tip: 'Malphite R knocks everyone up; MF channels R on the clump.' },
  { pair: ['JarvanIV', 'MissFortune'], label: 'J4 arena → MF R', tip: 'J4 Cataclysm walls them in so they can\'t walk out of Bullet Time.' },
  { pair: ['JarvanIV', 'Galio'], label: 'J4 arena + Galio R', tip: 'Galio ults onto J4 as he Cataclysms: taunt everyone trapped in the arena.' },
  { pair: ['Galio', 'Kennen'], label: 'Galio R follows Kennen', tip: 'Galio R onto Kennen as he flashes in with Slicing Maelstrom.' },
  { pair: ['Galio', 'Diana'], label: 'Galio R follows Diana', tip: 'Galio R onto a diving Diana: she pulls them, he taunts the same group.' },
  { pair: ['Rumble', 'Lissandra'], label: 'Lissandra lockdown → Rumble R', tip: 'Lissandra W root or R freeze keeps them in the Equalizer fire.' },
  { pair: ['Rumble', 'Amumu'], label: 'Amumu R → Rumble R', tip: 'Amumu R stuns in place; Rumble draws R through the whole clump.' },
  { pair: ['Nunu', 'Kennen'], label: 'Nunu + Kennen', tip: 'Nunu snowball stun and R slow keep them inside Kennen\'s storm.' },
  { pair: ['Bard', 'Karthus'], label: 'Bard stasis → Karthus R', tip: 'Bard R a group; Karthus times R so it lands as the stasis ends.' },
  { pair: ['Bard', 'Fiddlesticks'], label: 'Bard stasis → Fiddle R', tip: 'Bard R freezes them; Fiddle starts Crowstorm so it lands as stasis ends.' },
  { pair: ['Renata', 'MissFortune'], label: 'Renata R → MF R', tip: 'Renata R makes them fight each other while MF channels on top.' },
  { pair: ['Gangplank', 'Leona'], label: 'Leona lockdown → GP barrels', tip: 'Leona stuns them in place for barrels and Cannon Barrage.' },
  { pair: ['Rell', 'Seraphine'], label: 'Rell R → Seraphine R', tip: 'Rell R magnetizes them together; Seraphine R charms the whole clump.' },
  { pair: ['Seraphine', 'Sona'], label: 'Double Crescendo', tip: 'Chain the two R stuns: one after the other on the same group, never at once.' },
  { pair: ['Neeko', 'Galio'], label: 'Neeko R + Galio taunt', tip: 'Neeko R pop-blossom and Galio R taunt on the same group: long stacked CC.' },

  // pick / poke
  { pair: ['Ashe', 'Varus'], label: 'Ashe arrow + Varus chains', tip: 'Land one long-range pick and the other follows up to lock the target.' },
  { pair: ['Ashe', 'Ezreal'], label: 'Ashe arrow → Ezreal poke', tip: 'Ashe R stun lets Ezreal land Q and R from max range.' },
  { pair: ['Zilean', 'Ziggs'], label: 'Zilean + Ziggs poke', tip: 'Double-bomb stun plus Ziggs satchels: endless displacement and poke.' },
  { pair: ['Sion', 'Anivia'], label: 'Sion + Anivia wall', tip: 'Sion charges them back toward Anivia\'s wall and R zone.' },
  { pair: ['Sona', 'Taric'], label: 'Sona + Taric sustain', tip: 'Sona heals and speed plus Taric invulnerability: take long fights, not short ones.' },
];
