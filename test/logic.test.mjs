import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  LIISU_STORAGE_KEY,
  GOAL_V2_FROM,
  GOAL_V3_FROM,
  GOALS_V1,
  GOALS_V2,
  GOALS_V3,
  LIISU_GOALS,
  maxTracker,
  liisuTracker,
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
  assert.equal(maxTracker.storageKey, "max_daily_score_v1");
});

test("Liisu uses her own storage key", () => {
  assert.equal(LIISU_STORAGE_KEY, "liisu_daily_score_v1");
  assert.equal(liisuTracker.storageKey, "liisu_daily_score_v1");
  assert.notEqual(liisuTracker.storageKey, maxTracker.storageKey);
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
  assert.equal(GOAL_V3_FROM, "2026-10-24");
  assert.equal(goalSetIdFor("2026-10-20"), "v1");
  assert.equal(goalSetIdFor("2026-10-21"), "v2");
  assert.equal(goalSetIdFor("2026-10-23"), "v2");
  assert.equal(goalSetIdFor("2026-10-24"), "v3");
  assert.equal(goalSetIdFor("2026-12-31"), "v3");

  assert.deepEqual(ids("2026-10-18"), ["delegate", "stop21", "kids30", "output", "review"]);
  assert.deepEqual(ids("2026-10-20"), ["delegate", "stop21", "kids30", "output"]);
  assert.deepEqual(ids("2026-10-21"), ["project", "stop21", "kids30", "noshort", "exercise", "bedtime"]);
  assert.deepEqual(ids("2026-10-23"), ["project", "stop21", "kids30", "noshort", "exercise", "bedtime"]);
  assert.deepEqual(ids("2026-10-24"), [
    "project", "stop21", "kids30", "noshort", "exercise", "bedtime",
    "food", "nosugar", "nopickup",
  ]);
  assert.deepEqual(ids("2026-10-25"), ids("2026-10-24"));
  assert.equal(ids("2026-10-23").includes("food"), false);
  assert.equal(ids("2026-10-23").includes("nosugar"), false);
  assert.equal(ids("2026-10-23").includes("nopickup"), false);
  assert.equal(ids("2026-10-20").includes("bedtime"), false);
  assert.equal(ids("2026-10-25").includes("review"), false);

  for (const retired of ["delegate", "output", "review"]) {
    assert.equal(GOALS_V2.some((goal) => goal.id === retired), false);
    assert.equal(GOALS_V3.some((goal) => goal.id === retired), false);
  }
  for (const kept of ["stop21", "kids30"]) {
    const before = GOALS_V1.find((goal) => goal.id === kept);
    const after = GOALS_V2.find((goal) => goal.id === kept);
    const current = GOALS_V3.find((goal) => goal.id === kept);
    assert.equal(after.title, before.title);
    assert.equal(after.desc, before.desc);
    assert.equal(current.title, before.title);
    assert.equal(current.desc, before.desc);
  }
  for (const goal of GOALS_V2) {
    const current = GOALS_V3.find((item) => item.id === goal.id);
    assert.ok(current);
    assert.equal(current.title, goal.title);
    assert.equal(current.desc, goal.desc);
  }
  assert.deepEqual(
    GOALS_V3.slice(GOALS_V2.length).map((goal) => goal.title),
    ["Good food choice", "No free sugar", "No unnecessary phone pickup"],
  );
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
  assert.deepEqual(dayScore("2026-10-23", entry), { num: 4, denom: 6 });
  // The three goals added on the 24th are unset here, so they do not add points.
  assert.deepEqual(dayScore("2026-10-24", entry), { num: 4, denom: 9 });
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

test("goals added on 2026-10-24 do not score or save on earlier days", () => {
  const stuffed = {
    ts: 1,
    v: {
      project: true,
      stop21: true,
      kids30: true,
      noshort: true,
      exercise: true,
      bedtime: true,
      food: true,
      nosugar: true,
      nopickup: true,
    },
  };
  assert.deepEqual(dayScore("2026-10-23", stuffed), { num: 6, denom: 6 });
  assert.equal(isComplete("2026-10-23", stuffed), true);
  assert.deepEqual(dayScore("2026-10-24", stuffed), { num: 9, denom: 9 });
  assert.equal(isComplete("2026-10-24", stuffed), true);
  assert.equal(isComplete("2026-10-24", {
    v: { project: true, stop21: true, kids30: true, noshort: true, exercise: true, bedtime: true },
  }), false);

  const today = "2026-10-24";
  assert.equal(applyGoal({ days: {} }, "2026-10-23", "food", true, today, 1).ok, false);
  assert.equal(applyGoal({ days: {} }, "2026-10-23", "nosugar", false, today, 1).ok, false);
  assert.equal(applyGoal({ days: {} }, "2026-10-23", "nopickup", true, today, 1).ok, false);
  const saved = applyGoal({ days: {} }, "2026-10-23", "bedtime", true, today, 2);
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.data.days["2026-10-23"].v, { bedtime: true });

  const added = applyGoal(saved.data, today, "nopickup", true, today, 3);
  assert.equal(added.ok, true);
  assert.equal(added.data.days[today].v.nopickup, true);
  assert.deepEqual(added.data.days["2026-10-23"].v, { bedtime: true });
  assert.deepEqual(dayScore(today, added.data.days[today]), { num: 1, denom: 9 });
});

test("a week crossing 2026-10-24 sums six-goal and nine-goal days separately", () => {
  const fill = (iso) => {
    const v = {};
    for (const goal of activeGoals(iso)) v[goal.id] = true;
    return { ts: 1, v };
  };
  const data = {
    days: {
      "2026-10-23": fill("2026-10-23"),
      "2026-10-24": fill("2026-10-24"),
    },
  };
  const week = weekScore(data, "2026-10-24");
  assert.equal(week.start, "2026-10-19");
  assert.equal(week.totalNum, 6 + 9);
  assert.equal(week.totalDen, 6 + 9);
});

test("Liisu scores only her five goals on every date", () => {
  const titles = [
    "Caught negative thought",
    "20 min walk",
    "Good food choice",
    "Acknowledged positive kid thing",
    "Told kids a positive thing",
  ];
  assert.deepEqual(LIISU_GOALS.map((goal) => goal.title), titles);
  assert.deepEqual(LIISU_GOALS.map((goal) => goal.id), ["thought", "walk", "food", "kidpos", "toldkids"]);
  for (const goal of LIISU_GOALS) assert.equal(typeof goal.desc, "string");

  for (const iso of ["2020-01-05", "2026-10-18", "2026-10-23", "2026-10-24", "2026-12-31"]) {
    assert.deepEqual(liisuTracker.activeGoals(iso).map((goal) => goal.title), titles);
    assert.equal(liisuTracker.activeGoals(iso).length, 5);
  }

  const mixed = {
    v: {
      project: true,
      bedtime: true,
      thought: true,
      walk: false,
      food: true,
      kidpos: true,
      toldkids: false,
    },
  };
  assert.deepEqual(liisuTracker.dayScore("2026-10-24", mixed), { num: 3, denom: 5 });
  assert.equal(liisuTracker.isComplete("2026-10-24", mixed), true);
  // Max's nine-goal day ignores Liisu-only ticks. Shared id "food" still counts for him.
  assert.deepEqual(dayScore("2026-10-24", mixed), { num: 3, denom: 9 });

  const today = "2026-10-24";
  assert.equal(liisuTracker.applyGoal({ days: {} }, "2026-10-25", "walk", true, today, 1).ok, false);
  assert.equal(liisuTracker.applyGoal({ days: {} }, today, "project", true, today, 1).ok, false);
  assert.equal(liisuTracker.applyGoal({ days: {} }, today, "bedtime", true, today, 1).ok, false);

  let saved = liisuTracker.applyGoal({ days: {} }, "2020-01-01", "walk", true, today, 4);
  assert.equal(saved.ok, true);
  saved = liisuTracker.applyGoal(saved.data, "2026-10-21", "thought", true, today, 5);
  saved = liisuTracker.applyGoal(saved.data, "2026-10-21", "walk", true, today, 5);
  saved = liisuTracker.applyGoal(saved.data, "2026-10-21", "food", false, today, 5);
  saved = liisuTracker.applyGoal(saved.data, "2026-10-21", "kidpos", true, today, 5);
  saved = liisuTracker.applyGoal(saved.data, "2026-10-21", "toldkids", true, today, 5);
  assert.deepEqual(liisuTracker.dayScore("2026-10-21", saved.data.days["2026-10-21"]), { num: 4, denom: 5 });
  assert.equal(liisuTracker.isComplete("2026-10-21", saved.data.days["2026-10-21"]), true);
  assert.deepEqual(liisuTracker.weekScore(saved.data, today), { totalNum: 4, totalDen: 5, start: "2026-10-19" });
  assert.equal(liisuTracker.rolling28({ days: {} }, today), 0);

  const perfect = {};
  for (const goal of liisuTracker.activeGoals(today)) perfect[goal.id] = true;
  assert.equal(liisuTracker.rolling28({ days: { [today]: { ts: 1, v: perfect } } }, today), 1 / 28);
});
