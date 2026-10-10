// Start aplikacji: wczytanie danych, pasek kart, renderowanie bieżącego widoku.
import { load, subscribe, S } from './store.js';
import { TABS, nav, onNav, go } from './nav.js';
import { h, fill, icon, refreshSheets, sheetsOpen } from './ui.js';
import { todayISO, addDays, dow, weekStart } from './util.js';
import * as today from './views/today.js';
import * as week from './views/week.js';
import * as recipes from './views/recipes.js';
import * as shop from './views/shop.js';
import * as progress from './views/progress.js';

const VIEWS = { today, week, recipes, shop, progress };
const viewEl = document.getElementById('view');
const tabsEl = document.getElementById('tabbar');
const scrollPos = {};
let shownTab = null;

// plakietka na Zakupach tylko w dni zakupów: sobota (lista na kolejny tydzień) i środa
function shopBadge() {
  const t = todayISO();
  const d = dow(t);
  const [start, trip] = d === 6 ? [addDays(t, 1), 'sobota'] : d === 3 ? [weekStart(t), 'środa'] : [];
  const list = start && S.user.shopping[start];
  return list ? list.items.filter((i) => i.trip === trip && !i.checked && !i.have).length : 0;
}

function drawTabs() {
  const badge = shopBadge();
  fill(
    tabsEl,
    h(
      'div',
      { class: 'tabs', role: 'tablist' },
      TABS.map((t) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: nav.tab === t.id ? 'on' : '',
            'aria-selected': nav.tab === t.id ? 'true' : 'false',
            onclick: () => (nav.tab === t.id ? scrollTo({ top: 0, behavior: 'smooth' }) : go(t.id)),
          },
          icon(t.icon, 25),
          t.label,
          t.id === 'shop' && badge > 0 && h('span', { class: 'dot' }, badge),
        ),
      ),
    ),
  );
}

function renderView() {
  const changed = shownTab !== nav.tab;
  if (changed && shownTab) scrollPos[shownTab] = scrollY;
  const params = nav.params;
  nav.params = {};
  const jump = Object.keys(params).length > 0;
  const keep = scrollY;
  const view = VIEWS[nav.tab] || today;

  viewEl.classList.toggle('wide', !!view.wide);
  fill(viewEl, view.render(params));

  if (changed) {
    viewEl.classList.remove('enter');
    void viewEl.offsetWidth; // restart animacji wejścia
    viewEl.classList.add('enter');
    scrollTo(0, jump ? 0 : scrollPos[nav.tab] || 0);
  } else scrollTo(0, jump ? 0 : keep);
  shownTab = nav.tab;
  if (location.hash.slice(1) !== nav.tab) history.replaceState(null, '', `#${nav.tab}`);
  drawTabs();
}

async function boot() {
  try {
    await load();
  } catch (e) {
    fill(viewEl, h('div', { id: 'boot' }, h('div', { style: { fontSize: '44px' } }, '😵'), h('p', {}, `Nie udało się uruchomić aplikacji: ${e.message}`), h('button', { class: 'btn', type: 'button', style: { maxWidth: '260px' }, onclick: () => location.reload() }, 'Spróbuj ponownie')));
    return;
  }
  const fromHash = location.hash.slice(1);
  if (VIEWS[fromHash]) nav.tab = fromHash;

  onNav(renderView);
  subscribe(() => {
    renderView();
    refreshSheets();
  });
  renderView();
  tabsEl.hidden = false;
  addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (VIEWS[tab] && tab !== nav.tab) go(tab);
  });

  // ekran „Dziś” zależy od godziny i daty
  setInterval(() => {
    if (document.visibilityState === 'visible' && !sheetsOpen() && nav.tab === 'today' && !document.querySelector('.cook')) renderView();
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !sheetsOpen() && !document.querySelector('.cook')) renderView();
  });
}

boot();

// offline: lista zakupów i przepisy z pamięci podręcznej (na localhost tylko z ?sw=1, żeby nie przeszkadzać w pracy nad kodem)
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!local || new URLSearchParams(location.search).has('sw'))) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
