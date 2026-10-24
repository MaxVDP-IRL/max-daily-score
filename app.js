// Shared screen for Max and Liisu. The page picks the tracker; this file
// never chooses a storage key or a goal set on its own.

import {
  tallinnISO,
  prettyDate,
  isoAddDays,
  daysBefore,
  canLogDate,
} from "./logic.js";

export function startApp(tracker){
  if(!tracker || typeof tracker.storageKey !== "string" || typeof tracker.activeGoals !== "function"){
    throw new Error("startApp needs a score tracker");
  }
  const {
    storageKey,
    activeGoals,
    dayScore,
    isComplete,
    weekScore,
    rolling28,
    applyGoal,
  } = tracker;

  let viewDate = tallinnISO();

  function getTodayISO(){ return tallinnISO(); }

  function toast(msg){
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1200);
  }

  function load(){
    try{
      const raw = localStorage.getItem(storageKey);
      if(!raw) return { days:{} };
      const data = JSON.parse(raw);
      if(!data || typeof data !== "object") return { days:{} };
      if(!data.days || typeof data.days !== "object") data.days = {};
      return data;
    }catch(e){
      return { days:{} };
    }
  }

  function save(data){
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  function ensureToday(data){
    const iso = getTodayISO();
    if(!data.days[iso]){
      data.days[iso] = { ts: Date.now(), v: {} };
      save(data);
    }
  }

  function showDate(iso){
    const today = getTodayISO();
    if(!canLogDate(iso, today)) return;
    viewDate = iso;
    renderAll(load());
  }

  function commitGoal(goalId, value){
    const today = getTodayISO();
    const result = applyGoal(load(), viewDate, goalId, value, today, Date.now());
    if(!result.ok) return;
    save(result.data);
    renderAll(result.data);
    toast("Saved");
  }

  const kpiList = document.getElementById("kpiList");
  const historyEl = document.getElementById("history");
  const todayLine = document.getElementById("todayLine");
  const dayNav = document.getElementById("dayNav");

  function dayNavText(iso, today){
    const dateText = prettyDate(iso);
    if(iso === today) return { title: "Today", sub: dateText };
    if(iso === isoAddDays(today, -1)) return { title: "Yesterday", sub: `${dateText} · tap for today` };
    const n = daysBefore(iso, today);
    const unit = n === 1 ? "day" : "days";
    return { title: dateText, sub: `${n} ${unit} ago · tap for today` };
  }

  function renderDayNav(){
    const today = getTodayISO();
    const onToday = viewDate === today;
    const label = dayNavText(viewDate, today);
    dayNav.replaceChildren();

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "day-arrow";
    prev.id = "day-prev";
    prev.setAttribute("aria-label", "Previous day");
    prev.textContent = "‹";
    prev.addEventListener("click", () => showDate(isoAddDays(viewDate, -1)));

    const center = document.createElement(onToday ? "div" : "button");
    center.className = "day-label";
    center.id = "day-label";
    if(!onToday){
      center.type = "button";
      center.setAttribute("aria-label", "Return to today");
      center.addEventListener("click", () => showDate(today));
    }
    const title = document.createElement("span");
    title.className = "day-nav-title";
    title.textContent = label.title;
    const sub = document.createElement("span");
    sub.className = "day-nav-sub";
    sub.textContent = label.sub;
    center.append(title, sub);

    const next = document.createElement("button");
    next.type = "button";
    next.className = "day-arrow";
    next.id = "day-next";
    next.setAttribute("aria-label", "Next day");
    next.textContent = "›";
    next.disabled = onToday;
    next.addEventListener("click", () => {
      const now = getTodayISO();
      if(viewDate >= now) return;
      showDate(isoAddDays(viewDate, 1));
    });

    dayNav.append(prev, center, next);
  }

  function renderKpis(data){
    kpiList.replaceChildren();
    const today = getTodayISO();
    const onToday = viewDate === today;
    const entry = data.days[viewDate] || { v:{} };
    const goals = activeGoals(viewDate);
    const score = dayScore(viewDate, entry);

    todayLine.textContent = `${prettyDate(today)} - Tallinn time`;
    document.getElementById("logHeading").textContent = onToday
      ? "Today (tap fast, close app)"
      : "Earlier day";

    const note = document.getElementById("dayNote");
    note.textContent = onToday
      ? `This day ${score.num}/${score.denom}. Inputs are binary. Save happens instantly.`
      : `This day ${score.num}/${score.denom}. Edits save to ${prettyDate(viewDate)}. Tap the date to return to today.`;

    for(const goal of goals){
      const row = document.createElement("div");
      row.className = "kpi";

      const left = document.createElement("div");
      left.className = "label";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = goal.title;
      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = goal.desc;
      left.append(title, desc);

      const toggle = document.createElement("div");
      toggle.className = "toggle";

      const yes = document.createElement("div");
      yes.className = "pill";
      yes.textContent = "YES";

      const no = document.createElement("div");
      no.className = "pill";
      no.textContent = "NO";

      const val = entry.v?.[goal.id];
      if(val === true){
        yes.classList.add("good");
        no.classList.add("off");
      }else if(val === false){
        no.classList.add("bad");
        yes.classList.add("off");
      }else{
        yes.classList.add("off");
        no.classList.add("off");
      }

      yes.addEventListener("click", () => commitGoal(goal.id, true));
      no.addEventListener("click", () => commitGoal(goal.id, false));

      toggle.append(yes, no);
      row.append(left, toggle);
      kpiList.append(row);
    }
  }

  function renderScores(data){
    const today = getTodayISO();
    const wk = weekScore(data, today);
    const wkPct = wk.totalDen ? Math.round(100 * wk.totalNum / wk.totalDen) : 0;
    document.getElementById("weekScore").textContent = `${wk.totalNum}/${wk.totalDen} (${wkPct}%)`;

    const rolling = rolling28(data, today);
    document.getElementById("rollScore").textContent = `${Math.round(rolling * 100)}%`;
  }

  function renderHistory(data){
    historyEl.replaceChildren();
    const today = getTodayISO();

    for(let i = 0; i < 14; i++){
      const iso = isoAddDays(today, -i);
      const entry = data.days[iso];
      const exists = !!entry;
      const complete = exists && isComplete(iso, entry);
      const score = dayScore(iso, entry || { v:{} });
      const pct = score.denom ? Math.round(100 * score.num / score.denom) : 0;

      const row = document.createElement("div");
      row.className = "row";
      if(iso === viewDate) row.classList.add("viewing");

      const left = document.createElement("div");
      left.className = "left";

      let hint = "";
      if(!exists) hint = "Missing (treated as 0%)";
      else if(!complete) hint = `Incomplete · ${score.num}/${score.denom}`;
      else hint = `${score.num}/${score.denom} (${pct}%)`;

      const dateEl = document.createElement("div");
      dateEl.className = "d";
      dateEl.textContent = prettyDate(iso);
      const hintEl = document.createElement("div");
      hintEl.className = "hint";
      hintEl.textContent = hint;
      left.append(dateEl, hintEl);

      const dots = document.createElement("div");
      dots.className = "dots";
      for(const goal of activeGoals(iso)){
        const dot = document.createElement("div");
        dot.className = "dot";
        dot.title = goal.title;
        if(!exists){
          dot.classList.add("miss");
        }else{
          const value = entry.v?.[goal.id];
          if(value === true) dot.classList.add("good");
          else if(value === false) dot.classList.add("bad");
          else dot.classList.add("miss");
        }
        dots.append(dot);
      }

      row.append(left, dots);
      historyEl.append(row);
    }
  }

  function renderAll(data){
    const today = getTodayISO();
    if(!canLogDate(viewDate, today)) viewDate = today;
    renderDayNav();
    renderKpis(data);
    renderScores(data);
    renderHistory(data);
  }

  document.getElementById("exportBtn").addEventListener("click", async () => {
    const data = load();
    const json = JSON.stringify(data);
    document.getElementById("dataBox").value = json;
    try{
      if(navigator.clipboard) await navigator.clipboard.writeText(json);
      toast("Copied JSON");
    }catch(e){
      toast("Exported");
    }
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    const box = document.getElementById("dataBox");
    const txt = box.value.trim();
    if(!txt){ toast("Paste JSON first"); return; }
    try{
      const parsed = JSON.parse(txt);
      if(!parsed || typeof parsed !== "object" || !parsed.days) throw new Error("Bad format");
      localStorage.setItem(storageKey, JSON.stringify(parsed));
      const data = load();
      ensureToday(data);
      const today = getTodayISO();
      if(!canLogDate(viewDate, today)) viewDate = today;
      renderAll(data);
      toast("Imported");
    }catch(e){
      toast("Import failed");
    }
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    const ok = confirm("This clears all data. Continue?");
    if(!ok) return;
    localStorage.removeItem(storageKey);
    const data = load();
    ensureToday(data);
    renderAll(data);
    toast("Reset");
  });

  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState !== "visible") return;
    const today = getTodayISO();
    if(viewDate > today) viewDate = today;
    const data = load();
    ensureToday(data);
    renderAll(data);
  });

  if("serviceWorker" in navigator){
    if(navigator.serviceWorker.controller){
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    }
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  const data = load();
  ensureToday(data);
  renderAll(data);
}
