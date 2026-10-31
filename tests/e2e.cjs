// Clicks through a demo workout in a real browser and saves screenshots.
// Run: npm run e2e   (needs Playwright + Chromium; screenshots go to $SHOTS or ./shots)

const { execSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const globalRoot = execSync("npm root -g").toString().trim();
const { chromium, devices } = require(path.join(globalRoot, "playwright"));

const PORT = 4173 + Math.floor(Math.random() * 500);
const SHOTS = process.env.SHOTS || path.join(__dirname, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });

function serve() {
  const root = path.join(__dirname, "..", "web");
  const bin = path.join(globalRoot, "http-server", "bin", "http-server");
  const p = spawn(process.execPath, [bin, root, "-p", String(PORT), "-c-1", "-s"], { stdio: "ignore" });
  return new Promise((resolve) => setTimeout(() => resolve(p), 800));
}

function check(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function run(name, device) {
  console.log(`\n${name}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...device, serviceWorkers: "block" });
  const page = await ctx.newPage();
  // The demo never calls the Sheet; keep these runs offline from Google whatever config.js says.
  await page.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'export const API_URL = ""; export const APP_NAME = "Coach Sahaj";' }),
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_|net::/.test(m.text()) && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${name}-${n}.png`), fullPage: false });

  await page.goto(`http://localhost:${PORT}/?u=demo`);
  await page.waitForSelector(".exlist");
  check((await page.textContent(".eyebrow")).includes("Session 2 of 4"), "demo opens on session 2 (session 1 already done)");
  check((await page.textContent(".title")).includes("Week 1 · Day B"), "shows Week 1 · Day B");
  check((await page.locator(".mcard").count()) >= 3, "target muscle cards render");
  check((await page.locator(".sslabel").count()) === 1 && (await page.locator(".exrow.ss").count()) === 2, "the superset is bracketed on the home screen");
  await shot("1-home");

  await page.click("[data-a=start]");
  await page.waitForSelector(".srow");
  check((await page.textContent(".extitle")).trim() === "DB Hip Thrust", "workout starts on the first exercise");
  check(!(await page.textContent(".shead")).includes("hand"), "one-dumbbell exercises just say kg");
  check((await page.locator(".srow").count()) === 4, "1 warm-up + 3 working sets");
  await shot("2-workout");

  // Pre-filled numbers are real values in the boxes, marked data-pre.
  const box = (si, f) => page.locator(`input[data-si="${si}"][data-f="${f}"]`);
  const pre = async (si, f) => (await box(si, f).getAttribute("data-pre")) !== null;
  check((await box(1, "kg").inputValue()) === "10" && (await pre(1, "kg")), "set 1 is pre-filled with the coach's load");
  check((await box(3, "kg").inputValue()) === "10" && (await box(3, "reps").inputValue()) === "10", "and the sets below it copy set 1");
  check((await box(0, "kg").inputValue()) === "5" && (await box(0, "reps").inputValue()) === "10", "the warm-up keeps its own ramp");

  // Tick the warm-up (uses the pre-filled numbers), then type a working set.
  await page.click('.chk[data-si="0"]');
  check(await page.locator('.srow.done').count() === 1, "warm-up ticked from suggestions");
  const kg = box(1, "kg");
  await kg.fill("12");
  check((await box(2, "kg").inputValue()) === "12" && (await box(3, "kg").inputValue()) === "12", "typing on set 1 moves the sets below it straight away");
  check(!(await pre(1, "kg")) && (await pre(2, "kg")), "typed and pre-filled boxes are told apart");
  await box(1, "reps").fill("11");
  check((await box(2, "reps").inputValue()) === "11" && (await box(3, "reps").inputValue()) === "11", "reps follow too");
  check((await box(0, "kg").inputValue()) === "5", "set 1 doesn't move the warm-up");
  await shot("2a-prefilled");
  await page.click('.chk[data-si="1"]');
  await page.waitForSelector(".rirgrid");
  await page.waitForTimeout(400);
  await shot("3-rir");
  await page.click('.rirbtn[data-v="2"]');
  check((await page.textContent('.cell.rir[data-si="1"]')).trim() === "2", "RIR saved on the set");
  check((await page.textContent("[data-rest]")).trim() !== "0:00", "rest timer started");
  check((await page.textContent(".setlabel")).includes("Set 2 of 3"), "label moves to set 2 of 3");
  check((await page.textContent(".nudge")).includes("Right on target"), "effort nudge confirms an on-target set");
  await page.click('.cell.rir[data-si="1"]');
  await page.click('.rirbtn[data-v="4"]');
  check((await page.textContent(".nudge")).includes("Next set, add 1–2 reps"), "an easy set nudges for more reps (coach set the load)");
  check((await page.textContent("#toast")).includes("Next set, add 1–2 reps"), "the nudge also pops up, in case the line is scrolled away");
  await page.click('.cell.rir[data-si="1"]');
  await page.click('.rirbtn[data-v="2"]');
  check((await box(2, "kg").inputValue()) === "12" && (await box(2, "reps").inputValue()) === "11", "after the tick, set 2 shows what set 1 was logged at");
  await shot("4-logged");

  // Tapping a pre-filled box selects it, so typing replaces the number.
  await box(3, "kg").tap();
  const sel = await box(3, "kg").evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
  check(sel[0] === 0 && sel[1] === sel[2] && sel[2] > 0, "tapping a pre-filled box selects its number");
  await page.keyboard.type("14");
  check((await box(3, "kg").inputValue()) === "14", "and typing replaces it");
  // A phone that drops the selection still replaces the number on the first key.
  await box(3, "reps").evaluate((el) => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await page.keyboard.type("9");
  check((await box(3, "reps").inputValue()) === "9", "the first key replaces a pre-fill even without the selection");
  // A pre-filled set ticked then unticked goes back to following the set above.
  await page.click('.chk[data-si="2"]');
  await page.waitForSelector(".rirgrid");
  await page.click('.panel [data-a=setRir][data-v=""]');
  check((await page.locator(".srow.done").count()) === 3, "a pre-filled set ticks without typing");
  await page.click('.chk[data-si="2"]');
  check((await page.locator(".srow.done").count()) === 2 && (await pre(2, "kg")), "unticked, it's pre-filled again");
  // Editing set 1 moves set 2 but never a box the client typed in.
  await kg.fill("13");
  check((await box(2, "kg").inputValue()) === "13", "set 2 follows an edit to set 1");
  check((await box(3, "kg").inputValue()) === "14", "a typed box is never overwritten");
  await kg.fill("12");
  await page.locator(".extitle").click(); // leave the box

  await page.click("[data-a=toggleLast]");
  check((await page.textContent(".tgl")).includes("Last"), "target/last toggle flips");
  await page.click("[data-a=toggleLast]");

  // Persisted across reload mid-workout.
  await page.reload();
  await page.waitForSelector(".srow");
  check(await page.locator(".srow.done").count() === 2, "workout survives a reload");

  await page.click("[data-a=info]");
  await page.waitForSelector(".sh-title");
  await page.waitForTimeout(400);
  await shot("5-info");
  await page.click(".backdrop", { position: { x: 10, y: 10 } });

  // Superset: the pulldown (rest 0) leads into the shoulder press, and the timer still runs after it.
  await page.click('.tile[data-i="1"]');
  check((await page.textContent(".ssbox")).includes("Superset · 1 of 2"), "a superset says so on the exercise");
  check((await page.textContent(".ssbox")).includes("go straight to Seated DB Shoulder Press"), "and what to do next");
  check((await page.locator(".ssband .tile").count()) === 2, "the pair sits together in the exercise strip");
  await page.click("[data-a=rest]");
  if (await page.locator("[data-a=restSkip]").count()) await page.click("[data-a=restSkip]");
  else await page.click(".backdrop", { position: { x: 10, y: 10 } });
  check((await page.textContent("[data-rest]")).trim() === "0:00", "no rest running before the superset set");
  await page.click('.chk[data-si="0"]');
  await page.waitForSelector(".rirgrid");
  await page.click('.rirbtn[data-v="2"]');
  check((await page.textContent("[data-rest]")).trim() !== "0:00", "the timer runs after a superset's first exercise");
  check((await page.textContent(".cta .btn")).includes("Superset: Seated DB Shoulder Press"), "after a set, the main button points at the partner");
  await shot("2b-superset");
  await page.click(".ssgo");
  check((await page.textContent(".extitle")).trim() === "Seated DB Shoulder Press", "the superset link jumps to the partner");
  check((await page.textContent(".ssbox")).includes("Back to Lat Pulldown"), "and the partner links back");
  check((await page.textContent(".shead")).includes("kg/hand"), "two-dumbbell exercises ask for kg per hand");

  // Go to the bodyweight exercise (no kg column).
  await page.click('.tile[data-i="3"]');
  check((await page.textContent(".extitle")).trim() === "Glute Bridge", "jump via the exercise strip");
  check(await page.locator('input[data-f="kg"]').count() === 0, "bodyweight exercise hides kg");
  // Over 50 reps asks first: 151 is usually 15.
  await box(0, "reps").fill("151");
  check((await box(1, "reps").inputValue()) === "151", "bodyweight sets pass reps down");
  await page.click('.chk[data-si="0"]');
  await page.waitForSelector("[data-a=repsFix]");
  check((await page.textContent(".sh-title")).includes("151 reps?"), "over 50 reps asks to check the number");
  check((await page.locator(".srow.done").count()) === 0, "and nothing is ticked yet");
  await page.waitForTimeout(300);
  await shot("6a-check-reps");
  await page.click("[data-a=repsFix]");
  check(await box(0, "reps").evaluate((el) => document.activeElement === el && el.selectionEnd - el.selectionStart === 3), "fixing it puts you back in the box, number selected");
  await page.keyboard.type("15");
  check((await box(1, "reps").inputValue()) === "15", "the set below follows the fix");
  await page.click("[data-a=tickAll]");
  check(await page.locator(".srow.done").count() === 2, "tick-all completes every set");
  await shot("6-bodyweight");

  await page.click("[data-a=finish]");
  await page.waitForSelector(".stats");
  check((await page.textContent("[data-a=logAll]")).includes("numbers shown"), "finish offers to log the unticked sets");
  await page.fill("#fnote", "Felt strong today");
  await shot("7-finish");
  await page.click("[data-a=finishSave]");
  await page.waitForSelector(".donecheck");
  await page.waitForTimeout(300);
  await shot("8-done");

  await page.click("[data-a=home]");
  await page.waitForSelector(".exlist");
  check((await page.textContent(".eyebrow")).includes("Session 3 of 4"), "home moves on to session 3");
  check((await page.textContent(".exlist")).includes("each side"), "one-side exercises say each side");
  await page.click("[data-a=history]");
  await page.waitForSelector(".hcard");
  check(await page.locator(".hcard").count() === 2, "history lists both finished sessions");
  await page.click(".hhead");
  await shot("9-history");

  await page.waitForFunction(() => JSON.parse(localStorage.getItem("wt.queue.demo") || "[]").length === 0, null, { timeout: 5000 });
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("wt.demo.db")));
  const mine = db.log.filter((r) => r.session === 2);
  check(mine.length === 5, `5 sets reached the store (got ${mine.length})`);
  check(mine.some((r) => r.kg === "12" && r.reps === "11" && r.rir === "2" && r.set_no === 1), "typed set stored with RIR");
  check(db.sessions.some((s) => s.session === 2 && s.note === "Felt strong today"), "session note stored");

  // Second pass over the less common controls.
  await page.click("[data-a=home]");
  await page.click("[data-a=pick]");
  await page.click('.sh-item[data-n="4"]');
  check((await page.textContent(".title")).includes("Week 2 · Day B"), "a different session can be picked");
  await page.click("[data-a=start]");
  await page.waitForSelector(".srow");
  // Swap: coach's picks first, equipment filter, logged with what it replaced, then back.
  await page.click("[data-a=swap]");
  await page.waitForSelector(".swaplist");
  await page.waitForTimeout(400);
  await shot("10-swap");
  check((await page.locator(".swapitem").first().textContent()).includes("Glute Bridge"), "swap lists the coach's picks first");
  await page.click('.eqchip[data-v="cable"]');
  check((await page.locator('.swapitem[data-name="Cable Pull-Through"]').count()) === 0, "'no cable' hides cable exercises");
  await page.click('.swapitem[data-name="Glute Bridge"]');
  check((await page.textContent(".extitle")).trim() === "Glute Bridge", "swap replaces the exercise for today");
  check((await page.textContent(".swapnote")).includes("Instead of DB Hip Thrust"), "it shows what it replaced");
  check((await page.locator('input[data-f="kg"]').count()) === 0, "a bodyweight swap hides the kg boxes");
  await shot("11-swapped");
  await page.click('.chk[data-si="1"]');
  await page.click('.rirbtn[data-v="2"]');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("wt.demo.db")).log.some((r) => r.exercise === "Glute Bridge" && r.swapped_from === "DB Hip Thrust"), null, { timeout: 5000 });
  check(true, "the logged set records the swap");
  await page.click("[data-a=swap]");
  check((await page.textContent(".panel")).includes("Untick them first"), "no swapping once a set is ticked");
  await page.click(".panel [data-a=closeSheet]");
  await page.click('.chk[data-si="1"]');
  await page.click("[data-a=swap]");
  await page.click(".swapitem.back");
  check((await page.textContent(".extitle")).trim() === "DB Hip Thrust", "swap back to the planned exercise");
  check((await page.locator(".swapnote").count()) === 0 && (await page.locator('input[data-f="kg"]').count()) > 0, "back to normal after swapping back");
  // Swap to anything: search the whole library, or type a name that isn't in it.
  await page.click("[data-a=swap]");
  await page.fill(".search", "push");
  check((await page.locator('.swapbody .swapitem[data-name="Push-Up"]').count()) === 1, "swap search covers the whole library");
  await page.fill(".search", "Leg  Extension ");
  check((await page.textContent(".swapitem.custom")).includes("Use “Leg Extension”"), "a name not in the library can be used");
  await page.click(".swapitem.custom");
  check((await page.textContent(".extitle")).trim() === "Leg Extension", "the swap takes the typed name");
  check((await page.textContent(".swapnote")).includes("Instead of DB Hip Thrust"), "and still shows what it replaced");
  await page.click("[data-a=swap]");
  await page.click(".swapitem.back");
  check((await page.textContent(".extitle")).trim() === "DB Hip Thrust", "and swaps back");

  await page.click("[data-a=note]");
  await page.fill('textarea[data-f="exnote"]', "Left hip a bit tight");
  await page.click(".panel [data-a=closeSheet]");
  check(await page.locator(".pill.has").count() === 1, "exercise note marks the Note pill");
  const before = await page.locator(".srow").count();
  await page.click('.badge[data-si="1"]');
  await page.click("[data-a=toggleType]");
  check(await page.locator(".badge.w").count() === 2, "a working set can become a warm-up");
  await page.click('.badge[data-si="0"]');
  await page.click("[data-a=deleteSet]");
  check(await page.locator(".srow").count() === before - 1, "a set can be deleted");
  await page.click("[data-a=rest]");
  if (await page.locator("[data-a=restSkip]").count()) {
    await page.click("[data-a=restSkip]"); // still resting from an earlier tick
    await page.click("[data-a=rest]");
  }
  await page.click('[data-a=restStart][data-v="60"]');
  await page.click('[data-a=restAdj][data-v="15"]');
  check(["1:15", "1:14"].includes((await page.textContent(".bigclock")).trim()), "rest +15s works");
  await page.click("[data-a=restSkip]");
  check((await page.textContent("[data-rest]")).trim() === "0:00", "rest can be skipped");
  await page.click('.chk[data-si="0"]');
  // A big number typed but not ticked is still checked by log-all; "it's right" logs it.
  const lastSi = (await page.locator(".srow").count()) - 1;
  await box(lastSi, "reps").fill("60");
  // Log everything else from the suggestions, then throw it all away.
  await page.click("[data-a=menu]");
  await page.click(".panel [data-a=finish]");
  await page.waitForSelector("[data-a=logAll]");
  await page.click("[data-a=logAll]");
  await page.waitForSelector("[data-a=repsOk]");
  check((await page.textContent(".sh-title")).includes("60 reps?"), "log-all checks big numbers too");
  await page.click("[data-a=repsOk]");
  check((await page.textContent("#toast")).startsWith("Logged"), "log-all ticks the rest");
  check(await page.locator("[data-a=logAll]").count() === 0, "nothing left unticked after log-all");
  check(Number(await page.textContent(".stats div:nth-child(2) b")) > 1, "the summary counts the logged sets");
  await page.click("[data-a=backToWorkout]");
  await page.waitForSelector(".srow");

  // Add an exercise that isn't in the plan.
  const tiles = await page.locator(".tile[data-a=go]").count();
  await page.click("[data-a=addEx]");
  await page.fill(".search", "leg");
  check((await page.locator(".addlist .swapitem:not(.custom)").count()) === 1, "searching the library narrows the list");
  await page.click(".addlist .swapitem:not(.custom)");
  check((await page.textContent(".extitle")).trim() === "Leg Press", "the added exercise opens");
  check((await page.locator(".tile[data-a=go]").count()) === tiles + 1, "and joins the exercise strip");
  await shot("12-added");

  // Another phone (the coach's) opening the same link sees the workout, read-only.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("wt.queue.demo") || "[]").length === 0, null, { timeout: 5000 });
  const sharedDb = await page.evaluate(() => localStorage.getItem("wt.demo.db"));
  const other = await browser.newContext({ ...device, serviceWorkers: "block" });
  await other.addInitScript((db) => {
    if (!localStorage.getItem("wt.demo.db")) localStorage.setItem("wt.demo.db", db);
  }, sharedDb);
  const coach = await other.newPage();
  coach.on("pageerror", (e) => errors.push(String(e)));
  await coach.route("**/config.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: 'export const API_URL = ""; export const APP_NAME = "Coach Sahaj";' }),
  );
  await coach.goto(`http://localhost:${PORT}/?u=demo`);
  await coach.waitForSelector(".livecard");
  check((await coach.textContent(".livecard")).includes("Workout in progress"), "another phone sees the workout in progress");
  await coach.click(".livecard");
  await coach.waitForSelector(".sumlist.live");
  check((await coach.locator(".sumlist.live li").count()) === 4, "the live view lists the session's exercises");
  check((await coach.locator(".sumlist.live li.done").count()) >= 1, "with what's been done");
  await coach.waitForTimeout(300);
  await coach.screenshot({ path: path.join(SHOTS, `${name}-13-watch.png`) });
  await other.close();
  await page.click("[data-a=menu]");
  await page.click("[data-a=discard]");
  await page.click("[data-a=discardYes]");
  await page.waitForSelector(".exlist");
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("wt.queue.demo") || "[]").length === 0, null, { timeout: 5000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("wt.demo.db")).log.filter((r) => r.session === 4).length);
  check(after === 0, "discarding removes the sets it had saved");

  // Landing page without a link, and a real-looking link before the Sheet is connected.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("[data-a=demo]");
  check(true, "landing page shows without a link");
  await page.goto(`http://localhost:${PORT}/?u=abc123def456`);
  await page.waitForSelector("[data-a=retry]");
  check((await page.textContent(".title")).includes("Not connected"), "unconnected app explains itself");

  check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
}

(async () => {
  const server = await serve();
  try {
    await run("iphone", devices["iPhone 13"]);
    await run("ipad", devices["iPad (gen 7)"]);
    await run("small-android", { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    console.log(`\nScreenshots in ${SHOTS}`);
  } finally {
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
