// Wartości odżywcze i koszt — zawsze liczone ze składników (na 100 g).
import { SLOTS, round1 } from './util.js';

export const NUTR = ['kcal', 'protein', 'fat', 'satFat', 'carbs', 'fiber'];

export const zero = () => ({ kcal: 0, protein: 0, fat: 0, satFat: 0, carbs: 0, fiber: 0, cost: 0 });

export function computePerServing(recipe, ingMap) {
  const t = zero();
  for (const it of recipe.ingredients || []) {
    const ing = ingMap[it.id];
    if (!ing) continue;
    const g = Number(it.g) || 0;
    for (const k of NUTR) t[k] += ((ing[k] || 0) * g) / 100;
    t.cost += (g * (ing.pricePerKg || 0)) / 1000;
  }
  const s = recipe.servings || 1;
  const out = {};
  for (const k of [...NUTR, 'cost']) out[k] = round1(t[k] / s);
  out.kcal = Math.round(t.kcal / s);
  return out;
}

// przelicza perServing we wszystkich przepisach (po edycji składnika / przepisu)
export function recomputeAll(recipes, ingMap) {
  for (const r of recipes) r.perServing = computePerServing(r, ingMap);
}

export function add(a, b, factor = 1) {
  for (const k of [...NUTR, 'cost']) a[k] += (b[k] || 0) * factor;
  return a;
}

// plan dnia: 1 porcja każdego posiłku (portions dotyczy gotowania, nie jedzenia)
export function dayPlanned(day, recipeMap) {
  const t = zero();
  if (!day) return t;
  for (const s of SLOTS) {
    const m = day.meals[s];
    const r = m && recipeMap[m.recipeId];
    if (r) add(t, r.perServing);
  }
  return t;
}

// to, co faktycznie zjedzone danego dnia (odhaczone + wpisy „poza planem”)
export function dayEaten(day, recipeMap, logEntries = []) {
  const t = zero();
  if (day) {
    for (const s of SLOTS) {
      const m = day.meals[s];
      if (!m) continue;
      if (m.status === 'zjedzone') {
        const r = recipeMap[m.recipeId];
        if (r) add(t, r.perServing);
      } else if (m.status === 'zamienione' && m.actualId) {
        const r = recipeMap[m.actualId];
        if (r) add(t, r.perServing);
      }
    }
  }
  for (const e of logEntries) t.kcal += Number(e.kcal) || 0;
  return t;
}
