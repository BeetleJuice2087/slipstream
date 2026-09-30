# Slipstream

An arrow-escape puzzle game. Open `index.html` in any modern browser to play.
No build step, no server, no accounts. Works offline (fonts fall back to system fonts).

## Files
- `index.html` – markup for every screen
- `styles.css` – all styling (dark and light themes, high contrast, reduced motion)
- `engine.js` – pure puzzle logic: seeded RNG, difficulty table, generator, validator, collision
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

## Developer tools
Settings → tap the version line five times → turn on Developer tools (or open with `#debug`).
A Dev button appears in game: seed, board data, validate, show solution order, auto-solve,
and a sandbox "Generate new seed" that never touches your stats.

## Difficulties and hearts
Seven tiers: Easy, Medium, Hard, Expert, Nightmare, Insane, Impossible. The campaign runs 150 levels
(1-30 Easy, 31-70 Medium, 71-100 Hard, 101-115 Expert, 116-130 Nightmare, 131-140 Insane,
141-150 Impossible); Zen offers all seven.
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
