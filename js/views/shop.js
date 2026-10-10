// Zakupy: listy na sobotę i środę z planu, działy w kolejności sklepu, spiżarnia, eksport.
import { S, commit } from '../store.js';
import { todayISO, addDays, dow, weekStart, fmtWeekRange, zl, uid } from '../util.js';
import { TRIPS, tripCost, shoppingLines, shortcutURL } from '../shopping.js';
import { regenShopping } from '../model.js';
import { h, icon, openSheet, actionSheet, pageHeader, iconButton, segmented, copyText, toast } from '../ui.js';
import { go, refresh } from '../nav.js';

const view = { start: null, trip: null };
let popKey = null;

const TRIP_LABEL = { sobota: 'Sobota', 'środa': 'Środa' };
const TRIP_HINT = { sobota: 'duże zakupy: wszystko trwałe + świeże na nd–śr', 'środa': 'po pracy: mięso, ryba i świeże na czw–sob' };

function defaults() {
  const today = todayISO();
  const d = dow(today);
  const lists = S.user.shopping;
  const cur = weekStart(today);
  const next = addDays(cur, 7);
  // w sobotę kupuje się już na kolejny tydzień
  const start = d === 6 && lists[next] ? next : lists[cur] ? cur : lists[next] ? next : Object.keys(lists).sort().pop() || cur;
  const trip = start === cur && d >= 3 ? 'środa' : 'sobota';
  return { start, trip };
}

export function openShortcutHelp() {
  openSheet({
    title: 'Skrót do Przypomnień',
    body: () => [
      h('p', { class: 'muted pad' }, 'Jednorazowa konfiguracja na iPhonie. Potem przycisk „Do Przypomnień” wrzuca całą listę do aplikacji Przypomnienia — każda pozycja osobno, w kolejności działów.'),
      h(
        'div',
        { class: 'card', style: { padding: 0 } },
        h(
          'ol',
          { class: 'how' },
          h('li', {}, 'W Przypomnieniach utwórz listę o nazwie ', h('code', {}, 'Zakupy'), '.'),
          h('li', {}, 'Otwórz aplikację Skróty → „+” → nazwij skrót dokładnie ', h('code', {}, 'Zakupy z planu'), '.'),
          h('li', {}, 'Dodaj czynność „Odbierz tekst jako dane wejściowe” (w szczegółach skrótu: przyjmuj Tekst).'),
          h('li', {}, 'Dodaj „Podziel tekst” → wg nowych linii.'),
          h('li', {}, 'Dodaj „Powtórz z każdym” → w środku „Dodaj nowe przypomnienie” z „Powtarzana rzecz” do listy „Zakupy”.'),
          h('li', {}, 'Gotowe. Wróć tutaj i dotknij „Do Przypomnień”.'),
        ),
      ),
      h('p', { class: 'caption' }, 'Bez Skrótu też się da: „Kopiuj listę”, a potem wklej w Przypomnieniach — wiele linii tworzy osobne pozycje.'),
    ],
  });
}

function itemRow(start, it) {
  const done = it.checked || it.have;
  const toggle = () => {
    popKey = it.id;
    commit((u) => {
      const x = u.shopping[start].items.find((i) => i.id === it.id);
      if (x.have) x.have = false;
      else x.checked = !x.checked;
    });
  };
  return h(
    'div',
    { class: `row with-lead shop-item${done ? ' is-done' : ''}` },
    h('button', { type: 'button', class: `check ${done ? 'done' : ''}${popKey === it.id ? ' pop' : ''}`, 'aria-label': `${it.text}: ${done ? 'kupione' : 'do kupienia'}`, onclick: toggle }, icon('check', 17)),
    h('button', { type: 'button', class: 'meal-main', onclick: toggle }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, it.text), (it.qty || it.hint) && h('span', { class: 'qty' }, [it.qty, it.have ? 'mam w domu' : it.hint].filter(Boolean).join(' · ')))),
    it.ask &&
      !it.checked &&
      !it.have &&
      h(
        'button',
        {
          type: 'button',
          class: 'pill ask',
          title: 'Mam w domu — nie kupuję',
          onclick: () => {
            popKey = it.id;
            commit((u) => (u.shopping[start].items.find((i) => i.id === it.id).have = true));
          },
        },
        'mam',
      ),
    it.manual ? iconButton('trash', 'Usuń pozycję', () => commit((u) => (u.shopping[start].items = u.shopping[start].items.filter((i) => i.id !== it.id))), 'plain') : !it.have && it.costEst > 0 && h('span', { class: 'cost' }, zl(it.costEst)),
  );
}

function ring(done, total) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const el = h('div', {
    html: `<svg class="ring${pct >= 1 ? ' full' : ''}" viewBox="0 0 54 54"><circle class="track" cx="27" cy="27" r="${r}"/><circle class="value" cx="27" cy="27" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>`,
  });
  return el.firstChild;
}

export function render(params = {}) {
  if (params.start) view.start = params.start;
  if (params.trip) view.trip = params.trip;
  const def = defaults();
  if (!view.start || !S.user.shopping[view.start]) view.start = def.start;
  if (!view.trip) view.trip = def.trip;
  const { start, trip } = view;
  const list = S.user.shopping[start];

  if (!list) {
    return [
      pageHeader('Zakupy', 'Listy z planu'),
      h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🛒'), h('h3', {}, 'Lista powstanie z planu'), h('p', {}, 'Zatwierdź plan tygodnia — składniki z wszystkich przepisów zsumują się, zaokrąglą do opakowań i podzielą na sobotę i środę.'), h('button', { class: 'btn', type: 'button', onclick: () => go('week', { wizard: true }) }, 'Zaplanuj tydzień')),
    ];
  }

  const weeks = Object.keys(S.user.shopping).sort();
  const at = weeks.indexOf(start);
  const items = list.items.filter((i) => i.trip === trip);
  const open = items.filter((i) => !i.checked && !i.have);
  const left = (t) => list.items.filter((i) => i.trip === t && !i.checked && !i.have).length;
  const lines = shoppingLines(list, trip);

  const exportMenu = () =>
    actionSheet(`Lista — ${TRIP_LABEL[trip].toLowerCase()}`, [
      { icon: 'list', label: 'Do Przypomnień Apple', detail: 'przez Skrót „Zakupy z planu”', onSelect: () => (lines.length ? (location.href = shortcutURL(lines)) : toast('Wszystko już kupione')) },
      { icon: 'copy', label: 'Kopiuj listę jako tekst', detail: `${lines.length} pozycji do kupienia`, onSelect: () => copyText(lines.join('\n'), 'Lista skopiowana') },
      { icon: 'gear', label: 'Jak ustawić Skrót', onSelect: openShortcutHelp },
      { icon: 'swap', label: 'Odśwież z planu', detail: 'przelicz ilości; odhaczenia zostają', onSelect: () => (commit((u) => regenShopping(u, start)), toast('Lista przeliczona')) },
      {
        icon: 'close',
        label: 'Odznacz wszystko',
        onSelect: () =>
          commit((u) => {
            for (const i of u.shopping[start].items) if (i.trip === trip) i.checked = i.have = false;
          }),
      },
    ]);

  const out = [
    pageHeader('Zakupy', `Tydzień ${fmtWeekRange(start)}`, weeks.length > 1 && iconButton('left', 'Wcześniejsza lista', () => at > 0 && ((view.start = weeks[at - 1]), refresh())), weeks.length > 1 && iconButton('right', 'Późniejsza lista', () => at < weeks.length - 1 && ((view.start = weeks[at + 1]), refresh())), iconButton('share', 'Eksport listy', exportMenu)),
    segmented(
      TRIPS.map((t) => ({ value: t, label: `${TRIP_LABEL[t]}${left(t) ? ` · ${left(t)}` : ''}` })),
      trip,
      (t) => ((view.trip = t), refresh()),
    ),
    h('p', { class: 'caption', style: { margin: '8px 4px 12px' } }, TRIP_HINT[trip]),
    h(
      'div',
      { class: 'card shop-total' },
      ring(items.length - open.length, items.length),
      h('div', { class: 'grow' }, h('div', { class: 'big' }, `ok. ${zl(tripCost(list, trip), 0)}`), h('div', { class: 'row-sub' }, items.length ? (open.length ? `zostało ${open.length} z ${items.length} pozycji` : 'wszystko w koszyku 🎉') : 'nic do kupienia')),
      h('div', { class: 'small muted', style: { textAlign: 'right' } }, 'zużycie tygodnia', h('br'), h('b', { class: 'num', style: { color: 'var(--label)' } }, `ok. ${zl(list.costUse, 0)}`)),
    ),
  ];

  const sections = [...new Set(items.map((i) => i.section))];
  const order = (s) => {
    const i = S.user.sections.indexOf(s);
    return i < 0 ? 99 : i;
  };
  sections.sort((a, b) => order(a) - order(b));
  for (const sec of sections) {
    out.push(h('div', { class: 'group-label' }, sec), h('div', { class: 'list' }, items.filter((i) => i.section === sec).map((i) => itemRow(start, i))));
  }
  if (!items.length) out.push(h('div', { class: 'card empty', style: { marginTop: '12px' } }, h('div', { class: 'big' }, '🧺'), h('p', {}, trip === 'środa' ? 'W tym tygodniu środowe zakupy nie są potrzebne.' : 'Brak pozycji na sobotę.')));

  // dopisywanie własnych pozycji
  let text = '';
  const add = () => {
    const t = text.trim();
    if (!t) return;
    commit((u) => u.shopping[start].items.push({ id: uid('manual'), text: t, qty: '', section: 'Inne', trip, checked: false, manual: true }));
  };
  out.push(
    h('div', { class: 'group-label' }, 'Dopisz'),
    h(
      'div',
      { class: 'list' },
      h(
        'form',
        {
          class: 'row',
          onsubmit: (e) => {
            e.preventDefault();
            add();
          },
        },
        h('span', { class: 'ic', style: { color: 'var(--accent-text)' } }, icon('plus', 20)),
        h('input', { class: 'grow', style: { border: 0, background: 'none', outline: 'none', minHeight: '34px' }, placeholder: 'np. papier do pieczenia', enterkeyhint: 'done', 'aria-label': 'Własna pozycja', oninput: (e) => (text = e.target.value) }),
        h('button', { type: 'submit', class: 'btn compact secondary' }, 'Dodaj'),
      ),
    ),
  );

  if (list.pantry?.length && trip === 'sobota') {
    out.push(
      h('div', { class: 'group-label' }, 'Sprawdź w spiżarni'),
      h(
        'div',
        { class: 'list' },
        list.pantry.map((p) => {
          const toggle = () => {
            popKey = p.id;
            commit((u) => {
              const x = u.shopping[start].pantry.find((i) => i.id === p.id);
              x.checked = !x.checked;
            });
          };
          return h(
            'div',
            { class: `row with-lead shop-item${p.checked ? ' is-done' : ''}` },
            h('button', { type: 'button', class: `check green ${p.checked ? 'done' : ''}${popKey === p.id ? ' pop' : ''}`, 'aria-label': `${p.text}: ${p.checked ? 'jest' : 'sprawdź'}`, onclick: toggle }, icon('check', 17)),
            h('button', { type: 'button', class: 'meal-main', onclick: toggle }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, p.text), p.need > 0 && h('span', { class: 'qty' }, `w tym tygodniu ok. ${p.need} g`))),
          );
        }),
      ),
      h('p', { class: 'caption' }, 'Zawsze w domu — lista ich nie dolicza, ale rzuć okiem, czy starczy. Przyprawy wg przepisów.'),
    );
  }

  out.push(
    h(
      'div',
      { class: 'btn-row', style: { marginTop: '20px' } },
      h('button', { class: 'btn', type: 'button', onclick: () => (lines.length ? (location.href = shortcutURL(lines)) : toast('Wszystko już kupione')) }, icon('list', 20), 'Do Przypomnień'),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => copyText(lines.join('\n'), 'Lista skopiowana') }, icon('copy', 20), 'Kopiuj listę'),
    ),
    h('p', { class: 'caption center' }, 'Ceny orientacyjne (Lidl / Biedronka) — poprawisz je w Ustawieniach po pierwszych zakupach.'),
  );

  popKey = null;
  return out;
}
