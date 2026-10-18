import { APP_NAME } from "./config.js";
import * as L from "./logic.js";
import * as api from "./api.js";
import { muscleSvg } from "./body.js";
import { icon } from "./icons.js";

const $app = document.getElementById("app");
const $sheet = document.getElementById("sheet");
const $toast = document.getElementById("toast");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const S = {
  token: null,
  boot: null, // what the Sheet last told us (cached for offline)
  view: "loading", // landing | loading | error | home | workout | finish | done | history | watch
  error: null,
  pick: null, // session chosen on the home screen, if not the next one
  active: null, // the workout in progress, saved on every change
  sheet: null, // the open bottom sheet
  finishNote: "",
  done: null, // summary shown after finishing
  open: new Set(), // expanded history cards
  fetchedAt: 0,
  watch: null, // instance_id of a workout in progress elsewhere, shown read-only
};

const activeKey = () => `wt.active.${S.token}`;

/* ---------- data ---------- */

// Server data with anything not yet synced laid on top.
function data() {
  const b = S.boot;
  if (!b) return null;
  return { ...b, ...L.applyOps(b, api.pending(S.token)), groups: L.groupProgram(b.program) };
}

const libFor = (d, name) => d.exercises[L.norm(name)] || { exercise: name };
const cur = () => S.active.exercises[S.active.idx];

function saveActive() {
  if (S.active) api.LS.set(activeKey(), S.active);
}
let saveTimer;
function saveActiveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveActive, 300);
}

/* ---------- boot ---------- */

function resolveToken() {
  const url = new URL(location.href);
  const fromUrl = (url.searchParams.get("u") || "").trim();
  if (/^[\w-]{1,64}$/.test(fromUrl)) {
    api.LS.set("wt.token", fromUrl);
    return fromUrl;
  }
  const saved = api.LS.get("wt.token", null);
  if (saved && /^[\w-]{1,64}$/.test(saved)) {
    // Keep the token in the address so "Add to Home Screen" captures it.
    url.searchParams.set("u", saved);
    history.replaceState(null, "", url);
    return saved;
  }
  return null;
}

async function init() {
  S.token = resolveToken();
  if (!S.token) {
    S.view = "landing";
    render();
    return;
  }
  api.onSync(onSyncChange);
  api.startAutoFlush(S.token);
  S.boot = api.cachedBoot(S.token);
  const saved = api.LS.get(activeKey(), null);
  S.active = saved && saved.instance_id && Array.isArray(saved.exercises) && saved.exercises.length ? saved : null;
  S.view = S.boot ? (S.active ? "workout" : "home") : "loading";
  render();
  if (S.view === "workout") wake();
  await refresh();
  api.flush(S.token);
  // Keep the watch view current, and let home notice a workout starting on another phone.
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (S.view === "watch") refresh();
    else if (S.view === "home" && !S.active && Date.now() - S.fetchedAt > 60000) refresh();
  }, 15000);
}

async function refresh() {
  try {
    S.boot = await api.fetchBoot(S.token);
    S.error = null;
    S.fetchedAt = Date.now();
  } catch (e) {
    S.error = e;
    if (e.code === "unknown_link") S.boot = null;
  }
  if (!S.boot) {
    S.view = "error";
    render();
    return;
  }
  if (S.view === "loading" || S.view === "error") S.view = S.active ? "workout" : "home";
  // Never re-render under someone typing a set.
  if (S.view === "home" || S.view === "history" || S.view === "watch") render();
}

function onSyncChange() {
  // A sync moves writes from the queue into the cached copy, so re-read it.
  const cached = api.cachedBoot(S.token);
  if (cached) S.boot = cached;
  if (S.view === "home" || S.view === "done" || S.view === "history") render();
}

/* ---------- views ---------- */

function syncPill() {
  const st = api.syncStatus();
  if (!st.pending) return "";
  const label = st.syncing ? "Syncing…" : st.error ? "Saved on phone" : "Not synced yet";
  return `<button class="sync ${st.error ? "warn" : ""}" data-a="sync">${icon("cloud", 16)}<span>${label}</span></button>`;
}

function thumb(lib, name, extra = "") {
  const t = L.thumbUrl(lib.video_url);
  return `<span class="ini">${esc(L.initials(name))}</span>${t ? `<img src="${esc(t)}" alt="" loading="lazy">` : ""}${extra}`;
}

function chips(lib) {
  const p = L.splitList(lib.primary_muscles).map((m) => `<span class="chip">${esc(m)}</span>`);
  const s = L.splitList(lib.secondary_muscles).map((m) => `<span class="chip ghost">${esc(m)}</span>`);
  return p.length + s.length ? `<div class="chips">${p.join("")}${s.join("")}</div>` : "";
}

function viewLanding() {
  return `<main class="page centered">
    <div class="mark">${icon("stopwatch", 34)}</div>
    <h1 class="title">${esc(APP_NAME)}</h1>
    <p class="sub">Open the link your coach sent you to see today's workout.</p>
    <button class="btn btn-secondary" data-a="demo">Try the demo</button>
  </main>`;
}

function viewLoading() {
  return `<main class="page centered"><div class="spinner" aria-hidden="true"></div><p class="sub">Loading your plan…</p></main>`;
}

function viewError() {
  const code = S.error && S.error.code;
  const copy = {
    unknown_link: ["This link isn't recognised", "Ask your coach to send your link again."],
    not_configured: ["Not connected yet", "This app isn't linked to the training sheet yet. (Coach: add the Apps Script URL to config.js.)"],
  }[code] || ["Can't reach your plan", "Check your internet connection and try again."];
  return `<main class="page centered">
    <h1 class="title">${copy[0]}</h1>
    <p class="sub">${copy[1]}</p>
    <button class="btn btn-primary" data-a="retry">Try again</button>
  </main>`;
}

function viewHome(d) {
  const top = `<header class="bar">
    <span class="brand">${esc(APP_NAME)}</span><span class="grow"></span>${syncPill()}
    <button class="ib" data-a="history" aria-label="History">${icon("history")}</button>
  </header>`;
  const groups = d.groups;
  if (!groups.length) {
    return `${top}<main class="page"><h1 class="title">No plan yet</h1><p class="sub">Your coach hasn't added any sessions for you yet.</p></main>`;
  }
  const next = L.nextSession(groups, d.sessions);
  const done = L.finishedNumbers(d.sessions);
  const activeGroup = S.active && groups.find((x) => x.session === S.active.session);
  const g = activeGroup || groups.find((x) => x.session === S.pick) || next || groups[groups.length - 1];
  const items = g.items.map((r) => ({ name: r.exercise, lib: libFor(d, r.exercise), target: L.toTarget(r) }));
  const muscles = L.muscleSummary(items);
  const mins = L.estimateMinutes(items.map((i) => i.target));
  const tag = S.active ? "In progress" : g === next ? "Up next" : done.has(g.session) ? "Done before" : "Picked";
  const hi = d.client.name ? `Hi ${esc(d.client.name)} · ` : "";

  const complete = !next && !S.active
    ? `<div class="callout">You've done every session in this plan. Your coach will add the next block. You can repeat any session meanwhile.</div>`
    : "";

  // A workout being logged on another phone (the client's, when the coach opens their link).
  const live = S.active ? null : L.liveWorkouts(d)[0];
  const liveCard = live
    ? `<button class="livecard" data-a="watch" data-id="${esc(live.instance_id)}">
        <span class="livedot" aria-hidden="true"></span>
        <span class="livetext"><b>Workout in progress</b><small>${esc(live.session_name)} · ${plural(live.sets, "set")} · last ${esc(L.agoText(Date.now() - Date.parse(live.last)))}</small></span>
        <span class="livego">Watch ${icon("next", 18)}</span></button>`
    : "";

  const muscleCards = muscles.length
    ? `<h2 class="h2">Target Muscles</h2>
       <div class="mcards" data-keep="mcards">${muscles
         .map(
           (m) => `<div class="mcard"><div class="mfig">${muscleSvg(m.muscle)}</div>
             <div class="mtext"><div class="mname">${esc(m.muscle)}</div>
             <div class="msub">${plural(m.exercises, "exercise")}</div><div class="msub">${plural(m.sets, "set")}</div></div></div>`,
         )
         .join("")}</div>`
    : "";

  const rows = items
    .map(
      ({ name, lib, target }) => `<li class="exrow">
        <a class="thumb" href="${esc(L.videoHref(lib.video_url, name))}" target="_blank" rel="noopener" aria-label="Watch ${esc(name)}">${thumb(lib, name, `<span class="play">${icon("play", 14)}</span>`)}</a>
        <div class="exinfo">
          <div class="exname">${esc(name)}</div>
          <div class="exsub">${esc(L.planLine(target, lib.per_hand))}</div>
          ${target.note ? `<div class="exnote">${esc(target.note)}</div>` : ""}
          ${chips(lib)}
        </div>
      </li>`,
    )
    .join("");

  return `${top}
  <main class="page with-cta">
    ${liveCard}
    <p class="eyebrow">${hi}Session ${groups.indexOf(g) + 1} of ${groups.length} · ${tag}</p>
    <h1 class="title">${esc(g.name)}</h1>
    ${S.active ? "" : `<button class="linkbtn" data-a="pick">Choose a different session</button>`}
    ${complete}
    ${muscleCards}
    <div class="listhead">
      <h2 class="h2">${plural(items.length, "Exercise")}</h2>
      <p class="sub">Estimated workout time is ${mins} min</p>
    </div>
    <ul class="exlist">${rows}</ul>
    ${S.token === "demo" ? `<button class="linkbtn muted" data-a="resetDemo">Reset demo data</button>` : ""}
  </main>
  <footer class="cta">
    ${S.active
      ? `<button class="btn btn-primary" data-a="resume">Resume Workout</button>`
      : `<button class="btn btn-primary" data-a="start" data-n="${g.session}">Start Workout</button>`}
  </footer>`;
}

function viewWatch(d) {
  const rows = d.log.filter((r) => r.instance_id === S.watch);
  const finished = d.sessions.find((x) => x.instance_id === S.watch && x.finished_at);
  const top = `<header class="bar">
    <button class="ib" data-a="home" aria-label="Back">${icon("back")}</button>
    <span class="bar-title">${finished ? "Finished" : "Live"}</span><span class="ib"></span>
  </header>`;
  if (!rows.length) {
    return `${top}<main class="page"><h1 class="title">Nothing logged</h1><p class="sub">This workout was discarded or hasn't synced yet.</p></main>`;
  }
  const first = rows[0];
  const g = d.groups.find((x) => x.session === L.numOrNull(first.session));
  const w = L.liveWorkout(g, rows);
  const times = rows.map((r) => Date.parse(r.logged_at)).filter((t) => !Number.isNaN(t));
  const last = Math.max(...times);
  const sets = rows.filter((r) => r.set_type !== "W").length;
  const status = finished
    ? `Finished · ${plural(L.numOrNull(finished.duration_min) || 0, "minute")} · ${plural(sets, "set")}`
    : `${plural(sets, "set")} logged · last set ${L.agoText(Date.now() - last)}`;
  const list = w.exercises
    .map((e, i) => {
      const bw = !!libFor(d, e.name).bodyweight;
      const working = e.sets.filter((x) => x.set_type !== "W").length;
      const state = !finished && i === w.current ? "now" : e.target && working >= e.target.sets ? "done" : "";
      const label = { now: "Now", done: "Done" }[state] || (working ? `${working} of ${e.target ? e.target.sets : working}` : "");
      const sub = e.swappedFrom ? `Instead of ${e.swappedFrom}` : e.added ? "Added today" : e.target ? L.planLine(e.target) : "";
      const setsText = e.sets.length
        ? e.sets.map((x) => `${x.set_type === "W" ? "W " : ""}${L.setText(x, bw)}`).join(" · ")
        : "Not started";
      return `<li class="${state}"><span class="lhead"><span class="sname">${esc(e.name)}</span>${label ? `<span class="lstate">${esc(label)}</span>` : ""}</span>
        ${sub ? `<span class="lsub">${esc(sub)}</span>` : ""}<span class="ssets">${esc(setsText)}</span></li>`;
    })
    .join("");
  return `${top}
  <main class="page">
    <p class="eyebrow">${finished ? "Done" : `<span class="livedot" aria-hidden="true"></span> Updates every 15 seconds`}</p>
    <h1 class="title">${esc(first.session_name)}</h1>
    <p class="sub">${esc(status)}</p>
    <ul class="sumlist live">${list}</ul>
    <p class="sub small">Ticked sets show up here. Numbers typed but not ticked stay on their phone.</p>
  </main>`;
}

function restInfo() {
  const r = S.active && S.active.rest;
  if (!r) return { remaining: 0, total: 1, running: false };
  const remaining = Math.max(0, (r.endsAt - Date.now()) / 1000);
  return { remaining, total: r.total, running: remaining > 0 };
}

// Display numbers for each set: warm-ups count W1, W2…, working sets 1, 2, 3…
function numbering(ex) {
  let n = 0;
  let w = 0;
  return ex.sets.map((s) => (s.type === "W" ? ++w : ++n));
}

// Barbell warm-ups start at the empty bar.
const barKg = (lib) => (L.splitList(lib.equipment).some((q) => L.norm(q) === "barbell") ? 20 : 0);

function suggestions(ex, last, lib) {
  const bw = !!lib.bodyweight;
  const nums = numbering(ex);
  const firstWorking = L.suggest(ex.target, last, 0, bw);
  const warmups = ex.sets.filter((s) => s.type === "W").length;
  return ex.sets.map((s, i) =>
    s.type === "W"
      ? L.suggestWarmup(firstWorking, bw, nums[i] - 1, warmups, barKg(lib))
      : L.suggest(ex.target, last, nums[i] - 1, bw),
  );
}

function viewWorkout(d) {
  const a = S.active;
  const ex = cur();
  const lib = libFor(d, ex.name);
  const bw = !!lib.bodyweight;
  const showRir = d.client.show_rir;
  const last = L.lastPerformance(d.log, ex.name, a.instance_id);
  const nums = numbering(ex);
  const sugg = suggestions(ex, last, lib);
  const working = ex.sets.filter((s) => s.type === "N");
  const doneN = working.filter((s) => s.done).length;
  const wCount = ex.sets.length - working.length;
  const allDone = ex.sets.length > 0 && ex.sets.every((s) => s.done);
  const label = !working.length
    ? "No working sets"
    : doneN >= working.length
      ? `All ${working.length} sets done`
      : `Set ${doneN + 1} of ${working.length}`;
  const rest = restInfo();
  const nudge = showRir ? L.rirNudge(ex.target, ex.sets, last, bw) : null;
  const grid = `grid${bw ? " no-kg" : ""}${showRir ? "" : " no-rir"}`;

  const strip = a.exercises
    .map((e, i) => {
      const w = e.sets.filter((s) => s.type === "N");
      const complete = w.length > 0 && w.every((s) => s.done);
      return `<button class="tile${i === a.idx ? " on" : ""}${complete ? " complete" : ""}" data-a="go" data-i="${i}" aria-label="${esc(e.name)}${complete ? ", done" : ""}">
        <span class="tthumb">${thumb(libFor(d, e.name), e.name, complete ? `<span class="tdone">${icon("check", 18)}</span>` : "")}</span>
        <span class="tbar"></span></button>`;
    })
    .join("") +
    `<button class="tile" data-a="addEx" aria-label="Add an exercise"><span class="tthumb addthumb">${icon("plus", 26)}</span><span class="tbar hidden"></span></button>`;

  const sup = L.supersetOf(a.exercises, a.idx);
  const partner = sup && (a.idx < sup.to ? a.idx + 1 : sup.from);
  const superset = sup
    ? `<button class="swapnote" data-a="go" data-i="${partner}">${icon("swap", 16)}<span>Superset with ${esc(a.exercises[partner].name)}</span></button>`
    : "";

  const rows = ex.sets
    .map((s, i) => {
      const sg = sugg[i];
      let col;
      let muted = false;
      if (s.type === "W") {
        col = sg.kg !== "" ? `${sg.kg} kg × ${sg.reps}` : "Warm-up";
      } else if (ex.showLast) {
        const p = last && last.sets[nums[i] - 1];
        col = p ? L.setText(p, bw) : "—";
        muted = !p;
      } else {
        col = L.targetText(ex.target, bw);
        muted = col === "No target";
      }
      const n = s.type === "W" ? "W" : nums[i];
      const rirCell = showRir
        ? `<button class="cell rir" data-a="rir" data-si="${i}" aria-label="Set ${n} reps in reserve">${
            s.rir !== "" ? esc(s.rir === "5" ? "5+" : s.rir) : `<span class="ph">${esc(s.type === "W" ? "–" : L.rirFor(ex.target, nums[i]) || "–")}</span>`
          }</button>`
        : "";
      return `<div class="srow ${grid}${s.done ? " done" : ""}">
        <button class="badge${s.type === "W" ? " w" : ""}" data-a="setmenu" data-si="${i}" aria-label="Set ${n} options">${n}</button>
        <div class="tgt${muted ? " muted" : ""}">${col.split(" × ").map((p, j) => `<span>${j ? "× " : ""}${esc(p)}</span>`).join(" ")}</div>
        ${bw ? "" : `<input class="cell" data-f="kg" data-si="${i}" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="${esc(sg.kg)}" value="${esc(s.kg)}" aria-label="Set ${n} kilograms${lib.per_hand ? " per hand" : ""}">`}
        <input class="cell" data-f="reps" data-si="${i}" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="${esc(sg.reps)}" value="${esc(s.reps)}" aria-label="Set ${n} reps">
        ${rirCell}
        <button class="chk${s.done ? " on" : ""}" data-a="tick" data-si="${i}" aria-pressed="${s.done}" aria-label="Set ${n} done">${s.done ? icon("check", 20) : ""}</button>
      </div>`;
    })
    .join("");

  const isLast = a.idx === a.exercises.length - 1;
  const everything = a.exercises.every((e) => e.sets.every((s) => s.done));
  const ctaPrimary = isLast ? everything : allDone;

  return `<header class="wbar">
    <button class="ib" data-a="menu" aria-label="Workout menu">${icon("menu")}</button>
    <span class="elapsed" data-elapsed>${L.fmtElapsed(Date.now() - Date.parse(a.started_at))}</span>
    <span class="grow"></span>
    <button class="restbtn${rest.running ? " on" : ""}" data-a="rest" aria-label="Rest timer">
      ${icon("stopwatch", 22)}<span class="restclock" data-rest>${L.fmtClock(rest.remaining)}</span>
      <span class="restbar"><i data-restbar style="width:${rest.running ? (rest.remaining / rest.total) * 100 : 0}%"></i></span>
    </button>
  </header>
  <nav class="strip" data-keep="strip" aria-label="Exercises">${strip}</nav>
  <main class="page with-cta">
    <h1 class="extitle">${esc(ex.name)}</h1>
    <p class="setlabel">${label}</p>
    ${nudge ? `<p class="nudge ${nudge.tone}" role="status">${esc(nudge.text)}</p>` : ""}
    ${ex.swappedFrom ? `<button class="swapnote" data-a="swap">${icon("swap", 16)}<span>Instead of ${esc(ex.swappedFrom)}</span></button>` : ""}
    ${superset}
    ${ex.target.note ? `<div class="callout small">${esc(ex.target.note)}</div>` : ""}
    <div class="pills" data-keep="pills">
      <a class="pill" href="${esc(L.videoHref(lib.video_url, ex.name))}" target="_blank" rel="noopener">${icon("play", 18)}<span>Video</span></a>
      <button class="pill" data-a="info">${icon("info", 18)}<span>Info</span></button>
      <button class="pill" data-a="warmup">${wCount ? `<span class="count">${wCount}</span>` : icon("warm", 18)}<span>Warm Up</span></button>
      <button class="pill${ex.swappedFrom ? " has" : ""}" data-a="swap">${icon("swap", 18)}<span>Swap</span></button>
      <button class="pill${ex.note ? " has" : ""}" data-a="note">${icon("note", 18)}<span>Note</span></button>
    </div>
    <div class="table">
      <div class="shead ${grid}">
        <span>Set</span>
        <button class="tgl" data-a="toggleLast" aria-label="Switch between target and last time">${ex.showLast ? "Last" : "Target"} ${icon("swap", 18)}</button>
        ${bw ? "" : `<span>${lib.per_hand ? "kg/hand" : "kg"}</span>`}
        <span>Reps</span>
        ${showRir ? "<span>RIR</span>" : ""}
        <button class="chk${allDone ? " on" : ""}" data-a="tickAll" aria-label="Tick every set">${allDone ? icon("check", 20) : ""}</button>
      </div>
      ${rows}
    </div>
    <button class="addset" data-a="addset" aria-label="Add a set">${icon("plus")}</button>
  </main>
  <footer class="cta">
    <button class="btn ${ctaPrimary ? "btn-primary" : "btn-secondary"}" data-a="${isLast ? "finish" : "next"}">
      <span class="ell">${isLast ? "Finish Workout" : `Next: ${esc(a.exercises[a.idx + 1].name)}`}</span>${icon("next", 20)}
    </button>
  </footer>`;
}

function summarize(a) {
  let sets = 0;
  let volume = 0;
  let unticked = 0;
  const lines = [];
  for (const e of a.exercises) {
    const done = e.sets.filter((s) => s.done && s.type === "N");
    unticked += e.sets.filter((s) => !s.done && s.type === "N").length;
    sets += done.length;
    for (const s of done) volume += (L.numOrNull(s.kg) || 0) * (L.numOrNull(s.reps) || 0);
    if (done.length) lines.push({ name: e.name, sets: done });
  }
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(a.started_at)) / 60000));
  return { sets, volume: Math.round(volume), unticked, lines, minutes };
}

function stats(sum) {
  return `<div class="stats">
    <div><b>${sum.minutes}</b><span>minutes</span></div>
    <div><b>${sum.sets}</b><span>sets</span></div>
    <div><b>${sum.volume.toLocaleString("en-IN")}</b><span>kg lifted</span></div>
  </div>`;
}

function viewFinish(d) {
  const a = S.active;
  const sum = summarize(a);
  const name = d.client.name ? `, ${esc(d.client.name)}` : "";
  const bwFor = (n) => !!libFor(d, n).bodyweight;
  return `<header class="bar">
    <button class="ib" data-a="backToWorkout" aria-label="Back to workout">${icon("back")}</button>
    <span class="bar-title">Finish</span><span class="ib"></span>
  </header>
  <main class="page with-cta">
    <h1 class="title">${sum.sets ? `Nice work${name}` : "Nothing ticked yet"}</h1>
    <p class="sub">${esc(a.session_name)}</p>
    ${stats(sum)}
    ${sum.unticked
      ? `<div class="callout warn">${plural(sum.unticked, "planned set")} not ticked. Unticked sets aren't saved.
          <button class="linkbtn" data-a="logAll">Log ${sum.unticked === 1 ? "it" : "them"} with the numbers shown</button></div>`
      : ""}
    <ul class="sumlist">${sum.lines
      .map((l) => `<li><span class="sname">${esc(l.name)}</span><span class="ssets">${l.sets.map((s) => esc(L.setText(s, bwFor(l.name)))).join(" · ")}</span></li>`)
      .join("")}</ul>
    ${sum.sets
      ? `<label class="lbl" for="fnote">How did it go?</label>
         <textarea id="fnote" class="ta" data-f="finishNote" rows="3" maxlength="1000" placeholder="Energy, any pain, anything your coach should know">${esc(S.finishNote)}</textarea>`
      : `<p class="sub">Tick each set as you finish it. If you're stopping, you can discard this workout.</p>`}
  </main>
  <footer class="cta">
    ${sum.sets
      ? `<button class="btn btn-primary" data-a="finishSave">Finish &amp; Save</button>`
      : `<button class="btn btn-secondary" data-a="discardYes">Discard workout</button>`}
  </footer>`;
}

function syncLine() {
  const st = api.syncStatus();
  if (S.token === "demo") return "Demo mode: saved on this device only.";
  if (!st.pending) return "Your coach can see this session.";
  if (st.syncing) return "Sending to your coach…";
  return "Saved on this phone. It'll send by itself when you're back online.";
}

function viewDone() {
  const s = S.done;
  return `<main class="page centered">
    <div class="donecheck">${icon("check", 40)}</div>
    <h1 class="title">Workout saved</h1>
    <p class="sub">${esc(s.session_name)}</p>
    ${stats(s)}
    <p class="sub syncline">${esc(syncLine())}</p>
    <button class="btn btn-primary" data-a="home">Done</button>
  </main>`;
}

function viewHistory(d) {
  const list = L.history(d);
  const body = list.length
    ? list
        .map((h) => {
          const open = S.open.has(h.instance_id);
          const working = h.exercises.reduce((n, e) => n + e.sets.filter((s) => s.set_type !== "W").length, 0);
          const detail = open
            ? `<div class="hbody">${h.exercises
                .map((e) => {
                  const bw = !!libFor(d, e.name).bodyweight;
                  const from = (e.sets.find((x) => x.swapped_from) || {}).swapped_from;
                  return `<div class="hex"><div class="hexname">${esc(e.name)}${from ? ` <span class="hswap">instead of ${esc(from)}</span>` : ""}</div>${e.sets
                    .map((s) => `<div class="hset"><span class="hb${s.set_type === "W" ? " w" : ""}">${s.set_type === "W" ? "W" : esc(s.set_no)}</span>${esc(L.setText(s, bw))}</div>`)
                    .join("")}</div>`;
                })
                .join("")}${h.note ? `<div class="callout small">${esc(h.note)}</div>` : ""}</div>`
            : "";
          return `<article class="hcard">
            <button class="hhead" data-a="toggleHist" data-id="${esc(h.instance_id)}" aria-expanded="${open}">
              <span><span class="hname">${esc(h.session_name)}</span>
              <span class="hsub">${esc(L.fmtDay(h.date))} · ${esc(h.duration_min)} min · ${plural(working, "set")}</span></span>
              <span class="chev${open ? " up" : ""}">${icon("back", 20)}</span>
            </button>${detail}</article>`;
        })
        .join("")
    : `<p class="sub">No finished workouts yet.</p>`;
  return `<header class="bar">
    <button class="ib" data-a="home" aria-label="Back">${icon("back")}</button>
    <span class="bar-title">History</span>${syncPill() || '<span class="ib"></span>'}
  </header>
  <main class="page">${body}</main>`;
}

/* ---------- bottom sheets ---------- */

const RIR_LABELS = ["No more", "1 more", "2 more", "3 more", "4 more", "Easy"];

const SHEETS = {
  pick() {
    const d = data();
    const next = L.nextSession(d.groups, d.sessions);
    const done = L.finishedNumbers(d.sessions);
    return `<h2 class="sh-title">Choose a session</h2><div class="sh-list">${d.groups
      .map(
        (g) => `<button class="sh-item" data-a="pickSession" data-n="${g.session}">
          <span><b>${esc(g.name)}</b><small>${plural(g.items.length, "exercise")}</small></span>
          <span class="muted">${g === next ? "Up next" : done.has(g.session) ? "Done" : ""}</span></button>`,
      )
      .join("")}</div>`;
  },
  rir() {
    const ex = cur();
    const s = ex.sets[S.sheet.si];
    const n = numbering(ex)[S.sheet.si];
    const goal = s.type === "W" ? "" : L.rirFor(ex.target, n);
    return `<h2 class="sh-title">Reps in reserve</h2>
      <p class="sh-sub">Set ${s.type === "W" ? "W" : n}: how many more reps could you have done with good form?</p>
      ${goal ? `<p class="sh-sub">Your coach's target: <b>${esc(goal)}</b></p>` : ""}
      <div class="rirgrid">${RIR_LABELS.map(
        (lab, v) => `<button class="rirbtn${s.rir === String(v) ? " on" : ""}" data-a="setRir" data-v="${v}"><b>${v === 5 ? "5+" : v}</b><span>${lab}</span></button>`,
      ).join("")}</div>
      <button class="btn btn-secondary" data-a="setRir" data-v="">${s.rir !== "" ? "Clear" : "Skip"}</button>`;
  },
  setmenu() {
    const ex = cur();
    const s = ex.sets[S.sheet.si];
    const n = numbering(ex)[S.sheet.si];
    return `<h2 class="sh-title">${s.type === "W" ? `Warm-up set ${n}` : `Set ${n}`}</h2>
      <div class="sh-list">
        <button class="sh-item" data-a="toggleType">${s.type === "W" ? "Make it a working set" : "Make it a warm-up set"}</button>
        <button class="sh-item danger" data-a="deleteSet">Delete this set</button>
      </div>
      <button class="btn btn-secondary" data-a="closeSheet">Cancel</button>`;
  },
  info() {
    const d = data();
    const ex = cur();
    const lib = libFor(d, ex.name);
    const bw = !!lib.bodyweight;
    const perfs = L.performances(d.log, ex.name, S.active.instance_id).slice(0, 4);
    return `<h2 class="sh-title">${esc(ex.name)}</h2>
      <p class="sh-sub">${esc(L.planLine(ex.target, lib.per_hand))} · rest ${L.fmtClock(ex.target.rest)}</p>
      ${ex.target.note ? `<div class="callout"><b>From your coach</b><br>${esc(ex.target.note)}</div>` : ""}
      ${lib.cues ? `<h3 class="sh-h">How to</h3><p class="sh-p">${esc(lib.cues)}</p>` : ""}
      ${chips(lib)}
      <h3 class="sh-h">Recent</h3>
      ${perfs.length
        ? perfs.map((p) => `<div class="perf"><span class="pd">${esc(L.fmtDay(p.date))}</span><span>${p.sets.map((s) => esc(L.setText(s, bw))).join(" · ")}</span></div>`).join("")
        : `<p class="sh-p muted">Nothing logged yet.</p>`}
      <a class="btn btn-secondary" href="${esc(L.videoHref(lib.video_url, ex.name))}" target="_blank" rel="noopener">${icon("play", 18)} Watch video</a>`;
  },
  note() {
    const ex = cur();
    return `<h2 class="sh-title">Note for your coach</h2>
      <p class="sh-sub">${esc(ex.name)}</p>
      <textarea class="ta" data-f="exnote" rows="4" maxlength="1000" placeholder="How did it feel? Any pain, or anything to change?">${esc(ex.note)}</textarea>
      <button class="btn btn-primary" data-a="closeSheet">Done</button>`;
  },
  rest() {
    const r = restInfo();
    if (r.running) {
      return `<h2 class="sh-title">Rest</h2>
        <div class="bigclock" data-rest>${L.fmtClock(r.remaining)}</div>
        <div class="sh-row"><button class="btn btn-secondary" data-a="restAdj" data-v="-15">−15s</button>
        <button class="btn btn-secondary" data-a="restAdj" data-v="15">+15s</button></div>
        <button class="btn btn-primary" data-a="restSkip">Skip rest</button>`;
    }
    return `<h2 class="sh-title">Start a rest timer</h2>
      <div class="sh-row">${[60, 90, 120, 180]
        .map((v) => `<button class="btn btn-secondary" data-a="restStart" data-v="${v}">${L.fmtClock(v)}</button>`)
        .join("")}</div>`;
  },
  swap() {
    const ex = cur();
    const planned = ex.swappedFrom || ex.name;
    if (ex.sets.some((s) => s.done)) {
      return `<h2 class="sh-title">Swap exercise</h2>
        <p class="sh-sub">You've ticked sets on ${esc(ex.name)}. Untick them first if you want to swap it.</p>
        <button class="btn btn-secondary" data-a="closeSheet">OK</button>`;
    }
    return `<h2 class="sh-title">Swap ${esc(planned)}</h2>
      <input class="search" data-f="swapq" type="search" placeholder="Search every exercise" value="${esc(S.sheet.q || "")}" autocomplete="off" aria-label="Search every exercise">
      <div class="swapbody">${swapBody()}</div>`;
  },
  add() {
    return `<h2 class="sh-title">Add an exercise</h2>
      <input class="search" data-f="addq" type="search" placeholder="Search name, muscle or equipment" value="${esc(S.sheet.q || "")}" autocomplete="off" aria-label="Search exercises">
      <div class="swaplist addlist">${addList()}</div>`;
  },
  menu() {
    const a = S.active;
    return `<h2 class="sh-title">${esc(a.session_name)}</h2>
      <div class="sh-list">${a.exercises
        .map((e, i) => {
          const w = e.sets.filter((s) => s.type === "N");
          return `<button class="sh-item${i === a.idx ? " on" : ""}" data-a="go" data-i="${i}"><span>${esc(e.name)}</span>
            <span class="muted">${w.filter((s) => s.done).length}/${w.length}</span></button>`;
        })
        .join("")}</div>
      <button class="btn btn-primary" data-a="finish">Finish Workout</button>
      ${S.sheet.confirm
        ? `<p class="sh-sub">Discard this workout? Sets you've ticked will be deleted.</p>
           <div class="sh-row"><button class="btn btn-secondary" data-a="closeSheet">Keep going</button>
           <button class="btn btn-danger" data-a="discardYes">Discard</button></div>`
        : `<button class="btn btn-ghost danger" data-a="discard">Discard workout</button>`}`;
  },
};

function libItem(e, action, on = false) {
  const sub = [L.splitList(e.equipment).join(", "), L.splitList(e.primary_muscles).join(", ")].filter(Boolean).join(" · ");
  return `<button class="swapitem${on ? " on" : ""}" data-a="${action}" data-name="${esc(e.exercise)}">
    <span class="sthumb">${thumb(e, e.exercise)}</span>
    <span class="swaptext"><b>${esc(e.exercise)}</b><small>${esc(sub)}</small></span>${on ? icon("check", 20) : ""}</button>`;
}

// Anything typed that isn't a library name can still be used, logged under that name.
function customItem(q, action, found) {
  const name = L.customName(q);
  if (!name || found.some((e) => L.norm(e.exercise) === L.norm(name))) return "";
  return `<button class="swapitem custom" data-a="${action}" data-name="${esc(name)}">
    <span class="sthumb">${icon("plus", 22)}</span>
    <span class="swaptext"><b>Use “${esc(name)}”</b><small>Not in the library: logged under this name</small></span></button>`;
}

// Search results for a sheet's search box: library matches, then the typed name itself.
function searchItems(action, isOn = () => false) {
  const d = data();
  const q = S.sheet.q || "";
  const found = L.searchLibrary(d.exercises, q);
  const custom = customItem(q, action, found);
  if (!found.length && !custom) return `<p class="sh-p muted">Type a name to search. Your coach can add exercises in the Exercises tab.</p>`;
  return found.map((e) => libItem(e, action, isOn(e))).join("") + custom;
}

// The swap sheet under its search box: search results while typing, otherwise the coach's
// picks and same-movement exercises with the equipment filter.
function swapBody() {
  const d = data();
  const ex = cur();
  const planned = ex.swappedFrom || ex.name;
  const isOn = (e) => L.norm(e.exercise) === L.norm(ex.name);
  if (L.customName(S.sheet.q)) return `<div class="swaplist">${searchItems("swapTo", isOn)}</div>`;
  const missing = new Set(S.sheet.missing || []);
  const { picks, same } = L.swapCandidates(planned, d.exercises, missing);
  const gear = L.swapEquipment(planned, d.exercises);
  const item = (e) => libItem(e, "swapTo", isOn(e));
  const chips = gear.length
    ? `<p class="sh-sub">Not available today?</p><div class="eqchips">${gear
        .map((g) => `<button class="eqchip${missing.has(g) ? " on" : ""}" data-a="swapMissing" data-v="${esc(g)}" aria-pressed="${missing.has(g)}">${esc(g[0].toUpperCase() + g.slice(1))}</button>`)
        .join("")}</div>`
    : "";
  const back = ex.swappedFrom
    ? `<button class="swapitem back" data-a="swapTo" data-name="${esc(planned)}"><span class="sthumb">${thumb(libFor(d, planned), planned)}</span>
        <span class="swaptext"><b>Back to ${esc(planned)}</b><small>The planned exercise</small></span></button>`
    : "";
  const none = !picks.length && !same.length
    ? `<p class="sh-p muted">${missing.size ? "Nothing left without that equipment. Untick one, or search above." : "No suggestions for this one. Search above for any exercise."}</p>`
    : "";
  return `${chips}${back}
    ${picks.length ? `<h3 class="sh-h">Coach's picks</h3><div class="swaplist">${picks.map(item).join("")}</div>` : ""}
    ${same.length ? `<h3 class="sh-h">${picks.length ? "Also works" : "Same movement"}</h3><div class="swaplist">${same.map(item).join("")}</div>` : ""}${none}`;
}

function addList() {
  return searchItems("addTo");
}

function renderSheet() {
  if (!S.sheet) {
    $sheet.hidden = true;
    $sheet.innerHTML = "";
    document.body.classList.remove("sheet-open");
    return;
  }
  $sheet.innerHTML = `<div class="backdrop" data-a="closeSheet"></div>
    <div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>${SHEETS[S.sheet.type]()}</div>`;
  $sheet.hidden = false;
  document.body.classList.add("sheet-open");
}

function openSheet(sheet) {
  S.sheet = sheet;
  renderSheet();
  const f = $sheet.querySelector("textarea");
  if (f) f.focus();
}

function closeSheet() {
  S.sheet = null;
  renderSheet();
}

/* ---------- render ---------- */

function render() {
  const keep = {};
  $app.querySelectorAll("[data-keep]").forEach((el) => (keep[el.dataset.keep] = el.scrollLeft));
  if ((S.view === "workout" || S.view === "finish") && !S.active) S.view = "home";
  const d = S.boot ? data() : null;
  const html = {
    landing: viewLanding,
    loading: viewLoading,
    error: viewError,
    home: () => viewHome(d),
    workout: () => viewWorkout(d),
    finish: () => viewFinish(d),
    done: viewDone,
    history: () => viewHistory(d),
    watch: () => viewWatch(d),
  }[S.view]();
  $app.innerHTML = html;
  $app.querySelectorAll("[data-keep]").forEach((el) => {
    if (keep[el.dataset.keep] != null) el.scrollLeft = keep[el.dataset.keep];
  });
  document.body.dataset.view = S.view;
  renderSheet();
}

function scrollTop() {
  window.scrollTo(0, 0);
}

function centerTile() {
  const strip = $app.querySelector(".strip");
  const tile = strip && strip.querySelector(".tile.on");
  if (tile) strip.scrollLeft = tile.offsetLeft - (strip.clientWidth - tile.clientWidth) / 2;
}

let toastTimer;
function toast(msg, ms = 2400) {
  $toast.textContent = msg;
  $toast.classList.toggle("long", msg.length > 32);
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), ms);
}

/* ---------- workout actions ---------- */

function newSet(type) {
  return { id: S.active.nextSetId++, type, kg: "", reps: "", rir: "", done: false, at: "" };
}

function startWorkout(n) {
  const d = data();
  const g = d.groups.find((x) => x.session === n);
  if (!g) return;
  const now = new Date();
  S.active = {
    instance_id: L.newId(),
    session: g.session,
    session_name: g.name,
    date: L.localDate(now),
    started_at: now.toISOString(),
    idx: 0,
    rest: null,
    nextSetId: 1,
    exercises: [],
  };
  S.active.exercises = g.items.map((r) => {
    const target = L.toTarget(r);
    const sets = [];
    for (let i = 0; i < target.warmup; i++) sets.push(newSet("W"));
    for (let i = 0; i < target.sets; i++) sets.push(newSet("N"));
    return { name: r.exercise, target, sets, note: "", showLast: false };
  });
  S.finishNote = "";
  saveActive();
  unlockAudio();
  S.view = "workout";
  render();
  scrollTop();
  wake();
}

const entryId = (exIdx, s) => `${S.active.instance_id}.${exIdx}.${s.id}`;

function setOps(exIdx) {
  const a = S.active;
  const ex = a.exercises[exIdx];
  const nums = numbering(ex);
  return ex.sets
    .map((s, i) => ({ s, no: nums[i] }))
    .filter(({ s }) => s.done)
    .map(({ s, no }) => ({
      type: "set",
      entry_id: entryId(exIdx, s),
      instance_id: a.instance_id,
      date: a.date,
      logged_at: s.at,
      session: a.session,
      session_name: a.session_name,
      exercise: ex.name,
      set_type: s.type,
      set_no: no,
      kg: s.kg,
      reps: s.reps,
      rir: s.rir,
      swapped_from: ex.swappedFrom || "",
    }));
}

let flushTimer;
function flushSoon() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => api.flush(S.token), 1500);
}

function queueExercise(exIdx) {
  const ops = setOps(exIdx);
  if (ops.length) api.enqueue(S.token, ops);
  flushSoon();
}

let queueTimer;
function queueExerciseSoon(exIdx) {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(() => queueExercise(exIdx), 800);
}

function removeSet(exIdx, si) {
  const ex = S.active.exercises[exIdx];
  const s = ex.sets[si];
  if (s.done) api.enqueue(S.token, { type: "delete_set", entry_id: entryId(exIdx, s) });
  ex.sets.splice(si, 1);
  queueExercise(exIdx); // renumbers the sets still ticked
}

function startRest(sec) {
  if (!sec || sec <= 0) return;
  S.active.rest = { endsAt: Date.now() + sec * 1000, total: sec, fired: false };
}

// Fill empty boxes from the suggestion; returns the field still missing, if any.
function commitSuggestion(ex, si, d) {
  const lib = libFor(d, ex.name);
  const bw = !!lib.bodyweight;
  const last = L.lastPerformance(d.log, ex.name, S.active.instance_id);
  const sg = suggestions(ex, last, lib)[si];
  const s = ex.sets[si];
  if (!bw && s.kg === "") s.kg = sg.kg;
  if (s.reps === "") s.reps = sg.reps;
  if (!bw && s.kg === "") return "kg";
  if (s.reps === "") return "reps";
  return null;
}

function focusCell(si, f) {
  const el = $app.querySelector(`input[data-si="${si}"][data-f="${f}"]`);
  if (el) {
    el.focus();
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 400);
  }
}

const A = {
  demo() {
    location.href = `${location.pathname}?u=demo`;
  },
  retry() {
    S.view = "loading";
    render();
    refresh();
  },
  resetDemo() {
    api.resetDemo();
    location.reload();
  },
  sync() {
    api.flush(S.token).then((ok) => toast(ok ? "All synced" : "Still offline. It'll retry by itself."));
  },
  history() {
    S.view = "history";
    render();
    scrollTop();
  },
  watch(el) {
    S.watch = el.dataset.id;
    S.view = "watch";
    render();
    scrollTop();
    refresh();
  },
  addEx() {
    openSheet({ type: "add", q: "" });
  },
  addTo(el) {
    const a = S.active;
    // Not in the plan: no target, so suggestions come from this exercise's own history.
    const target = L.toTarget({ sets: 3 });
    const sets = [newSet("N"), newSet("N"), newSet("N")];
    a.exercises.push({ name: el.dataset.name, target, sets, note: "", showLast: false, added: true });
    a.idx = a.exercises.length - 1;
    saveActive();
    S.sheet = null;
    render();
    scrollTop();
    centerTile();
    toast(`Added ${el.dataset.name}`);
  },
  home() {
    S.view = "home";
    S.done = null;
    render();
    scrollTop();
    if (Date.now() - S.fetchedAt > 60000) refresh();
  },
  toggleHist(el) {
    const id = el.dataset.id;
    if (S.open.has(id)) S.open.delete(id);
    else S.open.add(id);
    render();
  },
  pick() {
    openSheet({ type: "pick" });
  },
  pickSession(el) {
    S.pick = Number(el.dataset.n);
    closeSheet();
    render();
    scrollTop();
  },
  start(el) {
    startWorkout(Number(el.dataset.n));
  },
  resume() {
    S.view = "workout";
    render();
    scrollTop();
    centerTile();
    wake();
  },
  go(el) {
    S.active.idx = Number(el.dataset.i);
    saveActive();
    S.sheet = null;
    S.view = "workout";
    render();
    scrollTop();
    centerTile();
  },
  next() {
    if (S.active.idx < S.active.exercises.length - 1) S.active.idx += 1;
    saveActive();
    render();
    scrollTop();
    centerTile();
  },
  menu() {
    openSheet({ type: "menu" });
  },
  rest() {
    unlockAudio();
    openSheet({ type: "rest" });
  },
  restAdj(el) {
    const r = S.active.rest;
    if (!r) return;
    const delta = Number(el.dataset.v) * 1000;
    r.endsAt += delta;
    r.total = Math.max(1, r.total + delta / 1000);
    saveActive();
    tickTimers();
  },
  restSkip() {
    S.active.rest = null;
    saveActive();
    closeSheet();
    render();
  },
  restStart(el) {
    startRest(Number(el.dataset.v));
    saveActive();
    render();
    openSheet({ type: "rest" });
  },
  info() {
    openSheet({ type: "info" });
  },
  note() {
    openSheet({ type: "note" });
  },
  swap() {
    openSheet({ type: "swap", missing: [] });
  },
  swapMissing(el) {
    const v = el.dataset.v;
    const m = S.sheet.missing;
    const i = m.indexOf(v);
    if (i >= 0) m.splice(i, 1);
    else m.push(v);
    renderSheet();
  },
  // Swaps are for this workout only: the plan in the Sheet is untouched.
  swapTo(el) {
    const ex = cur();
    const name = el.dataset.name;
    if (ex.sets.some((s) => s.done)) return;
    const planned = ex.swappedFrom || ex.name;
    if (L.norm(name) !== L.norm(ex.name)) {
      if (L.norm(name) === L.norm(planned)) {
        ex.name = planned;
        ex.target = { ...ex.target, kg: ex.plannedKg ?? null };
        delete ex.swappedFrom;
        delete ex.plannedKg;
      } else {
        if (!ex.swappedFrom) {
          ex.swappedFrom = ex.name;
          ex.plannedKg = ex.target.kg;
        }
        ex.name = name;
        // The planned load was for the planned exercise; suggestions come from this one's history instead.
        ex.target = { ...ex.target, kg: null };
      }
      ex.sets.forEach((s) => Object.assign(s, { kg: "", reps: "", rir: "" }));
      ex.showLast = false;
      saveActive();
      toast(ex.swappedFrom ? `Swapped to ${ex.name}` : `Back to ${ex.name}`);
    }
    S.sheet = null;
    render();
  },
  warmup() {
    const ex = cur();
    const at = ex.sets.filter((s) => s.type === "W").length;
    ex.sets.splice(at, 0, newSet("W"));
    queueExercise(S.active.idx);
    saveActive();
    render();
  },
  addset() {
    cur().sets.push(newSet("N"));
    saveActive();
    render();
  },
  toggleLast() {
    const ex = cur();
    ex.showLast = !ex.showLast;
    saveActive();
    render();
  },
  tick(el) {
    unlockAudio();
    const d = data();
    const si = Number(el.dataset.si);
    const ex = cur();
    const s = ex.sets[si];
    if (s.done) {
      s.done = false;
      api.enqueue(S.token, { type: "delete_set", entry_id: entryId(S.active.idx, s) });
      queueExercise(S.active.idx);
      saveActive();
      render();
      return;
    }
    const missing = commitSuggestion(ex, si, d);
    if (missing) {
      saveActive();
      render();
      focusCell(si, missing);
      toast(missing === "kg" ? "Enter the weight first" : "Enter your reps first");
      return;
    }
    s.done = true;
    s.at = new Date().toISOString();
    queueExercise(S.active.idx);
    startRest(L.restFor(S.active.exercises, S.active.idx));
    saveActive();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    render();
    if (d.client.show_rir && s.type === "N" && s.rir === "") openSheet({ type: "rir", si });
  },
  tickAll() {
    const d = data();
    const ex = cur();
    if (ex.sets.length && ex.sets.every((s) => s.done)) return;
    for (let si = 0; si < ex.sets.length; si++) {
      const s = ex.sets[si];
      if (s.done) continue;
      const missing = commitSuggestion(ex, si, d);
      if (missing) {
        saveActive();
        render();
        focusCell(si, missing);
        toast("Fill in the empty boxes first");
        return;
      }
      s.done = true;
      s.at = new Date().toISOString();
    }
    queueExercise(S.active.idx);
    startRest(L.restFor(S.active.exercises, S.active.idx));
    saveActive();
    render();
  },
  rir(el) {
    openSheet({ type: "rir", si: Number(el.dataset.si) });
  },
  setRir(el) {
    const ex = cur();
    const s = ex.sets[S.sheet.si];
    s.rir = el.dataset.v;
    if (s.done) queueExercise(S.active.idx);
    saveActive();
    S.sheet = null;
    render();
    // The same line sits under the set count, but that can be scrolled out of view by now.
    if (s.done && s.type === "N" && s.rir !== "") {
      const d = data();
      const n = L.rirNudge(ex.target, ex.sets, L.lastPerformance(d.log, ex.name, S.active.instance_id), !!libFor(d, ex.name).bodyweight);
      if (n) toast(n.text, 4000);
    }
  },
  setmenu(el) {
    openSheet({ type: "setmenu", si: Number(el.dataset.si) });
  },
  toggleType() {
    const ex = cur();
    const si = S.sheet.si;
    const [s] = ex.sets.splice(si, 1);
    s.type = s.type === "W" ? "N" : "W";
    // Warm-ups sit at the top, working sets after them.
    const at = s.type === "W" ? ex.sets.filter((x) => x.type === "W").length : ex.sets.length;
    ex.sets.splice(at, 0, s);
    queueExercise(S.active.idx);
    saveActive();
    S.sheet = null;
    render();
  },
  deleteSet() {
    removeSet(S.active.idx, S.sheet.si);
    saveActive();
    S.sheet = null;
    render();
  },
  finish() {
    S.sheet = null;
    S.view = "finish";
    render();
    scrollTop();
  },
  // Ticks every working set left, using what's typed or suggested; sets with nothing to go on stay.
  logAll() {
    const d = data();
    const at = new Date().toISOString();
    let logged = 0;
    let blank = 0;
    S.active.exercises.forEach((ex, i) => {
      let changed = false;
      ex.sets.forEach((s, si) => {
        if (s.done || s.type !== "N") return;
        if (commitSuggestion(ex, si, d)) {
          blank += 1;
          return;
        }
        Object.assign(s, { done: true, at });
        logged += 1;
        changed = true;
      });
      if (changed) queueExercise(i);
    });
    saveActive();
    render();
    toast(blank ? `Logged ${plural(logged, "set")}. ${plural(blank, "set")} had no numbers to use.` : `Logged ${plural(logged, "set")}`, 3500);
  },
  backToWorkout() {
    S.view = "workout";
    render();
    centerTile();
  },
  finishSave() {
    const a = S.active;
    a.exercises.forEach((_, i) => {
      const ops = setOps(i);
      if (ops.length) api.enqueue(S.token, ops);
    });
    const sum = summarize(a);
    const exNotes = a.exercises.filter((e) => e.note.trim()).map((e) => `${e.name}: ${e.note.trim()}`);
    const finished = new Date();
    api.enqueue(S.token, {
      type: "finish",
      instance_id: a.instance_id,
      session: a.session,
      session_name: a.session_name,
      date: a.date,
      started_at: a.started_at,
      finished_at: finished.toISOString(),
      duration_min: sum.minutes,
      sets_done: sum.sets,
      note: [S.finishNote.trim(), ...exNotes].filter(Boolean).join("\n"),
    });
    S.done = { ...sum, session_name: a.session_name };
    S.active = null;
    api.LS.del(activeKey());
    S.finishNote = "";
    S.pick = null;
    sleep();
    S.view = "done";
    render();
    scrollTop();
    api.flush(S.token);
  },
  discard() {
    S.sheet.confirm = true;
    renderSheet();
  },
  discardYes() {
    const a = S.active;
    const dels = [];
    a.exercises.forEach((e, i) => e.sets.forEach((s) => s.done && dels.push({ type: "delete_set", entry_id: entryId(i, s) })));
    if (dels.length) api.enqueue(S.token, dels);
    S.active = null;
    api.LS.del(activeKey());
    S.sheet = null;
    sleep();
    S.view = "home";
    render();
    scrollTop();
    toast("Workout discarded");
    api.flush(S.token);
  },
  closeSheet() {
    S.sheet = null;
    // Sheets can change the workout (a note, say), so redraw what's underneath.
    render();
  },
};

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || !A[el.dataset.a]) return;
  e.preventDefault();
  A[el.dataset.a](el);
});

function cleanKg(v) {
  let s = v.replace(",", ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  return s.slice(0, 6);
}

document.addEventListener("input", (e) => {
  const el = e.target;
  const f = el.dataset && el.dataset.f;
  if (!f) return;
  if (f === "finishNote") {
    S.finishNote = el.value;
    return;
  }
  // Typing in a sheet's search box redraws only its results, so the keyboard stays up.
  if (f === "addq" || f === "swapq") {
    S.sheet.q = el.value;
    const list = $sheet.querySelector(f === "addq" ? ".addlist" : ".swapbody");
    if (list) list.innerHTML = f === "addq" ? addList() : swapBody();
    return;
  }
  if (!S.active) return;
  const ex = cur();
  if (f === "exnote") {
    ex.note = el.value;
    saveActiveSoon();
    return;
  }
  const s = ex.sets[Number(el.dataset.si)];
  if (!s) return;
  const clean = f === "kg" ? cleanKg(el.value) : el.value.replace(/\D/g, "").slice(0, 3);
  if (clean !== el.value) el.value = clean;
  s[f] = clean;
  saveActiveSoon();
  if (s.done) queueExerciseSoon(S.active.idx);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.sheet) closeSheet();
});

// Thumbnails that fail to load fall back to the exercise's initials.
document.addEventListener("error", (e) => {
  if (e.target && e.target.tagName === "IMG") e.target.remove();
}, true);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveActive();
    return;
  }
  wake();
  if (S.view === "home" && Date.now() - S.fetchedAt > 5 * 60000) refresh();
});

/* ---------- timers, sound, screen ---------- */

let actx = null;
function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
  } catch {
    actx = null;
  }
}

function beep() {
  if (!actx) return;
  const t = actx.currentTime;
  for (const off of [0, 0.22, 0.44]) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.35, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.16);
    o.connect(g).connect(actx.destination);
    o.start(t + off);
    o.stop(t + off + 0.18);
  }
}

function tickTimers() {
  const a = S.active;
  if (!a) return;
  const el = document.querySelector("[data-elapsed]");
  if (el) el.textContent = L.fmtElapsed(Date.now() - Date.parse(a.started_at));
  const r = restInfo();
  document.querySelectorAll("[data-rest]").forEach((x) => (x.textContent = L.fmtClock(r.remaining)));
  document.querySelectorAll("[data-restbar]").forEach((x) => (x.style.width = `${r.running ? (r.remaining / r.total) * 100 : 0}%`));
  const btn = document.querySelector(".restbtn");
  if (btn) btn.classList.toggle("on", r.running);
  if (a.rest && !a.rest.fired && !r.running) {
    a.rest.fired = true;
    saveActive();
    // Only make noise if the rest ran out while the app was open.
    if (Date.now() - a.rest.endsAt < 3000) {
      beep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      toast("Rest's up. Next set!");
    }
  }
}
setInterval(tickTimers, 500);

let wakeLock = null;
async function wake() {
  try {
    if (S.view === "workout" && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    wakeLock = null;
  }
}
function sleep() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

init();
