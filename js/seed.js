// Dane startowe: przepisy.json → stan aplikacji przy pierwszym uruchomieniu. Bez DOM.
import { enrichIngredient, buildShopping } from './shopping.js';
import { DEFAULT_REMINDERS } from './ics.js';
import { weekFromTemplate } from './planner.js';
import { addDays, dow, weekStart, clone, byId } from './util.js';

// emoji + krótka nazwa do komunikatów („Spakuj: serek + teriyaki + skyr pitny”)
const META = {
  sn_serek_wiejski: ['🥣', 'Serek wiejski'],
  sn_twarozek: ['🌱', 'Twarożek'],
  sn_muffinki: ['🧁', 'Muffinki jajeczne'],
  sn_wrap_jajecznica: ['🌯', 'Wrap z jajecznicą'],
  sn_skyr_owies: ['🫐', 'Skyr z owsem'],
  sn_placuszki: ['🥞', 'Placuszki owsiane'],
  sn_owsianka_nocna: ['🌙', 'Owsianka nocna'],
  sn_pasta_tunczyk: ['🐟', 'Kanapki z pastą z tuńczyka'],
  sn_jajecznica: ['🍳', 'Jajecznica'],
  pr_skyr_pitny: ['🥤', 'Skyr pitny'],
  pr_jablko_orzechy: ['🍎', 'Jabłko + orzechy'],
  pr_warzywa_hummus: ['🥕', 'Warzywa z hummusem'],
  pr_wafle_twarozek: ['🍘', 'Wafle z twarożkiem'],
  pr_banan_kefir: ['🍌', 'Banan + kefir'],
  wi_skyr_borowki: ['🫐', 'Skyr z borówkami'],
  wi_jajka: ['🥚', '2 jajka + ogórek'],
  wi_serek: ['🥣', 'Serek wiejski'],
  wi_kefir: ['🥛', 'Kefir + orzechy'],
  wi_jablko: ['🍏', 'Jabłko + masło orzechowe'],
  lu_chilli: ['🌶️', 'Chilli con carne'],
  lu_teriyaki: ['🍗', 'Kurczak teriyaki'],
  lu_udon: ['🍜', 'Udon z kurczakiem'],
  lu_curry: ['🍛', 'Curry z kurczakiem'],
  lu_tikka: ['🥘', 'Kurczak tikka masala'],
  lu_pulpety: ['🍅', 'Pulpety drobiowe'],
  lu_gulasz: ['🍲', 'Gulasz wołowy'],
  lu_blacha: ['🥔', 'Kurczak z blachy'],
  lu_zapiekanka: ['🥦', 'Zapiekanka makaronowa'],
  lu_burrito: ['🌮', 'Burrito bowl'],
  lu_kotlety: ['🍽️', 'Kotlety drobiowe'],
  lu_makaron_szpinak: ['🍝', 'Makaron z kurczakiem'],
  lu_bulgur_warzywa: ['🍆', 'Bulgur z kurczakiem'],
  lu_wolowina_koreanska: ['🥢', 'Wołowina po koreańsku'],
  ko_tosty: ['🥪', 'Tosty z serem i szynką'],
  ko_kanapki_twarozek: ['🍞', 'Kanapki z twarożkiem'],
  ko_kanapki_serek: ['🥪', 'Kanapki z serkiem wiejskim'],
  ko_jajko_sadzone: ['🍳', 'Kanapki z jajkiem sadzonym'],
  ko_jajecznica: ['🍳', 'Jajecznica'],
  ko_wrap_kurczak: ['🌯', 'Wrap z kurczakiem'],
  ko_wrap_losos: ['🍣', 'Wrap z łososiem'],
  ko_wrap_hummus: ['🥙', 'Wrap z hummusem'],
  ko_quesadilla: ['🫓', 'Quesadilla'],
  ko_pizza_tortilla: ['🍕', 'Pizza na tortilli'],
  ko_salatka_kurczak: ['🥗', 'Sałatka z kurczakiem'],
  ko_salatka_grecka: ['🫒', 'Sałatka grecka'],
  ko_salatka_tunczyk: ['🥫', 'Sałatka z tuńczykiem'],
  ko_ziemniaki_twarozek: ['🥔', 'Ziemniaki z twarożkiem'],
  ko_kurczak_warzywa: ['🥘', 'Kurczak z warzywami'],
  ko_kurczak_lidl: ['🍗', 'Kurczak z Lidla + surówka'],
  ko_zapiekanka_bulka: ['🥖', 'Zapiekanka z bułki'],
  ko_zupa_kanapka: ['🍵', 'Zupa + kanapka'],
  ko_pierogi: ['🥟', 'Pierogi z surówką'],
  ko_miska_skyr: ['🍓', 'Miska skyr z owocami'],
  ko_kanapki_makrela: ['🐟', 'Kanapki z pastą z makreli'],
};

export const TYPE_EMOJI = {
  'śniadanie': '🍳',
  lunch: '🍲',
  'przekąska': '🍎',
  kolacja: '🥗',
  'przekąska wieczorna': '🌙',
};

export const emojiOf = (r) => r?.emoji || TYPE_EMOJI[r?.type] || '🍽️';

export function prepareCatalog(data) {
  const ingredients = clone(data.ingredients).map(enrichIngredient);
  const recipes = clone(data.recipes).map((r) => {
    const m = META[r.id];
    if (m) {
      r.emoji = m[0];
      r.short = m[1];
    }
    return r;
  });
  return { ingredients, recipes };
}

// wartości zalecane z rozdz. 3 założeń
export const LAB_REFS = {
  'Glukoza': { unit: 'mg/dl', min: 70, max: 99, ref: '70–99' },
  'Cholesterol całkowity': { unit: 'mg/dl', max: 190, ref: '< 190' },
  'LDL': { unit: 'mg/dl', max: 115, ref: '< 115' },
  'nie-HDL': { unit: 'mg/dl', max: 130, ref: '< 130' },
  'HDL': { unit: 'mg/dl', min: 40, ref: '> 40' },
  'Trójglicerydy': { unit: 'mg/dl', max: 100, ref: '< 100' },
  'Lp(a)': { unit: 'nmol/l', max: 75, ref: '< 75' },
  'TSH': { unit: 'mIU/l', min: 0.27, max: 4.2, ref: '0,27–4,2' },
};

const LAB_KEYS = {
  glukoza: 'Glukoza',
  'cholesterol całkowity': 'Cholesterol całkowity',
  HDL: 'HDL',
  'nie-HDL': 'nie-HDL',
  LDL: 'LDL',
  'trójglicerydy': 'Trójglicerydy',
  'Lp(a)': 'Lp(a)',
  TSH: 'TSH',
};

export function labsFromSeed(labs) {
  const out = [];
  for (const [key, raw] of Object.entries(labs?.results || {})) {
    const name = LAB_KEYS[key];
    const value = parseFloat(String(raw).replace(',', '.'));
    if (!name || !Number.isFinite(value)) continue;
    out.push({ date: labs.date, name, value, unit: LAB_REFS[name].unit });
  }
  return out;
}

// w sobotę planuje się kolejny tydzień; w pozostałe dni — bieżący
export const planningWeek = (today) => (dow(today) === 6 ? addDays(today, 1) : weekStart(today));

export function initialState(data, today) {
  const catalog = prepareCatalog(data);
  const t = data.targets;
  const start = planningWeek(today);
  const week = weekFromTemplate(data.sampleWeek, start);
  week.approved = true;
  const list = buildShopping(week, byId(catalog.recipes), byId(catalog.ingredients), { sections: data.shopSections });
  list.generatedAt = today;

  const user = {
    v: 1,
    createdAt: today,
    targets: {
      kcal: t.kcalPerDay,
      kcalMin: t.kcalRange[0],
      kcalMax: t.kcalRange[1],
      proteinMin: t.proteinG[0],
      proteinMax: t.proteinG[1],
      fiberMin: t.fiberGmin,
      satFatMax: t.satFatGmax,
      stepsGoal: t.stepsGoal,
      weightStart: t.weight.start,
      weightStage1: t.weight.stage1,
      weightGoal: t.weight.longTerm,
      budget: 220,
      budgetMax: 300,
    },
    times: {
      sniadanie: data.schedule.weekdays.breakfast,
      lunch: data.schedule.weekdays.lunch,
      przekaska: data.schedule.weekdays.snack,
      kolacja: data.schedule.weekdays.dinner,
      wieczor: data.schedule.weekdays.eveningSnack,
      kitchenClosed: data.schedule.weekdays.kitchenClosed,
      sleep: data.schedule.weekdays.sleepGoal,
    },
    reminders: { ...DEFAULT_REMINDERS },
    remindersOff: {},
    weeks: { [start]: week },
    shopping: { [start]: list },
    tasks: {},
    log: [],
    weights: [],
    labs: labsFromSeed(data.labs),
    labFollowUp: addDays(today, 90),
    templates: [{ id: 'tpl_tydzien_1', name: 'Tydzień 1 (teriyaki + chilli)', lunchA: data.sampleWeek.lunchA, lunchB: data.sampleWeek.lunchB, days: data.sampleWeek.days.map((d) => ({ sniadanie: d.sniadanie, lunch: d.lunch, przekaska: d.przekaska, kolacja: d.kolacja, wieczor: d.wieczor })) }],
    presets: clone(data.quickLogPresets),
    rules: clone(data.rules),
    sections: clone(data.shopSections),
    flags: { doctorDone: false, lastBackup: null },
  };
  return { user, catalog };
}
