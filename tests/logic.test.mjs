import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../web/logic.js";

test("parseReps reads ranges and keeps odd text", () => {
  assert.deepEqual(L.parseReps("8-10"), { lo: 8, hi: 10, text: "8-10" });
  assert.deepEqual(L.parseReps("8–10"), { lo: 8, hi: 10, text: "8–10" });
  assert.deepEqual(L.parseReps("8 to 10"), { lo: 8, hi: 10, text: "8 to 10" });
  assert.deepEqual(L.parseReps(12), { lo: 12, hi: 12, text: "12" });
  assert.equal(L.parseReps("30s").lo, null);
  assert.equal(L.parseReps("").lo, null);
});

test("youtubeId handles the usual link shapes", () => {
  assert.equal(L.youtubeId("https://www.youtube.com/watch?v=fURsHPHgssI"), "fURsHPHgssI");
  assert.equal(L.youtubeId("https://youtu.be/fURsHPHgssI?t=30"), "fURsHPHgssI");
  assert.equal(L.youtubeId("https://www.youtube.com/watch?feature=share&v=fURsHPHgssI"), "fURsHPHgssI");
  assert.equal(L.youtubeId("https://youtube.com/shorts/fURsHPHgssI"), "fURsHPHgssI");
  assert.equal(L.youtubeId("not a link"), null);
});

test("videoHref never passes through non-http links", () => {
  assert.equal(L.videoHref("javascript:alert(1)", "Squat").startsWith("https://www.youtube.com/results?"), true);
  assert.equal(L.videoHref("https://youtu.be/abc", "Squat"), "https://youtu.be/abc");
  assert.match(L.videoHref("", "Goblet Squat"), /search_query=Goblet%20Squat/);
});

const rows = [
  { session: 2, session_name: "Day B", order: 2, exercise: "Row" },
  { session: 1, session_name: "Day A", order: 2, exercise: "Press" },
  { session: 1, session_name: "", order: 1, exercise: "Squat" },
  { session: 2, order: 1, exercise: "Hinge" },
  { session: "", exercise: "Orphan" },
  { session: 3, exercise: "  " },
];

test("groupProgram orders sessions and exercises, skips blanks", () => {
  const g = L.groupProgram(rows);
  assert.deepEqual(g.map((x) => x.session), [1, 2]);
  assert.deepEqual(g[0].items.map((x) => x.exercise), ["Squat", "Press"]);
  assert.equal(g[0].name, "Day A");
  assert.deepEqual(g[1].items.map((x) => x.exercise), ["Hinge", "Row"]);
});

test("nextSession is the first one not finished, in order", () => {
  const g = L.groupProgram(rows);
  assert.equal(L.nextSession(g, []).session, 1);
  assert.equal(L.nextSession(g, [{ session: 1, finished_at: "x" }]).session, 2);
  assert.equal(L.nextSession(g, [{ session: 1, finished_at: "" }]).session, 1);
  assert.equal(L.nextSession(g, [{ session: 1, finished_at: "x" }, { session: "2", finished_at: "y" }]), null);
});

const log = [
  { instance_id: "a", date: "2026-10-01", logged_at: "2026-10-01T07:00:00Z", exercise: "Squat", set_type: "W", set_no: 1, kg: 4, reps: 8, rir: "" },
  { instance_id: "a", date: "2026-10-01", logged_at: "2026-10-01T07:01:00Z", exercise: "Squat", set_type: "N", set_no: 2, kg: 10, reps: 10, rir: "2" },
  { instance_id: "a", date: "2026-10-01", logged_at: "2026-10-01T07:00:30Z", exercise: "squat ", set_type: "N", set_no: 1, kg: 10, reps: 12, rir: "3" },
  { instance_id: "b", date: "2026-10-05", logged_at: "2026-10-05T07:00:00Z", exercise: "Squat", set_type: "N", set_no: 1, kg: 12, reps: 9, rir: "2" },
  { instance_id: "c", date: "2026-10-08", logged_at: "2026-10-08T07:00:00Z", exercise: "Squat", set_type: "N", set_no: 1, kg: 14, reps: 8, rir: "1" },
];

test("lastPerformance takes the newest session, skips warm-ups and the current one", () => {
  const last = L.lastPerformance(log, "Squat", "c");
  assert.equal(last.instance_id, "b");
  const older = L.performances(log, "SQUAT", "c")[1];
  assert.deepEqual(older.sets.map((s) => s.set_no), [1, 2]);
  assert.equal(L.lastPerformance(log, "Bench", null), null);
});

test("suggest prefers the coach's load, then last time, then the bottom of the range", () => {
  const t = L.toTarget({ sets: 3, reps: "8-10", target_kg: "" });
  const last = L.lastPerformance(log, "Squat", "c");
  assert.deepEqual(L.suggest(t, null, 0, false), { kg: "", reps: "8" });
  assert.deepEqual(L.suggest(t, last, 0, false), { kg: "12", reps: "9" });
  assert.deepEqual(L.suggest(t, last, 2, false), { kg: "12", reps: "9" }); // fewer sets last time
  const heavier = L.toTarget({ sets: 3, reps: "8-10", target_kg: 14 });
  assert.deepEqual(L.suggest(heavier, last, 0, false), { kg: "14", reps: "8" });
  const same = L.toTarget({ sets: 3, reps: "8-10", target_kg: 12 });
  assert.deepEqual(L.suggest(same, last, 0, false), { kg: "12", reps: "9" });
  assert.deepEqual(L.suggest(t, last, 0, true), { kg: "", reps: "9" });
});

test("suggested reps stay inside the coach's range when a new phase moves it", () => {
  const last = { sets: [{ kg: 20, reps: 12 }] };
  assert.deepEqual(L.suggest(L.toTarget({ reps: "8-10" }), last, 0, false), { kg: "20", reps: "10" });
  assert.deepEqual(L.suggest(L.toTarget({ reps: "12-15" }), last, 0, false), { kg: "20", reps: "12" });
  assert.deepEqual(L.suggest(L.toTarget({ reps: "6-8" }), { sets: [{ kg: 20, reps: 4 }] }, 0, false), { kg: "20", reps: "6" });
  assert.deepEqual(L.suggest(L.toTarget({ reps: "max" }), last, 0, false), { kg: "20", reps: "12" });
});

test("rirRange reads the coach's RIR column", () => {
  assert.deepEqual(L.rirRange("2"), { lo: 2, hi: 2 });
  assert.deepEqual(L.rirRange(2), { lo: 2, hi: 2 });
  assert.deepEqual(L.rirRange("1-2"), { lo: 1, hi: 2 });
  assert.deepEqual(L.rirRange("2–1"), { lo: 1, hi: 2 });
  assert.equal(L.rirRange(""), null);
  assert.equal(L.rirRange("hard"), null);
});

test("rirNudge pushes towards the target RIR from today's last rated set", () => {
  const t = L.toTarget({ reps: "6-8", target_rir: "2" });
  const set = (rir, done = true, at = "2026-10-13T10:00:00Z", type = "N") => ({ type, rir, done, at });
  assert.equal(L.rirNudge(L.toTarget({ reps: "8" }), [set("4")], null, false), null); // no target
  assert.deepEqual(L.rirNudge(t, [set("4"), set("", false)], null, false), {
    tone: "up",
    text: "Last set: RIR 4, target 2. Next set, add a little weight or 1–2 reps.",
  });
  assert.equal(L.rirNudge(t, [set("5")], null, false).text, "Last set: RIR 5+, target 2. Next time, add a little weight or 1–2 reps.");
  assert.equal(L.rirNudge(t, [set("5"), set("", false)], null, true).text, "Last set: RIR 5+, target 2. Next set, add 1–2 reps.");
  assert.equal(L.rirNudge(t, [set("3"), set("", false)], null, false).text, "Last set: RIR 3. One more rep next set gets you to 2.");
  assert.deepEqual(L.rirNudge(t, [set("2")], null, false), { tone: "good", text: "Last set: RIR 2. Right on target." });
  assert.equal(L.rirNudge(t, [set("1")], null, false).tone, "hold");
  // The most recently ticked set counts, not the last row; warm-ups and unrated sets don't.
  const sets = [set("4", true, "2026-10-13T10:05:00Z"), set("2", true, "2026-10-13T10:01:00Z"), set("", true), set("0", true, "z", "W")];
  assert.equal(L.rirNudge(t, sets, null, false).tone, "up");
  // A range target: 3 is one over the top of 1-2.
  assert.equal(L.rirNudge(L.toTarget({ target_rir: "1-2" }), [set("3")], null, false).text, "Last set: RIR 3. One more rep next time gets you to 1-2.");
  // The coach set the load: talk about reps, not weight.
  const heavy = L.toTarget({ target_kg: 40, target_rir: "2" });
  assert.equal(L.rirNudge(heavy, [set("4"), set("", false)], null, false).text, "Last set: RIR 4, target 2. Next set, add 1–2 reps.");
});

test("rirNudge says go heavier when every set last time was easy", () => {
  const t = L.toTarget({ reps: "6-8", target_rir: "2" });
  const easy = { sets: [{ kg: 40, reps: 8, rir: "4" }, { kg: 40, reps: 8, rir: "5" }] };
  const mixed = { sets: [{ kg: 40, reps: 8, rir: "4" }, { kg: 40, reps: 8, rir: "2" }] };
  assert.deepEqual(L.rirNudge(t, [], easy, false), { tone: "up", text: "Last time every set was RIR 4 or more. Target 2: go heavier today." });
  assert.equal(L.rirNudge(t, [], { sets: [{ rir: "5" }] }, true).text, "Last time every set was RIR 5+. Target 2: add reps today.");
  assert.equal(L.rirNudge(t, [], mixed, false), null);
  assert.equal(L.rirNudge(t, [], { sets: [{ kg: 40, reps: 8, rir: "" }] }, false), null);
  assert.equal(L.rirNudge(t, [], null, false), null);
  // Not when the coach has set today's load.
  assert.equal(L.rirNudge(L.toTarget({ target_kg: 40, target_rir: "2" }), [], easy, false), null);
});

test("one warm-up is half the working load, rounded to 2.5", () => {
  assert.deepEqual(L.suggestWarmup({ kg: "50" }, false), { kg: "25", reps: "10" });
  assert.deepEqual(L.suggestWarmup({ kg: "12" }, false), { kg: "5", reps: "10" });
  assert.deepEqual(L.suggestWarmup({ kg: "" }, false), { kg: "", reps: "10" });
  assert.deepEqual(L.suggestWarmup({ kg: "50" }, true), { kg: "", reps: "5" });
});

test("several warm-ups ramp up to the working load", () => {
  const ramp = (kg, count, bar = 0) =>
    Array.from({ length: count }, (_, i) => L.suggestWarmup({ kg: String(kg) }, false, i, count, bar)).map((w) => `${w.kg}x${w.reps}`);
  assert.deepEqual(ramp(60, 2), ["30x10", "45x4"]);
  assert.deepEqual(ramp(65, 3), ["25x10", "40x5", "52.5x3"]);
  assert.deepEqual(ramp(100, 4), ["40x10", "55x6", "70x4", "85x2"]);
  assert.deepEqual(ramp(100, 6).slice(4), ["85x2", "85x2"]); // more than 4: the last step repeats
  // Barbell lifts never go under the empty bar.
  assert.deepEqual(ramp(30, 2, 20), ["20x10", "22.5x4"]);
});

test("rirFor gives each working set its own target when there's a list", () => {
  assert.equal(L.rirFor(L.toTarget({ target_rir: "2" }), 3), "2");
  assert.equal(L.rirFor(L.toTarget({ target_rir: "1-2" }), 1), "1-2");
  const t = L.toTarget({ target_rir: "1, 2, 3,3" });
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => L.rirFor(t, n)), ["1", "2", "3", "3", "3"]);
  assert.equal(L.rirFor(L.toTarget({ target_rir: "" }), 1), "");
  assert.equal(L.planLine(L.toTarget({ sets: 4, reps: "8-10", target_rir: "1,2,3,3" })), "4 × 8–10 · RIR 1, 2, 3, 3");
});

test("rirNudge uses each set's own target from a list", () => {
  const t = L.toTarget({ reps: "8-10", target_rir: "1, 2, 3" });
  const set = (rir, done, at) => ({ type: "N", rir, done, at });
  // Top set at RIR 3 against a target of 1: about next time, since the next set is a planned back-off.
  assert.equal(L.rirNudge(t, [set("3", true, "a"), set("", false)], null, false).text, "Last set: RIR 3, target 1. Next time, add a little weight or 1–2 reps.");
  // Set 3's target is 3, so RIR 3 there is on target.
  assert.equal(L.rirNudge(t, [set("1", true, "a"), set("2", true, "b"), set("3", true, "c")], null, false).tone, "good");
  // Last time: easy against every set's own target.
  const easy = { sets: [{ set_no: 1, rir: "3" }, { set_no: 2, rir: "4" }, { set_no: 3, rir: "5" }] };
  assert.equal(L.rirNudge(t, [], easy, false).text, "Last time every set had 2 or more reps to spare. Go heavier today.");
  const fine = { sets: [{ set_no: 1, rir: "3" }, { set_no: 2, rir: "3" }, { set_no: 3, rir: "5" }] };
  assert.equal(L.rirNudge(t, [], fine, false), null);
});



test("applyOps upserts sets, deletes them, and records finished sessions", () => {
  let db = { log: [], sessions: [] };
  db = L.applyOps(db, [
    { type: "set", entry_id: "x.1", instance_id: "x", exercise: "Squat", kg: "10", reps: "8" },
    { type: "set", entry_id: "x.2", instance_id: "x", exercise: "Squat", kg: "10", reps: "8" },
  ]);
  db = L.applyOps(db, [
    { type: "set", entry_id: "x.1", instance_id: "x", exercise: "Squat", kg: "12", reps: "8" },
    { type: "delete_set", entry_id: "x.2" },
    { type: "finish", instance_id: "x", session: 1, finished_at: "t" },
  ]);
  assert.equal(db.log.length, 1);
  assert.equal(db.log[0].kg, "12");
  assert.equal(db.sessions[0].finished_at, "t");
  const h = L.history(db);
  assert.equal(h.length, 1);
  assert.equal(h[0].exercises[0].sets.length, 1);
});

test("text helpers", () => {
  const t = L.toTarget({ sets: 3, reps: "8-10", target_kg: 47.5, target_rir: "2" });
  assert.equal(L.targetText(t, false), "47.5 kg × 8–10");
  assert.equal(L.targetText(t, true), "8–10 reps");
  assert.equal(L.targetText(L.toTarget({}), false), "No target");
  assert.equal(L.planLine(t), "3 × 8–10 · 47.5 kg · RIR 2");
  assert.equal(L.setText({ kg: 50, reps: 8, rir: "2" }, false), "50 kg × 8 @2");
  assert.equal(L.setText({ kg: "", reps: 15, rir: "" }, false), "15 reps");
  assert.equal(L.setText({ kg: 20, reps: "", rir: "" }, false), "20 kg");
  assert.equal(L.setText({ kg: "", reps: "", rir: "" }, true), "done");
  assert.equal(L.fmtElapsed(28_000), "0:00:28");
  assert.equal(L.fmtElapsed(3_725_000), "1:02:05");
  assert.equal(L.fmtClock(180), "3:00");
  assert.equal(L.fmtClock(0.2), "0:01");
  assert.equal(L.fmtDay("2026-10-13"), "Tue 13 Oct");
  assert.equal(L.initials("DB Incline Press"), "DI");
});

test("muscleSummary counts primary muscles by sets", () => {
  const items = [
    { lib: { primary_muscles: "Chest, Front Delts" }, target: { sets: 3 } },
    { lib: { primary_muscles: "chest" }, target: { sets: 2 } },
    { lib: {}, target: { sets: 3 } },
  ];
  assert.deepEqual(L.muscleSummary(items).map((m) => [m.muscle, m.exercises, m.sets]), [
    ["Chest", 2, 5],
    ["Front Delts", 1, 3],
  ]);
});

test("estimateMinutes is sensible", () => {
  const t = L.toTarget({ sets: 3, rest_sec: 90 });
  // Per exercise: 1 min setup + 3 sets × (45 s work + 90 s rest) = 465 s.
  assert.equal(L.estimateMinutes([t, t, t, t]), 31);
});

const LIB = Object.fromEntries(
  [
    { exercise: "Goblet Squat", pattern: "squat", equipment: "dumbbells", primary_muscles: "Quads, Glutes", swaps: "Leg Press, Box Squat, Nonexistent" },
    { exercise: "Leg Press", pattern: "squat", equipment: "machine", primary_muscles: "Quads, Glutes" },
    { exercise: "Box Squat", pattern: "squat", equipment: "bodyweight, bench", primary_muscles: "Quads" },
    { exercise: "Barbell Squat", pattern: "squat", equipment: "barbell, rack", primary_muscles: "Quads, Glutes, Adductors" },
    { exercise: "Wall Sit", pattern: "squat", equipment: "bodyweight", primary_muscles: "Abs" },
    { exercise: "Hip Thrust", pattern: "hinge", equipment: "dumbbells, bench", primary_muscles: "Glutes" },
  ].map((e) => [L.norm(e.exercise), e]),
);

test("swap candidates: coach's picks first, then the same pattern by shared muscles", () => {
  const { picks, same } = L.swapCandidates("goblet squat", LIB);
  assert.deepEqual(picks.map((e) => e.exercise), ["Leg Press", "Box Squat"]);
  assert.deepEqual(same.map((e) => e.exercise), ["Barbell Squat", "Wall Sit"]);
});

test("swap candidates skip anything needing equipment that isn't there", () => {
  const { picks, same } = L.swapCandidates("Goblet Squat", LIB, new Set(["machine", "bench"]));
  assert.deepEqual(picks.map((e) => e.exercise), []);
  assert.deepEqual(same.map((e) => e.exercise), ["Barbell Squat", "Wall Sit"]);
  assert.deepEqual(L.swapCandidates("Unknown", LIB), { picks: [], same: [] });
});

test("swap equipment lists what the alternatives need, not bodyweight", () => {
  assert.deepEqual(L.swapEquipment("Goblet Squat", LIB), ["barbell", "bench", "dumbbells", "machine", "rack"]);
});

test("swap lists keep names that have commas inside brackets", () => {
  assert.deepEqual(L.splitNames("Glute Bridge, Single-Leg Hip Thrust (bench, bodyweight); Leg Press"), [
    "Glute Bridge", "Single-Leg Hip Thrust (bench, bodyweight)", "Leg Press",
  ]);
  const lib = Object.fromEntries([
    { exercise: "Hip Thrust", pattern: "hinge", swaps: "Single-Leg Hip Thrust (bench, bodyweight)" },
    { exercise: "Single-Leg Hip Thrust (bench, bodyweight)", pattern: "hinge" },
  ].map((e) => [L.norm(e.exercise), e]));
  assert.deepEqual(L.swapCandidates("Hip Thrust", lib).picks.map((e) => e.exercise), ["Single-Leg Hip Thrust (bench, bodyweight)"]);
});

test("exercises marked offer: false are never suggested as swaps", () => {
  const lib = { ...LIB, [L.norm("Barbell Squat")]: { ...LIB[L.norm("Barbell Squat")], offer: false } };
  const { same } = L.swapCandidates("Goblet Squat", lib);
  assert.deepEqual(same.map((e) => e.exercise), ["Wall Sit"]);
});

const ex = (rest, extra = {}) => ({ target: L.toTarget({ rest_sec: rest }), ...extra });

test("supersetOf groups exercises chained by rest 0", () => {
  const w = [ex(90), ex(0), ex(90), ex(0), ex(0), ex(60), ex(0)];
  assert.equal(L.supersetOf(w, 0), null);
  assert.deepEqual(L.supersetOf(w, 1), { from: 1, to: 2 });
  assert.deepEqual(L.supersetOf(w, 2), { from: 1, to: 2 });
  assert.deepEqual(L.supersetOf(w, 4), { from: 3, to: 5 });
  assert.equal(L.supersetOf(w, 6), null); // rest 0 on the last exercise leads nowhere
  // An exercise added during the workout never joins one.
  assert.equal(L.supersetOf([ex(0), ex(90, { added: true })], 0), null);
});

test("restFor gives a superset's first exercise the group's rest", () => {
  const w = [ex(90), ex(0), ex(75), ex(0)];
  assert.equal(L.restFor(w, 0), 90);
  assert.equal(L.restFor(w, 1), 75); // done as straight sets, the timer still runs
  assert.equal(L.restFor(w, 2), 75);
  assert.equal(L.restFor(w, 3), L.DEFAULT_REST_SEC);
});

test("liveWorkouts finds recent unfinished workouts, newest first", () => {
  const now = Date.parse("2026-10-18T01:30:00Z");
  const row = (inst, at, type = "N") => ({ instance_id: inst, logged_at: at, session: "3", session_name: "Phase 1", set_type: type });
  const db = {
    log: [
      row("a", "2026-10-18T01:00:00Z", "W"), row("a", "2026-10-18T01:20:00Z"), row("a", "2026-10-18T01:10:00Z"),
      row("b", "2026-10-18T01:25:00Z"),
      row("old", "2026-10-17T18:00:00Z"),
      row("done", "2026-10-18T01:29:00Z"),
    ],
    sessions: [{ instance_id: "done", finished_at: "2026-10-18T01:29:30Z" }],
  };
  const live = L.liveWorkouts(db, now);
  assert.deepEqual(live.map((g) => g.instance_id), ["b", "a"]);
  assert.deepEqual(live[1], { instance_id: "a", session: 3, session_name: "Phase 1", first: "2026-10-18T01:00:00Z", last: "2026-10-18T01:20:00Z", sets: 2 });
  assert.deepEqual(L.liveWorkouts(db, now, undefined, "b").map((g) => g.instance_id), ["a"]);
});

test("liveWorkout lays logged sets over the plan, swaps and additions included", () => {
  const group = L.groupProgram([
    { session: 3, session_name: "S3", order: 1, exercise: "Goblet Squat", sets: 3, reps: "10-12" },
    { session: 3, session_name: "S3", order: 2, exercise: "DB Incline Press", sets: 3, reps: "10-12" },
    { session: 3, session_name: "S3", order: 3, exercise: "Row", sets: 3, reps: "10-12" },
  ])[0];
  const r = (slot, ex, type, no, at, swapped = "") => ({ entry_id: `i.${slot}.${no}`, exercise: ex, set_type: type, set_no: no, logged_at: at, swapped_from: swapped });
  const w = L.liveWorkout(group, [
    r(0, "Goblet Squat", "N", 2, "t2"), r(0, "Goblet Squat", "W", 1, "t0"), r(0, "Goblet Squat", "N", 1, "t1"),
    r(1, "Machine Chest Press", "N", 1, "t4", "DB Incline Press"),
    r(3, "Leg Extension", "N", 1, "t5"),
  ]);
  assert.deepEqual(w.exercises.map((e) => e.name), ["Goblet Squat", "Machine Chest Press", "Row", "Leg Extension"]);
  assert.deepEqual(w.exercises[0].sets.map((x) => `${x.set_type}${x.set_no}`), ["W1", "N1", "N2"]);
  assert.equal(w.exercises[1].swappedFrom, "DB Incline Press");
  assert.equal(w.exercises[2].sets.length, 0);
  assert.equal(w.exercises[3].added, true);
  assert.equal(w.current, 3);
  assert.deepEqual(L.liveWorkout(null, []), { exercises: [], current: -1 });
});

test("searchLibrary matches every word against name, muscles and equipment", () => {
  const lib = {
    a: { exercise: "Leg Extension", primary_muscles: "Quads", equipment: "machine" },
    b: { exercise: "Leg Press", primary_muscles: "Quads, Glutes", equipment: "machine" },
    c: { exercise: "Goblet Squat", primary_muscles: "Quads", equipment: "dumbbells" },
    d: { exercise: "Barbell Deadlift", primary_muscles: "Glutes", equipment: "barbell", offer: false },
  };
  assert.deepEqual(L.searchLibrary(lib, "").map((e) => e.exercise), ["Goblet Squat", "Leg Extension", "Leg Press"]);
  assert.deepEqual(L.searchLibrary(lib, "leg").map((e) => e.exercise), ["Leg Extension", "Leg Press"]);
  assert.deepEqual(L.searchLibrary(lib, "quads dumbbell").map((e) => e.exercise), ["Goblet Squat"]);
  assert.deepEqual(L.searchLibrary(lib, "deadlift"), []); // ruled out by the client's flags
});

test("agoText", () => {
  assert.equal(L.agoText(20e3), "just now");
  assert.equal(L.agoText(5 * 60e3), "5 min ago");
  assert.equal(L.agoText(130 * 60e3), "2 h 10 min ago");
});

test("customName tidies a typed exercise name", () => {
  assert.equal(L.customName("  Leg   Extension "), "Leg Extension");
  assert.equal(L.customName("   "), "");
  assert.equal(L.customName(null), "");
  assert.equal(L.customName("x".repeat(80)).length, 60);
});

test("planLine says per hand for two-dumbbell exercises with a target load", () => {
  const t = L.toTarget({ sets: 3, reps: "10-12", target_kg: 10, target_rir: "3" });
  assert.equal(L.planLine(t, true), "3 × 10–12 · 10 kg per hand · RIR 3");
  assert.equal(L.planLine(t), "3 × 10–12 · 10 kg · RIR 3");
  assert.equal(L.planLine(L.toTarget({ sets: 3, reps: "10-12" }), true), "3 × 10–12");
});
