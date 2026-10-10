// Przełączanie kart (osobny moduł, żeby widoki mogły nawigować bez importowania app.js).

export const TABS = [
  { id: 'today', label: 'Dziś', icon: 'today' },
  { id: 'week', label: 'Tydzień', icon: 'calendar' },
  { id: 'recipes', label: 'Przepisy', icon: 'book' },
  { id: 'shop', label: 'Zakupy', icon: 'cart' },
  { id: 'progress', label: 'Postęp', icon: 'chart' },
];

export const nav = { tab: 'today', params: {} };

const listeners = new Set();
export const onNav = (fn) => listeners.add(fn);

// params trafiają do widoku jednorazowo (np. { start, trip } dla Zakupów)
export function go(tab, params = {}) {
  nav.tab = tab;
  nav.params = params;
  for (const l of listeners) l();
}

// odświeżenie bieżącej karty bez zmiany stanu aplikacji (np. inny tydzień na ekranie)
export const refresh = () => {
  for (const l of listeners) l();
};
