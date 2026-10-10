// Lista zakupów z planu: sumowanie składników, opakowania, podział sobota / środa, spiżarnia.
import { SLOTS, byId } from './util.js';

export const TRIPS = ['sobota', 'środa'];

// „czasem w domu” — lista dodaje, ale pyta „masz?”
export const PANTRY_SOMETIMES = [
  'olej_rzepakowy', 'musztarda', 'koncentrat', 'passata', 'pomidory_puszka',
  'mleko_kokosowe', 'skrobia', 'panko', 'fasola_czerwona', 'ciecierzyca',
];

// świeże poza mięsem i rybą — kupowane osobno na każdą połowę tygodnia
const FRESH = [
  'salata', 'szpinak', 'szczypiorek', 'koperek', 'kolendra', 'rzodkiewka', 'pieczarki',
  'kurczak_pieczony', 'surowka', 'bulka_pelnoziarnista',
];

// pola wyliczane przy seedzie (potem edytowalne w Ustawieniach)
export function enrichIngredient(ing) {
  if (ing.loose === undefined) ing.loose = !!(ing.unit && ing.unit.name === 'szt.' && ing.section === 'Warzywa i owoce');
  if (ing.fresh === undefined) ing.fresh = !!ing.perishable && (ing.section === 'Mięso i ryby' || FRESH.includes(ing.id));
  if (ing.ask === undefined) ing.ask = PANTRY_SOMETIMES.includes(ing.id);
  return ing;
}

// środowe zakupy są po pracy: środowa kolacja i wszystko później to „druga połowa”
export const isSecondHalf = (dayIdx, slot) => dayIdx > 3 || (dayIdx === 3 && (slot === 'kolacja' || slot === 'wieczor'));

// id składnika → { first, second } w gramach
export function collectNeeds(week, recipeMap) {
  const needs = {};
  const batchHalf = {}; // danie „na zapas” gotuje się w całości przy pierwszym użyciu
  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    for (const slot of SLOTS) {
      const m = day.meals[slot];
      const r = m && recipeMap[m.recipeId];
      if (!r) continue;
      let half = isSecondHalf(d, slot) ? 'second' : 'first';
      if (r.batch) {
        if (!batchHalf[r.id]) batchHalf[r.id] = half;
        half = batchHalf[r.id];
      }
      const f = (m.portions || 1) / (r.servings || 1);
      for (const it of r.ingredients) {
        const n = needs[it.id] || (needs[it.id] = { first: 0, second: 0 });
        n[half] += it.g * f;
      }
    }
  });
  return needs;
}

// ile gramów trafia do którego koszyka
export function splitTrips(ing, n) {
  const total = n.first + n.second;
  if (!ing.perishable) return { sobota: total, środa: 0 };
  if (ing.fresh) return { sobota: n.first, środa: n.second };
  return n.first > 0 ? { sobota: total, środa: 0 } : { sobota: 0, środa: total };
}

// zaokrąglenie do sztuk / opakowań
export function purchase(ing, grams) {
  if (ing.loose && ing.unit) {
    const n = Math.ceil(grams / ing.unit.grams - 1e-9);
    return { count: n, bought: n * ing.unit.grams, qty: `${n} szt.` };
  }
  const pack = ing.packGrams || 1;
  const n = Math.ceil(grams / pack - 1e-9);
  const single = /^1 szt/.test(ing.packLabel || '');
  return { count: n, bought: n * pack, qty: single ? `${n} szt.` : `${n} × ${ing.packLabel || `${pack} g`}` };
}

const round2 = (x) => Math.round(x * 100) / 100;

// koszt marnowanych resztek nietrwałych produktów (do oceny planu)
export function wasteCost(week, recipeMap, ingMap) {
  const needs = collectNeeds(week, recipeMap);
  let waste = 0;
  for (const id in needs) {
    const ing = ingMap[id];
    if (!ing || ing.pantry || !ing.perishable) continue;
    const split = splitTrips(ing, needs[id]);
    for (const trip of TRIPS) {
      const g = split[trip];
      if (g <= 0.001) continue;
      waste += ((purchase(ing, g).bought - g) * (ing.pricePerKg || 0)) / 1000;
    }
  }
  return waste;
}

/**
 * @param week        plan tygodnia
 * @param recipeMap   id → przepis
 * @param ingMap      id → składnik
 * @param opts.sections  kolejność działów w sklepie
 * @param opts.prev      lista z poprzedniego tygodnia (podpowiedź „powinno zostać”)
 */
export function buildShopping(week, recipeMap, ingMap, opts = {}) {
  const sections = opts.sections || [];
  const needs = collectNeeds(week, recipeMap);
  const left = {};
  for (const it of opts.prev?.items || []) {
    if (!it.ingredientId || it.manual) continue;
    left[it.ingredientId] = (left[it.ingredientId] || 0) + (it.bought || 0) - (it.need || 0);
  }

  const items = [];
  const pantry = [];
  let costUse = 0;
  for (const id of Object.keys(needs)) {
    const ing = ingMap[id];
    if (!ing) continue;
    const total = needs[id].first + needs[id].second;
    costUse += (total * (ing.pricePerKg || 0)) / 1000;
    if (ing.pantry) {
      pantry.push({ id: `pantry:${id}`, ingredientId: id, text: ing.name, need: Math.round(total), checked: false });
      continue;
    }
    const split = splitTrips(ing, needs[id]);
    for (const trip of TRIPS) {
      const g = split[trip];
      if (g <= 0.001) continue;
      const p = purchase(ing, g);
      const item = {
        id: `${trip}:${id}`,
        ingredientId: id,
        text: ing.name,
        qty: p.qty,
        count: p.count,
        need: Math.round(g),
        bought: p.bought,
        section: ing.section,
        trip,
        checked: false,
        costEst: round2((p.bought * (ing.pricePerKg || 0)) / 1000),
        ask: !!ing.ask,
      };
      if (!ing.perishable && left[id] >= g) {
        item.ask = true;
        item.hint = `z zeszłego tygodnia powinno zostać ok. ${Math.round(left[id])} g`;
      }
      items.push(item);
    }
  }

  const order = (s) => {
    const i = sections.indexOf(s);
    return i < 0 ? 99 : i;
  };
  items.sort((a, b) => order(a.section) - order(b.section) || a.text.localeCompare(b.text, 'pl'));
  pantry.sort((a, b) => a.text.localeCompare(b.text, 'pl'));
  return { items, pantry, costUse: round2(costUse), generatedAt: null };
}

export const tripCost = (list, trip) =>
  round2(list.items.filter((i) => i.trip === trip && !i.have).reduce((s, i) => s + (i.costEst || 0), 0));

export const storeCost = (list) => round2(TRIPS.reduce((s, t) => s + tripCost(list, t), 0));

// po zmianie planu: zachowaj odhaczenia i ręcznie dopisane pozycje
export function mergeShopping(prev, next) {
  if (!prev) return next;
  const old = byId(prev.items);
  for (const it of next.items) {
    const o = old[it.id];
    if (!o) continue;
    it.checked = !!o.checked && o.qty === it.qty;
    if (o.have) it.have = true;
  }
  const oldPantry = byId(prev.pantry || []);
  for (const it of next.pantry) it.checked = !!oldPantry[it.id]?.checked;
  next.items.push(...prev.items.filter((i) => i.manual));
  return next;
}

// tekst do schowka / Przypomnień — pozycja w linii, kolejność działów
export function shoppingLines(list, trip, { onlyOpen = true } = {}) {
  return list.items
    .filter((i) => i.trip === trip && !i.have && !(onlyOpen && i.checked))
    .map((i) => (i.qty ? `${i.text} — ${i.qty}` : i.text));
}

export function shortcutURL(lines, name = 'Zakupy z planu') {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(lines.join('\n'))}`;
}
