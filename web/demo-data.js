// Sample data for ?u=demo. Generic on purpose: this repo is public, so real
// clients, plans and health notes live only in the Google Sheet.

import { localDate } from "./logic.js";

const EXERCISES = [
  { exercise: "Goblet Squat", video_url: "", primary_muscles: "Quads, Glutes, Adductors", secondary_muscles: "Abs", bodyweight: false, cues: "Elbows inside the knees, chest tall. Only go as deep as feels good.", pattern: "squat", equipment: "dumbbells", swaps: "Leg Press, Bodyweight Box Squat" },
  { exercise: "DB Incline Press (neutral grip)", video_url: "", primary_muscles: "Chest, Front Delts", secondary_muscles: "Triceps", bodyweight: false, cues: "Palms facing each other. Lower to the chest slowly, press up and slightly in.", pattern: "h-push", equipment: "dumbbells, bench", swaps: "Machine Chest Press, Push-Up", per_hand: true },
  { exercise: "Single-Arm DB Row", video_url: "https://www.youtube.com/watch?v=fURsHPHgssI", primary_muscles: "Lats, Upper Back", secondary_muscles: "Biceps, Rear Delts", bodyweight: false, cues: "Hand and knee on the bench. Pull the elbow to your hip.", pattern: "h-pull", equipment: "dumbbells, bench", swaps: "Seated Cable Row, Band Row", per_side: true },
  { exercise: "Seated DB Shoulder Press", video_url: "https://www.youtube.com/watch?v=1WOecdL8nrI", primary_muscles: "Front Delts", secondary_muscles: "Triceps", bodyweight: false, cues: "Back against the bench, ribs down. Press straight up.", pattern: "v-push", equipment: "dumbbells, bench", swaps: "Machine Shoulder Press, Standing DB Shoulder Press", per_hand: true },
  { exercise: "Dead Bug", video_url: "", primary_muscles: "Abs", secondary_muscles: "", bodyweight: true, cues: "Lower back stays flat on the floor the whole time. Reps are per side.", pattern: "core", equipment: "bodyweight", swaps: "Bird Dog" },
  { exercise: "DB Hip Thrust", video_url: "https://www.youtube.com/watch?v=29OfN4ztW_g", primary_muscles: "Glutes", secondary_muscles: "Hamstrings", bodyweight: false, cues: "Chin tucked, ribs down. Squeeze at the top, don't arch.", pattern: "hinge", equipment: "dumbbells, bench", swaps: "Glute Bridge, Cable Pull-Through" },
  { exercise: "Lat Pulldown (neutral grip)", video_url: "", primary_muscles: "Lats", secondary_muscles: "Biceps", bodyweight: false, cues: "Lean back slightly, pull the bar to your upper chest.", pattern: "v-pull", equipment: "machine", swaps: "Single-Arm Cable Pulldown, Band Pulldown" },
  { exercise: "Glute Bridge", video_url: "https://www.youtube.com/watch?v=cvKZXsz-QIA", primary_muscles: "Glutes", secondary_muscles: "Hamstrings", bodyweight: true, cues: "Feet flat, push through the heels, pause at the top.", pattern: "hinge", equipment: "bodyweight" },
  // Library-only alternatives, for the Swap button.
  { exercise: "Leg Press", video_url: "", primary_muscles: "Quads, Glutes", secondary_muscles: "Adductors", bodyweight: false, cues: "Feet shoulder-width, lower until your knees are at about 90°.", pattern: "squat", equipment: "machine" },
  { exercise: "Bodyweight Box Squat", video_url: "", primary_muscles: "Quads, Glutes", secondary_muscles: "", bodyweight: true, cues: "Sit back to the bench, touch, and stand up tall.", pattern: "squat", equipment: "bodyweight, bench" },
  { exercise: "Machine Chest Press", video_url: "", primary_muscles: "Chest", secondary_muscles: "Front Delts, Triceps", bodyweight: false, cues: "Handles at mid-chest. Press out, control back.", pattern: "h-push", equipment: "machine" },
  { exercise: "Push-Up", video_url: "", primary_muscles: "Chest, Front Delts", secondary_muscles: "Triceps", bodyweight: true, cues: "Body in one line. Hands on a bench to make it easier.", pattern: "h-push", equipment: "bodyweight" },
  { exercise: "Seated Cable Row", video_url: "", primary_muscles: "Upper Back, Lats", secondary_muscles: "Biceps", bodyweight: false, cues: "Sit tall, pull to the lower ribs.", pattern: "h-pull", equipment: "cable" },
  { exercise: "Band Row", video_url: "", primary_muscles: "Upper Back", secondary_muscles: "Biceps", bodyweight: false, cues: "Band anchored at chest height. Squeeze the shoulder blades.", pattern: "h-pull", equipment: "band" },
  { exercise: "Machine Shoulder Press", video_url: "", primary_muscles: "Front Delts", secondary_muscles: "Triceps", bodyweight: false, cues: "Handles at shoulder height, press up.", pattern: "v-push", equipment: "machine" },
  { exercise: "Standing DB Shoulder Press", video_url: "", primary_muscles: "Front Delts", secondary_muscles: "Triceps, Abs", bodyweight: false, cues: "Squeeze your glutes so your back doesn't arch.", pattern: "v-push", equipment: "dumbbells", per_hand: true },
  { exercise: "Single-Arm Cable Pulldown", video_url: "", primary_muscles: "Lats", secondary_muscles: "Biceps", bodyweight: false, cues: "Kneel under the cable, pull the elbow down to your side.", pattern: "v-pull", equipment: "cable" },
  { exercise: "Band Pulldown", video_url: "", primary_muscles: "Lats", secondary_muscles: "Biceps", bodyweight: false, cues: "Band anchored high. Pull your elbows down to your sides.", pattern: "v-pull", equipment: "band" },
  { exercise: "Cable Pull-Through", video_url: "", primary_muscles: "Glutes, Hamstrings", secondary_muscles: "", bodyweight: false, cues: "Hips back, then stand tall and squeeze.", pattern: "hinge", equipment: "cable" },
  { exercise: "Bird Dog", video_url: "", primary_muscles: "Abs, Lower Back", secondary_muscles: "Glutes", bodyweight: true, cues: "Opposite arm and leg out, hips level. Reps are per side.", pattern: "core", equipment: "bodyweight" },
];

const DAY_A = [
  ["Goblet Squat", 3, "10-12", 8, "2", 90, 1, "Pain-free depth only."],
  ["DB Incline Press (neutral grip)", 3, "10-12", 6, "2", 90, 0, ""],
  ["Single-Arm DB Row", 3, "10-12", 8, "2", 60, 0, "Each side."],
  ["Dead Bug", 2, "8", "", "", 45, 0, ""],
];
const DAY_B = [
  ["DB Hip Thrust", 3, "10-12", 10, "2", 90, 1, ""],
  ["Lat Pulldown (neutral grip)", 3, "10-12", 25, "2", 0, 0, "Superset with the shoulder press: go straight to it, then rest."],
  ["Seated DB Shoulder Press", 3, "10-12", 4, "2", 90, 0, "Start light."],
  ["Glute Bridge", 2, "15", "", "", 45, 0, ""],
];

function program() {
  const rows = [];
  const plan = [["Week 1 · Day A", DAY_A], ["Week 1 · Day B", DAY_B], ["Week 2 · Day A", DAY_A], ["Week 2 · Day B", DAY_B]];
  plan.forEach(([name, day], i) => {
    day.forEach(([exercise, sets, reps, kg, rir, rest, warmup, note], order) => {
      rows.push({
        session: i + 1, session_name: name, order: order + 1, exercise, sets, reps,
        target_kg: kg, target_rir: rir, rest_sec: rest, warmup_sets: warmup, note,
      });
    });
  });
  return rows;
}

// One finished session three days ago, so "Last" and History have something to show.
function seedDb() {
  const day = new Date(Date.now() - 3 * 864e5);
  day.setHours(7, 30, 0, 0);
  const date = localDate(day);
  const inst = "demo-first";
  const at = (min) => new Date(day.getTime() + min * 60e3).toISOString();
  const log = [];
  const add = (exercise, set_no, kg, reps, rir, min, set_type = "N") =>
    log.push({ entry_id: `${inst}.${exercise}.${set_type}${set_no}`, instance_id: inst, date, logged_at: at(min), session: 1, session_name: "Week 1 · Day A", exercise, set_type, set_no, kg, reps, rir });
  add("Goblet Squat", 1, 4, 10, "", 3, "W");
  add("Goblet Squat", 1, 8, 12, "3", 5);
  add("Goblet Squat", 2, 8, 11, "2", 8);
  add("Goblet Squat", 3, 8, 10, "2", 11);
  add("DB Incline Press (neutral grip)", 1, 6, 12, "2", 15);
  add("DB Incline Press (neutral grip)", 2, 6, 11, "2", 18);
  add("DB Incline Press (neutral grip)", 3, 6, 10, "1", 21);
  add("Single-Arm DB Row", 1, 8, 12, "3", 24);
  add("Single-Arm DB Row", 2, 8, 12, "2", 26);
  add("Single-Arm DB Row", 3, 8, 12, "2", 28);
  add("Dead Bug", 1, "", 8, "", 31);
  add("Dead Bug", 2, "", 8, "", 33);
  return {
    log,
    sessions: [{
      instance_id: inst, session: 1, session_name: "Week 1 · Day A", date,
      started_at: at(0), finished_at: at(36), duration_min: 36, sets_done: 11,
      note: "Felt good. Squat depth fine.",
    }],
  };
}

export const DEMO = {
  client: { id: "demo", name: "Demo", show_rir: true },
  exercises: EXERCISES,
  program,
  seedDb,
};
