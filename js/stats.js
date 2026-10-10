// Statystyki postępu: trzymanie się planu, seria tygodni, trend wagi. Bez DOM.
import { SLOTS, diffDays, addDays } from './util.js';

export function adherence(week) {
  const a = { planned: 0, eaten: 0, swapped: 0, skipped: 0 };
  if (!week) return a;
  for (const day of week.days) {
    if (day.mode === 'poza domem') continue;
    for (const s of SLOTS) {
      const m = day.meals[s];
      if (!m) continue;
      a.planned++;
      if (m.status === 'zjedzone') a.eaten++;
      else if (m.status === 'zamienione') a.swapped++;
      else if (m.status === 'pominięte') a.skipped++;
    }
  }
  return a;
}

// tydzień „wg planu”: co najmniej 80% posiłków zjedzonych zgodnie z planem
export const weekOnPlan = (week) => {
  const a = adherence(week);
  return a.planned > 0 && a.eaten / a.planned >= 0.8;
};

// seria zakończonych tygodni wg planu (bieżący tydzień nie przerywa serii)
export function streak(weeks, currentStart) {
  let n = 0;
  let start = addDays(currentStart, -7);
  while (weeks[start] && weekOnPlan(weeks[start])) {
    n++;
    start = addDays(start, -7);
  }
  if (weeks[currentStart] && weekOnPlan(weeks[currentStart])) n++;
  return n;
}

// regresja liniowa: tempo w kg/tydzień i wartości trendu dla każdego pomiaru
export function weightTrend(weights) {
  const pts = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return { pts, perWeek: null, line: pts.map((p) => p.kg) };
  const x = pts.map((p) => diffDays(pts[0].date, p.date));
  const y = pts.map((p) => p.kg);
  const n = pts.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { pts, perWeek: slope * 7, line: x.map((v) => my + slope * (v - mx)) };
}

// średnie tempo z ostatnich `weeksBack` tygodni (przegląd co 3–4 tyg.)
export function recentPace(weights, weeksBack = 3) {
  const pts = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const from = pts.filter((p) => diffDays(p.date, last.date) >= weeksBack * 7 - 3).pop();
  if (!from || from === last) return null;
  const days = diffDays(from.date, last.date);
  return days ? ((last.kg - from.kg) / days) * 7 : null;
}
