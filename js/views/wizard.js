// Kreator sobotni: kalendarz → lunch A i B → plan wg reguł → podsumowanie i zatwierdzenie.
import { S, commit } from '../store.js';
import { DAYS, DAYS_SHORT, addDays, fmtShort, fmtWeekRange, round10, zl } from '../util.js';
import { generatePlan, suggestLunches, pickLunches, checkRules, weekFromTemplate, guestOk, LUNCH_B_MAX_MIN } from '../planner.js';
import { buildShopping, storeCost, tripCost } from '../shopping.js';
import { weekAt, plannerCtx, saveWeek } from '../model.js';
import { emojiOf } from '../seed.js';
import { h, icon, openSheet, segmented, toast, confirmSheet, iconButton } from '../ui.js';
import { go } from '../nav.js';
import { dayCard, rulesList, statTiles, kcalBars, exportICS, MODES } from './weekparts.js';
import { openClaudePlan } from './claude-ui.js';

const TITLES = ['Jak wygląda tydzień?', 'Wybierz lunche', 'Twój plan', 'Podsumowanie'];

export function openApproved(start) {
  const week = weekAt(start);
  const list = S.user.shopping[start];
  if (!week || !list) return;
  const count = (trip) => list.items.filter((i) => i.trip === trip).length;
  const sheet = openSheet({
    title: 'Plan zatwierdzony',
    body: () => [
      h('div', { class: 'recipe-hero' }, h('div', { class: 'big' }, '🎉'), h('h2', {}, `Tydzień ${fmtWeekRange(start)} gotowy`), h('p', { class: 'muted' }, 'Listy zakupów są wygenerowane. Zostały przypomnienia.')),
      h(
        'div',
        { class: 'list' },
        h('div', { class: 'row' }, h('span', { class: 'emoji' }, '🛒'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Sobota — duże zakupy'), h('span', { class: 'row-sub' }, `${count('sobota')} pozycji`)), h('span', { class: 'trail num' }, `ok. ${zl(tripCost(list, 'sobota'), 0)}`)),
        h('div', { class: 'row' }, h('span', { class: 'emoji' }, '🥩'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Środa — świeże'), h('span', { class: 'row-sub' }, `${count('środa')} pozycji`)), h('span', { class: 'trail num' }, `ok. ${zl(tripCost(list, 'środa'), 0)}`)),
      ),
      h(
        'div',
        { class: 'stack mt' },
        h('button', { class: 'btn', type: 'button', onclick: () => exportICS(week) }, icon('bell', 20), 'Dodaj przypomnienia do Kalendarza'),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            onclick: () => {
              sheet.close();
              go('shop', { start, trip: 'sobota' });
            },
          },
          icon('cart', 20),
          'Przejdź do zakupów',
        ),
      ),
      h('p', { class: 'caption center' }, 'iPhone nie pozwala aplikacjom webowym planować powiadomień, dlatego przypomnienia trafiają do Kalendarza jako plik .ics (z alarmami i treścią z planu).'),
    ],
  });
}

export function openTemplates(onPick) {
  const sheet = openSheet({
    title: 'Sprawdzone tygodnie',
    live: true,
    body: () => {
      const tpls = S.user.templates;
      if (!tpls.length) return [h('div', { class: 'card empty' }, h('div', { class: 'big' }, '⭐'), h('h3', {}, 'Jeszcze nic tu nie ma'), h('p', {}, 'Gdy tydzień się sprawdzi, zapisz go na ekranie Tydzień — wróci jednym dotknięciem.'))];
      return [
        h(
          'div',
          { class: 'list' },
          tpls.map((t) =>
            h(
              'div',
              { class: 'row' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'meal-main',
                  onclick: () => {
                    sheet.close();
                    onPick(t);
                  },
                },
                h('span', { class: 'emoji' }, '⭐'),
                h('span', { class: 'grow' }, h('span', { class: 'row-title' }, t.name), h('span', { class: 'row-sub' }, [t.lunchA, t.lunchB].map((id) => S.recipeMap[id]?.short || S.recipeMap[id]?.name).filter(Boolean).join(' + '))),
              ),
              iconButton(
                'trash',
                'Usuń szablon',
                async () => {
                  if (await confirmSheet('Usunąć szablon?', `„${t.name}” zniknie z listy sprawdzonych tygodni.`, 'Usuń', { destructive: true })) commit((u) => (u.templates = u.templates.filter((x) => x !== t)));
                },
                'plain',
              ),
            ),
          ),
        ),
      ];
    },
  });
}

/**
 * entry: 'claude' | 'template' — od razu otwiera alternatywną ścieżkę z kroku 1.
 */
export function openWizard(start, { entry } = {}) {
  const existing = weekAt(start);
  const draft = {
    step: 0,
    calendar: existing ? existing.days.map((d) => ({ mode: d.mode, guest: d.guest })) : DAYS.map(() => ({ mode: 'normal', guest: false })),
    lunchA: existing?.lunchA || null,
    lunchB: existing?.lunchB || null,
    week: null,
    sig: '',
    seed: Math.floor(Math.random() * 1e6) + 1,
  };
  const suggestions = suggestLunches(S.catalog.recipes, S.user.weeks, start);
  if (!draft.lunchA || !draft.lunchB) Object.assign(draft, pickLunches(suggestions, draft.calendar));

  const ctx = () => plannerCtx({ startSunday: start, calendar: draft.calendar, lunchA: draft.lunchA, lunchB: draft.lunchB, prevWeek: weekAt(addDays(start, -7)) });
  const signature = () => JSON.stringify([draft.calendar, draft.lunchA, draft.lunchB]);
  const generate = (keep) => {
    draft.week = generatePlan({ ...ctx(), seed: draft.seed, keep });
    draft.sig = signature();
  };
  const apply = (fn) => {
    fn(draft.week);
    draft.lunchA = draft.week.lunchA;
    draft.lunchB = draft.week.lunchB;
    draft.calendar = draft.week.days.map((d) => ({ mode: d.mode, guest: d.guest }));
    draft.sig = signature();
    sheet.refresh();
  };
  const useTemplate = (tpl) => {
    draft.week = weekFromTemplate(tpl, start, draft.calendar);
    draft.lunchA = tpl.lunchA;
    draft.lunchB = tpl.lunchB;
    draft.sig = signature();
    draft.step = 2;
    sheet.refresh();
    sheet.el.querySelector('.sheet-body').scrollTop = 0;
  };
  const goStep = (n) => {
    if (n === 2 && (!draft.lunchA || !draft.lunchB)) return toast('Wybierz lunch A i lunch B');
    // zmiana kalendarza lub lunchy → układamy od nowa, zachowując ręczne wybory
    if (n >= 2 && (!draft.week || draft.sig !== signature())) generate(draft.week);
    draft.step = n;
    sheet.refresh();
    sheet.el.querySelector('.sheet-body').scrollTop = 0;
  };
  const approve = () => {
    const week = draft.week;
    for (const day of week.days) for (const m of Object.values(day.meals)) if (m) delete m.locked;
    saveWeek(week, { approve: true });
    sheet.close();
    go('week', { start });
    openApproved(start);
  };

  const stepCalendar = () => [
    h(
      'div',
      { class: 'list' },
      draft.calendar.map((c, d) =>
        h(
          'div',
          { class: 'cal-row' },
          h('div', { class: 'cal-day' }, h('b', {}, DAYS_SHORT[d]), h('span', {}, fmtShort(addDays(start, d)))),
          h(
            'div',
            { class: 'grow' },
            segmented(
              Object.entries(MODES).map(([value, m]) => ({ value, label: m.label })),
              c.mode,
              (v) => ((c.mode = v), v === 'poza domem' && (c.guest = false), sheet.refresh()),
              { small: true },
            ),
          ),
          h('button', { type: 'button', class: `pill${c.guest ? ' on' : ''}`, disabled: c.mode === 'poza domem', 'aria-pressed': c.guest ? 'true' : 'false', title: 'Kolacja z dziewczyną', onclick: () => ((c.guest = !c.guest), sheet.refresh()) }, icon('guest', 17)),
        ),
      ),
    ),
    h('p', { class: 'caption' }, 'Ikona pary = kolacja z dziewczyną: porcje ×2 i danie bez pszenicy w roli głównej. „Poza domem” wyłącza dzień z planu i zakupów.'),
    h('div', { class: 'group-label' }, 'Albo na skróty'),
    h(
      'div',
      { class: 'list' },
      h('button', { class: 'row row-btn', type: 'button', onclick: () => openTemplates(useTemplate) }, h('span', { class: 'emoji' }, '⭐'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Wczytaj sprawdzony tydzień'), h('span', { class: 'row-sub' }, `${S.user.templates.length} zapisanych`)), h('span', { class: 'ic chev' }, icon('right', 18))),
      h('button', { class: 'row row-btn', type: 'button', onclick: () => openClaudePlan(start, draft.calendar, useTemplate) }, h('span', { class: 'emoji' }, '✨'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Zaproponuj z Claude'), h('span', { class: 'row-sub' }, 'kopiuj prompt → wklej odpowiedź')), h('span', { class: 'ic chev' }, icon('right', 18))),
    ),
  ];

  const stepLunches = () => {
    const pickedCard = (which, id, when) => {
      const r = S.recipeMap[id];
      return h('div', { class: 'card' }, h('div', { class: 'who' }, `Lunch ${which} · ${when}`), h('div', { class: 'name' }, r ? `${emojiOf(r)} ${r.short || r.name}` : 'wybierz poniżej'));
    };
    const guestWed = draft.calendar[3].guest;
    return [
      h('div', { class: 'picked' }, pickedCard('A', draft.lunchA, 'niedziela'), pickedCard('B', draft.lunchB, 'środa')),
      h(
        'div',
        { class: 'list' },
        suggestions.map(({ recipe: r, weeksAgo }) => {
          const tooLong = r.timeMin > LUNCH_B_MAX_MIN;
          const recent = weeksAgo != null && weeksAgo < 3;
          const info = [`${r.timeMin} min`, `~${round10(r.perServing.kcal)} kcal`, weeksAgo == null ? 'jeszcze nie było' : weeksAgo === 1 ? 'tydzień temu' : `${weeksAgo} tyg. temu`];
          return h(
            'div',
            { class: 'row', style: { opacity: recent ? 0.55 : 1 } },
            h('span', { class: 'emoji' }, emojiOf(r)),
            h(
              'span',
              { class: 'grow' },
              h('span', { class: 'row-title' }, r.short || r.name),
              h('span', { class: 'row-sub' }, info.join(' · ')),
              h('span', { class: 'tags', style: { marginTop: '5px' } }, r.tags.includes('strączki') && h('span', { class: 'tag green' }, 'strączki'), r.tags.includes('owies') && h('span', { class: 'tag green' }, 'owies'), r.wheatMain && h('span', { class: 'tag red' }, 'pszenica'), tooLong && h('span', { class: 'tag' }, 'za długie na środę'), guestWed && !guestOk(r) && h('span', { class: 'tag' }, 'nie na środę z gościem')),
            ),
            h(
              'span',
              { class: 'ab' },
              h('button', { type: 'button', class: draft.lunchA === r.id ? 'on' : '', 'aria-label': `Lunch A: ${r.name}`, onclick: () => ((draft.lunchA = r.id), draft.lunchB === r.id && (draft.lunchB = null), sheet.refresh()) }, 'A'),
              h('button', { type: 'button', class: draft.lunchB === r.id ? 'on' : '', disabled: tooLong, 'aria-label': `Lunch B: ${r.name}`, onclick: () => ((draft.lunchB = r.id), draft.lunchA === r.id && (draft.lunchA = null), sheet.refresh()) }, 'B'),
            ),
          );
        }),
      ),
      h('p', { class: 'caption' }, 'Kolejność wg rotacji — najdawniej jedzone na górze. Lunch nie powinien wracać częściej niż co 3 tygodnie.'),
    ];
  };

  const stepPlan = () => {
    const { facts } = checkRules(draft.week, ctx());
    return [
      statTiles(facts),
      h('div', { class: 'days' }, draft.week.days.map((_, d) => dayCard(draft.week, d, apply, { showLocks: true }))),
      h(
        'button',
        {
          class: 'btn secondary',
          type: 'button',
          style: { marginTop: '16px' },
          onclick: () => {
            draft.seed++;
            generate(draft.week);
            sheet.refresh();
            toast('Nowa propozycja — ręczne wybory zostały');
          },
        },
        icon('dice', 20),
        'Losuj ponownie',
      ),
    ];
  };

  const stepSummary = () => {
    const { facts, checks } = checkRules(draft.week, ctx());
    const list = buildShopping(draft.week, S.recipeMap, S.ingMap, { sections: S.user.sections });
    const failed = checks.filter((c) => !c.ok).length;
    return [
      statTiles(facts, [h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, zl(storeCost(list), 0)), h('div', { class: 'stat-label' }, 'w sklepie (całe opakowania)'))]),
      h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row-sub', style: { marginTop: 0 } }, 'kcal dzień po dniu'), kcalBars(facts)),
      h('h2', { class: 'section' }, 'Reguły', h('span', { class: 'aside' }, failed ? `${checks.length - failed} z ${checks.length}` : 'wszystkie spełnione')),
      rulesList(checks),
      failed > 0 && h('p', { class: 'caption' }, 'Plan można zatwierdzić mimo to — albo wróć i podmień pozycje.'),
    ];
  };

  const sheet = openSheet({
    title: `Tydzień ${fmtWeekRange(start)}`,
    full: true,
    className: 'wide-ok',
    closeLabel: 'Anuluj',
    body: () => [
      h('div', { class: 'steps-dots' }, TITLES.map((_, n) => h('i', { class: n === draft.step ? 'on' : '' }))),
      h('h2', { class: 'wizard-title' }, TITLES[draft.step]),
      h('p', { class: 'wizard-lead' }, ['Zaznacz dni poza domem, zjazd i wieczory z dziewczyną.', 'A gotujesz w niedzielę (do 2 h), B w środę po pracy (do 1 h). Po 4 porcje.', 'Śniadania, przekąski i kolacje dobrane wg reguł. Dotknij pozycji, żeby ją podmienić.', 'Sprawdź liczby i zatwierdź — powstaną listy zakupów.'][draft.step]),
      [stepCalendar, stepLunches, stepPlan, stepSummary][draft.step](),
    ],
    footer: () =>
      h(
        'div',
        { class: 'btn-row' },
        draft.step > 0 && h('button', { class: 'btn gray', type: 'button', style: { flex: '0 0 110px' }, onclick: () => goStep(draft.step - 1) }, 'Wstecz'),
        draft.step < 3 ? h('button', { class: 'btn', type: 'button', onclick: () => goStep(draft.step + 1) }, draft.step === 1 ? 'Ułóż plan' : 'Dalej') : h('button', { class: 'btn', type: 'button', onclick: approve }, icon('check', 20), 'Zatwierdź plan'),
      ),
  });

  if (entry === 'template') openTemplates(useTemplate);
  if (entry === 'claude') openClaudePlan(start, draft.calendar, useTemplate);
  return sheet;
}
