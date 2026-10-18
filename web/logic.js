// Pure helpers shared by the UI and the tests. Nothing in here touches the DOM.

export const DEFAULT_REST_SEC = 90;

export const LOG_FIELDS = [
  "entry_id", "instance_id", "date", "logged_at", "session", "session_name",
  "exercise", "set_type", "set_no", "kg", "reps", "rir", "swapped_from",
];
export const SESSION_FIELDS = [
  "instance_id", "session", "session_name", "date", "started_at",
  "finished_at", "duration_min", "sets_done", "note",
];

export const norm = (s) => String(s ?? "").trim().toLowerCase();

export function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function clampInt(v, lo, hi, dflt) {
  const n = numOrNull(v);
  if (n == null) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function truthy(v) {
  if (typeof v === "boolean") return v;
  return ["true", "yes", "y", "1", "x", "✓"].includes(norm(v));
}

export function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${rand}`;
}

/* ---------- program ---------- */

// "8-10", "8–10", "8 to 10", "12" → {lo, hi}. Anything else ("30s", "AMRAP") keeps its text.
export function parseReps(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/^(\d+)\s*(?:(?:-|–|—|to)\s*(\d+))?\s*$/i);
  if (!m) return { lo: null, hi: null, text: t };
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), text: t };
}

export function repsLabel(r) {
  if (r.lo == null) return r.text;
  return r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`;
}

export function toTarget(row) {
  return {
    sets: clampInt(row.sets, 1, 20, 3),
    reps: parseReps(row.reps),
    kg: numOrNull(row.target_kg),
    rir: String(row.target_rir ?? "").trim(),
    rest: clampInt(row.rest_sec, 0, 900, DEFAULT_REST_SEC),
    warmup: clampInt(row.warmup_sets, 0, 5, 0),
    note: String(row.note ?? "").trim(),
  };
}

// Program rows → sessions in order, each with its exercises in order.
export function groupProgram(rows) {
  const by = new Map();
  (rows || []).forEach((r, i) => {
    const n = numOrNull(r.session);
    if (n == null || !String(r.exercise ?? "").trim()) return;
    if (!by.has(n)) by.set(n, { session: n, name: "", items: [] });
    const g = by.get(n);
    if (!g.name && String(r.session_name ?? "").trim()) g.name = String(r.session_name).trim();
    g.items.push({ ...r, exercise: String(r.exercise).trim(), _i: i });
  });
  const out = [...by.values()].sort((a, b) => a.session - b.session);
  for (const g of out) {
    const ord = (x) => numOrNull(x.order) ?? 1000 + x._i;
    g.items.sort((a, b) => ord(a) - ord(b) || a._i - b._i);
    if (!g.name) g.name = `Session ${g.session}`;
  }
  return out;
}

export function finishedNumbers(sessions) {
  const done = new Set();
  for (const s of sessions || []) if (s.finished_at) done.add(Number(s.session));
  return done;
}

// Sessions run in order, not by weekday: a missed day doesn't skip anything.
export function nextSession(groups, sessions) {
  const done = finishedNumbers(sessions);
  return groups.find((g) => !done.has(g.session)) || null;
}

/* ---------- supersets ---------- */

// rest_sec 0 means "go straight to the next exercise": the two (or more) form a superset and
// the rest comes after the last one. Exercises added during the workout never join one.
export function supersetOf(exercises, i) {
  const joins = (j) => j >= 0 && j < exercises.length - 1 && exercises[j].target.rest === 0 && !exercises[j].added && !exercises[j + 1].added;
  if (!exercises[i] || exercises[i].added) return null;
  let from = i;
  while (joins(from - 1)) from -= 1;
  let to = i;
  while (joins(to)) to += 1;
  return to > from ? { from, to } : null;
}

// The rest timer after a set. A superset's first exercise uses the group's rest, so the timer
// still runs when the pair is done as straight sets.
export function restFor(exercises, i) {
  const g = supersetOf(exercises, i);
  const own = exercises[i] ? exercises[i].target.rest : 0;
  if (own > 0) return own;
  const last = g ? exercises[g.to].target.rest : 0;
  return last > 0 ? last : DEFAULT_REST_SEC;
}

/* ---------- live view ---------- */

// Workouts with sets logged but not finished, newest first: what a coach opening the same link
// on another phone can watch. Only ones with a set in the last `maxAgeMs`.
export function liveWorkouts(db, now = Date.now(), maxAgeMs = 4 * 3600 * 1000, exclude = null) {
  const finished = new Set((db.sessions || []).filter((x) => x.finished_at).map((x) => x.instance_id));
  const by = new Map();
  for (const r of db.log || []) {
    if (!r.instance_id || finished.has(r.instance_id) || r.instance_id === exclude) continue;
    const at = String(r.logged_at || "");
    let g = by.get(r.instance_id);
    if (!g) {
      g = { instance_id: r.instance_id, session: numOrNull(r.session), session_name: r.session_name || "", first: at, last: at, sets: 0 };
      by.set(r.instance_id, g);
    }
    if (at > g.last) g.last = at;
    if (at && (!g.first || at < g.first)) g.first = at;
    if (r.set_type !== "W") g.sets += 1;
  }
  return [...by.values()].filter((g) => now - Date.parse(g.last) <= maxAgeMs).sort((a, b) => b.last.localeCompare(a.last));
}

// One workout's logged sets laid over its planned exercises (group may be null), in the order
// the client sees them. entry_id is instance.slot.set and slot is the exercise's place in the
// workout, so swapped and added exercises land where they are on the client's phone.
export function liveWorkout(group, rows) {
  const items = (group ? group.items : []).map((r) => ({ name: r.exercise, target: toTarget(r), swappedFrom: "", added: false, sets: [] }));
  let latest = null;
  for (const r of rows) {
    const slot = Number(String(r.entry_id || "").split(".")[1]);
    let it = Number.isInteger(slot) && slot >= 0 ? items[slot] : items.find((x) => norm(x.name) === norm(r.exercise));
    if (!it) {
      it = { name: r.exercise, target: null, swappedFrom: "", added: true, sets: [] };
      if (Number.isInteger(slot) && slot >= 0) items[slot] = it;
      else items.push(it);
    }
    it.name = r.exercise;
    it.swappedFrom = r.swapped_from || "";
    it.sets.push(r);
    if (!latest || String(r.logged_at || "") >= String(latest.r.logged_at || "")) latest = { r, it };
  }
  const exercises = items.filter(Boolean);
  for (const e of exercises) {
    e.sets.sort((a, b) => (a.set_type === b.set_type ? Number(a.set_no) - Number(b.set_no) : a.set_type === "W" ? -1 : 1));
  }
  return { exercises, current: latest ? exercises.indexOf(latest.it) : -1 };
}

export function agoText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

/* ---------- history ---------- */

// Every past performance of one exercise, newest first, warm-ups left out.
export function performances(log, exercise, excludeInstance) {
  const key = norm(exercise);
  const groups = new Map();
  for (const r of log || []) {
    if (norm(r.exercise) !== key || r.set_type === "W") continue;
    if (excludeInstance && r.instance_id === excludeInstance) continue;
    let g = groups.get(r.instance_id);
    if (!g) groups.set(r.instance_id, (g = { instance_id: r.instance_id, date: r.date || "", at: "", sets: [] }));
    g.sets.push(r);
    if (String(r.logged_at || "") > g.at) g.at = String(r.logged_at || "");
  }
  const list = [...groups.values()];
  list.forEach((g) => g.sets.sort((a, b) => Number(a.set_no) - Number(b.set_no)));
  list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.at > a.at ? 1 : b.at < a.at ? -1 : 0));
  return list;
}

export const lastPerformance = (log, exercise, excludeInstance) =>
  performances(log, exercise, excludeInstance)[0] || null;

// What goes in a set's empty boxes: the coach's load when given, else last time's.
export function suggest(target, last, idx, bodyweight) {
  const prev = last && last.sets.length ? last.sets[Math.min(idx, last.sets.length - 1)] : null;
  const prevKg = prev ? numOrNull(prev.kg) : null;
  let kg = null;
  if (!bodyweight) kg = target.kg ?? prevKg;
  let reps = null;
  if (prev && (bodyweight || target.kg == null || target.kg === prevKg)) reps = numOrNull(prev.reps);
  if (reps == null) reps = target.reps.lo;
  // A new phase can move the range (10-12 → 8-10): never suggest reps outside it.
  else if (target.reps.lo != null) reps = Math.min(target.reps.hi, Math.max(target.reps.lo, reps));
  return { kg: kg == null ? "" : fmtNum(kg), reps: reps == null ? "" : String(reps) };
}

// Warm-ups climb towards the first working set: light and longer first, heavier and
// shorter last. [share of the working load, reps] for 1, 2, 3 and 4+ warm-up sets.
const RAMPS = [
  [[0.5, 10]],
  [[0.5, 10], [0.75, 4]],
  [[0.4, 10], [0.6, 5], [0.8, 3]],
  [[0.4, 10], [0.55, 6], [0.7, 4], [0.85, 2]],
];

// Warm-up `idx` of `count`, rounded to 2.5 kg and never under `minKg` (the empty bar).
export function suggestWarmup(working, bodyweight, idx = 0, count = 1, minKg = 0) {
  if (bodyweight) return { kg: "", reps: "5" };
  const ramp = RAMPS[Math.min(Math.max(count, 1), RAMPS.length) - 1];
  const [share, reps] = ramp[Math.min(Math.max(idx, 0), ramp.length - 1)];
  const kg = numOrNull(working.kg);
  return { kg: kg == null ? "" : fmtNum(Math.max(minKg, Math.round((kg * share) / 2.5) * 2.5)), reps: String(reps) };
}

/* ---------- effort nudges ---------- */

// The coach's RIR: "2" → {lo: 2, hi: 2}, "1-2" → {lo: 1, hi: 2}, anything else → null.
export function rirRange(v) {
  const m = String(v ?? "").match(/^\s*(\d+)\s*(?:(?:-|–|to)\s*(\d+))?\s*$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] == null ? a : Number(m[2]);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

// The coach's RIR for working set n (from 1). "1, 2, 3, 3" gives each set its own: a top
// set, then back-offs. The last one carries on for any extra sets.
export function rirFor(target, n) {
  const list = String(target.rir ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return list.length ? list[Math.min(Math.max(n, 1), list.length) - 1] : "";
}

const perSetRir = (target) => String(target.rir ?? "").includes(",");

const rirText = (r) => (r >= 5 ? "5+" : String(r));

// One line under the set count that steers effort towards the coach's RIR: from the
// set ticked most recently today, or before any, from last time. The coach's own
// load is never second-guessed, so with a target kg the nudge is about reps.
export function rirNudge(target, sets, last, bodyweight) {
  const goalOf = (n) => rirRange(rirFor(target, n));
  const label = (t) => (t.lo === t.hi ? String(t.hi) : `${t.lo}-${t.hi}`);
  // With a target per set, the next set has its own plan (a back-off, say): talk about next time.
  const perSet = perSetRir(target);
  const more = bodyweight || target.kg != null ? "add 1–2 reps" : "add a little weight or 1–2 reps";
  let n = 0;
  const rated = [];
  for (const s of sets) {
    if (s.type !== "N") continue;
    n += 1;
    if (s.done && numOrNull(s.rir) != null) rated.push({ s, n });
  }
  if (rated.length) {
    const { s, n: k } = rated.reduce((a, b) => (String(b.s.at || "") >= String(a.s.at || "") ? b : a));
    const t = goalOf(k);
    if (!t) return null;
    const r = numOrNull(s.rir);
    const soon = sets.some((x) => x.type === "N" && !x.done) && !perSet;
    const was = `Last set: RIR ${rirText(r)}`;
    if (r >= t.hi + 2) {
      return { tone: "up", text: `${was}, target ${label(t)}. ${soon ? `Next set, ${more}.` : `Next time, ${more}.`}` };
    }
    if (r === t.hi + 1) {
      return { tone: "up", text: `${was}. ${soon ? "One more rep next set" : "One more rep next time"} gets you to ${label(t)}.` };
    }
    if (r < t.lo) return { tone: "hold", text: `${was}, harder than planned. Keep this weight.` };
    return { tone: "good", text: `${was}. Right on target.` };
  }
  if (target.kg != null) return null;
  const before = (last?.sets || [])
    .map((s, i) => ({ r: numOrNull(s.rir), t: goalOf(numOrNull(s.set_no) ?? i + 1) }))
    .filter((x) => x.r != null && x.t);
  if (before.length && before.every((x) => x.r >= x.t.hi + 2)) {
    const today = bodyweight ? "add reps today" : "go heavier today";
    if (perSet) return { tone: "up", text: `Last time every set had 2 or more reps to spare. Go ${bodyweight ? "for more reps" : "heavier"} today.` };
    const easiest = Math.min(...before.map((x) => x.r));
    return {
      tone: "up",
      text: `Last time every set was RIR ${rirText(easiest)}${easiest >= 5 ? "" : " or more"}. Target ${label(before[0].t)}: ${today}.`,
    };
  }
  return null;
}

/* ---------- local data merge ---------- */

const pick = (o, fields) => Object.fromEntries(fields.map((f) => [f, o[f] ?? ""]));

// Applies queued writes to {log, sessions}. Used for the demo store, the offline
// view (server data + what hasn't synced yet) and the cache after a sync.
export function applyOps(db, ops) {
  const log = new Map((db.log || []).map((r) => [r.entry_id, r]));
  const sessions = new Map((db.sessions || []).map((s) => [s.instance_id, s]));
  for (const op of ops || []) {
    if (op.type === "set") log.set(op.entry_id, pick(op, LOG_FIELDS));
    else if (op.type === "delete_set") log.delete(op.entry_id);
    else if (op.type === "finish") {
      sessions.set(op.instance_id, { ...(sessions.get(op.instance_id) || {}), ...pick(op, SESSION_FIELDS) });
    }
  }
  return { log: [...log.values()], sessions: [...sessions.values()] };
}

export function history(db) {
  const byInstance = new Map();
  for (const r of db.log || []) {
    if (!byInstance.has(r.instance_id)) byInstance.set(r.instance_id, []);
    byInstance.get(r.instance_id).push(r);
  }
  return (db.sessions || [])
    .filter((s) => s.finished_at)
    .sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at)))
    .map((s) => {
      const exercises = [];
      const idx = new Map();
      for (const r of byInstance.get(s.instance_id) || []) {
        if (!idx.has(r.exercise)) {
          idx.set(r.exercise, exercises.length);
          exercises.push({ name: r.exercise, sets: [] });
        }
        exercises[idx.get(r.exercise)].sets.push(r);
      }
      exercises.forEach((e) =>
        e.sets.sort((a, b) => (a.set_type === b.set_type ? Number(a.set_no) - Number(b.set_no) : a.set_type === "W" ? -1 : 1)),
      );
      return { ...s, exercises };
    });
}

/* ---------- summaries ---------- */

export function estimateMinutes(targets) {
  let sec = 0;
  for (const t of targets) sec += 60 + t.warmup * 60 + t.sets * (45 + t.rest);
  return Math.max(5, Math.round(sec / 60));
}

export function splitList(s) {
  return String(s ?? "").split(/[,;/]/).map((x) => x.trim()).filter(Boolean);
}

// Exercise names in a list, split on commas or semicolons outside brackets, so
// "Glute Bridge, Single-Leg Hip Thrust (bench, bodyweight)" is two names.
export function splitNames(s) {
  const out = [];
  let cur = "";
  let depth = 0;
  for (const ch of String(s ?? "")) {
    if (ch === "(" || ch === "[") depth += 1;
    else if ((ch === ")" || ch === "]") && depth) depth -= 1;
    if ((ch === "," || ch === ";") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function muscleSummary(items) {
  const by = new Map();
  for (const { lib, target } of items) {
    for (const m of splitList(lib.primary_muscles)) {
      const k = norm(m);
      if (!by.has(k)) by.set(k, { muscle: m, exercises: 0, sets: 0 });
      const e = by.get(k);
      e.exercises += 1;
      e.sets += target.sets;
    }
  }
  return [...by.values()].sort((a, b) => b.sets - a.sets || b.exercises - a.exercises);
}

/* ---------- swaps ---------- */

// Alternatives for one exercise from the library (a map of norm(name) → entry):
// the coach's own picks first, in their order, then anything else with the same
// movement pattern, closest muscles first. Anything needing equipment in `missing`
// is left out.
export function swapCandidates(name, library, missing = new Set()) {
  const key = norm(name);
  const cur = library[key] || {};
  const needs = (e) => splitList(e.equipment).map(norm);
  // offer: false marks something in this person's plan that their injury flags rule out as a swap.
  const usable = (e) => norm(e.exercise) !== key && e.offer !== false && !needs(e).some((q) => missing.has(q));
  const picks = [];
  for (const n of splitNames(cur.swaps)) {
    const e = library[norm(n)];
    if (e && usable(e) && !picks.includes(e)) picks.push(e);
  }
  const pattern = norm(cur.pattern);
  const mine = new Set(splitList(cur.primary_muscles).map(norm));
  const overlap = (e) => splitList(e.primary_muscles).filter((m) => mine.has(norm(m))).length;
  const same = pattern
    ? Object.values(library)
        .filter((e) => norm(e.pattern) === pattern && usable(e) && !picks.includes(e))
        .sort((a, b) => overlap(b) - overlap(a) || a.exercise.localeCompare(b.exercise))
    : [];
  return { picks, same };
}

// The library for "add an exercise": every word typed must match the name, muscles or equipment.
export function searchLibrary(library, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return Object.values(library)
    .filter((e) => e.offer !== false && e.exercise)
    .filter((e) => {
      const hay = norm([e.exercise, e.primary_muscles, e.secondary_muscles, e.equipment, e.pattern].join(" "));
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.exercise.localeCompare(b.exercise));
}

// A name typed for an exercise that isn't in the library, tidied; "" when there's nothing to use.
export function customName(q) {
  return String(q ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// Equipment worth offering as "not available today" for this exercise's swaps.
export function swapEquipment(name, library) {
  const cur = library[norm(name)] || {};
  const pattern = norm(cur.pattern);
  const names = new Set(splitNames(cur.swaps).map(norm));
  const seen = new Set();
  for (const e of Object.values(library)) {
    if (norm(e.exercise) === norm(name) || (pattern && norm(e.pattern) === pattern) || names.has(norm(e.exercise))) {
      for (const q of splitList(e.equipment)) if (norm(q) !== "bodyweight") seen.add(norm(q));
    }
  }
  return [...seen].sort();
}

/* ---------- formatting ---------- */

export function fmtNum(n) {
  const x = numOrNull(n);
  if (x == null) return "";
  return String(Math.round(x * 100) / 100);
}

export function targetText(t, bodyweight) {
  const r = repsLabel(t.reps);
  const numeric = t.reps.lo != null;
  if (bodyweight || t.kg == null) return r ? (numeric ? `${r} reps` : r) : "No target";
  return r ? `${fmtNum(t.kg)} kg × ${r}` : `${fmtNum(t.kg)} kg`;
}

export function planLine(t, perHand = false) {
  const parts = [];
  const r = repsLabel(t.reps);
  parts.push(r ? `${t.sets} × ${r}` : `${t.sets} sets`);
  if (t.kg != null) parts.push(`${fmtNum(t.kg)} kg${perHand ? " per hand" : ""}`);
  if (t.rir) parts.push(`RIR ${String(t.rir).split(",").map((x) => x.trim()).filter(Boolean).join(", ")}`);
  return parts.join(" · ");
}

export function setText(s, bodyweight) {
  const kg = numOrNull(s.kg);
  const reps = numOrNull(s.reps);
  const load = bodyweight || kg == null ? "" : `${fmtNum(kg)} kg`;
  // Sets logged without reps (older records) still show their load, or just that they were done.
  const base = reps == null ? load || "done" : load ? `${load} × ${reps}` : `${reps} reps`;
  return s.rir !== "" && s.rir != null ? `${base} @${s.rir}` : base;
}

export function fmtElapsed(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtClock(sec) {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(ymd || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* ---------- video ---------- */

export function youtubeId(url) {
  const m = String(url ?? "").match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/,
  );
  return m ? m[1] : null;
}

export function thumbUrl(url) {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

// Only ever hand out http(s) links; with no link, search YouTube for the exercise.
export function videoHref(url, name) {
  const u = String(url ?? "").trim();
  if (/^https?:\/\//i.test(u)) return u;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} exercise form`)}`;
}

export function initials(name) {
  const words = String(name ?? "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}
