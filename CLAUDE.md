# Coach Sahaj: notes for Claude

A workout tracker for a personal trainer (the coach) and a handful of clients. Clients open a private link on their phone or iPad, do the next session of the coach's plan, and log kg, reps and RIR per set. The coach writes plans in a Google Sheet, and everything clients log lands back in it.

Start with `README.md` (how it works for the coach) and `PLAN.md` (what's built, what's next).

## This repo is public

Never commit client names, injuries, health notes, link tokens, or anything copied out of the Sheet. That includes test fixtures, screenshots, commit messages and PR descriptions. Client details live only in the Sheet.

## Layout

```
web/                  the app: static ES modules, no build step
  app.js              views, bottom sheets, actions (S = state, A = actions, SHEETS = bottom sheets)
  logic.js            pure functions: targets, suggestions, supersets, time estimate, live view, swaps
  api.js              Sheet calls, the offline write queue, the cached bootstrap, the demo store
  demo-data.js        the ?u=demo plan and library
  sw.js               service worker: serves the cache, refreshes it in the background
apps-script/Code.gs   the Sheet backend (doGet bootstrap, doPost writes, setup menu)
tests/                logic and Apps Script unit tests, Playwright end-to-end
```

## The Sheet

- Spreadsheet ID: `1eWKwvsCTP3qWoUeNj9bbnYJIepQTuN1FN7ZwVk2sj9E`. Sharing is restricted to the coach's account; keep it that way.
- Read and write it with the Google Sheets connector. Read before writing, write at the next free row, then read back to check.
- **Tabs:**
  - `Clients` (`client_id`, `name`, `token`, `show_rir`, `active`, `notes`, `flags`, `link`). `link` is a single ARRAYFORMULA in H2 that builds every client's link from Settings → `app_url`. Don't write over it.
  - `Exercises`: the library
  - `Program`: one row per exercise per session
  - `Log`: one row per ticked set
  - `Sessions`: one row per finished workout
  - `Settings`
- Program columns are listed in `README.md`. The rules that matter when writing plans:
  - Sessions run in order by number, not weekday. A client's next session is the lowest one not finished.
  - `rest_sec` 0 makes a superset with the next exercise.
  - `target_rir` takes `2`, `1-2`, or one value per set (`1, 2, 3, 3`).
  - Leave `target_kg` blank to suggest last time's weight.
  - `reps` and `target_rir` are text columns so Sheets doesn't turn `8-10` into a date. Check that they read back unchanged.
  - Exercise names must match the Exercises tab exactly.
  - Notes are short, second person, and shown to the client.
- **Exercises:** `per_hand` (two dumbbells, so the app asks for kg per hand) and `per_side` (one side at a time, so reps are per side and time counts double) are tick boxes. `avoid_for` is matched against a client's `flags` and never leaves the Sheet.
- **Deleting Program rows:** delete bottom-up in one batch so row numbers don't shift mid-delete.
- **Log and Sessions:** change these only to correct something the coach tells you about. Keep `entry_id` as `<instance_id>.<slot>.<set id>`, where slot is the exercise's place in the workout.

## Deploying

- **The app:** GitHub Pages publishes from `main` (`.github/workflows/pages.yml`). Clients get a new version the second time they open the app, because the service worker refreshes its cache in the background.
- **The Apps Script:** changes to `Code.gs` only take effect after the coach pastes it into Extensions → Apps Script and deploys a **new version** (Deploy → Manage deployments → Edit → New version). Say so whenever a change needs it, and keep the app working against the old script until then.
- **What needs a redeploy:** every Exercises column except `avoid_for` reaches the app automatically, so new library columns don't. New Program, Log or Sessions fields do, because those lists are fixed in `Code.gs`.
- Claude can't reach `script.google.com` or `github.io` from the cloud container, so the live deployment can't be checked from here.

## Working on it

- `npm test`: logic tests, plus `Code.gs` run against an in-memory fake of Sheets.
- `npm run e2e`: Playwright clicks through the demo on iPhone, iPad and a small Android screen, and saves screenshots to `./shots` (gitignored). Chromium is preinstalled; the script uses the global Playwright.
- `npm run serve`, then open `http://localhost:4173/?u=demo`.
- Check UI changes in the screenshots, not just the test output.
- **Workflow:** work on a branch, open a PR, and merge it yourself once `npm test` and `npm run e2e` pass. The coach asked for this.
- **PRs:** short descriptions with what changed and how it was tested. Keep each PR to one change.
- **App copy:** short, plain, second person. Metric units. Clients include a beginner and an older parent on an iPad, so keep words simple and tap targets big.
