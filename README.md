# Arrow Escape: All-In-One

(Formerly "Slipstream". Saves, backups and the service-worker cache keep the old internal name so existing progress carries over.)

An arrow-escape puzzle game. Open `index.html` in any modern browser to play.
No build step, no server, no accounts. Works offline (fonts fall back to system fonts).

## Files
- `index.html` – markup for every screen
- `styles.css` – all styling (dark and light themes, high contrast, reduced motion)
- `engine.js` – pure puzzle logic: seeded RNG, difficulty table, generator, validator, collision
- `sounds.js` – recorded sound effects embedded as text (source files in `sounds/`)
- `game.js` – everything the player touches: renderer, input, modes, stats, saving, audio, settings, dev tools

## How the puzzles work
An arrow slides forward like a snake, so only its head's exit corridor (head to board edge) can block it.
Boards are built in reverse: each new arrow must have a clear corridor when placed, so the reverse of the
placement order is always a valid solution. A gap-fill pass then covers every leftover cell (new short
arrows, growing neighbours, splitting a neighbour's tail end) while keeping each arrow's rank in the removal
order consistent, so boards are fully covered and still provably solvable. A final pass merges leftover short arrows
end-to-end with a neighbour where the order allows, so boards mix short, medium and long winding arrows. Removing arrows can never block another, so the validator is
exact: keep removing every free arrow; the board is solvable if and only if it empties.

## Tuning
All difficulty numbers live in `DIFFICULTIES` in `engine.js`. Add an `expert` entry with `rank: 4`
and it appears in Zen automatically.

## Zen tightening (Hard and up)
- Zen Hard and up (and campaign 71+) use shorter arrows: medium arrows about half as long, few long
  ones, and the fill step's length cap follows suit (longest arrow ~13–25 instead of ~30–65).
  Insane and Impossible use the shortest arrows (about 135 and 185 arrows per board).
- After a Zen board on Hard and up is built, free arrows are made blocked where possible: the arrow
  is flipped end-for-end, or its head square is handed to a neighbour's tail. Each change is kept
  only if the exact solver still proves the board solvable. Every head points the way its last step
  goes (no turned heads). Campaign levels 71+ (Hard tier and up) get the same tightening;
  campaign levels 1–70 and Daily boards are not changed.
- Free at the start, roughly: Hard 18%, Expert 14%, Nightmare 12%, Insane 10%, Impossible 11%.

## Inconceivable
- An eighth difficulty above Impossible, for Zen 2D and 3D. 2D boards are always a full 35–38 × 47–51
  rectangle of short arrows: 250–290 arrows. 3D: up to 10×10×10 shapes, about 130 arrows.
- Campaign levels 151–160 are Inconceivable (the final chapter), followed by 3D bonus 16, a frozen
  Inconceivable block shape (~124 arrows). Clearing an Inconceivable board in Zen earns the "Inconceivable!" achievement.
- Saves that had already cleared level 150 get level 151 opened on load (`catchUpCampaign`).

## Pictures
- 32 hidden-picture boards (`pictures.js`): each is a simple silhouette (heart, fish, cat, anchor,
  guitar, lighthouse…) built from basic pieces and filled with arrows by the normal generator.
- Clear one to reveal its name and add it to the gallery. Three are always open; each find unlocks
  the next. Later pictures are bigger (about 30 → 110 arrows). No hearts; stars as usual.

## Time Attack

Three minutes to clear as many 2D boards as you can, on Easy, Medium, Hard or Expert. Boards come from the Zen generator with fresh seeds, and the next one is built in the background so there's no wait. A blocked tap costs 5 seconds; there are no hints or hearts. Your best run per difficulty (boards, then arrows) is kept in `timed.best`. Pays coins per board (3 / 5 / 8 / 12) plus 1 per 10 arrows.

## Undo and close calls

In Campaign, 3D bonus and Daily, Undo takes back your last blocked tap for 10 coins: the heart comes back and the arrow stops waiting. It's also offered on the Out of hearts screen. It doesn't erase the tap from the board's record, so stars and Perfect don't change. Your coins show next to the difficulty while you play. A clear on your last heart counts as a close call (`stats.closeCalls`).

## Holidays

Seasonal Shop items (`season` on a `STYLE` entry, months in `SEASONS`) appear in their own section at the top of the Shop only during their month, by the player's local date. Anything bought stays owned all year and then shows in the normal Shop sections. Halloween (October): Halloween arrow colors, Pumpkin / Witch / Haunted boards, and Pumpkins / Bats / Ghosts / Candy trails (little pictures from `ICONS`, drawn on both flat and 3D boards).

## Developer tools
Settings → tap the version line five times → turn on Developer tools (or open with `#debug`).
A Dev button appears in game: seed, board data, validate, show solution order, auto-solve,
and a sandbox "Generate new seed" that never touches your stats.

## Difficulties and hearts
Eight tiers: Easy, Medium, Hard, Expert, Nightmare, Insane, Impossible, Inconceivable. The campaign runs 160 levels
(1-30 Easy, 31-70 Medium, 71-100 Hard, 101-115 Expert, 116-130 Nightmare, 131-140 Insane,
141-150 Impossible, 151-160 Inconceivable); Zen offers all eight.
Campaign and Daily give 3 hearts per attempt; each blocked tap costs one and the third ends the run.
Zen has no heart limit.

## Install as an app (iPhone, Android, desktop)
The folder is a Progressive Web App: manifest.webmanifest, sw.js (offline), pwa.js, icons/.
It installs only when served from an https:// address, so host the whole folder, for example on Netlify:
1. Sign up free at netlify.com, then add a new site by dragging this folder onto the deploy area.
2. Open the https:// link it gives you.
   - iPhone (Safari): Share button, then "Add to Home Screen".
   - Android (Chrome): menu, then "Install app" / "Add to Home screen".
To update: upload the new folder to the same Netlify site. The app fetches new files whenever it's online
and uses its saved copy when offline.
Progress is stored on each device, inside the installed app.

## Sound credits
- Arrow sound: "Whoosh Transitions SFX 01" by StudioKolomna, Pixabay Content License (free to use, credit optional;
  built into the game, never offered as a standalone download).
- Level complete: "New Level Unlocked" by Universfield, Pixabay Content License (free to use, credit optional).
- The `sounds/` folder holds the trimmed source mp3s; the game uses the copies embedded in `sounds.js`,
  so `sounds/` doesn't need to be uploaded.

## Zen 3D cube
- Zen has a 2D / 3D switch. 3D boards are an N×N×N cube (Easy 3 … Impossible 9).
- Arrows lie on the cube's faces and can bend around its edges. A released arrow slides along its
  path and flies straight off the edge of the face its head is on; only arrows in that straight run
  can block it, so the same exact solver (remove every free arrow, repeat) proves each cube solvable.
- `cube.js` is the cube generator/solver (works in Node for testing); the 3D renderer is `CubeView`
  in `game.js` (canvas, hand-written rotation + perspective, no 3D library).
- 3D boards are plain cubes or random block shapes (L, T, towers, stacked blocks); Perlin outlines are 2D only.

## Campaign 3D bonus levels
- After every 10th campaign level (10, 20 … 150) there is an optional 3D bonus level: 15 in all.
  Bonus k unlocks when level 10k is cleared. They use hearts and stars like campaign levels but
  never block the main path. Progress is saved in `campaign.bonus`.
- The 15 boards are stored as finished data in `cube.js` (`BONUS`), not re-generated, so they stay
  the same even if the Zen 3D generator changes. `bonusCube(k)` checks the shape still matches.
