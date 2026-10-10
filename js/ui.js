// Klocki interfejsu: tworzenie DOM, ikony, arkusze od dołu, toasty, schowek, pliki.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val);
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

// podmienia zawartość; przyjmuje zagnieżdżone tablice i pomija null / false
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/* ——— ikony (kreska 2 px, 24 × 24) ——— */

const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 8h6M9 12h4"/>',
  cart: '<path d="M3 4h2.2l2.2 11h10.2L20 7H6.4"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  chart: '<path d="M3 20h18"/><path d="M5 15l4-4 4 3 6-8"/><path d="M15 6h4v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.6A7.6 7.6 0 0 0 6.9 6.6l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.5 2.6h4l.5-2.6a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  guest: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17.5 14a4.5 4.5 0 0 1 4 4.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="15" cy="15" r=".9" fill="currentColor"/><circle cx="15" cy="9" r=".9" fill="currentColor"/><circle cx="9" cy="15" r=".9" fill="currentColor"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8" fill="currentColor"/><circle cx="4" cy="12" r=".8" fill="currentColor"/><circle cx="4" cy="18" r=".8" fill="currentColor"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  upload: '<path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 19h14"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1.5 2 2 2 0-3 0-5 1-8z"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
  away: '<path d="M3 17l5-9 4 6 3-4 6 7z"/>',
  school: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

/* ——— arkusze ——— */

const stack = [];
export const sheetsOpen = () => stack.length > 0;
export const refreshSheets = () => stack.forEach((s) => s.live && s.refresh());

/**
 * Arkusz wysuwany od dołu (na szerokim ekranie — wyśrodkowane okno).
 * opts: { title, body(api) → Node|Node[], footer(api), full, live, onClose, closeLabel }
 * live — odświeżaj treść po każdej zmianie stanu aplikacji.
 */
export function openSheet(opts) {
  const backdrop = h('div', { class: 'backdrop' });
  const titleEl = h('div', { class: 'sheet-title' }, opts.title || '');
  const content = h('div', { class: 'sheet-body' });
  const footer = h('div', { class: 'sheet-footer' });
  const head = h(
    'div',
    { class: 'sheet-head' },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-bar' }, h('span', { class: 'sheet-side' }), titleEl, h('button', { class: 'sheet-close', type: 'button', onclick: () => api.close() }, opts.closeLabel || 'Gotowe')),
  );
  const panel = h('div', { class: `sheet${opts.full ? ' full' : ''}${opts.className ? ` ${opts.className}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '' }, head, content, footer);

  let closed = false;
  const api = {
    el: panel,
    live: !!opts.live,
    setTitle: (t) => (titleEl.textContent = t),
    refresh() {
      if (closed) return;
      const top = content.scrollTop;
      fill(content, opts.body(api));
      const f = opts.footer?.(api);
      fill(footer, f);
      footer.hidden = !f;
      content.scrollTop = top;
    },
    close(result) {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      panel.classList.remove('open');
      backdrop.classList.remove('open');
      setTimeout(() => {
        panel.remove();
        backdrop.remove();
      }, 380);
      if (!stack.length) document.documentElement.classList.remove('has-sheet');
      opts.onClose?.(result);
    },
  };

  backdrop.addEventListener('click', () => api.close());
  dragToDismiss(head, panel, api);
  document.body.append(backdrop, panel);
  stack.push(api);
  document.documentElement.classList.add('has-sheet');
  api.refresh();
  // wymuś przeliczenie stylu, żeby przejście ruszyło od stanu początkowego
  void panel.offsetHeight;
  panel.classList.add('open');
  backdrop.classList.add('open');
  return api;
}

function dragToDismiss(handle, panel, api) {
  let startY = null;
  let dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    startY = e.clientY;
    dy = 0;
    handle.setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translate3d(var(--sheet-x, 0), ${dy}px, 0)`;
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 110) api.close();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close();
});

// lista akcji (jak UIActionSheet)
export function actionSheet(title, actions, { message } = {}) {
  const s = openSheet({
    title,
    className: 'actions',
    closeLabel: 'Anuluj',
    body: () => [
      message && h('p', { class: 'muted pad' }, message),
      h(
        'div',
        { class: 'list' },
        actions.filter(Boolean).map((a) =>
          h(
            'button',
            {
              class: `row row-btn${a.destructive ? ' danger' : ''}${a.current ? ' current' : ''}`,
              type: 'button',
              onclick: () => {
                s.close();
                a.onSelect?.();
              },
            },
            a.icon && icon(a.icon),
            a.emoji && h('span', { class: 'emoji' }, a.emoji),
            h('span', { class: 'grow' }, h('span', { class: 'row-title' }, a.label), a.detail && h('span', { class: 'row-sub' }, a.detail)),
            a.current && icon('check', 20),
          ),
        ),
      ),
    ],
  });
  return s;
}

export function confirmSheet(title, message, okLabel = 'OK', { destructive = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const s = openSheet({
      title,
      className: 'actions',
      closeLabel: 'Anuluj',
      onClose: () => resolve(ok),
      body: () => [
        h('p', { class: 'pad' }, message),
        h(
          'button',
          {
            class: `btn${destructive ? ' danger' : ''}`,
            type: 'button',
            onclick: () => {
              ok = true;
              s.close();
            },
          },
          okLabel,
        ),
      ],
    });
  });
}

/* ——— drobne kontrolki ——— */

let toastTimer = null;
export function toast(msg, { action, onAction } = {}) {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  fill(
    box,
    h('span', {}, msg),
    action &&
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            box.classList.remove('show');
            onAction?.();
          },
        },
        action,
      ),
  );
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), action ? 5000 : 2600);
}

export function segmented(options, value, onChange, { small = false } = {}) {
  return h(
    'div',
    { class: `seg${small ? ' small' : ''}`, role: 'tablist' },
    options.map((o) =>
      h(
        'button',
        { type: 'button', role: 'tab', class: o.value === value ? 'on' : '', 'aria-selected': o.value === value ? 'true' : 'false', title: o.title, onclick: () => o.value !== value && onChange(o.value) },
        o.icon && icon(o.icon, 18),
        o.label,
      ),
    ),
  );
}

export function chip(label, on, onToggle) {
  return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: onToggle }, label);
}

export function stepper(value, onChange, { min = 1, max = 99, step = 1, format = (v) => v } = {}) {
  return h(
    'div',
    { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Mniej', disabled: value <= min, onclick: () => onChange(Math.max(min, value - step)) }, icon('minus', 18)),
    h('span', { class: 'stepper-value' }, format(value)),
    h('button', { type: 'button', 'aria-label': 'Więcej', disabled: value >= max, onclick: () => onChange(Math.min(max, value + step)) }, icon('plus', 18)),
  );
}

export function switchEl(on, onChange, label) {
  return h('button', { type: 'button', class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, onclick: () => onChange(!on) }, h('span', {}));
}

export function progressBar(value, max, { cls = '', mark } = {}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return h(
    'div',
    { class: `bar ${cls}` },
    h('div', { class: 'bar-fill', style: { width: `${pct}%` } }),
    mark != null && max > 0 && h('div', { class: 'bar-mark', style: { left: `${Math.min(100, (mark / max) * 100)}%` } }),
  );
}

// pole formularza z etykietą
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'field-hint' }, hint));
}

export async function copyText(text, okMsg = 'Skopiowano') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(okMsg);
}

// na iOS (PWA) najpewniej działa arkusz udostępniania; gdzie indziej zwykłe pobranie
export async function saveFile(name, text, mime) {
  const file = new File([text], name, { type: mime });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? await f.text() : null);
    });
    document.body.append(input);
    input.click();
  });
}

// nagłówek strony w stylu iOS: duży tytuł + akcje po prawej
export function pageHeader(title, subtitle, ...actions) {
  return h('header', { class: 'page-head' }, h('div', { class: 'grow' }, subtitle && h('div', { class: 'eyebrow' }, subtitle), h('h1', {}, title)), h('div', { class: 'head-actions' }, actions));
}

export function iconButton(name, label, onclick, cls = '') {
  return h('button', { type: 'button', class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick }, icon(name));
}
