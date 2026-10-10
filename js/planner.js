// Generator planu tygodnia i sprawdzanie reguł (rozdz. 5 i 9.4 założeń). Bez DOM.
import { SLOTS, SLOT_TYPE, DAYS, addDays, diffDays, rng, shuffle } from './util.js';
import { zero, add } from './nutrition.js';
import { wasteCost } from './shopping.js';

const LEGUME_IDS = ['fasola_czerwona', 'ciecierzyca', 'hummus'];
export const hasIng = (r, id) => r.ingredients.some((i) => i.id === id);
export const isFish = (r) => r.tags.includes('ryba');
export const isLegume = (r) => r.tags.includes('strączki') || LEGUME_IDS.some((id) => hasIng(r, id));
export const isOats = (r) => r.tags.includes('owies') || hasIng(r, 'platki_owsiane');
export const isNuts = (r) => hasIng(r, 'orzechy_wloskie');
// dla dziewczyny: bez pszenicy w roli głównej albo z sensownym zamiennikiem
export const guestOk = (r) => !r.wheatMain || (!!r.wheatSwap && !/^nie dla/i.test(r.wheatSwap));
// kanapki do zabrania na zjazd stacjonarny
export const isSandwich = (r) => r.type === 'kolacja' && /^kanapki/i.test(r.name) && r.tags.includes('bez gotowania');

export const LUNCH_B_MAX_MIN = 60; // środa po pracy
export const DINNER_MAX_MIN = 20;

export function emptyWeek(startSunday, calendar) {
  return {
    id: startSunday,
    startSunday,
    lunchA: null,
    lunchB: null,
    approved: false,
    days: DAYS.map((_, i) => ({
      date: addDays(startSunday, i),
      mode: calendar?.[i]?.mode || 'normal',
      guest: !!calendar?.[i]?.guest,
      meals: Object.fromEntries(SLOTS.map((s) => [s, null])),
    })),
  };
}

export const portionsFor = (slot, day) => (slot === 'kolacja' && day.guest ? 2 : 1);

// lunch A: nd–śr; lunch B: śr kolacja + czw–sob
export function applyLunches(week, lunchA, lunchB) {
  week.lunchA = lunchA;
  week.lunchB = lunchB;
  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    if (day.mode !== 'zjazd') {
      const id = d <= 3 ? lunchA : lunchB;
      day.meals.lunch = id ? { recipeId: id, portions: 1 } : null;
    }
    if (d === 3 && lunchB) day.meals.kolacja = { recipeId: lunchB, portions: portionsFor('kolacja', day) };
  });
  return week;
}

// przepisy pasujące do slotu; auto=false → pełna lista do ręcznej podmiany
export function candidates(recipes, slot, d, day, { auto = true } = {}) {
  const workday = (d >= 1 && d <= 5) || day.mode === 'zjazd';
  return recipes.filter((r) => {
    if (slot === 'lunch') {
      if (day.mode === 'zjazd') return auto ? isSandwich(r) : r.type === 'kolacja' || r.type === 'lunch';
      return r.type === 'lunch';
    }
    if (r.type !== SLOT_TYPE[slot] && !(slot === 'kolacja' && !auto && r.type === 'lunch')) return false;
    if (auto && r.tags.includes('awaryjne')) return false;
    if ((slot === 'sniadanie' || slot === 'przekaska') && workday && !r.tags.includes('do pracy')) return false;
    if (slot === 'kolacja') {
      if (auto && r.timeMin > DINNER_MAX_MIN) return false;
      if (auto && day.guest && !guestOk(r)) return false;
    }
    return true;
  });
}

// liczby opisujące tydzień — wspólne dla oceny (generator) i ekranu podsumowania
export function weekFacts(week, recipeMap) {
  let cost = 0;
  const days = week.days.map((day) => {
    const active = day.mode !== 'poza domem';
    const totals = zero();
    const recipes = [];
    let filled = 0;
    if (active) {
      for (const s of SLOTS) {
        const m = day.meals[s];
        const r = m && recipeMap[m.recipeId];
        if (!r) continue;
        add(totals, r.perServing);
        cost += (r.perServing.cost || 0) * (m.portions || 1);
        recipes.push(r);
        filled++;
      }
    }
    return { active, totals, recipes, filled, nuts: recipes.some(isNuts) };
  });
  const act = days.filter((x) => x.active);
  const all = act.flatMap((x) => x.recipes);
  const avg = zero();
  act.forEach((x) => add(avg, x.totals, 1 / act.length));
  return {
    days,
    activeDays: act.length,
    avg,
    fish: all.filter(isFish).length,
    legumes: all.filter(isLegume).length,
    oats: all.filter(isOats).length,
    nutDays: act.filter((x) => x.nuts).length,
    costUse: Math.round(cost * 100) / 100,
  };
}

const need = (n, activeDays) => Math.ceil((n * activeDays) / 7);

// niższy wynik = lepszy tydzień
export function scoreWeek(week, c) {
  const T = c.targets;
  const f = weekFacts(week, c.recipeMap);
  let p = 0;

  for (const d of f.days) {
    if (!d.active) continue;
    const k = d.totals.kcal;
    if (k < T.kcalMin) p += (T.kcalMin - k) * 0.15;
    else if (k > T.kcalMax) p += (k - T.kcalMax) * 0.15;
    p += Math.abs(k - T.kcal) * 0.005;
    if (d.totals.protein < T.proteinMin) p += (T.proteinMin - d.totals.protein) * 0.8;
  }
  if (f.avg.satFat > T.satFatMax) p += (f.avg.satFat - T.satFatMax) * 6;
  if (f.avg.fiber < T.fiberMin) p += (T.fiberMin - f.avg.fiber) * 4;

  const a = f.activeDays;
  if (a >= 4) p += f.fish === 0 ? 40 : f.fish === 1 ? 6 : f.fish > 3 ? (f.fish - 3) * 4 : 0;
  p += Math.max(0, need(3, a) - f.legumes) * 15;
  p += Math.max(0, need(3, a) - f.oats) * 15;
  p += Math.max(0, need(5, a) - f.nutDays) * 5;

  // różnorodność
  const count = {};
  const prev = {};
  const firstUse = {};
  week.days.forEach((day, d) => {
    if (!f.days[d].active) return;
    for (const s of SLOTS) {
      const m = day.meals[s];
      const r = m && c.recipeMap[m.recipeId];
      if (!r) continue;
      const fixed = (s === 'lunch' && day.mode !== 'zjazd') || (s === 'kolacja' && m.recipeId === week.lunchB);
      if (fixed) continue;
      const bySlot = count[s] || (count[s] = {});
      bySlot[r.id] = (bySlot[r.id] || 0) + 1;
      if (r.batch) {
        // jeden wypiek musi się zmieścić w trwałości z lodówki
        if (firstUse[r.id] === undefined) firstUse[r.id] = d;
        const over = d - firstUse[r.id] + 1 - (r.fridgeDays || r.servings);
        if (over > 0) p += over * 5;
        if (d === 0 || d === 6) p += 4; // w weekend lepiej coś świeżego
      }
      if (prev[s] === r.id && !r.batch) p += 2; // to samo dzień po dniu
      prev[s] = r.id;
      if (r.rating === 'może') p += 2;
      else if (r.rating === 'propozycja') p += 3;
      if (s === 'sniadanie' && (d === 0 || d === 6) && r.tags.includes('w domu')) p -= 3;
      if (s === 'kolacja' && c.prevDinners.has(r.id)) p += 1.5;
      if (s === 'kolacja' && day.guest && r.wheatMain) p += 3; // zamiennik to dodatkowy kłopot
    }
    for (const s of SLOTS) if (!day.meals[s]) prev[s] = null;
  });
  for (const s in count) {
    for (const id in count[s]) {
      const n = count[s][id];
      const r = c.recipeMap[id];
      if (s === 'kolacja' || s === 'lunch') p += (n - 1) * 12;
      else if (r.batch) {
        // przepis na 4 porcje: najlepiej zjeść cały wypiek
        const rem = n % r.servings;
        if (rem) p += (r.servings - rem) * 4;
        if (n > r.servings) p += 10;
      } else if (n > 3) p += (n - 3) * 7;
    }
  }

  p += wasteCost(week, c.recipeMap, c.ingMap) * (c.wasteWeight ?? 1);
  if (f.costUse > T.budgetMax) p += f.costUse - T.budgetMax;
  if (f.costUse > T.budget + 20) p += (f.costUse - T.budget - 20) * 0.15;
  return p;
}

function scoreContext(ctx) {
  const prevDinners = new Set();
  for (const day of ctx.prevWeek?.days || []) if (day.meals.kolacja) prevDinners.add(day.meals.kolacja.recipeId);
  return {
    recipeMap: ctx.recipeMap,
    ingMap: ctx.ingMap,
    targets: { budget: 220, budgetMax: 300, ...ctx.targets },
    prevDinners,
    wasteWeight: ctx.wasteWeight,
  };
}

/**
 * Wypełnia śniadania, przekąski i kolacje wokół ustalonych lunchy A i B.
 * ctx: { recipes, recipeMap, ingMap, targets, startSunday, calendar, lunchA, lunchB, prevWeek, seed, keep }
 * keep — istniejący tydzień: zachowaj jego posiłki z flagą `locked`.
 */
export function generatePlan(ctx) {
  const c = scoreContext(ctx);
  let best = null;
  let bestScore = Infinity;
  const restarts = ctx.restarts ?? 3;
  for (let i = 0; i < restarts; i++) {
    const week = climb(ctx, c, (ctx.seed ?? 1) * 7919 + i * 104729);
    const s = scoreWeek(week, c);
    if (s < bestScore) {
      best = week;
      bestScore = s;
    }
  }
  return best;
}

function climb(ctx, c, seed) {
  const rand = rng(seed);
  const week = emptyWeek(ctx.startSunday, ctx.calendar);
  applyLunches(week, ctx.lunchA, ctx.lunchB);

  const free = [];
  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    for (const slot of SLOTS) {
      const kept = ctx.keep?.days[d]?.meals[slot];
      if (kept?.locked) {
        day.meals[slot] = { ...kept };
        continue;
      }
      if (day.meals[slot]) continue; // lunch i środowa kolacja są ustalone
      const cand = candidates(ctx.recipes, slot, d, day);
      if (!cand.length) continue;
      const pick = cand[Math.floor(rand() * cand.length)];
      day.meals[slot] = { recipeId: pick.id, portions: portionsFor(slot, day) };
      free.push({ d, slot, cand });
    }
  });

  let best = scoreWeek(week, c);
  const pass = () => {
    let improved = false;
    for (const f of shuffle(free, rand)) {
      const meal = week.days[f.d].meals[f.slot];
      let bestId = meal.recipeId;
      for (const r of shuffle(f.cand, rand)) {
        if (r.id === bestId) continue;
        meal.recipeId = r.id;
        const s = scoreWeek(week, c);
        if (s < best - 1e-9) {
          best = s;
          bestId = r.id;
          improved = true;
        }
      }
      meal.recipeId = bestId;
    }
    return improved;
  };

  for (let i = 0; i < 6 && pass(); i++);

  // wypiek „na zapas” (muffinki, placuszki) opłaca się tylko na kilka dni z rzędu —
  // pojedyncza podmiana tego nie znajdzie, więc próbujemy całej serii naraz
  const breakfasts = free.filter((f) => f.slot === 'sniadanie');
  const batch = ctx.recipes.filter((r) => r.type === 'śniadanie' && r.batch);
  let changed = false;
  for (const r of batch) {
    const span = Math.min(r.servings, r.fridgeDays || r.servings);
    for (let start = 0; start + span <= breakfasts.length; start++) {
      const run = breakfasts.slice(start, start + span);
      if (run.some((f) => !f.cand.includes(r))) continue;
      const before = run.map((f) => week.days[f.d].meals.sniadanie.recipeId);
      run.forEach((f) => (week.days[f.d].meals.sniadanie.recipeId = r.id));
      const s = scoreWeek(week, c);
      if (s < best - 1e-9) {
        best = s;
        changed = true;
      } else run.forEach((f, i) => (week.days[f.d].meals.sniadanie.recipeId = before[i]));
    }
  }
  if (changed) for (let i = 0; i < 3 && pass(); i++);
  return week;
}

// propozycje lunchy wg rotacji: najdawniej używane najpierw
export function suggestLunches(recipes, weeks, startSunday) {
  const last = {};
  for (const w of Object.values(weeks || {})) {
    if (w.startSunday >= startSunday) continue;
    for (const id of [w.lunchA, w.lunchB]) {
      if (id && (!last[id] || w.startSunday > last[id])) last[id] = w.startSunday;
    }
  }
  const rate = { chcę: 0, może: 1, propozycja: 2 };
  return recipes
    .filter((r) => r.type === 'lunch')
    .map((r) => ({ recipe: r, weeksAgo: last[r.id] ? Math.round(diffDays(last[r.id], startSunday) / 7) : null }))
    .sort((a, b) => (b.weeksAgo ?? 99) - (a.weeksAgo ?? 99) || (rate[a.recipe.rating] ?? 1) - (rate[b.recipe.rating] ?? 1));
}

// domyślna para: dłuższe gotowanie w niedzielę (do 2 h), krótsze w środę (do 1 h)
export function pickLunches(suggestions, calendar) {
  const guestWed = !!calendar?.[3]?.guest;
  const okB = (r) => r.timeMin <= LUNCH_B_MAX_MIN && (!guestWed || guestOk(r));
  const first = suggestions[0]?.recipe;
  const fits = (s) => s.recipe !== first && (okB(s.recipe) || okB(first));
  const base = suggestions.find(fits);
  // przy równej rotacji lepiej nie brać dwóch dań z tej samej kuchni
  const sameKind = (r) => r.tags.includes('azjatyckie') && first.tags.includes('azjatyckie');
  const varied = base && suggestions.find((s) => fits(s) && !sameKind(s.recipe) && (s.weeksAgo ?? 99) === (base.weeksAgo ?? 99));
  const second = (varied || base)?.recipe;
  if (!first || !second) return { lunchA: first?.id || null, lunchB: second?.id || null };
  let [a, b] = [first, second];
  if (!okB(b) || (okB(a) && a.timeMin < b.timeMin)) [a, b] = [b, a];
  return { lunchA: a.id, lunchB: b.id };
}

// reguły z rozdz. 5 → lista „spełnione / niespełnione” do podsumowania
export function checkRules(week, ctx) {
  const T = { budget: 220, budgetMax: 300, ...ctx.targets };
  const f = weekFacts(week, ctx.recipeMap);
  const a = f.activeDays;
  const act = f.days.filter((d) => d.active);
  const r0 = (x) => Math.round(x);
  const out = [];
  const push = (id, label, ok, detail) => out.push({ id, label, ok, detail });

  const full = act.every((d) => d.filled === SLOTS.length);
  push('full', 'Pełny plan na każdy dzień', full, full ? `${a} dni × 5 posiłków` : 'są puste pozycje');
  const inRange = act.filter((d) => d.totals.kcal >= T.kcalMin - 60 && d.totals.kcal <= T.kcalMax + 60).length;
  push('kcal', `Kalorie ${T.kcalMin}–${T.kcalMax} kcal`, a > 0 && inRange === a, `śr. ${Math.round(f.avg.kcal / 10) * 10} kcal · ${inRange}/${a} dni w zakresie`);
  push('protein', `Białko ≥ ${T.proteinMin} g`, f.avg.protein >= T.proteinMin, `śr. ${r0(f.avg.protein)} g`);
  push('fiber', `Błonnik ≥ ${T.fiberMin} g`, f.avg.fiber >= T.fiberMin, `śr. ${r0(f.avg.fiber)} g`);
  push('satFat', `Tłuszcze nasycone ≤ ${T.satFatMax} g`, f.avg.satFat <= T.satFatMax, `śr. ${r0(f.avg.satFat)} g`);
  push('fish', 'Ryba 1–2× w tygodniu', f.fish >= 1, `${f.fish}×`);
  push('legumes', 'Strączki ≥ 3×', f.legumes >= need(3, a), `${f.legumes}×`);
  push('oats', 'Płatki owsiane ≥ 3×', f.oats >= need(3, a), `${f.oats}×`);
  push('nuts', 'Orzechy prawie codziennie', f.nutDays >= need(5, a), `${f.nutDays}/${a} dni`);

  // lodówka: porcje lunchu maks. 3 dni od ugotowania
  const firstDay = {};
  let fridgeOk = true;
  let lunchOk = true;
  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    for (const s of ['lunch', 'kolacja']) {
      const r = ctx.recipeMap[day.meals[s]?.recipeId];
      if (!r || r.type !== 'lunch') continue;
      if (firstDay[r.id] === undefined) firstDay[r.id] = d;
      if (d - firstDay[r.id] > (r.fridgeDays || 3)) fridgeOk = false;
    }
    if (day.mode === 'normal' && !day.meals.lunch) lunchOk = false;
  });
  push('fridge', 'Lunch w lodówce maks. 3 dni', fridgeOk && lunchOk, fridgeOk ? 'A: nd–śr · B: śr–sob' : 'porcja leży dłużej niż 3 dni');

  if (ctx.weeks) {
    const recent = [];
    for (const w of Object.values(ctx.weeks)) {
      const ago = diffDays(w.startSunday, week.startSunday) / 7;
      if (ago >= 1 && ago < 3) recent.push(w.lunchA, w.lunchB);
    }
    const repeated = [week.lunchA, week.lunchB].filter((id) => id && recent.includes(id));
    push('rotation', 'Lunch nie częściej niż co 3 tygodnie', !repeated.length, repeated.length ? `powtórka: ${repeated.map((id) => ctx.recipeMap[id]?.name).join(', ')}` : 'rotacja zachowana');
  }

  const guestDays = week.days.filter((d) => d.guest && d.mode !== 'poza domem');
  if (guestDays.length) {
    const bad = guestDays.filter((d) => {
      const r = ctx.recipeMap[d.meals.kolacja?.recipeId];
      return r && !guestOk(r);
    });
    push('guest', 'Kolacje z dziewczyną bez pszenicy', !bad.length, bad.length ? `${bad.length}× pszenica w roli głównej` : `${guestDays.length}× porcje ×2`);
  }

  push('budget', `Budżet do ${T.budgetMax} zł (cel ~${T.budget} zł)`, f.costUse <= T.budgetMax, `ok. ${r0(f.costUse)} zł zużycia`);
  return { facts: f, checks: out };
}

// „sprawdzony tydzień” → nowy tydzień
export function weekFromTemplate(tpl, startSunday, calendar) {
  const week = emptyWeek(startSunday, calendar);
  week.lunchA = tpl.lunchA;
  week.lunchB = tpl.lunchB;
  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    for (const s of SLOTS) {
      const id = tpl.days[d]?.[s];
      day.meals[s] = id ? { recipeId: id, portions: portionsFor(s, day) } : null;
    }
  });
  return week;
}

export function templateFromWeek(week, name) {
  return {
    name,
    lunchA: week.lunchA,
    lunchB: week.lunchB,
    days: week.days.map((day) => Object.fromEntries(SLOTS.map((s) => [s, day.meals[s]?.recipeId || null]))),
  };
}
