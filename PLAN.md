# Plan

**For:** Mom (on an iPad) and 1–2 PT clients.
**What they do:** open an icon on their phone or iPad, see the next session from the coach's plan, watch the YouTube demo for each exercise, and log kg, reps and RIR per set.

## Decisions

| Decision | Why |
|---|---|
| A web app saved to the home screen, not an App Store app | No store, no install friction. "Add to Home Screen" gives a full-screen app with its own icon. |
| A Google Sheet as the database, Apps Script as the API | S$0 a month, nothing to maintain, no free-tier pausing, and the coach already lives in spreadsheets. Plans are written there and logs land there. |
| GitHub Pages for hosting | Free, no new account, publishes on every push to `main` after the tests pass. Cloudflare Pages is the fallback if commercial-use terms ever matter. |
| A private link per person, no passwords | Three users. The link is remembered on the device. The data is sets and reps, never health forms. |
| Offline first | Every set is saved on the device the moment it's ticked and synced when there's signal. A workout survives closing the app. |
| Sessions in order, not by weekday | A missed day doesn't skip anything. The plan waits for the client. |
| RIR asked after each working set, in words | "How many more could you have done?" with 0 to 5+ buttons. Can be switched off per client (`show_rir`). |
| Boxes come pre-filled | Set 1 starts at the coach's target load, otherwise last time's; each later set copies the set before it. The numbers look like real values, so ticking is usually all it takes. Tapping a box selects it, so typing replaces it. |
| No client data in this repo | The repo is public. |

## Phases

- [x] **0 · Sheet backend:** tabs, a test client, data validation, the Coach menu with per-client links, optional finish emails.
- [x] **1 · The app:**
  - home: next session, target-muscle cards, exercise list, estimated time
  - workout: elapsed and rest timers, exercise strip, Video / Info / Warm Up / Note, set table with a Target ⇄ Last toggle and an RIR picker
  - finish summary, history, offline sync, demo mode
- [x] **Sheet set up and script deployed.**
- [x] **Go live:** GitHub Pages on, all clients' plans loaded.
- [x] **Exercise library and swaps:** pattern, equipment, coach's swaps and injury flags in the Exercises tab; a Swap button in the workout that filters by missing equipment and never offers a flagged movement.
- [x] **From the first sessions:** effort nudges towards the target RIR, warm-up ramps, a target RIR per set, "log the rest" at finish, supersets shown before and during the workout, a live view for the coach, adding and swapping in any exercise, kg per hand, a time estimate that counts one-side exercises and learns each client's pace, sets pre-filled from the set before, and a check on reps over 50.
- [ ] **2 · Polish from real use:**
  - a progress chart per exercise
  - pull-to-refresh
  - better thumbnails for exercises without a video
- [ ] **3 · Coach features:**
  - suggest the next load with the double-progression rule (top of the range on every set → add the smallest increment)
  - the flags guard from the PT memo (warn when a flagged movement's load goes up)
  - a weekly summary

## Open questions

- Mom's plan: coming from her iPad.
- Who is the second client, and do they train between sessions on their own?
- Does Mom find RIR easy, or should she get Easy / Good / Hard for the first month?
