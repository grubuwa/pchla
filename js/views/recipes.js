// Przepisy: lista z filtrami, karta przepisu ze skalowaniem, tryb gotowania, edytor, wybór przepisu.
import { S, commit } from '../store.js';
import { TYPES, round10, norm, num, zl, slugify, clone, uid } from '../util.js';
import { computePerServing } from '../nutrition.js';
import { emojiOf, TYPE_EMOJI } from '../seed.js';
import { h, icon, openSheet, actionSheet, confirmSheet, pageHeader, iconButton, chip, stepper, switchEl, field, toast } from '../ui.js';
import { openRecipeImport } from './claude-ui.js';

const TYPE_PLURAL = { 'śniadanie': 'Śniadania', lunch: 'Lunche', 'przekąska': 'Przekąski 15:00', kolacja: 'Kolacje', 'przekąska wieczorna': 'Wieczorem' };
const TYPE_SHORT = { 'śniadanie': 'Śniadania', lunch: 'Lunche', 'przekąska': 'Przekąski', kolacja: 'Kolacje', 'przekąska wieczorna': 'Wieczór' };
const FILTERS = ['do pracy', 'bez pszenicy', 'do 15 min', 'na zapas', 'bez gotowania', 'ryba', 'strączki', 'owies'];
const ALL_TAGS = ['do pracy', 'w domu', 'na zapas', 'szybkie', 'bez gotowania', 'ryba', 'strączki', 'owies', 'azjatyckie', 'jedna blacha', 'mrozi się', 'awaryjne', 'weekend'];

const matchTag = (r, tag) => {
  if (tag === 'bez pszenicy') return !r.wheatMain;
  if (tag === 'do 15 min') return r.timeMin <= 15;
  return r.tags.includes(tag);
};

function filterRecipes(recipes, { q, type, tags }) {
  const needle = norm(q || '');
  return recipes.filter((r) => {
    if (type && type !== 'all' && r.type !== type) return false;
    for (const t of tags) if (!matchTag(r, t)) return false;
    if (!needle) return true;
    if (norm(r.name).includes(needle)) return true;
    return r.ingredients.some((i) => norm(S.ingMap[i.id]?.name || '').includes(needle));
  });
}

const metaLine = (r) => [r.timeMin ? `${r.timeMin} min` : 'bez przygotowania', `~${round10(r.perServing.kcal)} kcal`, `${Math.round(r.perServing.protein)} g białka`].join(' · ');

function recipeRow(r, { onclick, current, trailing } = {}) {
  return h(
    'button',
    { class: `row row-btn inset${current ? ' current' : ''}`, type: 'button', onclick },
    h('span', { class: 'emoji tile' }, emojiOf(r)),
    h('span', { class: 'grow' }, h('span', { class: 'row-title' }, r.name), h('span', { class: 'row-sub' }, metaLine(r)), trailing),
    current ? icon('check', 20) : h('span', { class: 'ic chev' }, icon('right', 18)),
  );
}

function searchBox(value, placeholder, oninput) {
  return h('div', { class: 'search' }, icon('search', 18), h('input', { class: 'input', type: 'search', placeholder, value, autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search', oninput: (e) => oninput(e.target.value) }));
}

/* ——— lista ——— */

const view = { q: '', type: 'all', tags: new Set() };

function listNodes() {
  const found = filterRecipes(S.catalog.recipes, view);
  if (!found.length) {
    return [h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🔍'), h('h3', {}, 'Nic nie pasuje'), h('p', {}, 'Zmień filtry albo dodaj własny przepis.'), h('button', { class: 'btn secondary', type: 'button', onclick: () => ((view.q = ''), (view.type = 'all'), view.tags.clear(), rerender()) }, 'Wyczyść filtry'))];
  }
  if (view.type !== 'all') return [h('div', { class: 'list' }, found.map((r) => recipeRow(r, { onclick: () => openRecipe(r.id) })))];
  const out = [];
  for (const type of TYPES) {
    const group = found.filter((r) => r.type === type);
    if (!group.length) continue;
    out.push(h('div', { class: 'group-label' }, `${TYPE_PLURAL[type]} · ${group.length}`), h('div', { class: 'list' }, group.map((r) => recipeRow(r, { onclick: () => openRecipe(r.id) }))));
  }
  return out;
}

let listEl = null;
let rerender = () => {};

export function render() {
  listEl = h('div', {}, listNodes());
  const chipsEl = h('div', { class: 'chips' });
  const typesEl = h('div', { class: 'chips', style: { marginBottom: '10px' } });
  const drawChips = () => {
    typesEl.replaceChildren(
      chip('Wszystkie', view.type === 'all', () => ((view.type = 'all'), rerender())),
      ...TYPES.map((t) => chip(TYPE_SHORT[t], view.type === t, () => ((view.type = view.type === t ? 'all' : t), rerender()))),
    );
    chipsEl.replaceChildren(...FILTERS.map((t) => chip(t, view.tags.has(t), () => (view.tags.has(t) ? view.tags.delete(t) : view.tags.add(t), rerender()))));
  };
  rerender = () => {
    drawChips();
    listEl.replaceChildren(...listNodes());
  };
  drawChips();
  return [
    pageHeader(
      'Przepisy',
      `${S.catalog.recipes.length} w bazie`,
      iconButton('plus', 'Dodaj przepis', () =>
        actionSheet('Nowy przepis', [
          { icon: 'edit', label: 'Wpisz ręcznie', detail: 'składniki z katalogu, kcal policzą się same', onSelect: () => openRecipeEditor(null) },
          { icon: 'sparkle', label: 'Importuj z Claude', detail: 'wklej link lub tekst — Claude przerobi na format aplikacji', onSelect: () => openRecipeImport() },
        ]),
      ),
    ),
    searchBox(view.q, 'Szukaj przepisu lub składnika', (v) => ((view.q = v), listEl.replaceChildren(...listNodes()))),
    typesEl,
    chipsEl,
    h('div', { style: { height: '4px' } }),
    listEl,
  ];
}

/* ——— ilości ——— */

const PLURAL = {
  plaster: ['plaster', 'plastry', 'plastrów'],
  kubek: ['kubek', 'kubki', 'kubków'],
  butelka: ['butelka', 'butelki', 'butelek'],
  'ząbek': ['ząbek', 'ząbki', 'ząbków'],
  kromka: ['kromka', 'kromki', 'kromek'],
  'łyżka': ['łyżka', 'łyżki', 'łyżek'],
  'łyżeczka': ['łyżeczka', 'łyżeczki', 'łyżeczek'],
};

function unitWord(name, n) {
  const forms = PLURAL[name];
  if (!forms) return name;
  if (!Number.isInteger(n)) return forms[1];
  if (n === 1) return forms[0];
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? forms[1] : forms[2];
}

export function fmtGrams(g) {
  const v = g >= 100 ? Math.round(g / 5) * 5 : g >= 10 ? Math.round(g) : Math.round(g * 10) / 10;
  return `${String(v).replace('.', ',')} g`;
}

export function fmtUnits(g, unit) {
  if (!unit) return null;
  const n = Math.round((g / unit.grams) * 2) / 2;
  if (n <= 0) return null;
  const whole = Math.floor(n);
  const text = `${whole || ''}${n - whole ? '½' : ''}`;
  return `${text} ${unitWord(unit.name, n)}`;
}

/* ——— karta przepisu ——— */

export function openRecipe(id, { portions } = {}) {
  let servings = portions || S.recipeMap[id]?.servings || 1;
  const sheet = openSheet({
    title: 'Przepis',
    full: true,
    live: true,
    body: () => {
      const r = S.recipeMap[id];
      if (!r) return [h('div', { class: 'empty' }, 'Ten przepis został usunięty.')];
      const f = servings / r.servings;
      const p = r.perServing;
      return [
        h(
          'div',
          { class: 'recipe-hero' },
          h('div', { class: 'big' }, emojiOf(r)),
          h('h2', {}, r.name),
          h(
            'div',
            { class: 'tags' },
            h('span', { class: 'tag accent' }, r.type),
            h('span', { class: 'tag' }, r.timeMin ? `${r.timeMin} min` : '0 min'),
            r.tags.map((t) => h('span', { class: 'tag' }, t)),
            r.wheatMain && h('span', { class: 'tag red' }, 'pszenica'),
            r.rating !== 'chcę' && h('span', { class: 'tag blue' }, r.rating),
          ),
        ),
        h(
          'div',
          { class: 'stats four', style: { gridTemplateColumns: 'repeat(4, 1fr)' } },
          h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${round10(p.kcal)}`), h('div', { class: 'stat-label' }, 'kcal')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${Math.round(p.protein)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'białko')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${Math.round(p.fiber)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'błonnik')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${Math.round(p.satFat)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'tł. nasyc.')),
        ),
        h('p', { class: 'caption' }, `Na porcję, orientacyjnie · koszt ok. ${zl(p.cost)} · tłuszcz ${Math.round(p.fat)} g · węglowodany ${Math.round(p.carbs)} g`),

        h('h2', { class: 'section' }, 'Składniki'),
        h('div', { class: 'card portion-bar' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Porcje'), servings !== r.servings && h('span', { class: 'row-sub' }, `przepis bazowy: ${r.servings}`)), stepper(servings, (v) => ((servings = v), sheet.refresh()), { min: 1, max: 12 })),
        h('div', { style: { height: '12px' } }),
        h(
          'div',
          { class: 'list' },
          r.ingredients.map((it) => {
            const ing = S.ingMap[it.id];
            const g = it.g * f;
            const units = fmtUnits(g, ing?.unit);
            return h(
              'div',
              { class: 'row ing' },
              h('span', { class: 'grow' }, h('span', { class: 'row-title' }, ing?.name || it.id), !units && it.note && f === 1 && h('span', { class: 'row-sub' }, it.note)),
              h('span', { class: 'amount' }, h('b', {}, fmtGrams(g)), units && ` · ${units}`),
            );
          }),
          r.spices && h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Przyprawy'), h('span', { class: 'row-sub' }, r.spices))),
        ),

        h('h2', { class: 'section' }, 'Przygotowanie'),
        h('div', { class: 'list' }, r.steps.map((s, i) => h('div', { class: 'step' }, h('span', { class: 'step-n' }, i + 1), h('span', { class: 'grow' }, s)))),
        servings !== r.servings && h('p', { class: 'caption' }, `Ilości wymienione w krokach dotyczą przepisu na ${r.servings} ${r.servings === 1 ? 'porcję' : 'porcje'}.`),

        r.wheatSwap && h('div', { class: 'note warm' }, '🌾', h('span', {}, h('b', {}, 'Bez pszenicy: '), r.wheatSwap)),
        (r.fridgeDays || r.freezer) && h('div', { class: 'note' }, '🧊', h('span', {}, [r.fridgeDays && `W lodówce do ${r.fridgeDays} dni.`, r.freezer && 'Można mrozić (awaryjnie 2–3 porcje).'].filter(Boolean).join(' '))),
        r.notes && h('div', { class: 'note' }, '📝', h('span', {}, r.notes)),

        h(
          'div',
          { class: 'btn-row', style: { marginTop: '20px' } },
          h('button', { class: 'btn gray', type: 'button', onclick: () => openRecipeEditor(r) }, icon('edit', 19), 'Edytuj'),
          h(
            'button',
            {
              class: 'btn danger',
              type: 'button',
              onclick: async () => {
                if (!(await confirmSheet('Usunąć przepis?', `„${r.name}” zniknie z bazy. W zaplanowanych tygodniach zostaną puste pozycje.`, 'Usuń przepis', { destructive: true }))) return;
                sheet.close();
                commit((u, c) => (c.recipes = c.recipes.filter((x) => x.id !== r.id)), { catalog: true });
                toast('Przepis usunięty');
              },
            },
            icon('trash', 19),
            'Usuń',
          ),
        ),
      ];
    },
    footer: () => {
      const r = S.recipeMap[id];
      return r && r.steps.length ? h('button', { class: 'btn', type: 'button', onclick: () => openCook(r, servings) }, icon('play', 19), 'Tryb gotowania') : null;
    },
  });
  return sheet;
}

/* ——— tryb gotowania: duża czcionka, krok po kroku, ekran nie gaśnie, minutniki ——— */

function findTimers(text) {
  const out = [];
  const re = /(\d+)(?:\s*[–-]\s*(\d+))?\s*(min|sek|godz|s|h)(?![a-ząćęłńóśźż])/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[2] || m[1]);
    const unit = m[3].toLowerCase();
    const sec = n * (unit === 'min' ? 60 : unit === 'godz' || unit === 'h' ? 3600 : 1);
    if (sec >= 10 && sec <= 4 * 3600) out.push({ label: m[0].trim(), sec });
  }
  return out;
}

const clock = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${hh ? `${hh}:` : ''}${hh ? String(mm).padStart(2, '0') : mm}:${String(s % 60).padStart(2, '0')}`;
};

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.22);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* bez dźwięku */
  }
  navigator.vibrate?.([200, 100, 200, 100, 200]);
}

export function openCook(r, servings) {
  const f = servings / r.servings;
  const steps = ['__ing__', ...r.steps];
  let i = 0;
  const timers = {}; // `${krok}:${n}` → { end, done }
  let lock = null;
  let tick = null;

  const acquire = async () => {
    try {
      lock = await navigator.wakeLock?.request('screen');
    } catch {
      lock = null;
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && acquire();
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') close();
  };

  const root = h('div', { class: 'cook', role: 'dialog', 'aria-label': `Tryb gotowania: ${r.name}` });
  const close = () => {
    clearInterval(tick);
    lock?.release?.().catch(() => {});
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('keydown', onKey, true);
    root.remove();
  };
  const go = (d) => {
    const n = i + d;
    if (n >= steps.length) return close();
    if (n < 0) return;
    i = n;
    draw(true);
  };

  const timerButtons = () => {
    const found = i === 0 ? [] : findTimers(steps[i]);
    if (!found.length) return null;
    return h(
      'div',
      { class: 'timers' },
      found.map((t, n) => {
        const key = `${i}:${n}`;
        const st = timers[key];
        const left = st ? (st.end - Date.now()) / 1000 : t.sec;
        const cls = st ? (left <= 0 ? 'done' : 'running') : '';
        return h(
          'button',
          {
            type: 'button',
            class: `timer ${cls}`,
            onclick: () => {
              if (timers[key]) delete timers[key];
              else timers[key] = { end: Date.now() + t.sec * 1000, done: false };
              draw(false);
            },
          },
          icon('clock', 18),
          st ? (left <= 0 ? 'Gotowe!' : clock(left)) : `Minutnik ${t.label}`,
        );
      }),
    );
  };

  function draw(animate) {
    const isIng = i === 0;
    root.replaceChildren(
      h('div', { class: 'cook-top' }, h('div', { class: 'cook-progress' }, steps.map((_, n) => h('i', { class: n <= i ? 'on' : '' }))), iconButton('close', 'Zamknij tryb gotowania', close)),
      h(
        'div',
        { class: 'cook-main' },
        h('div', { class: 'cook-count' }, isIng ? `${r.name} · ${servings} ${servings === 1 ? 'porcja' : servings < 5 ? 'porcje' : 'porcji'}` : `Krok ${i} z ${steps.length - 1}`),
        isIng
          ? [
              h('div', { class: `cook-text${animate ? ' enter' : ''}` }, 'Przygotuj składniki'),
              h(
                'div',
                { class: 'list' },
                r.ingredients.map((it) => {
                  const ing = S.ingMap[it.id];
                  const units = fmtUnits(it.g * f, ing?.unit);
                  return h('div', { class: 'row ing' }, h('span', { class: 'grow row-title' }, ing?.name || it.id), h('span', { class: 'amount' }, h('b', {}, fmtGrams(it.g * f)), units && ` · ${units}`));
                }),
                r.spices && h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Przyprawy'), h('span', { class: 'row-sub' }, r.spices))),
              ),
            ]
          : [h('div', { class: `cook-text${animate ? ' enter' : ''}` }, steps[i]), f !== 1 && h('div', { class: 'muted' }, `Gotujesz ${servings} zamiast ${r.servings} porcji — przelicz ilości z tego kroku (×${num(f, 2).replace(/,?0+$/, '')}).`), timerButtons()],
      ),
      h('div', { class: 'cook-nav' }, h('button', { class: 'btn gray', type: 'button', disabled: i === 0, onclick: () => go(-1) }, icon('left', 22)), h('button', { class: 'btn', type: 'button', onclick: () => go(1) }, i === steps.length - 1 ? 'Gotowe 🎉' : isIng ? 'Zaczynamy' : 'Dalej')),
    );
  }

  tick = setInterval(() => {
    let running = false;
    for (const t of Object.values(timers)) {
      if (!t.done && Date.now() >= t.end) {
        t.done = true;
        beep();
      }
      running = true;
    }
    if (running) draw(false);
  }, 1000);

  acquire();
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('keydown', onKey, true);
  document.body.append(root);
  draw(false);
}

/* ——— wybór przepisu (podmiana w planie, „zjadłem inny przepis”) ——— */

/**
 * opts: { title, recipes, type, current, strict(r) → pasuje do reguł, strictLabel, note, onPick(id), onClear }
 */
export function openRecipePicker(opts) {
  const st = { q: '', tags: new Set(), strict: !!opts.strict, type: opts.type || 'all' };
  const base = opts.recipes || S.catalog.recipes;
  const body = h('div', {});
  const chipsEl = h('div', { class: 'chips', style: { marginBottom: '12px' } });

  const draw = () => {
    chipsEl.replaceChildren(
      ...(opts.strict ? [chip(opts.strictLabel || 'pasujące do reguł', st.strict, () => ((st.strict = !st.strict), draw()))] : []),
      ...(opts.type === null ? TYPES.map((t) => chip(TYPE_SHORT[t], st.type === t, () => ((st.type = st.type === t ? 'all' : t), draw()))) : []),
      ...FILTERS.map((t) => chip(t, st.tags.has(t), () => (st.tags.has(t) ? st.tags.delete(t) : st.tags.add(t), draw()))),
    );
    let found = filterRecipes(base, st);
    if (st.strict && opts.strict) found = found.filter(opts.strict);
    body.replaceChildren(
      found.length
        ? h(
            'div',
            { class: 'list' },
            found.map((r) =>
              recipeRow(r, {
                current: r.id === opts.current,
                onclick: () => {
                  sheet.close();
                  opts.onPick(r.id);
                },
                trailing: opts.badge?.(r),
              }),
            ),
          )
        : h('div', { class: 'card empty' }, h('p', {}, 'Nic nie pasuje do filtrów.'), st.strict && h('button', { class: 'btn secondary', type: 'button', onclick: () => ((st.strict = false), draw()) }, 'Pokaż wszystkie')),
    );
  };

  const sheet = openSheet({
    title: opts.title || 'Wybierz przepis',
    full: true,
    closeLabel: 'Anuluj',
    body: () => [
      opts.note && h('div', { class: 'note warm', style: { margin: '0 0 12px' } }, opts.note),
      searchBox('', 'Szukaj', (v) => ((st.q = v), draw())),
      chipsEl,
      body,
      opts.onClear &&
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            style: { marginTop: '16px' },
            onclick: () => {
              sheet.close();
              opts.onClear();
            },
          },
          'Usuń z planu',
        ),
    ],
  });
  draw();
  return sheet;
}

/* ——— edytor własnych przepisów ——— */

function openIngredientPicker(onPick) {
  let q = '';
  const body = h('div', {});
  const draw = () => {
    const needle = norm(q);
    const found = S.catalog.ingredients.filter((i) => i.id !== 'przyprawy' && (!needle || norm(i.name).includes(needle)));
    body.replaceChildren(
      h(
        'div',
        { class: 'list' },
        found.map((i) =>
          h(
            'button',
            {
              class: 'row row-btn',
              type: 'button',
              onclick: () => {
                sheet.close();
                onPick(i);
              },
            },
            h('span', { class: 'grow' }, h('span', { class: 'row-title' }, i.name), h('span', { class: 'row-sub' }, `${Math.round(i.kcal)} kcal · ${num(i.protein, 1)} g białka na 100 g`)),
          ),
        ),
      ),
    );
  };
  const sheet = openSheet({ title: 'Składnik', full: true, closeLabel: 'Anuluj', body: () => [searchBox('', 'Szukaj w katalogu', (v) => ((q = v), draw())), body, h('p', { class: 'caption' }, 'Nowy składnik (z wartościami na 100 g) najłatwiej dodać przez „Importuj z Claude”.')] });
  draw();
}

export function openRecipeEditor(original) {
  const isNew = !original;
  const d = original
    ? clone(original)
    : { id: '', name: '', emoji: '', type: 'kolacja', servings: 1, timeMin: 15, ingredients: [], steps: [], spices: '', fridgeDays: null, freezer: false, batch: false, tags: [], rating: 'chcę', wheatMain: false, wheatSwap: '', notes: '', custom: true };
  let stepsText = d.steps.join('\n');
  const set = (k, cast = (v) => v) => (e) => (d[k] = cast(e.target.value));
  const toNum = (v) => (v === '' ? null : Number(v));

  const sheet = openSheet({
    title: isNew ? 'Nowy przepis' : 'Edycja przepisu',
    full: true,
    closeLabel: 'Anuluj',
    body: () => {
      const per = computePerServing(d, S.ingMap);
      return [
        h(
          'div',
          { class: 'card' },
          field('Nazwa', h('input', { class: 'input', value: d.name, placeholder: 'np. Tofu z brokułem i ryżem', oninput: set('name') })),
          h(
            'div',
            { class: 'field-grid' },
            field('Typ', h('select', { class: 'input', onchange: (e) => ((d.type = e.target.value), sheet.refresh()) }, TYPES.map((t) => h('option', { value: t, selected: d.type === t }, t)))),
            field('Emoji', h('input', { class: 'input', value: d.emoji || '', placeholder: TYPE_EMOJI[d.type], maxlength: 4, oninput: set('emoji') })),
            field('Porcje', h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 1, value: d.servings, onchange: (e) => ((d.servings = Math.max(1, Number(e.target.value) || 1)), sheet.refresh()) })),
            field('Czas (min)', h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, value: d.timeMin, oninput: set('timeMin', (v) => Number(v) || 0) })),
          ),
        ),

        h('div', { class: 'group-label' }, `Składniki · ok. ${round10(per.kcal)} kcal i ${Math.round(per.protein)} g białka na porcję`),
        h(
          'div',
          { class: 'list' },
          d.ingredients.map((it, n) =>
            h(
              'div',
              { class: 'row' },
              h('span', { class: 'grow row-title' }, S.ingMap[it.id]?.name || it.id),
              h('input', { class: 'inline', type: 'number', inputmode: 'decimal', min: 0, value: it.g, 'aria-label': 'gramy', onchange: (e) => ((it.g = Number(e.target.value) || 0), sheet.refresh()) }),
              h('span', { class: 'muted' }, 'g'),
              iconButton('trash', 'Usuń składnik', () => (d.ingredients.splice(n, 1), sheet.refresh()), 'plain'),
            ),
          ),
          h('button', { class: 'row row-btn', type: 'button', onclick: () => openIngredientPicker((ing) => (d.ingredients.push({ id: ing.id, g: ing.unit?.grams || 100 }), sheet.refresh())) }, icon('plus', 20), h('span', { class: 'row-title', style: { color: 'var(--accent-text)' } }, 'Dodaj składnik')),
        ),
        h('p', { class: 'caption' }, 'Ilości w gramach na cały przepis, w stanie ważenia (suchy ryż, surowe mięso).'),

        h('div', { class: 'group-label' }, 'Przygotowanie'),
        h(
          'div',
          { class: 'card' },
          field('Kroki — każdy w nowej linii', h('textarea', { class: 'input', rows: 6, placeholder: 'Pokrój…\nUsmaż 6–7 min…', oninput: (e) => (stepsText = e.target.value) }, stepsText)),
          field('Przyprawy', h('input', { class: 'input', value: d.spices, placeholder: 'sól, pieprz, wędzona papryka', oninput: set('spices') })),
          field('Notatka', h('input', { class: 'input', value: d.notes, oninput: set('notes') })),
        ),

        h('div', { class: 'group-label' }, 'Tagi'),
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'chips wrap' },
            ALL_TAGS.map((t) =>
              chip(t, d.tags.includes(t), () => {
                d.tags = d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t];
                sheet.refresh();
              }),
            ),
          ),
        ),

        h('div', { class: 'group-label' }, 'Planowanie'),
        h(
          'div',
          { class: 'list' },
          h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Pszenica w roli głównej'), h('span', { class: 'row-sub' }, 'makaron, tortilla pszenna, bułka')), switchEl(d.wheatMain, (v) => ((d.wheatMain = v), sheet.refresh()), 'Pszenica w roli głównej')),
          d.wheatMain && h('div', { class: 'row' }, h('input', { class: 'input', value: d.wheatSwap, placeholder: 'Zamiennik bez pszenicy, np. tortilla kukurydziana', oninput: set('wheatSwap') })),
          h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Gotowane na zapas'), h('span', { class: 'row-sub' }, 'całość powstaje za jednym razem')), switchEl(d.batch, (v) => ((d.batch = v), sheet.refresh()), 'Na zapas')),
          h('div', { class: 'row' }, h('span', { class: 'grow row-title' }, 'Można mrozić'), switchEl(d.freezer, (v) => ((d.freezer = v), sheet.refresh()), 'Można mrozić')),
          h('div', { class: 'row' }, h('span', { class: 'grow row-title' }, 'Dni w lodówce'), h('input', { class: 'inline', type: 'number', inputmode: 'numeric', min: 0, value: d.fridgeDays ?? '', placeholder: '—', oninput: set('fridgeDays', toNum) })),
          h('div', { class: 'row' }, h('span', { class: 'grow row-title' }, 'Ocena'), h('select', { class: 'input', style: { width: 'auto', minHeight: '38px', paddingTop: '6px', paddingBottom: '6px' }, onchange: set('rating') }, ['chcę', 'może', 'propozycja'].map((x) => h('option', { value: x, selected: d.rating === x }, x)))),
        ),
      ];
    },
    footer: () =>
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            d.name = d.name.trim();
            d.steps = stepsText.split('\n').map((s) => s.trim()).filter(Boolean);
            d.ingredients = d.ingredients.filter((i) => i.g > 0);
            if (!d.name) return toast('Podaj nazwę przepisu');
            if (!d.ingredients.length) return toast('Dodaj przynajmniej jeden składnik');
            if (!d.emoji) delete d.emoji;
            if (isNew) d.id = `wl_${slugify(d.name)}_${uid('').slice(-4)}`;
            delete d.short; // krótka nazwa wyliczy się z nowej
            commit(
              (u, c) => {
                const at = c.recipes.findIndex((x) => x.id === d.id);
                if (at >= 0) c.recipes[at] = d;
                else c.recipes.push(d);
              },
              { catalog: true },
            );
            sheet.close();
            toast(isNew ? 'Przepis dodany' : 'Zapisano zmiany');
          },
        },
        isNew ? 'Dodaj przepis' : 'Zapisz',
      ),
  });
}
