# Dominion

A browser god game in the spirit of the classic "god sim" genre: you are an invisible deity
with a giant hand, a tribe of villagers, and a creature you raise and train. Win each land by
impressing the rival tribes into worshipping you, or by crushing them with soldiers, miracles
and your creature. Every choice nudges you towards benevolence or malevolence, and the world,
your temple, your hand and your creature change to match.

Everything is original code and procedural art. There are no external assets, no build step and
no server: it is plain JavaScript on top of [Three.js](https://threejs.org) (vendored, MIT).

## Install and play

**macOS and Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/guilyx/dominion/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/guilyx/dominion/main/install.ps1 | iex
```

That picks the right build for your machine, installs it, and on macOS clears the download
quarantine for you so the first launch is not blocked. Add `| sh -s -- --dry-run` (or
`-DryRun` on Windows) to see what it would do without touching anything.

Prefer to do it by hand, or want the no-install version? Every release ships a desktop build for
Windows, macOS and Linux, plus a single HTML file that runs anywhere — take one from the
[latest release](https://github.com/guilyx/dominion/releases/latest) and follow the steps below.

The desktop builds are **not code-signed**, so each system will warn you the first time. The steps
below are the normal way to accept an unsigned app; they are only needed once.

### Windows

1. Download `dominion-<version>-win-x64-setup.exe` (installer) or
   `dominion-<version>-win-x64-portable.exe` (no install, runs from anywhere).
2. Run it. SmartScreen will say "Windows protected your PC" — click **More info**, then
   **Run anyway**.

The portable build needs no administrator rights and leaves nothing behind.

### macOS

1. Download `dominion-<version>-mac-arm64.dmg` for Apple silicon, or `…-mac-x64.dmg` for Intel.
2. Open it and drag **Dominion** to Applications.
3. The first launch is blocked because the app is unsigned. Clear the download quarantine:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Dominion.app
   ```

   Then open it normally. (Alternatively: launch it once, then go to **System Settings → Privacy
   & Security** and click **Open Anyway**.)

### Linux

**AppImage** — works on most distributions, no install:

```sh
chmod +x dominion-*-linux-x86_64.AppImage
./dominion-*-linux-x86_64.AppImage
# if your system has no FUSE:
./dominion-*-linux-x86_64.AppImage --appimage-extract-and-run
```

**Debian / Ubuntu**:

```sh
sudo apt install ./dominion-*-linux-amd64.deb
dominion
```

### Any OS, no install at all

Download `dominion-<version>-portable.html` and open it in a browser. It is the whole game in one
file: no server, no network, no dependencies. Works from a USB stick.

Saves live in your browser's (or the app's) local storage. The game autosaves every two minutes,
and F5 / F9 quick-save and quick-load. Saves made in the browser and in the desktop app are
separate.

## Run from source

Needs [Node.js](https://nodejs.org) 18 or newer, and nothing else.

```sh
git clone https://github.com/guilyx/dominion.git
cd baw
npm start          # serves the game and opens a browser
```

`npm start` runs a small dependency-free static server, so it behaves the same on Windows, macOS
and Linux. Other useful commands:

| Command | What it does |
| --- | --- |
| `npm start` | Serve the game at `http://localhost:8765` and open it |
| `npm run build` | Write `dist/index.html`, the portable single-file build |
| `npm test` | Static checks plus the headless browser smoke test |
| `npm run test:static` | Data and syntax checks only — about a second, no browser |
| `npm run desktop` | Build, then run the Electron app from source |
| `npm run dist` | Build installers for the current platform into `release/` |

`npm start` and `npm run build` need no dependencies at all. The desktop app and the smoke test
need `npm install` first (Electron and Playwright).

You can also just open `index.html` directly from disk. Chrome, Edge and Firefox allow saving
from `file://`; Safari does not, so use `npm start` or the desktop app there.

## Controls

| Action | Input |
| --- | --- |
| Pan | Left-drag on the land (grab and pull), Shift+drag or middle-drag anywhere, WASD / arrow keys (Shift doubles speed), or push the pointer against the screen edge |
| Rotate / tilt | Right-drag, middle-drag, Ctrl+drag, Q / E |
| Zoom | Mouse wheel, towards the cursor |
| Pick up | Left-click a villager, tree, rock or resource heap (inside your influence) |
| Drop / throw | Release. Flick the mouse while releasing to throw |
| Reward creature | Hold the button on it and move (stroke) |
| Punish creature | Quick tap on it |
| Cast a miracle | `1`-`9` or the Miracles tab, then click. Hold Shift to keep casting |
| Build | `B`, pick a building, click the ground. `R` rotates, Shift keeps placing |
| Cancel | Right-click or Esc |
| Centre on temple / creature | Space / F |
| Tabs | `B`uild, `M`iracles, `C`reature, army `T`, trib`U`te, stats `I`, Esc menu |
| Speed / pause | `+` / `-`, `P` |
| Hurry a villager | Alt+click them (they work faster for a while, but it scares them) |
| Sacrifice | Alt+drop a villager on your own altar |
| Gesture casting | Alt+drag: circle = Water, V = Heal, zigzag = Fireball, vertical = Lightning, horizontal = Shield |
| Walls and roads | Pick them in Build, then drag a line on the ground |
| Minimap | Click to jump the camera |
| Creature orders | `K` then click an enemy to attack; `G` then click a spot to guard (also in the Creature tab) |
| Photo mode | `Y` hides the interface |
| Help overlay | `H` |

Touch works too: one finger pans or grabs, two fingers pinch to zoom and twist to rotate.

## How it works

**Building** is on a hex grid: pick a building and the ghost snaps to the nearest tile, one building per tile, with the grid shown around your cursor while you place. Walls, gates and roads are free-form lines, and roads can run under buildings. The menu tucks away while you place so you can see the ground.

The build menu is grouped into five categories (Homes & Food, Work & Trade, Faith & Learning, Defence, Monuments) so it stays one screenful however many buildings exist. Each chip counts what is open to you out of what the category holds, and a gold dot marks a category with something the current age just unlocked that you have not built yet. Every panel is capped to the window height and scrolls inside itself, so no tab can run off the top of the screen.

**Villagers** eat, sleep in houses at night, and work a job. Drop a villager on a field, house,
altar, armoury, mine, lodge, library, market, harbour, herbalist, construction site, tree or
rock to give them that job, or click a building and use the + / − controls to staff it. The
"available" count next to the buttons is the exact pool the + button draws from (idle adults and
breeders, sleepers included; never children, soldiers or villagers away on a mission).

**Skills.** Every second a villager spends at a job is experience in it: Novice, Apprentice
(a minute), Journeyman, Expert (nine minutes), Master, Legend (twenty-five). Each level is +12%
output, and a Legend inspires everyone at the same building by a further 25%. The building panel
lists the crew with their rank; the + button picks the most experienced available villager, the −
button releases the least. Hover a villager to see their rank and what they are best at.

**Ages.** Scholars at a Library produce Insight, and Insight carries your people from the Stone
Age through the Bronze, Iron and Classical Ages. Each age opens new buildings (granary, market,
harbour and herbalist; then tavern, monastery, armoury, towers and statues; then the wonders)
and pays two Tribute. The top bar shows the age, the Insight meter and the minutes to the next
age. Rival tribes advance with time.

**Adjacency.** Like Civilization, what sits on the six neighbouring hexes matters: fields next to
a granary or the water grow faster, mines on high ground yield more, altars pray harder beside
shrines, statues and wonders, houses are happier beside a market or tavern, markets earn more
beside houses and a harbour. The building panel shows the bonus and what would raise it.

**New trades.** Merchants at a Market sell surplus food, wood and stone for gold. Fishers at a
Harbour (it must touch the water) bring food in every season. Healers from the Herbalist's hut
walk to the sick and the hurt. The Tavern makes the whole town rest better.

**Holy work.** The Monastery trains **missionaries** (60 prayer) who walk to a rival town and
preach: its loyalty drops while they speak and wavering villagers convert on the spot; and
**emissaries** (30 gold) who win favour: at 3 the town stops raiding you, at 6 it sends gifts,
at 9 it joins you in a peaceful union. Favour is lost when you terrorise them.

**Wonders.** The Great Pyramid shakes every town in the land; the Obelisk of Dawn makes every
altar in its town yield 30% more prayer; the Terraces of Plenty make every field grow 40% faster.

**Upgrades.** Temples, houses, fields, altars, lodges, mines, storehouses, armouries and towers
have three levels. Click a building and pay the upgrade; builders raise it over time. Each level
scales the building up to fill more of its hex, adds ornaments, and multiplies what it does:
capacity, storage, crop growth, ore yield, prayer, tower range. A level-3 temple widens your
influence. "Auto-assign jobs" lets
the town manage itself; turn it off for full control. Food comes from fields, wood from trees,
and stone, iron and gold from rocks and veins; everything is stored in your temple. Drop heaps on
the temple to store them.

**Resources and the mid game.** Five resources: food, wood, stone, iron, gold. Loose rocks run
out; a Mine built next to a vein digs that vein forever (three miners each). A Woodcutter's lodge
makes saplings sprout around it so foresters never run out, and forests regrow slowly on their
own. Storehouses raise the storage cap. Stone builds walls, altars and towers; iron trains
soldiers; gold pays for statues and wonders.

**Production.** Every stockpile in the town panel carries a live per-minute net figure (hover it
for produced and consumed separately). Press `I` for the full picture: produced, consumed and net
per resource, prayer and Insight, thirty-minute charts of population and stockpiles, who does
what, and which needs your people lack.

**Tribute and renown.** Renown accrues every second from population, impressiveness and
happiness; every 450 renown is one Tribute point, and the top bar shows the meter and the minutes
to the next point. Milestones (every 15 villagers, first miracle, first steps, wonders, towns and
lands won) add bonus points. Walls, gates and the Shrine (a small wonder) need no unlock.

**Prayer Power** is generated by worshippers at an altar and spent on miracles. Good miracles
(Water, Heal, Food, Siren, Shield) push you towards benevolence; Fireball, Lightning, Hurricane
and Meteor push you towards malevolence. So do throwing and drowning your own villagers.

**Influence** is the ring around your temple. You can only act inside it. It grows with
population and impressiveness (buildings, wonders, recent miracles).

**Impressiveness and conversion.** When your influence reaches a rival town and your town is
more impressive than theirs, their loyalty drops. Below 40% their villagers start migrating to
you; at 0% the whole town converts. Gifts of food dropped on their hall, miracles cast near
them, and your creature's presence all help.

**Conquest.** Unlock the Armoury with Tribute, train platoons (6 villagers + 30 ore), select
one in the Army tab and click an enemy building. Destroying a town's hall captures it.
Watchtowers shoot at attackers. Soldiers are useful before any war: three or more near home make
villagers feel safe (happier, more births), and a platoon ordered onto an enemy field raids it and
carries the food home. Enemy tribes build, breed, train and attack you too, and on
later lands their gods cast fireballs and their creatures rampage.

**Creature.** It acts on its own, choosing between eating, gathering wood, watering and
harvesting fields, fighting, sleeping, exploring and (if you let it) eating villagers. Reward
what you want more of, punish what you don't; each judgement also shifts its alignment. Feed it
by dropping food (or villagers, if you are that kind of god) on it. Leash modes: follow your hand,
roam free, stay put, or send it somewhere. With the "Creature miracles" unlock it learns any
miracle it watches you cast nearby and casts it for free.

**Tribute** is earned from milestones (population, first miracle, wonders, towns won, lands won)
and spent on permanent unlocks: buildings, miracles, creature upgrades and divine perks.

**Villager lives.** Everyone has a name, an age and sometimes a trait (strong, pious, fertile,
hardy, coward, and the rare chosen one). Children play until they grow up, elders slow down and
eventually die. Villagers have needs (food, home, worship, safety, rest); the loudest unmet need
floats over their head as a coloured orb, and town happiness drives births, prayer and how easily
rivals convert them.

**Seasons and weather.** Two days per season. Winter stalls crops and burns wood for warmth.
Rain grows crops everywhere, storms strike with lightning, summer droughts wither fields and
start wildfires.

**The director.** A pacing system watches how strong you are and, every few minutes, sends
something: migrants, a windfall, a prophet, a storm, a plague, raiders, a wildfire. Two
consciences, Seraph and Imp, comment on what happens with opposite advice.

**Fortification and logistics.** Walls block everyone, gates let your own people through, roads
speed movement. Storage is capped by your temple, houses and storehouses. Soldiers come in three
kinds: swordsmen, archers and battering rams. Enemy soldiers that cannot path to you will smash
the nearest wall.

**Settlements.** With the Settlements unlock, build a New Temple far from your first and drop
villagers on it to found a second town.

**Biomes.** Moisture and temperature fields carve the island into grassland, jungle, marsh,
desert, badlands, savanna, volcanic ash, tundra and alpine snow. Coastlines are domain-warped,
with islets, inland lakes and mountain ridges. Each biome has its own ground colours, tree density
and tree type; fields grow at different rates on different soil (jungle fastest, desert and
tundra slowest); deserts hide more gold, badlands more iron.

**Sound.** Everything is synthesized in the browser: layered ambience (wind, birds by day,
crickets and owls at night, surf near the coast, rain in storms) and a generative score whose
mode follows your alignment and which brings in drums only when danger is near. Master, music,
effects and ambience sliders live in the Menu tab.

**Saves.** Quick save (F5/F9), an autosave every two minutes, and five named slots with land, day,
population and time stamps. "Continue" loads the most recent, "Load game…" lists them all.

**Campaign and skirmish.** Four lands of increasing size and difficulty, with two to five rival
tribes spread around each island; alignment, tribute, unlocks and your creature's training
carry over. Skirmish takes a seed, a map size (small to a "huge" 1000-unit island) and one to
seven rival tribes, so every seed is a new island you can share.

## Look and feel

- **The hand** is a rounded palm with jointed fingers and a thumb, a faint sleeve of light, an
  orb while casting, claws when you turn evil, and a golden glow when you turn good. It banks as
  it moves, wiggles when idle, and leaves sparkles when swept quickly.
- **Villagers** are articulated figures with skin and hair variety, a team-coloured headband, a
  job-coloured tunic, and tools. They swing arms and legs when walking, chop and hammer at work,
  raise their arms in worship, carry loads in front of them, look around and wave when idle, and
  wear helmets and shields as soldiers. Children are small, elders grey and stooped. A floating
  icon shows their loudest unmet need.
- **Creatures** have capsule bodies, big blinking eyes, ears, wagging tails and species details
  (mane, horns, spots, shell). They breathe, bob as they walk, watch your hand when it is near,
  tilt their heads with their mood, and speak in a bubble.
- **The world** has a gradient sky with sun, moon, stars and drifting clouds, wave-shader water
  with sun glints, two kinds of trees, swaying grass around the camera, house windows that glow
  at night and chimneys that smoke in winter.
- **The interface** uses rendered 3D icons for buildings and creature portraits, a living island
  behind the main menu, a hover highlight under anything you can grab, a first-steps checklist on
  the first land, and resource icons in the town panel.

## Under the hood

- **Chunked terrain with LOD.** The island is a 2-unit heightfield; the mesh is split into 32-cell
  chunks that are built lazily around the camera at three levels of detail, with skirts hiding
  the seams, and unloaded when far. Alignment and seasons repaint chunks lazily.
- **Spatial hash.** Villagers, trees, rocks and items live in 8-unit grid buckets; every
  "nearest" query is local.
- **A\* pathfinding.** A 3-unit walkability grid with roads as cheap cells, gates as owner-only
  cells, string-pulled paths and a straight-line fast path when nothing is in the way.
- **Simulation LOD.** Villagers far from the camera tick every third frame with a scaled dt.
- **Seeded randomness.** All simulation randomness comes from one seeded generator saved with the
  game, so a seed always produces the same island.
- **Compact saves.** Trees are stored as flat number arrays; a vast map saves in about half a
  megabyte.

## Code map

```
index.html      page shell and HUD markup
style.css       HUD styling
src/util.js     PRNG, value noise, maths helpers, spatial hash, A* nav grid
src/data.js     buildings, miracles, unlocks, species, lands (tuning lives here)
src/terrain.js  island heightfield, mesh, water, ray picking
src/gfx.js      renderer, lights, mesh kits, instanced crowds, particles
src/world.js    entity store, towns, save/load
src/camera.js   god camera and raw input
src/audio.js    procedural sound effects and alignment-aware drone
src/people.js   villager AI
src/buildings.js construction, fire, towers, damage
src/towns.js    economy, births, loyalty/conversion, enemy AI
src/miracles.js miracle effects
src/creature.js creature AI, learning, combat
src/army.js     platoons, unit types and combat
src/director.js seasons, weather, the pacing director and the advisors
src/hand.js     the divine hand and targeting modes
src/ui.js       HUD, tabs, overlays
src/game.js     bootstrap, land generation, main loop, campaign flow
build.js        bundles everything into dist/index.html
install.sh      one-line installer for macOS and Linux
install.ps1     one-line installer for Windows
scripts/release/bump.mjs  bumps the version and dates the changelog for a release

desktop/main.js Electron shell for the packaged desktop app
tools/serve.js  dependency-free static server behind `npm start`
tools/make-icon.js  draws build-assets/icon.png with zlib, no image libraries
test/static.mjs syntax and game-data consistency checks (no browser)
test/smoke.mjs  headless playthrough of the portable build
test/desktop.mjs launches the packaged app and plays a land in it
```

## Continuous integration and releases

Every pull request runs three jobs:

- **Static checks** — every file parses, the game's data tables agree with each
  other (no building missing from the menu, no category claiming a building
  twice, no unlock that nothing defines), and the portable bundle really is
  self-contained.
- **Smoke test** — loads the portable build in headless Chromium, plays five
  minutes of simulated game time, opens every panel, and round-trips a save.
- **Packaging** — builds the Electron app and launches it, checking it loads
  the game, keeps Node out of the renderer, and can write a save.

Releases need no approval and no release pull request. Every pull request carries
one label saying what merging it ships — `release:patch`, `release:minor`,
`release:major` or `release:none` — and merging a versioned one bumps
`package.json`, dates the `[Unreleased]` entries in `CHANGELOG.md`, commits and
tags that on `main`, builds all the binaries, and publishes the GitHub release
with those changelog entries as its notes.

A release can also be cut by running the Release workflow by hand, or by pushing
a `v*` tag. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Game code: Apache-2.0 (see `LICENSE`). Three.js is MIT (see `vendor/THREE-LICENSE`).
This is an original fan project; it contains no assets, names or text from any commercial game.
