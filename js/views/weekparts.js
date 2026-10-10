// Wspólne elementy ekranu „Tydzień” i kreatora: karta dnia, podmiana przepisu, reguły, kafle.
import { S } from '../store.js';
import { SLOTS, SLOT_LABEL, DAYS, DAYS_SHORT, fmtShort, round10, shortName, todayISO, zl } from '../util.js';
import { dayPlanned } from '../nutrition.js';
import { candidates, guestOk, suggestLunches } from '../planner.js';
import { changeMeal, changeDayMode, changeGuest } from '../model.js';
import { weekEvents, buildICS, icsFileName } from '../ics.js';
import { emojiOf } from '../seed.js';
import { h, icon, actionSheet, saveFile, toast } from '../ui.js';
import { openRecipePicker } from './recipes.js';

export const MODES = {
  normal: { label: 'W domu', icon: 'home', detail: 'zwykły dzień wg planu' },
  zjazd: { label: 'Zjazd', icon: 'school', detail: 'stacjonarny — kanapki do zabrania zamiast ciepłego posiłku' },
  'poza domem': { label: 'Poza domem', icon: 'away', detail: 'dzień wypada z planu i z listy zakupów' },
};

/**
 * Podmiana pozycji w planie. apply(fn) wykonuje zmianę na tygodniu (zapisanym lub szkicu).
 */
export function openSwap(week, d, slot, apply) {
  const day = week.days[d];
  const cur = day.meals[slot];
  const recipes = S.catalog.recipes;
  const all = candidates(recipes, slot, d, day, { auto: false });
  const strictIds = new Set(candidates(recipes, slot, d, day).map((r) => r.id));
  const planLunch = day.mode !== 'zjazd' && cur && (cur.recipeId === week.lunchA || cur.recipeId === week.lunchB) && (slot === 'lunch' || (slot === 'kolacja' && d === 3));
  const which = cur?.recipeId === week.lunchA ? 'A' : 'B';
  const lastUsed = slot === 'lunch' ? Object.fromEntries(suggestLunches(recipes, S.user.weeks, week.startSunday).map((s) => [s.recipe.id, s.weeksAgo])) : null;

  let note = null;
  if (planLunch && slot === 'lunch') note = ['🍲', h('span', {}, `Lunch ${which} gotujesz raz na kilka dni — zmiana obejmie wszystkie jego porcje w tym tygodniu.`)];
  else if (planLunch) note = ['🍲', h('span', {}, 'Środowa kolacja to pierwsza porcja lunchu B. Wybierz inny lunch (zmieni cały lunch B) albo zwykłą kolację.')];
  else if (slot === 'kolacja' && day.guest) note = ['👫', h('span', {}, 'Kolacja z dziewczyną: porcje ×2, bez pszenicy w roli głównej albo z zamiennikiem.')];

  openRecipePicker({
    title: `${SLOT_LABEL[slot]} · ${DAYS[d].toLowerCase()}`,
    recipes: all,
    current: cur?.recipeId,
    strict: slot === 'lunch' && day.mode !== 'zjazd' ? null : (r) => strictIds.has(r.id),
    note,
    badge: (r) => {
      if (lastUsed && r.type === 'lunch') {
        const ago = lastUsed[r.id];
        return h('span', { class: 'row-sub' }, ago == null ? 'jeszcze nie było' : ago === 1 ? 'ostatnio: tydzień temu' : `ostatnio: ${ago} tyg. temu`);
      }
      if (slot === 'kolacja' && day.guest && r.wheatMain) return h('span', { class: 'row-sub' }, guestOk(r) ? `zamiennik: ${r.wheatSwap}` : 'pszenica w roli głównej');
      return null;
    },
    onPick: (id) => apply((w) => changeMeal(w, d, slot, id)),
    onClear: cur && !planLunch ? () => apply((w) => changeMeal(w, d, slot, null)) : null,
  });
}

export function openDayMode(week, d, apply) {
  const day = week.days[d];
  actionSheet(
    `${DAYS[d]} ${fmtShort(day.date)}`,
    Object.entries(MODES).map(([mode, m]) => ({ icon: m.icon, label: m.label, detail: m.detail, current: day.mode === mode, onSelect: () => apply((w) => changeDayMode(w, d, mode)) })),
  );
}

/**
 * Karta dnia z 5 pozycjami. apply(fn) — jak w openSwap.
 */
export function dayCard(week, d, apply, { showLocks = false } = {}) {
  const day = week.days[d];
  const T = S.user.targets;
  const off = day.mode === 'poza domem';
  const tot = dayPlanned(day, S.recipeMap);
  const out = !off && tot.kcal > 0 && (tot.kcal < T.kcalMin - 60 || tot.kcal > T.kcalMax + 60);
  const mode = MODES[day.mode];

  return h(
    'section',
    { class: `day${off ? ' off' : ''}${day.date === todayISO() ? ' today' : ''}` },
    h(
      'div',
      { class: 'day-head' },
      h('div', { class: 'grow' }, h('div', {}, h('span', { class: 'day-name' }, DAYS[d]), h('span', { class: 'day-date' }, fmtShort(day.date))), !off && h('div', { class: `day-sum${out ? ' warn' : ''}` }, tot.kcal ? `~${round10(tot.kcal)} kcal · ${Math.round(tot.protein)} g białka` : 'brak posiłków')),
      !off && h('button', { type: 'button', class: `pill${day.guest ? ' on' : ''}`, 'aria-pressed': day.guest ? 'true' : 'false', title: 'Kolacja z dziewczyną', onclick: () => apply((w) => changeGuest(w, d, !day.guest)) }, icon('guest', 17), day.guest && '×2'),
      h('button', { type: 'button', class: `pill${day.mode !== 'normal' ? ' blue' : ''}`, title: 'Tryb dnia', onclick: () => openDayMode(week, d, apply) }, icon(mode.icon, 17), day.mode !== 'normal' && mode.label),
    ),
    off
      ? h('div', { class: 'day-off-note' }, 'Bez planu i zakupów. „Słoik od mamy” wpiszesz w Dziś jako posiłek poza planem.')
      : h(
          'div',
          { class: 'day-meals' },
          SLOTS.map((slot) => {
            const meal = day.meals[slot];
            const r = meal && S.recipeMap[meal.recipeId];
            const wheat = slot === 'kolacja' && day.guest && r && r.wheatMain;
            return h(
              'button',
              { type: 'button', class: `slot-row${r ? '' : ' empty'}`, onclick: () => openSwap(week, d, slot, apply) },
              h('span', { class: 'emoji' }, r ? emojiOf(r) : '➕'),
              h(
                'span',
                { class: 'what' },
                h('span', { class: 'slot-name' }, slot === 'lunch' && day.mode === 'zjazd' ? 'Na zjazd' : SLOT_LABEL[slot], meal?.portions > 1 && ` · ×${meal.portions}`, wheat && (guestOk(r) ? ' · zamiennik pszenicy' : ' · pszenica!'), showLocks && meal?.locked && ' · wybrane ręcznie'),
                h('span', { class: 'recipe' }, r ? r.short || shortName(r) : meal ? 'przepis usunięty — wybierz inny' : 'Wybierz'),
              ),
              r && h('span', { class: 'kcal' }, `${round10(r.perServing.kcal)}`),
              icon('right', 16),
            );
          }),
        ),
  );
}

export function statTiles(facts, extra = []) {
  const T = S.user.targets;
  const kcalOk = facts.avg.kcal >= T.kcalMin - 60 && facts.avg.kcal <= T.kcalMax + 60;
  return h(
    'div',
    { class: `stats${extra.length ? ' four' : ''}` },
    h('div', { class: `stat${kcalOk ? '' : ' bad'}` }, h('div', { class: 'stat-value' }, `~${round10(facts.avg.kcal)}`), h('div', { class: 'stat-label' }, 'kcal / dzień')),
    h('div', { class: `stat${facts.avg.protein >= T.proteinMin ? '' : ' bad'}` }, h('div', { class: 'stat-value' }, `${Math.round(facts.avg.protein)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'białka / dzień')),
    h('div', { class: `stat${facts.costUse <= T.budgetMax ? '' : ' bad'}` }, h('div', { class: 'stat-value' }, zl(facts.costUse, 0)), h('div', { class: 'stat-label' }, 'zużycie / tydzień')),
    extra,
  );
}

export function rulesList(checks) {
  return h(
    'div',
    { class: 'list' },
    checks.map((c) => h('div', { class: `rule${c.ok ? '' : ' bad'}` }, h('span', { class: 'rule-mark' }, icon(c.ok ? 'check' : 'close', 15)), h('span', { class: 'grow' }, c.label), h('span', { class: 'rule-detail' }, c.detail))),
  );
}

export function kcalBars(facts) {
  const T = S.user.targets;
  const max = Math.max(T.kcalMax, ...facts.days.map((d) => d.totals.kcal)) || 1;
  return h(
    'div',
    { class: 'mini-bars' },
    facts.days.map((d, i) => {
      const k = d.totals.kcal;
      const out = d.active && (k < T.kcalMin - 60 || k > T.kcalMax + 60);
      return h('div', { class: `col${d.active ? '' : ' off'}${out ? ' out' : ''}` }, h('em', {}, d.active ? round10(k) : '—'), h('i', { style: { height: `${d.active ? Math.max(4, (k / max) * 62) : 4}px` } }), h('span', {}, DAYS_SHORT[i]));
    }),
  );
}

export async function exportICS(week) {
  const events = weekEvents(week, S.recipeMap, S.user.reminders, S.user.remindersOff);
  if (!events.length) return toast('Brak przypomnień do wyeksportowania');
  const ok = await saveFile(icsFileName(week), buildICS(events), 'text/calendar');
  if (ok) toast(`${events.length} przypomnień — dodaj plik do Kalendarza`);
}
