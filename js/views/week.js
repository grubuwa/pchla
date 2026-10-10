// Ekran „Tydzień”: siatka nd–sob × 5 posiłków, podmiany, tryby dni, sumy, reguły, zatwierdzanie.
import { S, commit } from '../store.js';
import { todayISO, addDays, dow, weekStart, fmtWeekRange, diffDays, shortName } from '../util.js';
import { checkRules, templateFromWeek } from '../planner.js';
import { weekAt, plannerCtx, updateWeek, saveWeek } from '../model.js';
import { emojiOf } from '../seed.js';
import { h, icon, openSheet, confirmSheet, pageHeader, iconButton, field, toast } from '../ui.js';
import { dayCard, statTiles, rulesList, kcalBars, exportICS } from './weekparts.js';
import { openWizard, openApproved } from './wizard.js';
import { openRecipe } from './recipes.js';
import { refresh } from '../nav.js';

let shown = null;

// w sobotę planuje się kolejny tydzień, więc to on jest domyślny
const defaultStart = () => {
  const today = todayISO();
  return dow(today) === 6 ? addDays(today, 1) : weekStart(today);
};

function weekLabel(start) {
  const cur = weekStart(todayISO());
  const diff = diffDays(cur, start) / 7;
  return diff === 0 ? 'ten tydzień' : diff === 1 ? 'następny tydzień' : diff === -1 ? 'poprzedni tydzień' : diff > 0 ? `za ${diff} tyg.` : `${-diff} tyg. temu`;
}

function saveAsTemplate(week) {
  const a = S.recipeMap[week.lunchA];
  const b = S.recipeMap[week.lunchB];
  let name = [a, b].filter(Boolean).map((r) => r.short || shortName(r)).join(' + ') || `Tydzień ${fmtWeekRange(week.startSunday)}`;
  const sheet = openSheet({
    title: 'Sprawdzony tydzień',
    closeLabel: 'Anuluj',
    body: () => [
      h('p', { class: 'muted pad' }, 'Zapisany tydzień wczytasz później jednym dotknięciem — w kreatorze, w kroku 1.'),
      h('div', { class: 'card' }, field('Nazwa', h('input', { class: 'input', value: name, oninput: (e) => (name = e.target.value) }))),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          style: { marginTop: '14px' },
          onclick: () => {
            commit((u) => u.templates.push({ id: `tpl_${Date.now().toString(36)}`, ...templateFromWeek(week, name.trim() || 'Sprawdzony tydzień') }));
            sheet.close();
            toast('Zapisano jako sprawdzony tydzień');
          },
        },
        'Zapisz',
      ),
    ],
  });
}

function lunchCard(week) {
  const row = (which, id, when) => {
    const r = S.recipeMap[id];
    if (!r) return null;
    return h('button', { class: 'row row-btn', type: 'button', onclick: () => openRecipe(r.id) }, h('span', { class: 'emoji' }, emojiOf(r)), h('span', { class: 'grow' }, h('span', { class: 'row-sub', style: { marginTop: 0 } }, `Lunch ${which} · ${when}`), h('span', { class: 'row-title' }, r.name)), h('span', { class: 'ic chev' }, icon('right', 18)));
  };
  const rows = [row('A', week.lunchA, 'gotujesz w niedzielę'), row('B', week.lunchB, 'gotujesz w środę')].filter(Boolean);
  return rows.length ? h('div', { class: 'list', style: { marginTop: '12px' } }, rows) : null;
}

function emptyWeekCard(start) {
  return h(
    'div',
    { class: 'card empty' },
    h('div', { class: 'big' }, '🗓️'),
    h('h3', {}, `Brak planu na ${fmtWeekRange(start)}`),
    h('p', {}, 'Kreator ułoży cały tydzień wg Twoich reguł w ok. 10 minut. Możesz też wczytać sprawdzony tydzień albo poprosić Claude.'),
    h('button', { class: 'btn', type: 'button', onclick: () => openWizard(start) }, 'Zaplanuj tydzień'),
    h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn secondary', type: 'button', onclick: () => openWizard(start, { entry: 'template' }) }, '⭐ Sprawdzony'), h('button', { class: 'btn secondary', type: 'button', onclick: () => openWizard(start, { entry: 'claude' }) }, '✨ Claude')),
  );
}

export const wide = true; // na szerokim ekranie: prawdziwa siatka 7 kolumn

export function render(params = {}) {
  if (params.start) shown = params.start;
  if (!shown) shown = defaultStart();
  const start = shown;
  const week = weekAt(start);
  if (params.wizard) setTimeout(() => openWizard(start), 60);

  const move = (n) => {
    shown = addDays(start, 7 * n);
    refresh();
  };
  const out = [
    pageHeader('Tydzień', 'Plan niedziela → sobota', week && iconButton('sparkle', 'Kreator tygodnia', () => openWizard(start))),
    h(
      'div',
      { class: 'week-nav' },
      iconButton('left', 'Poprzedni tydzień', () => move(-1)),
      h('div', { class: 'label' }, fmtWeekRange(start), h('small', {}, [weekLabel(start), week ? (week.approved ? 'zatwierdzony' : 'szkic') : null].filter(Boolean).join(' · '))),
      iconButton('right', 'Następny tydzień', () => move(1)),
    ),
  ];

  if (!week) {
    out.push(emptyWeekCard(start));
    return out;
  }

  const apply = (fn) => updateWeek(start, fn);
  const { facts, checks } = checkRules(week, plannerCtx());
  const failed = checks.filter((c) => !c.ok);

  out.push(
    statTiles(facts),
    h(
      'div',
      { class: 'list', style: { marginTop: '12px' } },
      h(
        'button',
        {
          class: 'row row-btn',
          type: 'button',
          onclick: () =>
            openSheet({
              title: 'Reguły tygodnia',
              body: () => [h('div', { class: 'card' }, h('div', { class: 'row-sub', style: { marginTop: 0 } }, 'kcal dzień po dniu'), kcalBars(facts)), h('div', { style: { height: '12px' } }), rulesList(checks), h('p', { class: 'caption' }, 'Wartości orientacyjne, liczone ze składników. Sumy bez kawy z mlekiem (~50 kcal).')],
            }),
        },
        h('span', { class: `rule-mark`, style: failed.length ? { background: 'var(--red-soft)', color: 'var(--red)' } : {} }, icon(failed.length ? 'close' : 'check', 15)),
        h('span', { class: 'grow' }, h('span', { class: 'row-title' }, failed.length ? `Reguły: ${checks.length - failed.length} z ${checks.length} spełnionych` : 'Wszystkie reguły spełnione'), failed.length > 0 && h('span', { class: 'row-sub' }, failed.map((c) => c.label).join(' · '))),
        h('span', { class: 'ic chev' }, icon('right', 18)),
      ),
    ),
    lunchCard(week),
    h('div', { class: 'days grid' }, week.days.map((_, d) => dayCard(week, d, apply))),
  );

  out.push(
    h(
      'div',
      { class: 'stack mt', style: { maxWidth: '648px', margin: '20px auto 0' } },
      !week.approved &&
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              saveWeek(week, { approve: true });
              openApproved(start);
            },
          },
          icon('check', 20),
          'Zatwierdź plan i wygeneruj zakupy',
        ),
      week.approved && h('p', { class: 'caption center', style: { margin: '0 0 4px' } }, 'Plan zatwierdzony — każda zmiana od razu aktualizuje listy zakupów.'),
      h(
        'div',
        { class: 'list' },
        h('button', { class: 'row row-btn', type: 'button', onclick: () => openWizard(start) }, icon('sparkle'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Kreator tygodnia'), h('span', { class: 'row-sub' }, 'ułóż od nowa: kalendarz → lunche → plan')), h('span', { class: 'ic chev' }, icon('right', 18))),
        h('button', { class: 'row row-btn', type: 'button', onclick: () => saveAsTemplate(week) }, h('span', { class: 'ic' }, '⭐'), h('span', { class: 'grow row-title' }, 'Zapisz jako sprawdzony tydzień')),
        h('button', { class: 'row row-btn', type: 'button', onclick: () => exportICS(week) }, icon('bell'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Przypomnienia do Kalendarza'), h('span', { class: 'row-sub' }, 'plik .ics z alarmami i treścią z planu'))),
        h(
          'button',
          {
            class: 'row row-btn danger',
            type: 'button',
            onclick: async () => {
              if (!(await confirmSheet('Usunąć plan?', `Plan i listy zakupów na ${fmtWeekRange(start)} zostaną usunięte.`, 'Usuń plan', { destructive: true }))) return;
              commit((u) => {
                delete u.weeks[start];
                delete u.shopping[start];
              });
              toast('Plan usunięty');
            },
          },
          icon('trash'),
          h('span', { class: 'grow row-title' }, 'Usuń plan tygodnia'),
        ),
      ),
    ),
  );
  return out;
}
