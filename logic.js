// Pure scoring rules for Daily Score. No DOM and no localStorage.
// Day keys stay YYYY-MM-DD in Europe/Tallinn. Storage shape is unchanged:
// { days: { [iso]: { ts, v: { [goalId]: true|false } } } }

export const STORAGE_KEY = "max_daily_score_v1";
export const TZ = "Europe/Tallinn";

// Tallinn calendar day this goal set ships. Earlier dates keep the original
// goals, including the Sunday-only weekly review. This date and later use the
// new six daily goals, including when a past day in that range is edited later.
export const GOAL_V2_FROM = "2026-10-21";

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

export function goalSetIdFor(iso) {
  return iso >= GOAL_V2_FROM ? "v2" : "v1";
}

export function activeGoals(iso) {
  if (goalSetIdFor(iso) === "v2") return GOALS_V2.slice();
  if (isSunday(iso)) return GOALS_V1.slice();
  return GOALS_V1.filter((goal) => goal.id !== "review");
}

function valuesOf(entry) {
  if (!entry || typeof entry.v !== "object" || entry.v === null) return {};
  return entry.v;
}

export function dayScore(dayIso, entry) {
  const goals = activeGoals(dayIso);
  const values = valuesOf(entry);
  let num = 0;
  for (const goal of goals) {
    if (values[goal.id] === true) num += 1;
  }
  return { num, denom: goals.length };
}

export function isComplete(dayIso, entry) {
  const values = valuesOf(entry);
  for (const goal of activeGoals(dayIso)) {
    const value = values[goal.id];
    if (value !== true && value !== false) return false;
  }
  return true;
}

function daysOf(data) {
  if (!data || typeof data.days !== "object" || data.days === null) return {};
  return data.days;
}

export function weekScore(data, anyIso) {
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

export function rolling28(data, endIso) {
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

export function canLogDate(iso, todayIso) {
  return typeof iso === "string"
    && typeof todayIso === "string"
    && ISO_RE.test(iso)
    && ISO_RE.test(todayIso)
    && iso <= todayIso;
}

// Writes one goal on one day. Other days, other goal ids, and root fields stay.
// Future dates and goals outside that day's set are rejected unchanged.
export function applyGoal(data, iso, goalId, value, todayIso, now = 0) {
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
