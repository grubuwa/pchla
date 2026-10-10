// Operacje na stanie używane przez widoki (plan, statusy posiłków, lista zakupów, wpisy).
import { S, commit } from './store.js';
import { addDays, dow, weekStart, todayISO, uid } from './util.js';
import { buildShopping, mergeShopping } from './shopping.js';
import { portionsFor, candidates } from './planner.js';

export const weekAt = (start) => S.user.weeks[start] || null;

export function dayOf(date) {
  const start = weekStart(date);
  const week = weekAt(start);
  const idx = dow(date);
  return { start, week, idx, day: week ? week.days[idx] : null };
}

export const plannerCtx = (extra = {}) => ({
  recipes: S.catalog.recipes,
  recipeMap: S.recipeMap,
  ingMap: S.ingMap,
  targets: S.user.targets,
  weeks: S.user.weeks,
  ...extra,
});

// wołać wewnątrz commit()
export function regenShopping(u, start) {
  const week = u.weeks[start];
  if (!week) return;
  const next = buildShopping(week, S.recipeMap, S.ingMap, { sections: u.sections, prev: u.shopping[addDays(start, -7)] });
  next.generatedAt = todayISO();
  u.shopping[start] = mergeShopping(u.shopping[start], next);
}

export function saveWeek(week, { approve } = {}) {
  commit((u) => {
    if (approve !== undefined) week.approved = approve;
    u.weeks[week.startSunday] = week;
    if (week.approved) regenShopping(u, week.startSunday);
  });
}

// zmiana w zapisanym tygodniu; zatwierdzony plan od razu aktualizuje listy zakupów
export function updateWeek(start, fn) {
  commit((u) => {
    const week = u.weeks[start];
    if (!week) return;
    fn(week);
    if (week.approved) regenShopping(u, start);
  });
}

/* ——— funkcje działające na obiekcie tygodnia (zapisanym albo szkicu z kreatora) ——— */

export function changeMeal(week, d, slot, recipeId) {
  const day = week.days[d];
  const cur = day.meals[slot];
  const r = S.recipeMap[recipeId];
  const batchSlot = day.mode !== 'zjazd' && (slot === 'lunch' || (slot === 'kolacja' && d === 3));
  const isPlanLunch = cur && (cur.recipeId === week.lunchA || cur.recipeId === week.lunchB);
  if (batchSlot && isPlanLunch && r?.type === 'lunch') {
    // lunch gotuje się raz na kilka dni — podmiana dotyczy wszystkich jego porcji
    const old = cur.recipeId;
    week[old === week.lunchA ? 'lunchA' : 'lunchB'] = recipeId;
    for (const dd of week.days) {
      for (const s of ['lunch', 'kolacja']) if (dd.meals[s]?.recipeId === old) dd.meals[s] = { ...dd.meals[s], recipeId, status: undefined, actualId: undefined };
    }
    return;
  }
  day.meals[slot] = recipeId ? { recipeId, portions: portionsFor(slot, day), locked: true } : null;
}

export function changeDayMode(week, d, mode) {
  const day = week.days[d];
  day.mode = mode;
  const r = S.recipeMap[day.meals.lunch?.recipeId];
  if (mode === 'zjazd' && (!r || r.type === 'lunch')) {
    const pick = candidates(S.catalog.recipes, 'lunch', d, day)[0];
    if (pick) day.meals.lunch = { recipeId: pick.id, portions: 1 };
  } else if (mode === 'normal' && (!r || r.type !== 'lunch')) {
    const id = d <= 3 ? week.lunchA : week.lunchB;
    if (id) day.meals.lunch = { recipeId: id, portions: 1 };
  }
}

export function changeGuest(week, d, guest) {
  const day = week.days[d];
  day.guest = guest;
  if (day.meals.kolacja) day.meals.kolacja.portions = portionsFor('kolacja', day);
}

/* ——— dzień: statusy i wpisy poza planem ——— */

export function setStatus(date, slot, status, actualId) {
  const { start, idx } = dayOf(date);
  commit((u) => {
    const meal = u.weeks[start]?.days[idx].meals[slot];
    if (!meal) return;
    if (status) meal.status = status;
    else delete meal.status;
    if (actualId) meal.actualId = actualId;
    else delete meal.actualId;
    // zmiana statusu kasuje wpis „poza planem” przypięty do tego posiłku
    u.log = u.log.filter((e) => !(e.date === date && e.slot === slot));
  });
}

export function toggleEaten(date, slot) {
  const meal = dayOf(date).day?.meals[slot];
  if (meal) setStatus(date, slot, meal.status === 'zjedzone' ? null : 'zjedzone');
}

export function addLog({ date, slot, label, kcal }) {
  const { start, idx } = dayOf(date);
  commit((u) => {
    const meal = slot && u.weeks[start]?.days[idx].meals[slot];
    if (meal) {
      u.log = u.log.filter((e) => !(e.date === date && e.slot === slot));
      meal.status = 'zamienione';
      delete meal.actualId;
    }
    u.log.push({ id: uid('log'), date, slot: meal ? slot : undefined, label, kcal: Math.round(Number(kcal) || 0) });
  });
}

export function removeLog(id) {
  commit((u) => {
    const e = u.log.find((x) => x.id === id);
    if (!e) return;
    u.log = u.log.filter((x) => x.id !== id);
    if (e.slot) {
      const { start, idx } = dayOf(e.date);
      const meal = u.weeks[start]?.days[idx].meals[e.slot];
      if (meal?.status === 'zamienione' && !meal.actualId) delete meal.status;
    }
  });
}

export const logOf = (date) => S.user.log.filter((e) => e.date === date);

export const taskDone = (date, id) => !!S.user.tasks[date]?.[id];

export function setTask(date, id, done) {
  commit((u) => {
    const t = u.tasks[date] || (u.tasks[date] = {});
    if (done) t[id] = true;
    else delete t[id];
  });
}

/* ——— pomiary ——— */

export function saveWeight(entry) {
  commit((u) => {
    u.weights = u.weights.filter((w) => w.date !== entry.date);
    u.weights.push(entry);
    u.weights.sort((a, b) => a.date.localeCompare(b.date));
  });
}

export const removeWeight = (date) => commit((u) => (u.weights = u.weights.filter((w) => w.date !== date)));

export const lastWeight = () => S.user.weights[S.user.weights.length - 1] || null;
