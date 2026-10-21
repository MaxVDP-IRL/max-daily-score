import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  GOAL_V2_FROM,
  GOALS_V1,
  GOALS_V2,
  tallinnISO,
  isoAddDays,
  mondayOfWeek,
  goalSetIdFor,
  activeGoals,
  dayScore,
  isComplete,
  weekScore,
  rolling28,
  canLogDate,
  applyGoal,
} from "../logic.js";

const ids = (iso) => activeGoals(iso).map((goal) => goal.id);

test("storage key stays max_daily_score_v1", () => {
  assert.equal(STORAGE_KEY, "max_daily_score_v1");
});

test("Tallinn date rolls at local midnight, including winter time", () => {
  assert.equal(tallinnISO(new Date("2026-10-21T20:30:00Z")), "2026-10-21");
  assert.equal(tallinnISO(new Date("2026-10-21T21:30:00Z")), "2026-10-22");
  assert.equal(tallinnISO(new Date("2026-01-15T21:30:00Z")), "2026-01-15");
  assert.equal(tallinnISO(new Date("2026-01-15T22:30:00Z")), "2026-01-16");
});

test("date arithmetic stays on the calendar across month ends and the DST weekend", () => {
  assert.equal(isoAddDays("2026-10-31", 1), "2026-11-01");
  assert.equal(isoAddDays("2026-03-01", -1), "2026-02-28");
  assert.equal(isoAddDays("2024-03-01", -1), "2024-02-29");
  assert.equal(isoAddDays("2026-10-24", 1), "2026-10-25");
  assert.equal(mondayOfWeek("2026-10-21"), "2026-10-19");
  assert.equal(mondayOfWeek("2026-10-19"), "2026-10-19");
  assert.equal(mondayOfWeek("2026-10-18"), "2026-10-12");
});

test("goal set switches on the ship date and does not reuse retired ids", () => {
  assert.equal(GOAL_V2_FROM, "2026-10-21");
  assert.equal(goalSetIdFor("2026-10-20"), "v1");
  assert.equal(goalSetIdFor("2026-10-21"), "v2");
  assert.equal(goalSetIdFor("2026-12-31"), "v2");

  assert.deepEqual(ids("2026-10-18"), ["delegate", "stop21", "kids30", "output", "review"]);
  assert.deepEqual(ids("2026-10-20"), ["delegate", "stop21", "kids30", "output"]);
  assert.deepEqual(ids("2026-10-21"), ["project", "stop21", "kids30", "noshort", "exercise", "bedtime"]);
  assert.deepEqual(ids("2026-10-25"), ["project", "stop21", "kids30", "noshort", "exercise", "bedtime"]);
  assert.equal(ids("2026-10-20").includes("bedtime"), false);

  for (const retired of ["delegate", "output", "review"]) {
    assert.equal(GOALS_V2.some((goal) => goal.id === retired), false);
  }
  for (const kept of ["stop21", "kids30"]) {
    const before = GOALS_V1.find((goal) => goal.id === kept);
    const after = GOALS_V2.find((goal) => goal.id === kept);
    assert.equal(after.title, before.title);
    assert.equal(after.desc, before.desc);
  }
});

test("historical days keep the original score, including Sunday review", () => {
  const sunday = {
    ts: 1,
    v: { delegate: true, stop21: true, kids30: false, output: true, review: true },
  };
  assert.deepEqual(dayScore("2026-10-18", sunday), { num: 4, denom: 5 });
  assert.equal(isComplete("2026-10-18", sunday), true);

  const tuesday = {
    ts: 1,
    v: { delegate: true, stop21: false, kids30: true, output: false, review: true },
  };
  assert.deepEqual(dayScore("2026-10-20", tuesday), { num: 2, denom: 4 });
  assert.equal(isComplete("2026-10-20", tuesday), true);
  assert.equal(isComplete("2026-10-20", { v: { delegate: true, stop21: false, kids30: true } }), false);
});

test("days from the cutover onward score the new set and ignore retired ticks", () => {
  const entry = {
    ts: 1,
    v: {
      delegate: true,
      output: true,
      review: true,
      project: true,
      stop21: true,
      kids30: false,
      noshort: true,
      exercise: false,
      bedtime: true,
    },
  };
  assert.deepEqual(dayScore("2026-10-21", entry), { num: 4, denom: 6 });
  assert.equal(isComplete("2026-10-21", entry), true);
  assert.deepEqual(dayScore("2026-10-25", entry), { num: 4, denom: 6 });
  assert.equal(isComplete("2026-10-25", { v: { project: true } }), false);
});

test("a week that crosses the cutover sums each day's own denominator", () => {
  const data = {
    days: {
      "2026-10-18": { ts: 1, v: { delegate: true, stop21: true, kids30: true, output: true, review: true } },
      "2026-10-19": { ts: 1, v: { delegate: true, stop21: true, kids30: true, output: true } },
      "2026-10-20": { ts: 1, v: { delegate: false, stop21: true, kids30: true, output: true } },
      "2026-10-21": { ts: 1, v: { project: true, stop21: true, kids30: true, noshort: true, exercise: true, bedtime: true, review: true } },
    },
  };

  const previousWeek = weekScore(data, "2026-10-18");
  assert.equal(previousWeek.start, "2026-10-12");
  assert.equal(previousWeek.totalNum, 5);
  assert.equal(previousWeek.totalDen, 5);

  const crossing = weekScore(data, "2026-10-21");
  assert.equal(crossing.start, "2026-10-19");
  assert.equal(crossing.totalNum, 4 + 3 + 6);
  assert.equal(crossing.totalDen, 4 + 4 + 6);
});

test("rolling average treats a missing day as 0 and a perfect v2 day as 1", () => {
  assert.equal(rolling28({ days: {} }, "2026-10-21"), 0);
  const days = {};
  for (let i = 0; i < 28; i++) {
    const iso = isoAddDays("2026-10-21", -i);
    const v = {};
    for (const goal of activeGoals(iso)) v[goal.id] = true;
    days[iso] = { ts: 1, v };
  }
  assert.equal(rolling28({ days }, "2026-10-21"), 1);
});

test("logging a past day updates that entry and the week, and refuses the future", () => {
  const today = "2026-10-21";
  const original = {
    days: {
      "2026-10-18": { ts: 5, v: { delegate: true, review: false, note: "keep-me" } },
    },
    untouched: true,
  };

  const rejectedFuture = applyGoal(original, "2026-10-22", "project", true, today, 9);
  assert.equal(rejectedFuture.ok, false);
  assert.equal(rejectedFuture.data, original);

  const rejectedGoal = applyGoal(original, "2026-10-18", "project", true, today, 9);
  assert.equal(rejectedGoal.ok, false);
  assert.equal(rejectedGoal.data, original);
  assert.equal(canLogDate("2026-10-22", today), false);
  assert.equal(canLogDate(today, today), true);

  const backfill = applyGoal({ days: {} }, "2026-10-20", "stop21", true, today, 7);
  assert.equal(backfill.ok, true);
  assert.deepEqual(backfill.data.days["2026-10-20"], { ts: 7, v: { stop21: true } });
  assert.deepEqual(weekScore(backfill.data, today), { totalNum: 1, totalDen: 4, start: "2026-10-19" });

  const withToday = applyGoal(backfill.data, today, "project", true, today, 8);
  assert.deepEqual(weekScore(withToday.data, today), { totalNum: 2, totalDen: 10, start: "2026-10-19" });
  assert.equal(applyGoal(backfill.data, "2026-10-20", "bedtime", true, today, 8).ok, false);

  const preserved = applyGoal(
    { ...original, days: { "2026-10-18": { ...original.days["2026-10-18"], marker: "day" } } },
    "2026-10-18",
    "stop21",
    true,
    today,
    11,
  );
  assert.equal(preserved.ok, true);
  assert.equal(preserved.data.untouched, true);
  assert.equal(preserved.data.days["2026-10-18"].marker, "day");
  assert.deepEqual(preserved.data.days["2026-10-18"].v, {
    delegate: true,
    review: false,
    note: "keep-me",
    stop21: true,
  });
  assert.equal(preserved.data.days["2026-10-18"].ts, 5);
  assert.deepEqual(original.days["2026-10-18"].v, { delegate: true, review: false, note: "keep-me" });

  const legacyOnCutover = {
    days: { "2026-10-21": { ts: 3, v: { delegate: true, output: false } } },
  };
  const edited = applyGoal(legacyOnCutover, "2026-10-21", "exercise", true, today, 12);
  assert.equal(edited.data.days["2026-10-21"].v.delegate, true);
  assert.equal(edited.data.days["2026-10-21"].v.output, false);
  assert.equal(edited.data.days["2026-10-21"].v.exercise, true);
  assert.deepEqual(dayScore("2026-10-21", edited.data.days["2026-10-21"]), { num: 1, denom: 6 });
  const withBed = applyGoal(edited.data, "2026-10-21", "bedtime", true, today, 13);
  assert.equal(withBed.ok, true);
  assert.equal(withBed.data.days["2026-10-21"].v.bedtime, true);
  assert.equal(withBed.data.days["2026-10-21"].v.delegate, true);
  assert.deepEqual(dayScore("2026-10-21", withBed.data.days["2026-10-21"]), { num: 2, denom: 6 });
  assert.equal(applyGoal(legacyOnCutover, "2026-10-21", "review", true, today, 12).ok, false);
});
