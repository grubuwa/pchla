// Claude bez API: szablony promptów do skopiowania i walidacja wklejonej odpowiedzi. Bez DOM.
import { SLOTS, SLOT_LABEL, SLOT_TYPE, TYPES, DAYS, fmtWeekRange, addDays, slugify, round10 } from './util.js';
import { adherence, weightTrend } from './stats.js';

// wyciąga pierwszy obiekt JSON z odpowiedzi (blok kodu albo goły tekst)
export function extractJSON(text) {
  const src = String(text || '');
  const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : src;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return { error: 'Nie widzę w tekście obiektu JSON — skopiuj całą odpowiedź Claude.' };
  try {
    return { value: JSON.parse(body.slice(a, b + 1)) };
  } catch (e) {
    return { error: `JSON jest uszkodzony (${e.message}). Poproś Claude o ponowne wypisanie odpowiedzi.` };
  }
}

const recipeLine = (r) =>
  `${r.id} | ${r.name} | ${r.type} | ${round10(r.perServing.kcal)} kcal | B ${Math.round(r.perServing.protein)} g | ${r.timeMin} min | ${r.tags.join(', ')}${r.wheatMain ? ` | pszenica (zamiennik: ${r.wheatSwap || 'brak'})` : ''}`;

export function planPrompt({ recipes, targets, rules, startSunday, calendar, weeks }) {
  const history = Object.values(weeks || {})
    .filter((w) => w.startSunday < startSunday && w.lunchA)
    .sort((a, b) => b.startSunday.localeCompare(a.startSunday))
    .slice(0, 4)
    .map((w) => `- ${fmtWeekRange(w.startSunday)}: A = ${w.lunchA}, B = ${w.lunchB}`);
  const exceptions = calendar
    .map((c, i) => {
      const bits = [];
      if (c.mode === 'poza domem') bits.push('poza domem — wszystkie sloty null');
      if (c.mode === 'zjazd') bits.push('zjazd stacjonarny — w slocie lunch kanapki do zabrania (przepis typu kolacja „Kanapki…”), śniadanie i przekąska z tagiem „do pracy”');
      if (c.guest) bits.push('kolacja z dziewczyną — danie bez pszenicy w roli głównej albo z zamiennikiem');
      return bits.length ? `- ${DAYS[i]} (${addDays(startSunday, i)}): ${bits.join('; ')}` : null;
    })
    .filter(Boolean);

  return `Ułóż mi jadłospis na tydzień ${fmtWeekRange(startSunday)} (niedziela → sobota) do mojej aplikacji „pchła”. Używaj wyłącznie przepisów z listy poniżej (po ID).

CELE DZIENNE
- ${targets.kcalMin}–${targets.kcalMax} kcal (cel ${targets.kcal}), białko ≥ ${targets.proteinMin} g, błonnik ≥ ${targets.fiberMin} g, tłuszcze nasycone ≤ ${targets.satFatMax} g (średnio w tygodniu)
- sloty i orientacyjne kcal: śniadanie ~420, lunch ~620, przekąska ~210, kolacja ~500, wieczorem ~150

STRUKTURA TYGODNIA
- lunch A (gotowany w niedzielę, 4 porcje): niedziela, poniedziałek, wtorek, środa — slot „lunch”
- lunch B (gotowany w środę po pracy, do 60 min, 4 porcje): środa — slot „kolacja”; czwartek, piątek, sobota — slot „lunch”
- śniadania i przekąski w dni robocze (pn–pt) muszą mieć tag „do pracy”
- kolacje (poza środą): typ „kolacja”, do 20 min, bez tagu „awaryjne”, bez powtórek w tygodniu

REGUŁY
${rules.map((r) => `- ${r}`).join('\n')}

WYJĄTKI W TYM TYGODNIU
${exceptions.length ? exceptions.join('\n') : '- brak (zwykły tydzień)'}

OSTATNIE LUNCHE (nie powtarzaj wcześniej niż po 3 tygodniach)
${history.length ? history.join('\n') : '- brak historii (pierwszy tydzień)'}

PRZEPISY (id | nazwa | typ | kcal na porcję | białko | czas | tagi)
${recipes.map(recipeLine).join('\n')}

FORMAT ODPOWIEDZI
Odpowiedz wyłącznie jednym blokiem kodu JSON, bez komentarza:
\`\`\`json
{
  "lunchA": "id_przepisu",
  "lunchB": "id_przepisu",
  "days": [
    { "day": "Niedziela", "sniadanie": "id", "lunch": "id", "przekaska": "id", "kolacja": "id", "wieczor": "id" }
  ]
}
\`\`\`
Dokładnie 7 dni w kolejności: ${DAYS.join(', ')}. W dniu „poza domem” wpisz null we wszystkich slotach.`;
}

function slotAccepts(slot, r, mode) {
  if (slot === 'lunch') return r.type === 'lunch' || (mode === 'zjazd' && r.type === 'kolacja');
  if (slot === 'kolacja') return r.type === 'kolacja' || r.type === 'lunch';
  return r.type === SLOT_TYPE[slot];
}

// → { ok, errors, template } ; template ma format „sprawdzonego tygodnia”
export function validatePlan(obj, recipeMap, calendar = []) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Odpowiedź nie jest obiektem JSON.'] };
  if (!Array.isArray(obj.days) || obj.days.length !== 7) {
    return { ok: false, errors: [`Plan musi mieć 7 dni (niedziela → sobota), a ma ${Array.isArray(obj.days) ? obj.days.length : 0}.`] };
  }
  const days = obj.days.map((d, i) => {
    const out = {};
    const mode = calendar[i]?.mode || 'normal';
    for (const s of SLOTS) {
      const id = d?.[s] ?? null;
      out[s] = null;
      if (id === null || id === '') {
        if (mode !== 'poza domem') errors.push(`${DAYS[i]} · ${SLOT_LABEL[s]}: brak przepisu.`);
        continue;
      }
      const r = recipeMap[id];
      if (!r) {
        errors.push(`${DAYS[i]} · ${SLOT_LABEL[s]}: nie znam przepisu „${id}”.`);
        continue;
      }
      if (!slotAccepts(s, r, mode)) {
        errors.push(`${DAYS[i]} · ${SLOT_LABEL[s]}: „${r.name}” to ${r.type}, nie pasuje do tego slotu.`);
        continue;
      }
      out[s] = id;
    }
    return out;
  });
  const lunchOf = (id, fallback) => (recipeMap[id]?.type === 'lunch' ? id : fallback || null);
  const template = {
    name: '',
    lunchA: lunchOf(obj.lunchA, days[0].lunch || days[1].lunch),
    lunchB: lunchOf(obj.lunchB, days[4].lunch || days[5].lunch),
    days,
  };
  if (!template.lunchA) errors.push('Brak poprawnego lunchu A.');
  if (!template.lunchB) errors.push('Brak poprawnego lunchu B.');
  return { ok: errors.length === 0, errors, template };
}

export function recipePrompt({ ingredients, sections, source }) {
  return `Przerób poniższy przepis na format mojej aplikacji do planowania posiłków („pchła”).

MOJE ZAŁOŻENIA
- redukcja: lżejsze wersje, chude mięso, olej rzepakowy lub oliwa zamiast masła, mało tłuszczów nasyconych, dużo białka i warzyw
- typy posiłków i orientacyjne kcal na porcję: śniadanie ~420, lunch ~620 (na zapas, 4 porcje), przekąska ~210, kolacja ~500 (do 20 min), przekąska wieczorna ~150
- ilości składników w gramach w stanie ważenia (suche kasze/ryż/makaron, surowe mięso, odsączone puszki), dla całego przepisu

KATALOG SKŁADNIKÓW (id — nazwa). Używaj tych ID zawsze, gdy składnik pasuje:
${ingredients.map((i) => `${i.id} — ${i.name}`).join('\n')}

Jeśli składnika nie ma w katalogu, dodaj go do "newIngredients" z wartościami na 100 g i orientacyjną ceną (Lidl/Biedronka). Przyprawy suche wpisz tylko tekstem w "spices".

FORMAT ODPOWIEDZI
Odpowiedz wyłącznie jednym blokiem kodu JSON:
\`\`\`json
{
  "recipe": {
    "name": "Nazwa dania",
    "type": "${TYPES.join(' | ')}",
    "servings": 4,
    "timeMin": 30,
    "ingredients": [{ "id": "piers_kurczaka", "g": 500, "note": "opcjonalnie, np. 2 szt." }],
    "steps": ["Krok 1…", "Krok 2…"],
    "spices": "sól, pieprz",
    "fridgeDays": 3,
    "freezer": false,
    "batch": true,
    "tags": ["na zapas", "do pracy", "bez pszenicy", "szybkie", "bez gotowania", "ryba", "strączki", "owies"],
    "wheatMain": false,
    "wheatSwap": "",
    "notes": ""
  },
  "newIngredients": [
    { "id": "snake_case", "name": "Nazwa", "section": "${sections.join(' | ')}", "kcal": 0, "protein": 0, "fat": 0, "satFat": 0, "carbs": 0, "fiber": 0, "pricePerKg": 0, "packGrams": 0, "packLabel": "opak. 500 g", "pantry": false, "wheat": false, "perishable": true, "unit": null }
  ]
}
\`\`\`
W "tags" zostaw tylko te, które pasują. "unit" to null albo { "name": "szt.", "grams": 60 }.

PRZEPIS DO PRZEROBIENIA
${source?.trim() || '[wklej tutaj link albo tekst przepisu]'}`;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// → { ok, errors, recipe, newIngredients }
export function validateRecipe(obj, ingMap, sections = []) {
  const errors = [];
  const src = obj?.recipe || obj;
  if (!src || typeof src !== 'object') return { ok: false, errors: ['Odpowiedź nie zawiera przepisu.'] };

  const newIngredients = [];
  for (const n of Array.isArray(obj.newIngredients) ? obj.newIngredients : []) {
    if (!n || !n.name) {
      errors.push('Nowy składnik bez nazwy.');
      continue;
    }
    const id = slugify(n.id || n.name);
    if (ingMap[id]) continue; // już jest w katalogu
    for (const k of ['kcal', 'protein', 'fat', 'satFat', 'carbs', 'fiber']) {
      if (!isNum(n[k]) || n[k] < 0) errors.push(`Składnik „${n.name}”: brak wartości „${k}” na 100 g.`);
    }
    newIngredients.push({
      id,
      name: String(n.name),
      section: sections.includes(n.section) ? n.section : 'Inne',
      kcal: +n.kcal || 0, protein: +n.protein || 0, fat: +n.fat || 0, satFat: +n.satFat || 0, carbs: +n.carbs || 0, fiber: +n.fiber || 0,
      pricePerKg: +n.pricePerKg || 0,
      packGrams: +n.packGrams || 100,
      packLabel: String(n.packLabel || ''),
      pantry: !!n.pantry,
      wheat: !!n.wheat,
      perishable: n.perishable !== false,
      unit: n.unit && n.unit.name && isNum(n.unit.grams) ? { name: String(n.unit.name), grams: n.unit.grams } : null,
    });
  }
  const known = { ...ingMap };
  for (const n of newIngredients) known[n.id] = n;

  if (!src.name) errors.push('Przepis nie ma nazwy.');
  if (!TYPES.includes(src.type)) errors.push(`Nieznany typ posiłku: „${src.type}”. Dozwolone: ${TYPES.join(', ')}.`);
  if (!isNum(src.servings) || src.servings < 1) errors.push('Liczba porcji musi być liczbą ≥ 1.');
  const ingredients = [];
  if (!Array.isArray(src.ingredients) || !src.ingredients.length) errors.push('Przepis nie ma składników.');
  for (const it of src.ingredients || []) {
    const id = known[it?.id] ? it.id : slugify(it?.id || '');
    if (!known[id]) {
      errors.push(`Nieznany składnik „${it?.id}” — brak go w katalogu i w „newIngredients”.`);
      continue;
    }
    if (!isNum(it.g) || it.g <= 0) {
      errors.push(`Składnik „${known[id].name}”: ilość w gramach musi być liczbą > 0.`);
      continue;
    }
    ingredients.push(it.note ? { id, g: it.g, note: String(it.note) } : { id, g: it.g });
  }
  const steps = (Array.isArray(src.steps) ? src.steps : []).map(String).filter((s) => s.trim());
  if (!steps.length) errors.push('Przepis nie ma kroków.');

  const recipe = {
    id: `wl_${slugify(src.name || 'przepis')}`,
    name: String(src.name || ''),
    type: src.type,
    servings: src.servings,
    timeMin: isNum(src.timeMin) ? src.timeMin : 0,
    ingredients,
    steps,
    spices: String(src.spices || ''),
    fridgeDays: isNum(src.fridgeDays) ? src.fridgeDays : null,
    freezer: !!src.freezer,
    batch: !!src.batch,
    tags: (Array.isArray(src.tags) ? src.tags : []).map(String),
    rating: 'propozycja',
    wheatMain: !!src.wheatMain,
    wheatSwap: String(src.wheatSwap || ''),
    notes: String(src.notes || ''),
    custom: true,
  };
  return { ok: errors.length === 0, errors, recipe, newIngredients };
}

// kontekst do rozmowy z „dietetykiem” w claude.ai
export function dietitianContext({ targets, weights, weeks, log, labs, recipeMap, today }) {
  const lastWeeks = Object.values(weeks || {})
    .filter((w) => w.startSunday <= today)
    .sort((a, b) => b.startSunday.localeCompare(a.startSunday))
    .slice(0, 4);
  const from = lastWeeks.length ? lastWeeks[lastWeeks.length - 1].startSunday : addDays(today, -28);
  const w = [...(weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  const trend = weightTrend(w);
  const lines = [];

  lines.push('Jesteś moim dietetykiem. Poniżej moje cele, pomiary i to, jak trzymałem się planu w ostatnich tygodniach. Oceń postęp i zaproponuj konkretne korekty (bez liczenia kalorii co do grama).');
  lines.push('', 'CELE');
  lines.push(`- ${targets.kcalMin}–${targets.kcalMax} kcal dziennie, białko ${targets.proteinMin}–${targets.proteinMax} g, błonnik ≥ ${targets.fiberMin} g, tłuszcze nasycone ≤ ${targets.satFatMax} g`);
  lines.push(`- waga: start ${targets.weightStart} kg → etap 1: ${targets.weightStage1} kg → cel: ${targets.weightGoal} kg; kroki: ${targets.stepsGoal}/dzień`);

  lines.push('', 'WAGA (ważenie raz w tygodniu, rano na czczo)');
  if (!w.length) lines.push('- brak pomiarów');
  for (const p of w.slice(-6)) {
    lines.push(`- ${p.date}: ${String(p.kg).replace('.', ',')} kg${p.waistCm ? `, pas ${p.waistCm} cm` : ''}${p.steps ? `, śr. ${p.steps} kroków` : ''}`);
  }
  if (trend.perWeek !== null) lines.push(`- trend: ${trend.perWeek.toFixed(2).replace('.', ',')} kg/tydzień`);

  lines.push('', 'TRZYMANIE SIĘ PLANU (ostatnie tygodnie)');
  if (!lastWeeks.length) lines.push('- brak zakończonych tygodni');
  for (const wk of lastWeeks) {
    const a = adherence(wk);
    const lunches = [wk.lunchA, wk.lunchB].map((id) => recipeMap[id]?.name).filter(Boolean).join(' / ');
    lines.push(`- ${fmtWeekRange(wk.startSunday)}: ${a.eaten}/${a.planned} wg planu, ${a.swapped} zamienionych, ${a.skipped} pominiętych${lunches ? ` · lunche: ${lunches}` : ''}`);
  }

  const off = (log || []).filter((e) => e.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  lines.push('', 'POZA PLANEM');
  if (!off.length) lines.push('- nic nie wpisałem');
  for (const e of off) lines.push(`- ${e.date}${e.slot ? ` (${SLOT_LABEL[e.slot].toLowerCase()})` : ''}: ${e.label}, ok. ${e.kcal} kcal`);

  if (labs?.length) {
    lines.push('', 'BADANIA');
    for (const l of [...labs].sort((a, b) => a.date.localeCompare(b.date))) lines.push(`- ${l.date}: ${l.name} ${String(l.value).replace('.', ',')} ${l.unit}`);
  }
  return lines.join('\n');
}
