// Ekran „Dziś”: teraz / następny posiłek, odhaczanie, paski kcal i białka, zadania dnia.
import { S } from '../store.js';
import { SLOTS, SLOT_LABEL, DAYS, todayISO, addDays, dow, fmtDateLong, fmtWeekRange, timeToMin, nowMin, round10, shortName, diffDays, zl } from '../util.js';
import { dayPlanned, dayEaten } from '../nutrition.js';
import { dayOf, weekAt, toggleEaten, setStatus, addLog, removeLog, logOf, taskDone, setTask } from '../model.js';
import { storeCost, tripCost } from '../shopping.js';
import { emojiOf } from '../seed.js';
import { h, icon, openSheet, actionSheet, pageHeader, iconButton, progressBar, field, toast } from '../ui.js';
import { go } from '../nav.js';
import { openRecipe, openRecipePicker } from './recipes.js';
import { openSettings, exportBackupFile } from './settings.js';
import { openWeighIn } from './progress.js';

let popKey = null; // który znaczek ma „podskoczyć” po odświeżeniu

const kcalText = (r) => `~${round10(r.perServing.kcal)} kcal`;

function currentMeal(day, times) {
  const now = nowMin();
  const open = SLOTS.filter((s) => day.meals[s] && !day.meals[s].status);
  if (!open.length) return null;
  const slot = open.find((s) => timeToMin(times[s]) + 90 >= now) || open[open.length - 1];
  const t = timeToMin(times[slot]);
  return { slot, state: now < t - 20 ? 'next' : now <= t + 90 ? 'now' : 'late' };
}

const WHERE = {
  sniadanie: 'w pracy, z kawą',
  lunch: 'z pojemnika, z mikrofali',
  przekaska: 'żeby nie wracać głodnym',
  kolacja: 'w domu',
  wieczor: 'ostatni posiłek dnia',
};

function hero(date, day) {
  const u = S.user;
  const closed = nowMin() >= timeToMin(u.times.kitchenClosed) || nowMin() < 4 * 60;
  const cur = currentMeal(day, u.times);

  if (!cur || (closed && cur.state === 'late')) {
    const eaten = SLOTS.filter((s) => day.meals[s]?.status === 'zjedzone').length;
    const planned = SLOTS.filter((s) => day.meals[s]).length;
    if (closed) {
      return h(
        'section',
        { class: 'hero night' },
        h('div', { class: 'hero-emoji' }, '🌙'),
        h('div', { class: 'hero-eyebrow' }, `Po ${u.times.kitchenClosed}`),
        h('div', { class: 'hero-title' }, 'Kuchnia zamknięta'),
        h('div', { class: 'hero-meta' }, `Dziś ${eaten} z ${planned} posiłków wg planu. Cel snu: ${u.times.sleep}.`),
      );
    }
    return h(
      'section',
      { class: 'hero' },
      h('div', { class: 'hero-emoji' }, '🎉'),
      h('div', { class: 'hero-eyebrow' }, 'Na dziś wszystko'),
      h('div', { class: 'hero-title' }, 'Wszystkie posiłki odhaczone'),
      h('div', { class: 'hero-meta' }, `${eaten} z ${planned} zgodnie z planem. Kuchnia zamyka się o ${u.times.kitchenClosed}.`),
    );
  }

  const meal = day.meals[cur.slot];
  const r = S.recipeMap[meal.recipeId];
  const label = { now: 'Teraz', next: 'Następny posiłek', late: 'Jeszcze nie odhaczone' }[cur.state];
  const isDinnerCook = cur.slot === 'kolacja' && r?.timeMin > 0;
  return h(
    'section',
    { class: 'hero' },
    h('div', { class: 'hero-emoji' }, emojiOf(r)),
    h('div', { class: 'hero-eyebrow' }, icon('clock', 15), `${label} · ${u.times[cur.slot]} · ${SLOT_LABEL[cur.slot]}`),
    h('div', { class: 'hero-title' }, shortName(r) || 'Posiłek'),
    h('div', { class: 'hero-meta' }, [r && kcalText(r), r && `${Math.round(r.perServing.protein)} g białka`, isDinnerCook ? `${r.timeMin} min` : WHERE[cur.slot], meal.portions > 1 && `porcje ×${meal.portions}`].filter(Boolean).join(' · ')),
    h(
      'div',
      { class: 'hero-actions' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            popKey = `${date}:${cur.slot}`;
            toggleEaten(date, cur.slot);
          },
        },
        icon('check', 20),
        'Zjedzone',
      ),
      r && h('button', { class: 'btn ghost', type: 'button', onclick: () => openRecipe(r.id, { portions: meal.portions }) }, 'Przepis'),
    ),
  );
}

function noPlanHero(today) {
  const next = Object.keys(S.user.weeks).sort().find((s) => s > today);
  if (next) {
    const w = weekAt(next);
    const a = S.recipeMap[w.lunchA];
    const days = diffDays(today, next);
    return h(
      'section',
      { class: 'hero' },
      h('div', { class: 'hero-emoji' }, '🗓️'),
      h('div', { class: 'hero-eyebrow' }, days === 1 ? 'Plan startuje jutro' : `Plan startuje za ${days} dni`),
      h('div', { class: 'hero-title' }, `Tydzień ${fmtWeekRange(next)}`),
      h('div', { class: 'hero-meta' }, a ? `W niedzielę gotujesz lunch A: ${shortName(a)}. Dziś: ważenie, plan i duże zakupy.` : 'Dziś: ważenie, plan i duże zakupy.'),
      h('div', { class: 'hero-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => go('week', { start: next }) }, 'Zobacz plan'), h('button', { class: 'btn ghost', type: 'button', onclick: () => go('shop', { start: next, trip: 'sobota' }) }, 'Zakupy')),
    );
  }
  return h(
    'section',
    { class: 'hero' },
    h('div', { class: 'hero-emoji' }, '🗓️'),
    h('div', { class: 'hero-eyebrow' }, 'Brak planu na dziś'),
    h('div', { class: 'hero-title' }, 'Ułóż tydzień w 10 minut'),
    h('div', { class: 'hero-meta' }, 'Kreator dobierze lunche, śniadania i kolacje wg Twoich reguł.'),
    h('div', { class: 'hero-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => go('week', { wizard: true }) }, 'Zaplanuj tydzień')),
  );
}

function meters(day, date) {
  const T = S.user.targets;
  const planned = dayPlanned(day, S.recipeMap);
  const eaten = dayEaten(day, S.recipeMap, logOf(date));
  const over = eaten.kcal > T.kcalMax;
  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'meters' },
      h(
        'div',
        {},
        h('div', { class: 'meter-top' }, h('span', { class: 'meter-value' }, `~${round10(eaten.kcal)}`), h('span', { class: 'meter-of' }, `z ${T.kcal} kcal`)),
        progressBar(eaten.kcal, T.kcalMax, { cls: over ? 'over' : '', mark: Math.min(planned.kcal, T.kcalMax) }),
        h('div', { class: 'meter-label' }, over ? `ponad zakres o ~${round10(eaten.kcal - T.kcalMax)} kcal` : `plan na dziś: ~${round10(planned.kcal)} kcal`),
      ),
      h(
        'div',
        {},
        h('div', { class: 'meter-top' }, h('span', { class: 'meter-value' }, `${Math.round(eaten.protein)} g`), h('span', { class: 'meter-of' }, `z ${T.proteinMin} g białka`)),
        progressBar(eaten.protein, T.proteinMin, { cls: 'green' }),
        h('div', { class: 'meter-label' }, `plan na dziś: ${Math.round(planned.protein)} g`),
      ),
    ),
  );
}

const STATUS = {
  zjedzone: { cls: 'done', icon: 'check', text: null },
  zamienione: { cls: 'swapped', icon: 'swap', text: 'zamienione' },
  'pominięte': { cls: 'skipped', icon: 'minus', text: 'pominięte' },
};

function mealRow(date, slot, meal) {
  const r = S.recipeMap[meal.recipeId];
  const st = STATUS[meal.status];
  const actual = meal.actualId && S.recipeMap[meal.actualId];
  const off = S.user.log.find((e) => e.date === date && e.slot === slot);
  const key = `${date}:${slot}`;
  const check = h('button', { type: 'button', class: `check ${st?.cls || ''}${popKey === key ? ' pop' : ''}`, 'aria-label': `${SLOT_LABEL[slot]}: ${meal.status || 'odhacz jako zjedzone'}`, onclick: () => ((popKey = key), toggleEaten(date, slot)) }, icon(st?.icon || 'check', 17));
  const kcal = off ? `~${round10(off.kcal)} kcal` : actual ? kcalText(actual) : r ? kcalText(r) : '';
  return h(
    'div',
    { class: `row with-lead meal${meal.status === 'zjedzone' ? ' is-done' : ''}${meal.status === 'pominięte' ? ' is-skipped' : ''}` },
    check,
    h(
      'button',
      { type: 'button', class: 'meal-main', onclick: () => mealActions(date, slot, meal) },
      h('span', { class: 'emoji' }, emojiOf(actual || r)),
      h(
        'span',
        { class: 'grow' },
        h('span', { class: 'slot' }, `${S.user.times[slot]} · ${SLOT_LABEL[slot]}`, st?.text && h('span', { class: `tag ${meal.status === 'zamienione' ? 'blue' : ''}` }, st.text), meal.portions > 1 && h('span', { class: 'tag accent' }, `×${meal.portions}`)),
        h('span', { class: 'row-title' }, off ? off.label : shortName(actual || r) || '—'),
        (off || actual) && r && h('span', { class: 'row-sub' }, `zamiast: ${shortName(r)}`),
      ),
      h('span', { class: 'kcal' }, kcal),
    ),
  );
}

function mealActions(date, slot, meal) {
  const r = S.recipeMap[meal.recipeId];
  actionSheet(`${SLOT_LABEL[slot]} · ${shortName(r)}`, [
    { icon: 'check', label: 'Zjedzone wg planu', current: meal.status === 'zjedzone', onSelect: () => ((popKey = `${date}:${slot}`), setStatus(date, slot, 'zjedzone')) },
    {
      icon: 'swap',
      label: 'Zjadłem inny przepis',
      detail: 'wybierz z bazy — policzę kcal i białko',
      onSelect: () => openRecipePicker({ title: 'Co zjadłeś zamiast?', type: null, onPick: (id) => setStatus(date, slot, 'zamienione', id) }),
    },
    { icon: 'flame', label: 'Zjadłem coś poza planem', detail: 'bar, Żabka, słoik od mamy…', onSelect: () => openQuickLog(date, slot) },
    { icon: 'minus', label: 'Pominięte', current: meal.status === 'pominięte', onSelect: () => setStatus(date, slot, 'pominięte') },
    meal.status && { icon: 'close', label: 'Wyczyść status', onSelect: () => setStatus(date, slot, null) },
    r && { icon: 'book', label: 'Pokaż przepis', onSelect: () => openRecipe(r.id, { portions: meal.portions }) },
  ]);
}

// szybki wpis „zjadłem coś poza planem”
export function openQuickLog(date, slot = null) {
  const form = { label: '', kcal: '' };
  const save = (label, kcal) => {
    if (!label.trim() || !(Number(kcal) > 0)) return toast('Podaj nazwę i orientacyjne kcal');
    addLog({ date, slot, label: label.trim(), kcal });
    sheet.close();
    toast('Zapisane — bez wyrzutów, wracasz do planu');
  };
  const sheet = openSheet({
    title: slot ? `Zamiast: ${SLOT_LABEL[slot].toLowerCase()}` : 'Poza planem',
    closeLabel: 'Anuluj',
    body: () => [
      h('p', { class: 'muted pad' }, 'Wybierz najbliższą pozycję — wartości są orientacyjne, nie liczymy co do grama.'),
      h(
        'div',
        { class: 'list' },
        S.user.presets.map((p) => h('button', { class: 'row row-btn', type: 'button', onclick: () => save(p.name, p.kcal) }, h('span', { class: 'grow row-title' }, p.name), h('span', { class: 'trail num' }, `~${p.kcal} kcal`))),
      ),
      h('div', { class: 'group-label' }, 'Własna pozycja'),
      h(
        'div',
        { class: 'card' },
        field('Co to było?', h('input', { class: 'input', placeholder: 'np. drożdżówka', oninput: (e) => (form.label = e.target.value) })),
        field('Orientacyjnie kcal', h('input', { class: 'input', type: 'number', inputmode: 'numeric', placeholder: '400', oninput: (e) => (form.kcal = e.target.value) })),
        h('button', { class: 'btn', type: 'button', onclick: () => save(form.label, form.kcal) }, 'Zapisz'),
      ),
    ],
  });
}

function shoppingTask(start, trip, title) {
  const list = S.user.shopping[start];
  if (!list) return null;
  const items = list.items.filter((i) => i.trip === trip && !i.have);
  if (!items.length) return null;
  const left = items.filter((i) => !i.checked).length;
  return {
    id: `shop-${trip}`,
    emoji: '🛒',
    title,
    detail: left ? `${left} z ${items.length} pozycji · ok. ${zl(tripCost(list, trip), 0)}` : 'wszystko kupione',
    auto: left === 0,
    action: () => go('shop', { start, trip }),
  };
}

function tasks(today) {
  const u = S.user;
  const d = dow(today);
  const out = [];
  const { week, day } = dayOf(today);
  const tomorrow = dayOf(addDays(today, 1));
  const names = (dy, slots) => slots.map((s) => shortName(S.recipeMap[dy.meals[s]?.recipeId])).filter(Boolean);
  const packed = (x) => x.day && x.day.mode !== 'poza domem' && ((x.idx >= 1 && x.idx <= 5) || x.day.mode === 'zjazd');

  if (packed({ day, idx: d }) && nowMin() < 10 * 60) {
    const items = names(day, ['sniadanie', 'lunch', 'przekaska']);
    if (items.length) out.push({ id: 'pack', emoji: '🎒', title: `Spakuj: ${items.join(' + ')}`, detail: 'wszystko czeka w lodówce' });
  }
  if (d === 6) {
    const next = addDays(today, 1);
    const nw = weekAt(next);
    out.push({ id: 'weigh', emoji: '⚖️', title: 'Zważ się', detail: 'rano, na czczo — liczy się trend', auto: u.weights.some((w) => w.date === today), action: () => openWeighIn(today) });
    out.push({
      id: 'plan',
      emoji: '🗓️',
      title: nw?.approved ? `Plan na ${fmtWeekRange(next)} gotowy` : `Zaplanuj tydzień ${fmtWeekRange(next)}`,
      detail: nw?.approved ? 'możesz go jeszcze poprawić' : 'ok. 10 minut w kreatorze',
      auto: !!nw?.approved,
      action: () => go('week', { start: next, wizard: !nw?.approved }),
    });
    const shop = shoppingTask(next, 'sobota', 'Duże zakupy');
    if (shop) out.push(shop);
  }
  if (d === 0 && week?.lunchA && S.recipeMap[week.lunchA]) {
    const r = S.recipeMap[week.lunchA];
    const portions = week.days.reduce((n, dy) => n + (dy.mode !== 'poza domem' && dy.meals.lunch?.recipeId === r.id ? dy.meals.lunch.portions : 0), 0);
    out.push({ id: 'cookA', emoji: '👨‍🍳', title: `Gotujesz lunch A: ${shortName(r)}`, detail: `${portions || r.servings} porcje · ok. ${r.timeMin} min`, action: () => openRecipe(r.id, { portions: portions || r.servings }) });
  }
  if (d === 3 && week) {
    const shop = shoppingTask(week.startSunday, 'środa', 'Małe zakupy po pracy');
    if (shop) out.push(shop);
    const r = S.recipeMap[week.lunchB];
    if (r) {
      const portions = week.days.reduce((n, dy) => n + (dy.mode === 'poza domem' ? 0 : ['lunch', 'kolacja'].reduce((k, s) => k + (dy.meals[s]?.recipeId === r.id ? dy.meals[s].portions : 0), 0)), 0);
      out.push({ id: 'cookB', emoji: '👨‍🍳', title: `Gotujesz lunch B: ${shortName(r)}`, detail: `${portions || r.servings} porcje · ok. ${r.timeMin} min · dziś na kolację`, action: () => openRecipe(r.id, { portions: portions || r.servings }) });
    }
  }
  if (packed(tomorrow)) {
    const items = names(tomorrow.day, ['sniadanie', 'przekaska']);
    const lunch = names(tomorrow.day, ['lunch'])[0];
    if (items.length) out.push({ id: 'prep', emoji: '🌙', title: `Przygotuj na jutro: ${items.join(', ')}`, detail: lunch ? `+ pojemnik z lunchem: ${lunch}` : 'wieczorem, do lodówki' });
  }
  if (d === 6 && (!u.flags.lastBackup || diffDays(u.flags.lastBackup, today) >= 7)) {
    out.push({ id: 'backup', emoji: '💾', title: 'Zrób kopię zapasową', detail: 'dane są tylko na tym urządzeniu', action: exportBackupFile });
  }
  if (u.labFollowUp && diffDays(today, u.labFollowUp) <= 14) {
    out.push({ id: 'labs', emoji: '🩸', title: 'Kontrolny lipidogram na czczo', detail: 'ok. 3 miesiące od startu diety', action: () => go('progress') });
  }
  return out;
}

function taskList(today) {
  const list = tasks(today);
  if (!list.length) return null;
  return [
    h('h2', { class: 'section' }, 'Zadania dnia'),
    h(
      'div',
      { class: 'list' },
      list.map((t) => {
        const done = t.auto ?? taskDone(today, t.id);
        const key = `task:${t.id}`;
        return h(
          'div',
          { class: `row with-lead task${done ? ' is-done' : ''}` },
          h(
            'button',
            {
              type: 'button',
              class: `check green ${done ? 'done' : ''}${popKey === key ? ' pop' : ''}`,
              'aria-label': done ? 'Zrobione' : 'Oznacz jako zrobione',
              onclick: () => {
                if (t.auto !== undefined) return t.action?.();
                popKey = key;
                setTask(today, t.id, !done);
              },
            },
            icon('check', 17),
          ),
          h('button', { type: 'button', class: 'meal-main', onclick: () => (t.action ? t.action() : ((popKey = key), setTask(today, t.id, !done))) }, h('span', { class: 'emoji' }, t.emoji), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, t.title), t.detail && h('span', { class: 'row-sub' }, t.detail)), t.action && h('span', { class: 'ic chev' }, icon('right', 18))),
        );
      }),
    ),
  ];
}

export function render() {
  const today = todayISO();
  const { day } = dayOf(today);
  const active = day && day.mode !== 'poza domem';
  const log = logOf(today);
  const freeLog = log.filter((e) => !e.slot);

  const out = [pageHeader('Dziś', fmtDateLong(today), iconButton('gear', 'Ustawienia', openSettings))];

  if (active) {
    out.push(hero(today, day), h('div', { style: { height: '12px' } }), meters(day, today));
    out.push(
      h('h2', { class: 'section' }, 'Posiłki', day.guest && h('span', { class: 'tag accent' }, 'kolacja z dziewczyną'), day.mode === 'zjazd' && h('span', { class: 'tag blue' }, 'zjazd')),
      h('div', { class: 'list' }, SLOTS.filter((s) => day.meals[s]).map((s) => mealRow(today, s, day.meals[s]))),
    );
  } else if (day) {
    out.push(h('section', { class: 'hero calm' }, h('div', { class: 'hero-emoji' }, '🧳'), h('div', { class: 'hero-eyebrow' }, 'Poza domem'), h('div', { class: 'hero-title' }, 'Dziś bez planu'), h('div', { class: 'hero-meta' }, 'Ten dzień nie liczy się do zakupów. Jeśli chcesz, wpisz orientacyjnie, co zjadłeś — np. „słoik od mamy”.')));
  } else {
    out.push(noPlanHero(today));
  }

  if (freeLog.length) {
    out.push(
      h('div', { class: 'group-label' }, 'Poza planem'),
      h('div', { class: 'list' }, freeLog.map((e) => h('div', { class: 'row' }, h('span', { class: 'emoji' }, '🍔'), h('span', { class: 'grow row-title' }, e.label), h('span', { class: 'trail num' }, `~${e.kcal} kcal`), iconButton('trash', 'Usuń wpis', () => removeLog(e.id), 'plain')))),
    );
  }
  out.push(h('div', { class: 'stack mt' }, h('button', { class: 'btn secondary', type: 'button', onclick: () => openQuickLog(today) }, icon('plus', 20), 'Zjadłem coś poza planem')));

  out.push(taskList(today));
  if (!active && DAYS[dow(today)] && !day && !tasks(today).length) out.push(h('p', { class: 'caption center' }, 'Plan tygodnia układa się w sobotę rano.'));

  popKey = null;
  return out;
}
