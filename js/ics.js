// Przypomnienia jako plik .ics (PWA na iOS nie zaplanuje lokalnych powiadomień bez serwera push).
import { addDays, shortName } from './util.js';

export const DEFAULT_REMINDERS = {
  pack: '07:00',
  snack: '14:50',
  dinner: '17:30',
  prep: '21:00',
  kitchen: '22:00',
  sleep: '23:00',
  weigh: '09:30',
  cookA: '15:00',
  cookB: '16:30',
};

export const REMINDER_LABELS = {
  pack: 'Spakuj jedzenie (dni robocze)',
  snack: 'Przekąska',
  dinner: 'Kolacja',
  prep: 'Przygotuj na jutro',
  kitchen: 'Kuchnia zamknięta',
  sleep: 'Pora spać',
  weigh: 'Ważenie + planowanie (sobota)',
  cookA: 'Gotowanie lunchu A (niedziela)',
  cookB: 'Zakupy + lunch B (środa)',
};

// treść przypomnień wynika z planu
export function weekEvents(week, recipeMap, times = DEFAULT_REMINDERS, off = {}) {
  const ev = [];
  const name = (m) => shortName(recipeMap[m?.recipeId]);
  const push = (kind, date, title, note = '') => {
    if (!off[kind] && times[kind]) ev.push({ kind, date, time: times[kind], title, note });
  };
  const packed = (day, d) => day && day.mode !== 'poza domem' && ((d >= 1 && d <= 5) || day.mode === 'zjazd');

  week.days.forEach((day, d) => {
    if (day.mode === 'poza domem') return;
    const m = day.meals;
    if (packed(day, d)) {
      const items = [name(m.sniadanie), name(m.lunch), name(m.przekaska)].filter(Boolean);
      if (items.length) push('pack', day.date, `Spakuj: ${items.join(' + ')}`);
    }
    if (m.przekaska) push('snack', day.date, `Przekąska: ${name(m.przekaska)} — nie pomijaj`);
    if (m.kolacja) {
      const r = recipeMap[m.kolacja.recipeId];
      const guest = day.guest ? ' (×2, z dziewczyną)' : '';
      if (r) push('dinner', day.date, `Kolacja: ${shortName(r)}, ok. ${r.timeMin} min${guest}`);
    }
    const next = week.days[d + 1];
    if (packed(next, d + 1)) {
      const items = [name(next.meals.sniadanie), name(next.meals.przekaska)].filter(Boolean);
      if (items.length) push('prep', day.date, `Przygotuj na jutro: ${items.join(', ')}`);
    }
    push('kitchen', day.date, 'Kuchnia zamknięta');
    push('sleep', day.date, `Pora spać — cel ${times.sleep}`);
    if (d === 0 && week.lunchA && recipeMap[week.lunchA]) push('cookA', day.date, `Gotujesz lunch A: ${recipeMap[week.lunchA].name}`);
    if (d === 3 && week.lunchB && recipeMap[week.lunchB]) push('cookB', day.date, `Zakupy (lista środowa) + gotujesz lunch B: ${recipeMap[week.lunchB].name}`);
    if (d === 6) push('weigh', day.date, 'Ważenie + planowanie tygodnia');
  });
  return ev;
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: linie do 75 oktetów, kontynuacja zaczyna się spacją
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;

export function buildICS(events, now = new Date()) {
  const dtstamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//pchla//plan posilkow//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:pchła'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:pchla-${e.date}-${e.kind}@pchla.app`, // stały UID: ponowny import aktualizuje, nie dubluje
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.date, e.time)}`,
      'DURATION:PT5M',
      `SUMMARY:${esc(e.title)}`,
    );
    if (e.note) lines.push(`DESCRIPTION:${esc(e.note)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const icsFileName = (week) => `pchla-${week.startSunday}_${addDays(week.startSunday, 6)}.ics`;
