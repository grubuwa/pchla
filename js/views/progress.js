// Postęp: waga z trendem i celami, seria tygodni, badania, log „poza planem”.
import { S, commit } from '../store.js';
import { todayISO, weekStart, addDays, diffDays, fmtDate, fmtShort, num, parseDate, DAYS_SHORT, dow } from '../util.js';
import { adherence, streak, weightTrend, recentPace } from '../stats.js';
import { saveWeight, removeWeight, removeLog, weekAt } from '../model.js';
import { LAB_REFS } from '../seed.js';
import { h, icon, openSheet, pageHeader, iconButton, field, switchEl, toast, confirmSheet } from '../ui.js';
import { copyDietitian } from './claude-ui.js';

const kg = (x, d = 1) => num(x, d);

export function openWeighIn(date = todayISO()) {
  const prev = S.user.weights.find((w) => w.date === date);
  const last = S.user.weights[S.user.weights.length - 1];
  const f = { date, kg: prev?.kg ?? '', waistCm: prev?.waistCm ?? '', steps: prev?.steps ?? '' };
  const sheet = openSheet({
    title: 'Ważenie',
    closeLabel: 'Anuluj',
    body: () => [
      h('p', { class: 'muted pad' }, 'Raz w tygodniu, w sobotę rano, na czczo. Pojedynczy wynik potrafi skakać — patrz na trend.'),
      h(
        'div',
        { class: 'card' },
        field('Waga (kg)', h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1', value: f.kg, placeholder: last ? kg(last.kg) : '120,0', oninput: (e) => (f.kg = e.target.value) })),
        h(
          'div',
          { class: 'field-grid' },
          field('Data', h('input', { class: 'input', type: 'date', value: f.date, max: todayISO(), onchange: (e) => (f.date = e.target.value || date) })),
          field('Pas (cm) — opcjonalnie', h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.5', value: f.waistCm, oninput: (e) => (f.waistCm = e.target.value) })),
        ),
        field('Średnia kroków z tygodnia — opcjonalnie', h('input', { class: 'input', type: 'number', inputmode: 'numeric', step: '100', value: f.steps, placeholder: String(S.user.targets.stepsGoal), oninput: (e) => (f.steps = e.target.value) }), 'Z aplikacji Zdrowie → Kroki → średnia tygodniowa.'),
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          style: { marginTop: '14px' },
          onclick: () => {
            const v = Number(String(f.kg).replace(',', '.'));
            if (!(v > 30 && v < 300)) return toast('Podaj wagę w kilogramach');
            const entry = { date: f.date, kg: Math.round(v * 10) / 10 };
            if (Number(f.waistCm) > 0) entry.waistCm = Number(f.waistCm);
            if (Number(f.steps) > 0) entry.steps = Math.round(Number(f.steps));
            saveWeight(entry);
            sheet.close();
            toast('Zapisane');
          },
        },
        'Zapisz pomiar',
      ),
    ],
  });
}

function chart(weights, T) {
  const { pts, line } = weightTrend(weights);
  const W = 340;
  const H = 190;
  const m = { l: 34, r: 12, t: 16, b: 24 };
  const first = pts[0].date;
  const span = Math.max(28, diffDays(first, pts[pts.length - 1].date) + 7);
  const vals = pts.map((p) => p.kg);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals, T.weightStart);
  if (lo - T.weightStage1 < 6) lo = Math.min(lo, T.weightStage1); // pokaż linię etapu, gdy jest blisko
  lo = Math.floor(lo - 1);
  hi = Math.ceil(hi + 1);
  const x = (date) => m.l + (diffDays(first, date) / span) * (W - m.l - m.r);
  const y = (v) => m.t + ((hi - v) / (hi - lo)) * (H - m.t - m.b);
  const step = hi - lo > 16 ? 5 : hi - lo > 8 ? 2 : 1;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join('');
  const area = `${path}L${x(pts[pts.length - 1].date).toFixed(1)},${H - m.b}L${x(first).toFixed(1)},${H - m.b}Z`;
  const lastP = pts[pts.length - 1];
  const goalLine = (v, label) => (v >= lo && v <= hi ? `<line class="goal" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="goal-label" x="${W - m.r}" y="${y(v) - 5}" text-anchor="end">${label} ${v} kg</text>` : '');
  const xLabels = [first, pts.length > 1 ? lastP.date : null].filter(Boolean).map((d, i) => `<text x="${x(d)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${fmtShort(d)}</text>`).join('');

  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wykres wagi">
    ${ticks.map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${goalLine(T.weightStage1, 'etap 1:')}
    ${pts.length > 1 ? `<path class="area" d="${area}"/><path class="line" d="${path}"/>` : ''}
    ${pts.length > 2 ? `<path class="trend" d="M${x(first)},${y(line[0])}L${x(lastP.date)},${y(line[line.length - 1])}"/>` : ''}
    ${pts.map((p, i) => `<circle class="pt${i === pts.length - 1 ? ' last' : ''}" cx="${x(p.date)}" cy="${y(p.kg)}" r="${i === pts.length - 1 ? 5 : 3.5}"/>`).join('')}
    <text class="value-label" x="${Math.min(W - m.r - 2, x(lastP.date))}" y="${y(lastP.kg) - 10}" text-anchor="end">${kg(lastP.kg)}</text>
    ${xLabels}
  </svg>`;
  return h('div', { html: svg }).firstChild;
}

function weightCard() {
  const u = S.user;
  const T = u.targets;
  const ws = u.weights;
  if (!ws.length) {
    return h(
      'div',
      { class: 'card empty' },
      h('div', { class: 'big' }, '⚖️'),
      h('h3', {}, 'Pierwsze ważenie przed Tobą'),
      h('p', {}, `Start: ok. ${T.weightStart} kg. Etap 1: ${T.weightStage1} kg (−10%), cel: ${T.weightGoal} kg. Waż się raz w tygodniu — w sobotę rano, na czczo.`),
      h('button', { class: 'btn', type: 'button', onclick: () => openWeighIn() }, icon('plus', 20), 'Dodaj ważenie'),
    );
  }
  const last = ws[ws.length - 1];
  const start = T.weightStart;
  const lost = start - last.kg;
  const total = start - T.weightGoal;
  const { perWeek } = weightTrend(ws);
  const pct = Math.max(0, Math.min(100, (lost / total) * 100));
  const stagePct = ((start - T.weightStage1) / total) * 100;
  const toStage = last.kg - T.weightStage1;
  return h(
    'div',
    { class: 'card' },
    h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '12px' } }, h('div', { class: 'grow' }, h('div', { class: 'row-sub', style: { marginTop: 0 } }, `Ostatnie ważenie · ${fmtDate(last.date)}`), h('div', { class: 'big-number' }, kg(last.kg), h('small', {}, 'kg'))), h('div', { style: { textAlign: 'right' } }, h('span', { class: `tag ${lost > 0 ? 'green' : ''}` }, `${lost > 0 ? '−' : '+'}${kg(Math.abs(lost))} kg od startu`), perWeek !== null && h('div', { class: 'small muted num', style: { marginTop: '6px' } }, `trend: ${perWeek > 0 ? '+' : '−'}${kg(Math.abs(perWeek), 2)} kg/tydz.`))),
    h('div', { class: 'goal-track' }, h('div', { class: 'fill', style: { width: `${pct}%` } }), h('div', { class: 'milestone', style: { left: `${stagePct}%` } })),
    h('div', { class: 'goal-legend' }, h('span', {}, `start ${start}`), h('span', {}, toStage > 0 ? `do etapu 1 (${T.weightStage1} kg): ${kg(toStage)} kg` : `etap 1 osiągnięty 🎉`), h('span', {}, `cel ${T.weightGoal}`)),
    h('div', { style: { height: '14px' } }),
    chart(ws, T),
  );
}

function reviewBanner() {
  const ws = S.user.weights;
  if (ws.length < 4) return null;
  const pace = recentPace(ws, 3);
  if (pace === null || pace <= -0.5) return null;
  return h('div', { class: 'banner blue', style: { marginTop: '12px' } }, h('span', { class: 'emoji' }, '🔎'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Czas na przegląd'), h('span', { class: 'row-sub' }, `Średnio ${pace > 0 ? '+' : '−'}${kg(Math.abs(pace), 2)} kg/tydz. przez ostatnie 3 tygodnie. Jeśli tempo spada poniżej 0,5 kg, rozważ −100–150 kcal (Ustawienia → Cele), ale nie schodź poniżej ~1800 kcal bez lekarza.`)));
}

function planStats() {
  const u = S.user;
  const cur = weekStart(todayISO());
  const a = adherence(weekAt(cur));
  const n = streak(u.weeks, cur);
  const lastSteps = [...u.weights].reverse().find((w) => w.steps)?.steps;
  return h(
    'div',
    { class: 'stats' },
    h('div', { class: `stat${n > 0 ? ' good' : ''}` }, h('div', { class: 'stat-value' }, `${n}`, h('small', {}, n === 1 ? 'tydz.' : 'tyg.')), h('div', { class: 'stat-label' }, 'seria wg planu')),
    h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, a.planned ? `${a.eaten}` : '—', a.planned ? h('small', {}, `/ ${a.planned}`) : null), h('div', { class: 'stat-label' }, 'posiłków w tym tyg.')),
    h('div', { class: `stat${lastSteps >= u.targets.stepsGoal ? ' good' : ''}` }, h('div', { class: 'stat-value' }, lastSteps ? num(lastSteps / 1000, 1) : '—', lastSteps ? h('small', {}, 'tys.') : null), h('div', { class: 'stat-label' }, `kroków · cel ${num(u.targets.stepsGoal / 1000, 0)} tys.`)),
  );
}

function weekDots() {
  const week = weekAt(weekStart(todayISO()));
  if (!week) return null;
  const today = todayISO();
  return h(
    'div',
    { class: 'card', style: { marginTop: '12px' } },
    h('div', { class: 'row-sub', style: { margin: '0 0 10px' } }, 'Ten tydzień — posiłki wg planu'),
    h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', textAlign: 'center' } },
      week.days.map((day, d) => {
        const meals = Object.values(day.meals).filter(Boolean);
        const eaten = meals.filter((m) => m.status === 'zjedzone').length;
        const off = day.mode === 'poza domem' || !meals.length;
        const pct = off ? 0 : eaten / meals.length;
        const future = day.date > today;
        return h(
          'div',
          {},
          h('div', { style: { height: '44px', borderRadius: '10px', background: 'var(--fill)', position: 'relative', overflow: 'hidden', opacity: future ? 0.5 : 1 } }, h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct * 100}%`, background: pct >= 0.8 ? 'var(--green)' : 'var(--accent)', transition: 'height .6s var(--spring)' } })),
          h('div', { class: 'small muted', style: { marginTop: '4px', fontWeight: day.date === today ? 700 : 400, color: day.date === today ? 'var(--accent-text)' : '' } }, DAYS_SHORT[d]),
        );
      }),
    ),
  );
}

/* ——— badania ——— */

function labStatus(name, value) {
  const ref = LAB_REFS[name];
  if (!ref) return '';
  if ((ref.max != null && value > ref.max) || (ref.min != null && value < ref.min)) return 'bad';
  return 'good';
}

function openLabHistory(name) {
  openSheet({
    title: name,
    live: true,
    body: () => {
      const rows = S.user.labs.filter((l) => l.name === name).sort((a, b) => b.date.localeCompare(a.date));
      const ref = LAB_REFS[name];
      return [
        ref && h('p', { class: 'muted pad' }, `Zalecane: ${ref.ref} ${ref.unit}`),
        h(
          'div',
          { class: 'list' },
          rows.map((l) => h('div', { class: 'row' }, h('span', { class: 'grow row-title' }, fmtDate(l.date) + ` ${parseDate(l.date).getFullYear()}`), h('span', { class: `lab-value ${labStatus(name, l.value)}` }, `${num(l.value, l.value % 1 ? 1 : 0)} ${l.unit}`), iconButton('trash', 'Usuń wynik', () => commit((u) => (u.labs = u.labs.filter((x) => x !== l))), 'plain'))),
        ),
      ];
    },
  });
}

function openAddLab() {
  const names = [...new Set([...Object.keys(LAB_REFS), ...S.user.labs.map((l) => l.name)])];
  const f = { date: todayISO(), name: 'LDL', custom: '', value: '', unit: 'mg/dl' };
  const sheet = openSheet({
    title: 'Nowy wynik',
    closeLabel: 'Anuluj',
    body: () => [
      h(
        'div',
        { class: 'card' },
        field(
          'Badanie',
          h(
            'select',
            {
              class: 'input',
              onchange: (e) => {
                f.name = e.target.value;
                f.unit = LAB_REFS[f.name]?.unit || f.unit;
                sheet.refresh();
              },
            },
            names.map((n) => h('option', { value: n, selected: f.name === n }, n)),
            h('option', { value: '__custom', selected: f.name === '__custom' }, 'Inne…'),
          ),
        ),
        f.name === '__custom' && field('Nazwa badania', h('input', { class: 'input', value: f.custom, oninput: (e) => (f.custom = e.target.value) })),
        h('div', { class: 'field-grid' }, field('Wynik', h('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1', value: f.value, oninput: (e) => (f.value = e.target.value) })), field('Jednostka', h('input', { class: 'input', value: f.unit, oninput: (e) => (f.unit = e.target.value) }))),
        field('Data badania', h('input', { class: 'input', type: 'date', value: f.date, max: todayISO(), onchange: (e) => (f.date = e.target.value || f.date) }), LAB_REFS[f.name] ? `Zalecane: ${LAB_REFS[f.name].ref} ${LAB_REFS[f.name].unit}` : null),
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          style: { marginTop: '14px' },
          onclick: () => {
            const name = f.name === '__custom' ? f.custom.trim() : f.name;
            const value = Number(String(f.value).replace(',', '.'));
            if (!name || !Number.isFinite(value) || f.value === '') return toast('Podaj nazwę i wynik');
            commit((u) => u.labs.push({ date: f.date, name, value, unit: f.unit.trim() }));
            sheet.close();
            toast('Wynik dodany');
          },
        },
        'Dodaj wynik',
      ),
    ],
  });
}

function labsSection() {
  const u = S.user;
  const latest = {};
  for (const l of [...u.labs].sort((a, b) => a.date.localeCompare(b.date))) {
    latest[l.name] = { ...l, prev: latest[l.name] };
  }
  const names = Object.keys(latest);
  const dueIn = u.labFollowUp ? diffDays(todayISO(), u.labFollowUp) : null;
  return [
    h('h2', { class: 'section' }, 'Badania', h('button', { class: 'aside', type: 'button', style: { color: 'var(--accent-text)', fontWeight: 600 }, onclick: openAddLab }, '+ Dodaj wynik')),
    h(
      'div',
      { class: 'list' },
      names.map((name) => {
        const l = latest[name];
        const ref = LAB_REFS[name];
        const delta = l.prev ? l.value - l.prev.value : null;
        return h(
          'button',
          { class: 'row row-btn', type: 'button', onclick: () => openLabHistory(name) },
          h('span', { class: 'grow' }, h('span', { class: 'row-title' }, name), h('span', { class: 'row-sub' }, [ref && `zalecane ${ref.ref}`, fmtShort(l.date) + `.${parseDate(l.date).getFullYear()}`, delta !== null && `${delta > 0 ? '+' : '−'}${num(Math.abs(delta), 1)} od poprzedniego`].filter(Boolean).join(' · '))),
          h('span', { class: `lab-value ${labStatus(name, l.value)}` }, `${num(l.value, l.value % 1 ? 1 : 0)}`),
          h('span', { class: 'ic chev' }, icon('right', 18)),
        );
      }),
    ),
    h(
      'div',
      { class: 'list', style: { marginTop: '12px' } },
      h('div', { class: 'row' }, h('span', { class: 'emoji' }, '🩺'), h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Konsultacja lekarska'), h('span', { class: 'row-sub' }, 'internista / kardiolog: Lp(a), LDL, niski HDL')), switchEl(u.flags.doctorDone, (v) => commit((x) => (x.flags.doctorDone = v)), 'Konsultacja odbyta')),
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'emoji' }, '🩸'),
        h('span', { class: 'grow' }, h('span', { class: 'row-title' }, 'Kontrolny lipidogram na czczo'), h('span', { class: 'row-sub' }, dueIn === null ? 'ok. 3 miesiące od startu diety' : dueIn > 0 ? `ok. ${fmtDate(u.labFollowUp)} ${parseDate(u.labFollowUp).getFullYear()} — za ${Math.round(dueIn / 7)} tyg.` : 'termin minął — umów badanie')),
        h('input', { class: 'inline', type: 'date', style: { width: '138px' }, value: u.labFollowUp || '', 'aria-label': 'Termin badania kontrolnego', onchange: (e) => commit((x) => (x.labFollowUp = e.target.value || null)) }),
      ),
    ),
    h('p', { class: 'caption' }, 'Aplikacja nie zastępuje lekarza. Wynik konsultacji może zmienić zalecenia, np. limit tłuszczów nasyconych.'),
  ];
}

function logSection() {
  const log = [...S.user.log].sort((a, b) => b.date.localeCompare(a.date));
  const cur = weekStart(todayISO());
  const thisWeek = log.filter((e) => e.date >= cur);
  const all = log.slice(0, 12);
  return [
    h('h2', { class: 'section' }, 'Poza planem', thisWeek.length > 0 && h('span', { class: 'aside' }, `w tym tyg.: ${thisWeek.length}× · ~${thisWeek.reduce((s, e) => s + e.kcal, 0)} kcal`)),
    all.length
      ? h('div', { class: 'list' }, all.map((e) => h('div', { class: 'row' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, e.label), h('span', { class: 'row-sub' }, `${DAYS_SHORT[dow(e.date)]} ${fmtShort(e.date)}${e.slot ? ' · zamiast posiłku z planu' : ''}`)), h('span', { class: 'trail num' }, `~${e.kcal} kcal`), iconButton('trash', 'Usuń wpis', () => removeLog(e.id), 'plain'))))
      : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Nic tu nie ma — i dobrze. Gdy zjesz coś spoza planu, wpisz to jednym dotknięciem na ekranie Dziś. Bez oceniania: chodzi o to, żeby widzieć wzorzec.')),
  ];
}

export function render() {
  const ws = [...S.user.weights].reverse();
  return [
    pageHeader('Postęp', 'Trend, nie pojedynczy wynik', iconButton('plus', 'Dodaj ważenie', () => openWeighIn())),
    weightCard(),
    reviewBanner(),
    h('div', { style: { height: '12px' } }),
    planStats(),
    weekDots(),
    ws.length > 0 && [
      h('h2', { class: 'section' }, 'Pomiary'),
      h(
        'div',
        { class: 'list' },
        ws.slice(0, 8).map((w, i) => {
          const before = ws[i + 1];
          const diff = before ? w.kg - before.kg : null;
          return h(
            'div',
            { class: 'row' },
            h('button', { type: 'button', class: 'meal-main', onclick: () => openWeighIn(w.date) }, h('span', { class: 'grow' }, h('span', { class: 'row-title num' }, `${kg(w.kg)} kg`), h('span', { class: 'row-sub' }, [`${fmtDate(w.date)}`, w.waistCm && `pas ${num(w.waistCm, w.waistCm % 1 ? 1 : 0)} cm`, w.steps && `${w.steps} kroków`].filter(Boolean).join(' · '))), diff !== null && h('span', { class: `tag ${diff < 0 ? 'green' : diff > 0 ? 'red' : ''}` }, `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${kg(Math.abs(diff))}`)),
            iconButton('trash', 'Usuń pomiar', async () => (await confirmSheet('Usunąć pomiar?', `${kg(w.kg)} kg z ${fmtDate(w.date)}`, 'Usuń', { destructive: true })) && removeWeight(w.date), 'plain'),
          );
        }),
      ),
    ],
    labsSection(),
    logSection(),
    h('div', { class: 'stack mt' }, h('button', { class: 'btn secondary', type: 'button', onclick: copyDietitian }, icon('sparkle', 20), 'Skopiuj kontekst dla dietetyka (Claude)')),
    h('p', { class: 'caption center' }, 'Kopiuje cele, wagę z ostatnich tygodni i odchylenia od planu — wklej w rozmowie na claude.ai.'),
  ];
}
