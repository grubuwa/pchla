// Stan aplikacji w pamięci + zapis w IndexedDB (dane są tylko na urządzeniu).
import { initialState } from './seed.js';
import { byId, todayISO } from './util.js';
import { recomputeAll } from './nutrition.js';
import { enrichIngredient } from './shopping.js';

const DB_NAME = 'pchla';
const STORE = 'kv';

// S.user — plany, listy, pomiary, ustawienia; S.catalog — składniki i przepisy
export const S = { user: null, catalog: null, recipeMap: {}, ingMap: {} };

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// tryb prywatny / brak IndexedDB → localStorage
async function read(key) {
  try {
    return await idb('readonly', (s) => s.get(key));
  } catch {
    try {
      return JSON.parse(localStorage.getItem(`pchla:${key}`));
    } catch {
      return null;
    }
  }
}

async function write(key, value) {
  try {
    await idb('readwrite', (s) => s.put(value, key));
  } catch {
    try {
      localStorage.setItem(`pchla:${key}`, JSON.stringify(value));
    } catch {
      /* brak miejsca — dane zostają w pamięci do zamknięcia */
    }
  }
}

function reindex() {
  S.recipeMap = byId(S.catalog.recipes);
  S.ingMap = byId(S.catalog.ingredients);
}

async function seed() {
  const res = await fetch('data/przepisy.json');
  if (!res.ok) throw new Error('Nie udało się wczytać danych startowych (data/przepisy.json).');
  return initialState(await res.json(), todayISO());
}

export async function load() {
  let [user, catalog] = await Promise.all([read('user'), read('catalog')]);
  if (!user || !catalog) {
    ({ user, catalog } = await seed());
    await Promise.all([write('user', user), write('catalog', catalog)]);
  }
  S.user = user;
  S.catalog = catalog;
  reindex();
  navigator.storage?.persist?.().catch(() => {});
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const dirty = new Set();
let timer = null;

export function flush() {
  clearTimeout(timer);
  timer = null;
  const keys = [...dirty];
  dirty.clear();
  return Promise.all(keys.map((k) => write(k, S[k])));
}

/**
 * Jedyna droga zmiany stanu: mutuje, zapisuje (z opóźnieniem) i odświeża widoki.
 * opts.catalog — zmieniono składniki/przepisy (przelicz perServing i indeksy)
 * opts.silent  — bez odświeżania widoków
 */
export function commit(fn, { catalog = false, silent = false } = {}) {
  fn?.(S.user, S.catalog);
  dirty.add('user');
  if (catalog) {
    S.catalog.ingredients.forEach(enrichIngredient);
    reindex();
    recomputeAll(S.catalog.recipes, S.ingMap);
    dirty.add('catalog');
  }
  if (!timer) timer = setTimeout(flush, 200);
  if (!silent) for (const l of listeners) l();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
}

export function exportBackup() {
  return JSON.stringify({ app: 'pchla', v: 1, exportedAt: new Date().toISOString(), user: S.user, catalog: S.catalog }, null, 1);
}

export async function importBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('To nie jest poprawny plik JSON.');
  }
  if (data?.app !== 'pchla' || !data.user?.weeks || !Array.isArray(data.catalog?.recipes) || !Array.isArray(data.catalog?.ingredients)) {
    throw new Error('Ten plik nie wygląda na kopię zapasową aplikacji pchła.');
  }
  S.user = data.user;
  S.catalog = data.catalog;
  reindex();
  dirty.add('user');
  dirty.add('catalog');
  await flush();
  for (const l of listeners) l();
}

export async function resetAll() {
  const fresh = await seed();
  S.user = fresh.user;
  S.catalog = fresh.catalog;
  reindex();
  dirty.add('user');
  dirty.add('catalog');
  await flush();
  for (const l of listeners) l();
}
