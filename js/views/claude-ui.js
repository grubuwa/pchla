// Claude bez API: kopiuj prompt → wklej w claude.ai → wklej odpowiedź → walidacja i podgląd.
import { S, commit } from '../store.js';
import { todayISO, round10, fmtWeekRange } from '../util.js';
import { planPrompt, recipePrompt, validatePlan, validateRecipe, extractJSON, dietitianContext } from '../claude.js';
import { computePerServing } from '../nutrition.js';
import { enrichIngredient } from '../shopping.js';
import { h, icon, openSheet, field, copyText, toast } from '../ui.js';
import { fmtGrams } from './recipes.js';

const CLAUDE_URL = 'https://claude.ai/new';

const stepHead = (n, text) => h('div', { class: 'group-label', style: { marginLeft: '4px' } }, `${n}. ${text}`);
const errorList = (errors) => h('ul', { class: 'errors' }, errors.slice(0, 12).map((e) => h('li', {}, e)), errors.length > 12 && h('li', {}, `…i jeszcze ${errors.length - 12}`));
const openClaude = () => h('a', { class: 'btn secondary', href: CLAUDE_URL, target: '_blank', rel: 'noopener' }, 'Otwórz claude.ai');

/** Plan tygodnia: onPlan(template) dostaje zweryfikowany plan w formacie „sprawdzonego tygodnia”. */
export function openClaudePlan(start, calendar, onPlan) {
  let answer = '';
  let errors = [];
  const prompt = () => planPrompt({ recipes: S.catalog.recipes, targets: S.user.targets, rules: S.user.rules, startSunday: start, calendar, weeks: S.user.weeks });
  const sheet = openSheet({
    title: 'Plan z Claude',
    full: true,
    closeLabel: 'Anuluj',
    body: () => [
      h('p', { class: 'muted pad' }, `Claude ułoży tydzień ${fmtWeekRange(start)} z Twoich przepisów. Bez API — przez kopiuj i wklej w aplikacji Claude (plan Pro).`),
      stepHead(1, 'Skopiuj prompt'),
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(prompt(), 'Prompt skopiowany — wklej go w claude.ai') }, icon('copy', 20), 'Kopiuj prompt'),
      h('p', { class: 'caption' }, 'Zawiera cele, reguły, wyjątki tygodnia, ostatnie lunche i listę przepisów z ID.'),
      stepHead(2, 'Wklej go w rozmowie z Claude'),
      openClaude(),
      stepHead(3, 'Wklej tutaj odpowiedź'),
      h('textarea', { class: 'input mono', placeholder: '```json\n{ "lunchA": "…", "lunchB": "…", "days": [ … ] }\n```', oninput: (e) => (answer = e.target.value) }, answer),
      errors.length > 0 && errorList(errors),
    ],
    footer: () =>
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            const parsed = extractJSON(answer);
            if (parsed.error) errors = [parsed.error];
            else {
              const res = validatePlan(parsed.value, S.recipeMap, calendar);
              errors = res.errors;
              if (res.ok) {
                sheet.close();
                onPlan({ ...res.template, name: 'Plan z Claude' });
                toast('Plan wczytany — sprawdź i zatwierdź');
                return;
              }
            }
            sheet.refresh();
            sheet.el.querySelector('.errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          },
        },
        'Sprawdź i pokaż podgląd',
      ),
  });
}

/** Import przepisu z linku lub tekstu. */
export function openRecipeImport() {
  let source = '';
  let answer = '';
  let errors = [];
  let preview = null; // { recipe, newIngredients }

  const save = () => {
    const { recipe, newIngredients } = preview;
    commit(
      (u, c) => {
        for (const ing of newIngredients) if (!c.ingredients.some((i) => i.id === ing.id)) c.ingredients.push(enrichIngredient(ing));
        let id = recipe.id;
        for (let n = 2; c.recipes.some((r) => r.id === id); n++) id = `${recipe.id}_${n}`;
        c.recipes.push({ ...recipe, id });
      },
      { catalog: true },
    );
    sheet.close();
    toast('Przepis dodany do bazy');
  };

  const previewNodes = () => {
    const { recipe, newIngredients } = preview;
    const ingMap = { ...S.ingMap };
    for (const n of newIngredients) ingMap[n.id] = n;
    const per = computePerServing(recipe, ingMap);
    return [
      h('div', { class: 'recipe-hero' }, h('div', { class: 'big' }, '✨'), h('h2', {}, recipe.name), h('div', { class: 'tags' }, h('span', { class: 'tag accent' }, recipe.type), h('span', { class: 'tag' }, `${recipe.servings} porcji`), h('span', { class: 'tag' }, `${recipe.timeMin} min`), recipe.tags.map((t) => h('span', { class: 'tag' }, t)))),
      h('div', { class: 'stats' }, h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `~${round10(per.kcal)}`), h('div', { class: 'stat-label' }, 'kcal / porcję')), h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${Math.round(per.protein)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'białka')), h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, `${Math.round(per.satFat)}`, h('small', {}, 'g')), h('div', { class: 'stat-label' }, 'tł. nasyc.'))),
      h('div', { class: 'group-label' }, 'Składniki'),
      h(
        'div',
        { class: 'list' },
        recipe.ingredients.map((it) => {
          const isNew = newIngredients.some((n) => n.id === it.id);
          return h('div', { class: 'row ing' }, h('span', { class: 'grow' }, h('span', { class: 'row-title' }, ingMap[it.id].name), isNew && h('span', { class: 'row-sub' }, `nowy składnik · ${Math.round(ingMap[it.id].kcal)} kcal / 100 g`)), h('span', { class: 'amount' }, h('b', {}, fmtGrams(it.g))));
        }),
      ),
      h('div', { class: 'group-label' }, `Kroki · ${recipe.steps.length}`),
      h('div', { class: 'list' }, recipe.steps.map((s, i) => h('div', { class: 'step' }, h('span', { class: 'step-n' }, i + 1), h('span', { class: 'grow' }, s)))),
      h('p', { class: 'caption' }, 'Po dodaniu możesz wszystko poprawić w edytorze przepisu. Wartości i ceny nowych składników — w Ustawieniach.'),
    ];
  };

  const sheet = openSheet({
    title: 'Import przepisu',
    full: true,
    closeLabel: 'Anuluj',
    body: () =>
      preview
        ? previewNodes()
        : [
            h('p', { class: 'muted pad' }, 'Claude przerobi dowolny przepis na format aplikacji: składniki z Twojego katalogu w gramach, kroki, tagi. Lżejsza wersja pod Twoje cele.'),
            stepHead(1, 'Wklej link albo tekst przepisu'),
            h('textarea', { class: 'input', placeholder: 'https://… albo skopiowana treść przepisu', oninput: (e) => (source = e.target.value) }, source),
            stepHead(2, 'Skopiuj prompt i wklej w claude.ai'),
            h(
              'div',
              { class: 'btn-row' },
              h('button', { class: 'btn', type: 'button', onclick: () => copyText(recipePrompt({ ingredients: S.catalog.ingredients, sections: S.user.sections, source }), 'Prompt skopiowany') }, icon('copy', 20), 'Kopiuj prompt'),
              openClaude(),
            ),
            stepHead(3, 'Wklej tutaj odpowiedź'),
            h('textarea', { class: 'input mono', placeholder: '```json\n{ "recipe": { … }, "newIngredients": [ … ] }\n```', oninput: (e) => (answer = e.target.value) }, answer),
            errors.length > 0 && errorList(errors),
          ],
    footer: () =>
      preview
        ? h('div', { class: 'btn-row' }, h('button', { class: 'btn gray', type: 'button', style: { flex: '0 0 110px' }, onclick: () => ((preview = null), sheet.refresh()) }, 'Wstecz'), h('button', { class: 'btn', type: 'button', onclick: save }, 'Dodaj do bazy'))
        : h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => {
                const parsed = extractJSON(answer);
                if (parsed.error) errors = [parsed.error];
                else {
                  const res = validateRecipe(parsed.value, S.ingMap, S.user.sections);
                  errors = res.errors;
                  if (res.ok) preview = res;
                }
                sheet.refresh();
                if (preview) sheet.el.querySelector('.sheet-body').scrollTop = 0;
                else sheet.el.querySelector('.errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              },
            },
            'Sprawdź i pokaż podgląd',
          ),
  });
}

export function copyDietitian() {
  const u = S.user;
  copyText(dietitianContext({ targets: u.targets, weights: u.weights, weeks: u.weeks, log: u.log, labs: u.labs, recipeMap: S.recipeMap, today: todayISO() }), 'Kontekst skopiowany — wklej w claude.ai');
}
