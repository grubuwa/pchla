// Ustawienia: cele, godziny, przypomnienia, składniki (ceny, opakowania, spiżarnia), kopia zapasowa.
import { S, commit, exportBackup, importBackup, resetAll } from '../store.js';
import { todayISO, addDays, fmtDate, norm, num, zl } from '../util.js';
import { REMINDER_LABELS } from '../ics.js';
import { regenShopping } from '../model.js';
import { h, icon, openSheet, confirmSheet, field, switchEl, toast, saveFile, pickFile, iconButton } from '../ui.js';
import { openShortcutHelp } from './shop.js';
import { openRecipeImport, copyDietitian } from './claude-ui.js';

export async function exportBackupFile() {
  const ok = await saveFile(`pchla-kopia-${todayISO()}.json`, exportBackup(), 'application/json');
  if (!ok) return;
  commit((u) => (u.flags.lastBackup = todayISO()));
  toast('Kopia zapasowa zapisana');
}

async function importBackupFile() {
  const text = await pickFile();
  if (!text) return;
  if (!(await confirmSheet('Wczytać kopię?', 'Obecne dane w aplikacji (plany, pomiary, przepisy) zostaną zastąpione zawartością pliku.', 'Zastąp dane', { destructive: true }))) return;
  try {
    await importBackup(text);
    toast('Kopia wczytana');
  } catch (e) {
    toast(e.message);
  }
}

// wiersz z liczbą / godziną; zapis po opuszczeniu pola
function inputRow(label, value, onSave, { type = 'number', unit, sub, step } = {}) {
  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'grow' }, h('span', { class: 'row-title' }, label), sub && h('span', { class: 'row-sub' }, sub)),
    h('input', {
      class: 'inline',
      type,
      inputmode: type === 'number' ? 'decimal' : null,
      step,
      value: value ?? '',
      'aria-label': label,
      style: type === 'time' ? { width: '104px' } : null,
      onchange: (e) => {
        const v = type === 'number' ? Number(String(e.target.value).replace(',', '.')) : e.target.value;
        if (type === 'number' && !Number.isFinite(v)) return;
        if (type === 'time' && !v) return;
        onSave(v);
      },
    }),
    unit && h('span', { class: 'muted', style: { minWidth: '34px' } }, unit),
  );
}

const SECTIONS_HINT = 'Dział decyduje o kolejności na liście zakupów.';

function openIngredient(id) {
  const ing = S.ingMap[id];
  if (!ing) return;
  const save = (fn) => {
    commit(
      (u, c) => {
        fn(c.ingredients.find((i) => i.id === id));
        // bieżące i przyszłe listy zakupów liczą się od nowa
        for (const start of Object.keys(u.shopping)) if (u.weeks[start]?.approved && start >= addDays(todayISO(), -7)) regenShopping(u, start);
      },
      { catalog: true },
    );
    sheet.refresh();
  };
  const sw = (label, key, sub) => h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, label), sub && h('span', { class: 'row-sub' }, sub)), switchEl(!!S.ingMap[id][key], (v) => save((i) => (i[key] = v)), label));
  const sheet = openSheet({
    title: 'Składnik',
    full: true,
    body: () => {
      const i = S.ingMap[id];
      return [
        h('div', { class: 'card' }, field('Nazwa', h('input', { class: 'input', value: i.name, onchange: (e) => e.target.value.trim() && save((x) => (x.name = e.target.value.trim())) })), field('Dział w sklepie', h('select', { class: 'input', onchange: (e) => save((x) => (x.section = e.target.value)) }, S.user.sections.map((s) => h('option', { value: s, selected: i.section === s }, s))), SECTIONS_HINT)),
        h('div', { class: 'group-label' }, 'Cena i opakowanie'),
        h(
          'div',
          { class: 'list' },
          inputRow('Cena', i.pricePerKg, (v) => save((x) => (x.pricePerKg = Math.max(0, v))), { unit: 'zł/kg', step: '0.5' }),
          inputRow('Opakowanie', i.packGrams, (v) => v > 0 && save((x) => (x.packGrams = v)), { unit: 'g', sub: i.packGrams ? `1 opak. ≈ ${zl((i.packGrams * i.pricePerKg) / 1000)}` : null }),
          h('div', { class: 'row' }, h('span', { class: 'grow row-title' }, 'Opis opakowania'), h('input', { class: 'inline', style: { width: '170px', textAlign: 'left' }, value: i.packLabel || '', placeholder: 'np. tacka 500 g', 'aria-label': 'Opis opakowania', onchange: (e) => save((x) => (x.packLabel = e.target.value.trim())) })),
          i.unit && inputRow(`1 ${i.unit.name}`, i.unit.grams, (v) => v > 0 && save((x) => (x.unit.grams = v)), { unit: 'g' }),
        ),
        h('div', { class: 'group-label' }, 'Zakupy'),
        h(
          'div',
          { class: 'list' },
          sw('Zawsze w domu', 'pantry', 'lista pomija, pokazuje w „sprawdź w spiżarni”'),
          sw('Czasem w domu', 'ask', 'lista dodaje z pytaniem „mam”'),
          sw('Nietrwały', 'perishable', 'kupowany na tę połowę tygodnia, w której jest potrzebny'),
          sw('Świeży — osobno w sobotę i w środę', 'fresh', 'mięso, ryby, sałaty, zioła'),
          i.unit?.name === 'szt.' && sw('Kupowany na sztuki', 'loose', 'zamiast pełnych opakowań'),
        ),
        h('div', { class: 'group-label' }, 'Wartości na 100 g'),
        h(
          'div',
          { class: 'list' },
          [
            ['kcal', 'Energia', 'kcal'],
            ['protein', 'Białko', 'g'],
            ['fat', 'Tłuszcz', 'g'],
            ['satFat', 'w tym nasycone', 'g'],
            ['carbs', 'Węglowodany', 'g'],
            ['fiber', 'Błonnik', 'g'],
          ].map(([k, label, unit]) => inputRow(label, i[k], (v) => save((x) => (x[k] = Math.max(0, v))), { unit, step: '0.1' })),
        ),
        h('p', { class: 'caption' }, 'Zmiana przelicza kcal we wszystkich przepisach i aktualizuje listy zakupów.'),
      ];
    },
  });
}

function openIngredients() {
  let q = '';
  const body = h('div', {});
  const draw = () => {
    const needle = norm(q);
    const found = S.catalog.ingredients.filter((i) => i.id !== 'przyprawy' && (!needle || norm(i.name).includes(needle)));
    const groups = S.user.sections.map((s) => [s, found.filter((i) => i.section === s)]).filter(([, list]) => list.length);
    body.replaceChildren(
      ...groups.flatMap(([s, list]) => [
        h('div', { class: 'group-label' }, s),
        h(
          'div',
          { class: 'list' },
          list.map((i) =>
            h(
              'button',
              { class: 'row row-btn', type: 'button', onclick: () => openIngredient(i.id) },
              h('span', { class: 'grow' }, h('span', { class: 'row-title' }, i.name), h('span', { class: 'row-sub' }, [`${num(i.pricePerKg, i.pricePerKg % 1 ? 2 : 0)} zł/kg`, i.packLabel, i.pantry && 'zawsze w domu', i.ask && 'czasem w domu'].filter(Boolean).join(' · '))),
              h('span', { class: 'ic chev' }, icon('right', 18)),
            ),
          ),
        ),
      ]),
    );
  };
  const sheet = openSheet({
    title: 'Składniki',
    full: true,
    live: true,
    body: () => {
      draw();
      return [h('div', { class: 'search' }, icon('search', 18), h('input', { class: 'input', type: 'search', placeholder: 'Szukaj składnika', value: q, oninput: (e) => ((q = e.target.value), draw()) })), body];
    },
  });
  return sheet;
}

function openPresets() {
  const sheet = openSheet({
    title: 'Szybki wpis — presety',
    full: true,
    body: () => [
      h('p', { class: 'muted pad' }, 'Pozycje podpowiadane po dotknięciu „Zjadłem coś poza planem”. Orientacyjne kcal.'),
      h(
        'div',
        { class: 'list' },
        S.user.presets.map((p, n) =>
          h(
            'div',
            { class: 'row' },
            h('input', { class: 'grow', style: { border: 0, background: 'none', outline: 'none', minHeight: '34px', minWidth: 0 }, value: p.name, 'aria-label': 'Nazwa', onchange: (e) => commit((u) => (u.presets[n].name = e.target.value.trim() || p.name), { silent: true }) }),
            h('input', { class: 'inline', type: 'number', inputmode: 'numeric', value: p.kcal, 'aria-label': 'kcal', style: { width: '76px' }, onchange: (e) => commit((u) => (u.presets[n].kcal = Math.max(0, Number(e.target.value) || 0)), { silent: true }) }),
            iconButton('trash', 'Usuń preset', () => (commit((u) => u.presets.splice(n, 1), { silent: true }), sheet.refresh()), 'plain'),
          ),
        ),
        h('button', { class: 'row row-btn', type: 'button', onclick: () => (commit((u) => u.presets.push({ name: 'Nowa pozycja', kcal: 400 }), { silent: true }), sheet.refresh()) }, icon('plus', 20), h('span', { class: 'row-title', style: { color: 'var(--accent-text)' } }, 'Dodaj preset')),
      ),
    ],
  });
}

export function openSettings() {
  const set = (fn) => {
    commit(fn);
    sheet.refresh();
  };
  const link = (emoji, title, sub, onclick) => h('button', { class: 'row row-btn', type: 'button', onclick }, h('span', { class: 'emoji' }, emoji), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, title), sub && h('span', { class: 'row-sub' }, sub)), h('span', { class: 'ic chev' }, icon('right', 18)));

  const sheet = openSheet({
    title: 'Ustawienia',
    full: true,
    body: () => {
      const u = S.user;
      const T = u.targets;
      return [
        h('div', { class: 'group-label' }, 'Cele dzienne'),
        h(
          'div',
          { class: 'list' },
          inputRow('Kalorie', T.kcal, (v) => v >= 1200 && set((x) => Object.assign(x.targets, { kcal: v, kcalMin: v - 100, kcalMax: v + 100 })), { unit: 'kcal', sub: `zakres ${T.kcalMin}–${T.kcalMax}`, step: '50' }),
          inputRow('Białko od', T.proteinMin, (v) => v > 0 && set((x) => (x.targets.proteinMin = v)), { unit: 'g' }),
          inputRow('Białko do', T.proteinMax, (v) => v > 0 && set((x) => (x.targets.proteinMax = v)), { unit: 'g' }),
          inputRow('Błonnik od', T.fiberMin, (v) => v > 0 && set((x) => (x.targets.fiberMin = v)), { unit: 'g' }),
          inputRow('Tłuszcze nasycone do', T.satFatMax, (v) => v > 0 && set((x) => (x.targets.satFatMax = v)), { unit: 'g', sub: 'ze względu na lipidogram' }),
          inputRow('Kroki', T.stepsGoal, (v) => v > 0 && set((x) => (x.targets.stepsGoal = Math.round(v))), { unit: '/dzień', step: '500' }),
        ),
        T.kcal < 1800 && h('div', { class: 'note red' }, '⚠️', h('span', {}, 'Poniżej ok. 1800 kcal nie schodź bez konsultacji z lekarzem.')),
        h('p', { class: 'caption' }, 'Przegląd co 3–4 tygodnie: jeśli średnia spada wolniej niż 0,5 kg/tydz. przez 3 tygodnie → −100–150 kcal. Przeliczaj cel co ok. 5 kg.'),

        h('div', { class: 'group-label' }, 'Waga i budżet'),
        h(
          'div',
          { class: 'list' },
          inputRow('Waga startowa', T.weightStart, (v) => v > 0 && set((x) => (x.targets.weightStart = v)), { unit: 'kg', step: '0.1' }),
          inputRow('Etap 1', T.weightStage1, (v) => v > 0 && set((x) => (x.targets.weightStage1 = v)), { unit: 'kg', step: '0.1' }),
          inputRow('Cel długoterminowy', T.weightGoal, (v) => v > 0 && set((x) => (x.targets.weightGoal = v)), { unit: 'kg', step: '0.1' }),
          inputRow('Budżet tygodnia (cel)', T.budget, (v) => v > 0 && set((x) => (x.targets.budget = v)), { unit: 'zł', step: '10' }),
          inputRow('Budżet tygodnia (maks.)', T.budgetMax, (v) => v > 0 && set((x) => (x.targets.budgetMax = v)), { unit: 'zł', step: '10' }),
        ),

        h('div', { class: 'group-label' }, 'Godziny posiłków'),
        h(
          'div',
          { class: 'list' },
          [
            ['sniadanie', 'Śniadanie'],
            ['lunch', 'Lunch'],
            ['przekaska', 'Przekąska'],
            ['kolacja', 'Kolacja'],
            ['wieczor', 'Przekąska wieczorna'],
            ['kitchenClosed', 'Kuchnia zamknięta'],
            ['sleep', 'Cel snu'],
          ].map(([k, label]) => inputRow(label, u.times[k], (v) => set((x) => (x.times[k] = v)), { type: 'time' })),
        ),

        h('div', { class: 'group-label' }, 'Przypomnienia w Kalendarzu (.ics)'),
        h(
          'div',
          { class: 'list' },
          Object.entries(REMINDER_LABELS).map(([k, label]) =>
            h(
              'div',
              { class: 'row' },
              h('span', { class: 'grow row-title' }, label),
              h('input', { class: 'inline', type: 'time', style: { width: '104px' }, value: u.reminders[k], disabled: !!u.remindersOff[k], 'aria-label': `${label} — godzina`, onchange: (e) => e.target.value && set((x) => (x.reminders[k] = e.target.value)) }),
              switchEl(!u.remindersOff[k], (v) => set((x) => (v ? delete x.remindersOff[k] : (x.remindersOff[k] = true))), label),
            ),
          ),
        ),
        h('p', { class: 'caption' }, 'iPhone nie pozwala aplikacji webowej planować powiadomień. Po zatwierdzeniu planu (albo z ekranu Tydzień) pobierasz plik .ics i dodajesz go do Kalendarza — wydarzenia mają alarmy i treść z planu.'),

        h('div', { class: 'group-label' }, 'Zakupy'),
        h(
          'div',
          { class: 'list' },
          link('🥫', 'Składniki', `ceny, opakowania, spiżarnia · ${S.catalog.ingredients.length} pozycji`, openIngredients),
          link('📲', 'Skrót do Przypomnień Apple', 'jednorazowa konfiguracja na iPhonie', openShortcutHelp),
          h('div', { class: 'row' }, h('span', { class: 'emoji' }, '🗓️'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Dni zakupów'), h('span', { class: 'row-sub' }, 'sobota — duże; środa po pracy — mięso, ryba, świeże'))),
        ),

        h('div', { class: 'group-label' }, 'Dziennik i Claude'),
        h('div', { class: 'list' }, link('🍔', 'Presety „poza planem”', `${u.presets.length} pozycji`, openPresets), link('✨', 'Importuj przepis z Claude', 'link lub tekst → format aplikacji', openRecipeImport), link('🧑‍⚕️', 'Kontekst dla dietetyka', 'kopiuje cele, wagę i odchylenia od planu', copyDietitian)),

        h('div', { class: 'group-label' }, 'Kopia zapasowa'),
        h(
          'div',
          { class: 'list' },
          link('💾', 'Eksportuj kopię (JSON)', u.flags.lastBackup ? `ostatnia: ${fmtDate(u.flags.lastBackup)}` : 'jeszcze nie robiłeś kopii', async () => {
            await exportBackupFile();
            sheet.refresh();
          }),
          link('📂', 'Wczytaj kopię', 'zastępuje dane w aplikacji', importBackupFile),
        ),
        h('p', { class: 'caption' }, 'Wszystkie dane są tylko na tym urządzeniu (IndexedDB). Aplikacja przypomina o kopii raz w tygodniu, w sobotę.'),

        h('div', { class: 'group-label' }, 'Inne'),
        h(
          'div',
          { class: 'list' },
          h(
            'button',
            {
              class: 'row row-btn danger',
              type: 'button',
              onclick: async () => {
                if (!(await confirmSheet('Przywrócić dane startowe?', 'Usunie wszystkie plany, pomiary, własne przepisy i zmiany cen. Tego nie da się cofnąć — najpierw zrób kopię zapasową.', 'Usuń wszystko i zacznij od nowa', { destructive: true }))) return;
                await resetAll();
                sheet.close();
                toast('Przywrócono dane startowe');
              },
            },
            icon('trash'),
            h('span', { class: 'grow row-title' }, 'Przywróć dane startowe'),
          ),
        ),
        h('p', { class: 'caption center' }, 'pchła 1.0 · plan posiłków, przepisy i zakupy'),
      ];
    },
  });
}
