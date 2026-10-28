// Pure scoring rules for Daily Score. No DOM and no localStorage.
// Day keys stay YYYY-MM-DD in Europe/Tallinn. Storage shape is unchanged:
// { days: { [iso]: { ts, v: { [goalId]: true|false } } } }
//
// Max and Liisu share this file. Each tracker has its own storage key and its
// own goal versions, so a day is always scored against the set that belonged
// to that person on that date.

export const STORAGE_KEY = "max_daily_score_v1";
export const LIISU_STORAGE_KEY = "liisu_daily_score_v1";
export const TZ = "Europe/Tallinn";

// Tallinn calendar day each of Max's sets ships. Earlier dates keep the older
// set, including when that day is edited later.
// v1: before 2026-10-21, with the Sunday-only weekly review
// v2: 2026-10-21 through 2026-10-23, the six daily goals
// v3: 2026-10-24 through 2026-10-27, those six plus food, sugar, and phone pickup
// v4: 2026-10-28 onward, those nine plus 2l of water and vitamins
export const GOAL_V2_FROM = "2026-10-21";
export const GOAL_V3_FROM = "2026-10-24";
export const GOAL_V4_FROM = "2026-10-28";

const freezeGoals = (goals) => Object.freeze(goals.map((goal) => Object.freeze({ ...goal })));

export const GOALS_V1 = freezeGoals([
  { id: "delegate", title: "Delegation", desc: "Delegated >=1 decision" },
  { id: "stop21", title: "Work boundary", desc: "Stopped work by 21:00" },
  { id: "kids30", title: "Fatherhood", desc: ">=30 min device-free with kids" },
  { id: "output", title: "Output", desc: "Produced something tangible" },
  { id: "review", title: "System", desc: "Weekly review done (Sun only)" },
]);

export const GOALS_V2 = freezeGoals([
  { id: "project", title: "Progress a project", desc: "Moved a project forward" },
  { id: "stop21", title: "Work boundary", desc: "Stopped work by 21:00" },
  { id: "kids30", title: "Fatherhood", desc: ">=30 min device-free with kids" },
  { id: "noshort", title: "No short form", desc: "No short-form video/scrolling" },
  { id: "exercise", title: "Exercise", desc: "Did a workout" },
  { id: "bedtime", title: "Bed on time", desc: "In bed on time" },
]);

export const GOALS_V3 = freezeGoals([
  ...GOALS_V2,
  { id: "food", title: "Good food choice", desc: "Made a good food choice" },
  { id: "nosugar", title: "No free sugar", desc: "Skipped free sugar" },
  { id: "nopickup", title: "No unnecessary phone pickup", desc: "No unnecessary phone pickup" },
]);

export const GOALS_V4 = freezeGoals([
  ...GOALS_V3,
  { id: "water", title: "2l of water", desc: "Drank 2l of water" },
  { id: "vitamins", title: "Vitamins", desc: "Took vitamins" },
]);

// Tallinn calendar day Liisu's sixth goal ships. She has logged the five-goal
// set since 2026-10-24. Dates before this keep that set, including when she
// edits them later.
// v1: before 2026-10-26, the five goals
// v2: 2026-10-26 onward, those five plus Orange light
export const LIISU_GOAL_V2_FROM = "2026-10-26";

export const LIISU_GOALS = freezeGoals([
  { id: "thought", title: "Caught negative thought", desc: "Noticed a negative thought" },
  { id: "walk", title: "20 min walk", desc: "Walked for 20 minutes" },
  { id: "food", title: "Good food choice", desc: "Made a good food choice" },
  { id: "kidpos", title: "Acknowledged positive kid thing", desc: "Acknowledged a positive thing a kid did" },
  { id: "toldkids", title: "Told kids a positive thing", desc: "Told the kids something positive" },
]);

export const LIISU_GOALS_V2 = freezeGoals([
  ...LIISU_GOALS,
  { id: "orange", title: "Orange light", desc: "Orange light" },
]);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function tallinnISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

export function prettyDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(dt);
}

export function isoAddDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function daysBefore(earlier, later) {
  const [y1, m1, d1] = earlier.split("-").map(Number);
  const [y2, m2, d2] = later.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function isSunday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

export function mondayOfWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return isoAddDays(iso, -diff);
}

function valuesOf(entry) {
  if (!entry || typeof entry.v !== "object" || entry.v === null) return {};
  return entry.v;
}

function daysOf(data) {
  if (!data || typeof data.days !== "object" || data.days === null) return {};
  return data.days;
}

export function canLogDate(iso, todayIso) {
  return typeof iso === "string"
    && typeof todayIso === "string"
    && ISO_RE.test(iso)
    && ISO_RE.test(todayIso)
    && iso <= todayIso;
}

// versions: [{ id, from, goals, weekdaySkip? }] sorted by the caller or here.
// weekdaySkip ids are hidden on every day except Sunday (Max's v1 review).
function createTracker(versions) {
  const ordered = Object.freeze(
    versions
      .slice()
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
      .map((version) => Object.freeze({
        id: version.id,
        from: version.from,
        goals: version.goals,
        weekdaySkip: version.weekdaySkip ? Object.freeze(version.weekdaySkip.slice()) : null,
      })),
  );

  function versionFor(iso) {
    let match = ordered[0];
    for (const version of ordered) {
      if (iso >= version.from) match = version;
      else break;
    }
    return match;
  }

  function goalSetIdFor(iso) {
    return versionFor(iso).id;
  }

  function activeGoals(iso) {
    const version = versionFor(iso);
    if (version.weekdaySkip && !isSunday(iso)) {
      const skip = new Set(version.weekdaySkip);
      return version.goals.filter((goal) => !skip.has(goal.id));
    }
    return version.goals.slice();
  }

  function dayScore(dayIso, entry) {
    const goals = activeGoals(dayIso);
    const values = valuesOf(entry);
    let num = 0;
    for (const goal of goals) {
      if (values[goal.id] === true) num += 1;
    }
    return { num, denom: goals.length };
  }

  function isComplete(dayIso, entry) {
    const values = valuesOf(entry);
    for (const goal of activeGoals(dayIso)) {
      const value = values[goal.id];
      if (value !== true && value !== false) return false;
    }
    return true;
  }

  function weekScore(data, anyIso) {
    const start = mondayOfWeek(anyIso);
    const days = daysOf(data);
    let totalNum = 0;
    let totalDen = 0;
    for (let i = 0; i < 7; i++) {
      const iso = isoAddDays(start, i);
      const entry = days[iso];
      if (!entry) continue;
      const score = dayScore(iso, entry);
      totalNum += score.num;
      totalDen += score.denom;
    }
    return { totalNum, totalDen, start };
  }

  function rolling28(data, endIso) {
    const days = daysOf(data);
    let sumPct = 0;
    for (let i = 27; i >= 0; i--) {
      const iso = isoAddDays(endIso, -i);
      const entry = days[iso] || { v: {} };
      const score = dayScore(iso, entry);
      sumPct += score.denom ? score.num / score.denom : 0;
    }
    return sumPct / 28;
  }

  // Writes one goal on one day. Other days, other goal ids, and root fields stay.
  // Future dates and goals outside that day's set are rejected unchanged.
  function applyGoal(data, iso, goalId, value, todayIso, now = 0) {
    const base = data && typeof data === "object" ? data : { days: {} };
    if (!canLogDate(iso, todayIso)) return { ok: false, data: base };
    if (value !== true && value !== false) return { ok: false, data: base };
    if (!activeGoals(iso).some((goal) => goal.id === goalId)) return { ok: false, data: base };

    const days = { ...daysOf(base) };
    const prev = days[iso] && typeof days[iso] === "object" ? days[iso] : null;
    const prevV = prev && prev.v && typeof prev.v === "object" ? prev.v : {};
    const next = prev ? { ...prev } : {};
    next.ts = prev && typeof prev.ts === "number" ? prev.ts : now;
    next.v = { ...prevV, [goalId]: value };
    days[iso] = next;
    return { ok: true, data: { ...base, days } };
  }

  return { goalSetIdFor, activeGoals, dayScore, isComplete, weekScore, rolling28, applyGoal };
}

const maxApi = createTracker([
  { id: "v1", from: "0000-00-00", goals: GOALS_V1, weekdaySkip: ["review"] },
  { id: "v2", from: GOAL_V2_FROM, goals: GOALS_V2 },
  { id: "v3", from: GOAL_V3_FROM, goals: GOALS_V3 },
  { id: "v4", from: GOAL_V4_FROM, goals: GOALS_V4 },
]);

export const goalSetIdFor = maxApi.goalSetIdFor;
export const activeGoals = maxApi.activeGoals;
export const dayScore = maxApi.dayScore;
export const isComplete = maxApi.isComplete;
export const weekScore = maxApi.weekScore;
export const rolling28 = maxApi.rolling28;
export const applyGoal = maxApi.applyGoal;

export const maxTracker = Object.freeze({
  storageKey: STORAGE_KEY,
  // The shared screen reads this. Liisu keeps the explainer line under each goal.
  showDescriptions: false,
  goalSetIdFor,
  activeGoals,
  dayScore,
  isComplete,
  weekScore,
  rolling28,
  applyGoal,
});

const liisuApi = createTracker([
  { id: "v1", from: "0000-00-00", goals: LIISU_GOALS },
  { id: "v2", from: LIISU_GOAL_V2_FROM, goals: LIISU_GOALS_V2 },
]);

export const liisuTracker = Object.freeze({
  storageKey: LIISU_STORAGE_KEY,
  showDescriptions: true,
  ...liisuApi,
});
