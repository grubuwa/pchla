// Wspólne stałe i drobne pomocniki (bez DOM — używane także w testach).

export const SLOTS = ['sniadanie', 'lunch', 'przekaska', 'kolacja', 'wieczor'];

export const SLOT_LABEL = {
  sniadanie: 'Śniadanie',
  lunch: 'Lunch',
  przekaska: 'Przekąska',
  kolacja: 'Kolacja',
  wieczor: 'Wieczorem',
};

// typ przepisu pasujący do slotu
export const SLOT_TYPE = {
  sniadanie: 'śniadanie',
  lunch: 'lunch',
  przekaska: 'przekąska',
  kolacja: 'kolacja',
  wieczor: 'przekąska wieczorna',
};

export const TYPES = ['śniadanie', 'lunch', 'przekąska', 'kolacja', 'przekąska wieczorna'];

export const DAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
export const DAYS_SHORT = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export const pad = (n) => String(n).padStart(2, '0');

export function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// południe czasu lokalnego — zmiana czasu nie przesuwa daty
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export const dow = (s) => parseDate(s).getDay();
export const weekStart = (s) => addDays(s, -dow(s)); // tydzień planu = niedziela → sobota
export const todayISO = () => iso(new Date());
export const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);

export function fmtDate(s) {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function fmtDateLong(s) {
  return `${DAYS[dow(s)]}, ${fmtDate(s)}`;
}

export function fmtShort(s) {
  const d = parseDate(s);
  return `${d.getDate()}.${pad(d.getMonth() + 1)}`;
}

export function fmtWeekRange(start) {
  const a = parseDate(start);
  const b = parseDate(addDays(start, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]}`;
}

export const timeToMin = (t) => {
  const [hh, mm] = String(t).split(':').map(Number);
  return hh * 60 + (mm || 0);
};

export const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// liczby po polsku
export function num(x, digits = 0) {
  const v = Number(x) || 0;
  return v.toFixed(digits).replace('.', ',');
}

export const zl = (x, digits = 2) => `${num(x, digits)} zł`;
export const round10 = (x) => Math.round((Number(x) || 0) / 10) * 10;
export const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// deterministyczny generator losowy (testy generatora planu)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function slugify(s) {
  const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  return String(s)
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export const norm = (s) => slugify(s).replace(/_/g, ' ');

// „Kurczak teriyaki z ryżem, brokułem i marchewką” → „Kurczak teriyaki”
export function shortName(recipe) {
  if (!recipe) return '';
  if (recipe.short) return recipe.short;
  const name = recipe.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const parts = name.split(/(\s(?:z|ze|w|na)\s|[:,]|\s\+\s)/);
  let head = parts[0].trim();
  if (head.split(' ').length < 2 && parts.length > 2 && /^\s(?:z|ze|w|na)\s$/.test(parts[1])) {
    const tail = parts[2].split(/,|\si\s/)[0].trim();
    head = `${head}${parts[1]}${tail}`;
  }
  return head;
}
