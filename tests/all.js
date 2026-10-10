// Testy logiki: wartości odżywcze, lista zakupów, generator planu, .ics, import z Claude.
import { suite, assert, eq, near } from './harness.js';
import { SLOTS, byId, clone } from '../js/util.js';
import { computePerServing, dayPlanned } from '../js/nutrition.js';
import { buildShopping, mergeShopping, purchase, storeCost, tripCost, shoppingLines, shortcutURL, isSecondHalf } from '../js/shopping.js';
import { generatePlan, checkRules, candidates, suggestLunches, pickLunches, weekFromTemplate, templateFromWeek, guestOk, isSandwich, emptyWeek, applyLunches } from '../js/planner.js';
import { weekEvents, buildICS, DEFAULT_REMINDERS } from '../js/ics.js';
import { extractJSON, validatePlan, validateRecipe, planPrompt, recipePrompt } from '../js/claude.js';
import { prepareCatalog, initialState, planningWeek } from '../js/seed.js';
import { adherence, streak, weightTrend } from '../js/stats.js';

const START = '2026-10-11'; // niedziela

export function runAll(data) {
  const t = suite();
  const { ingredients, recipes } = prepareCatalog(data);
  const ingMap = byId(ingredients);
  const recipeMap = byId(recipes);
  const targets = initialState(data, '2026-10-10').user.targets;
  const normal = () => Array.from({ length: 7 }, () => ({ mode: 'normal', guest: false }));
  const sample = () => weekFromTemplate(data.sampleWeek, START);
  const list = (week, opts = {}) => buildShopping(week, recipeMap, ingMap, { sections: data.shopSections, ...opts });
  const item = (l, id) => l.items.find((i) => i.id === id);
  const plan = (over = {}) =>
    generatePlan({ recipes, recipeMap, ingMap, targets, startSunday: START, calendar: normal(), lunchA: 'lu_teriyaki', lunchB: 'lu_chilli', seed: 1, ...over });

  t.describe('Wartości odżywcze', () => {
    t.test('perServing liczone ze składników zgadza się z przepisy.json', () => {
      for (const r of recipes) {
        const p = computePerServing(r, ingMap);
        near(p.kcal, r.perServing.kcal, 1.5, `${r.id} kcal`);
        near(p.protein, r.perServing.protein, 0.11, `${r.id} białko`);
        near(p.cost, r.perServing.cost, 0.11, `${r.id} koszt`);
      }
    });
    t.test('sumy dzienne przykładowego tygodnia jak w założeniach', () => {
      const week = sample();
      data.sampleWeek.days.forEach((d, i) => {
        const tot = dayPlanned(week.days[i], recipeMap);
        near(tot.kcal, d.totals.kcal, 2, `${d.day} kcal`);
        near(tot.protein, d.totals.protein, 1, `${d.day} białko`);
      });
    });
    t.test('skalowanie porcji nie zmienia wartości na porcję', () => {
      const r = clone(recipeMap.lu_teriyaki);
      const before = computePerServing(r, ingMap);
      r.servings = 8;
      r.ingredients.forEach((i) => (i.g *= 2));
      eq(computePerServing(r, ingMap), before);
    });
  });

  t.describe('Lista zakupów', () => {
    t.test('sumuje składnik z wielu przepisów (pierś: teriyaki 700 g + wrap 150 g)', () => {
      const it = item(list(sample()), 'sobota:piers_kurczaka');
      eq(it.need, 850);
      eq(it.qty, '2 × tacka ok. 500 g');
      near(it.costEst, 28, 0.001);
    });
    t.test('zgadza się z listą z założeń (poza świeżymi dzielonymi na dwie wizyty)', () => {
      const l = list(sample());
      const split = ['rzodkiewka', 'salata', 'szczypiorek', 'mozzarella_light'];
      for (const trip of ['sobota', 'środa']) {
        for (const s of data.sampleWeek.shopping[trip]) {
          if (split.includes(s.id)) continue;
          const it = item(l, `${trip}:${s.id}`);
          assert(it, `brak ${s.id} w liście na ${trip}`);
          eq(it.need, s.need, `${s.id} potrzeba`);
          near(it.costEst, s.cost, 0.011, `${s.id} koszt`);
        }
      }
    });
    t.test('zaokrągla w górę do pełnych opakowań', () => {
      eq(purchase(ingMap.piers_kurczaka, 500).count, 1);
      eq(purchase(ingMap.piers_kurczaka, 501).count, 2);
      eq(purchase(ingMap.fasola_czerwona, 600).count, 3); // puszka = 240 g po odsączeniu
      eq(purchase(ingMap.jajko, 300).qty, '1 × opak. 10 szt.');
    });
    t.test('warzywa i owoce na sztuki', () => {
      eq(purchase(ingMap.papryka, 710).qty, '4 szt.');
      eq(purchase(ingMap.marchew, 260).qty, '4 szt.');
      near(item(list(sample()), 'sobota:marchew').costEst, 1.28, 0.001);
    });
    t.test('spiżarnia: pomija w liście, pokazuje w „sprawdź”', () => {
      const l = list(sample());
      eq(l.pantry.map((p) => p.text), data.sampleWeek.shopping['spiżarniaDoSprawdzenia']);
      assert(!l.items.some((i) => ingMap[i.ingredientId].pantry), 'składnik ze spiżarni trafił na listę');
    });
    t.test('„czasem w domu” — pozycja z pytaniem „masz?”', () => {
      const l = list(sample());
      assert(item(l, 'sobota:olej_rzepakowy').ask, 'olej powinien mieć pytanie');
      assert(!item(l, 'sobota:piers_kurczaka').ask, 'kurczak nie powinien mieć pytania');
    });
    t.test('podział: mięso i ryba na lunch B i koniec tygodnia w środę', () => {
      const l = list(sample());
      for (const id of ['wolowina_mielona', 'losos_wedzony', 'szynka_drobiowa', 'pieczarki']) {
        assert(item(l, `środa:${id}`), `${id} powinno być w środę`);
        assert(!item(l, `sobota:${id}`), `${id} nie powinno być w sobotę`);
      }
    });
    t.test('podział: trwałe produkty zawsze w sobotę, nawet do środowego gotowania', () => {
      const l = list(sample());
      for (const it of l.items) if (!ingMap[it.ingredientId].perishable) eq(it.trip, 'sobota', it.text);
      assert(item(l, 'sobota:fasola_czerwona'), 'fasola do chilli w sobotę');
    });
    t.test('podział: świeże mięso dzielone na połowy tygodnia', () => {
      const week = sample();
      week.days[5].meals.kolacja = { recipeId: 'ko_wrap_kurczak', portions: 1 }; // piątek
      const l = list(week);
      eq(item(l, 'sobota:piers_kurczaka').need, 850);
      eq(item(l, 'środa:piers_kurczaka').need, 150);
    });
    t.test('granica połowy tygodnia to środowa kolacja', () => {
      eq([isSecondHalf(3, 'lunch'), isSecondHalf(3, 'kolacja'), isSecondHalf(4, 'sniadanie'), isSecondHalf(0, 'wieczor')], [false, true, true, false]);
    });
    t.test('dzień „poza domem” wypada z listy', () => {
      const week = sample();
      const need = (l) => l.items.filter((i) => i.ingredientId === 'skyr_pitny').reduce((s, i) => s + i.need, 0);
      const base = need(list(week)); // pn, czw, sob
      week.days[1].mode = 'poza domem';
      eq(need(list(week)), base - 350);
      assert(item(list(week), 'środa:skyr_pitny'), 'zostały tylko czw i sob → zakup w środę');
    });
    t.test('gość: porcje ×2 podwajają składniki kolacji', () => {
      const week = sample();
      const base = item(list(week), 'środa:losos_wedzony').need;
      week.days[6].meals.kolacja.portions = 2;
      eq(item(list(week), 'środa:losos_wedzony').need, base * 2);
    });
    t.test('działy w kolejności sklepu', () => {
      const l = list(sample());
      const idx = l.items.filter((i) => i.trip === 'sobota').map((i) => data.shopSections.indexOf(i.section));
      eq(idx, [...idx].sort((a, b) => a - b));
    });
    t.test('koszt: w sklepie (opakowania) ≥ zużycie', () => {
      const l = list(sample());
      near(storeCost(l), tripCost(l, 'sobota') + tripCost(l, 'środa'), 0.011);
      assert(storeCost(l) > l.costUse, 'koszt w sklepie powinien być wyższy od zużycia');
      near(l.costUse, 217, 12, 'zużycie tygodnia');
    });
    t.test('ponowne generowanie zachowuje odhaczenia i własne pozycje', () => {
      const a = list(sample());
      item(a, 'sobota:piers_kurczaka').checked = true;
      item(a, 'sobota:olej_rzepakowy').have = true;
      a.items.push({ id: 'manual:1', text: 'Papier do pieczenia', qty: '', section: 'Inne', trip: 'sobota', checked: false, manual: true });
      const b = mergeShopping(a, list(sample()));
      assert(item(b, 'sobota:piers_kurczaka').checked, 'odhaczenie zniknęło');
      assert(item(b, 'sobota:olej_rzepakowy').have, '„mam w domu” zniknęło');
      assert(item(b, 'manual:1'), 'własna pozycja zniknęła');
    });
    t.test('zmiana ilości kasuje odhaczenie pozycji', () => {
      const a = list(sample());
      item(a, 'sobota:piers_kurczaka').checked = true;
      const week = sample();
      week.days[2].meals.kolacja = { recipeId: 'ko_salatka_kurczak', portions: 2 };
      const b = mergeShopping(a, list(week));
      assert(!item(b, 'sobota:piers_kurczaka').checked, 'ilość się zmieniła — pozycja powinna wrócić');
    });
    t.test('podpowiedź z poprzedniego tygodnia: „powinno zostać”', () => {
      const prev = list(sample());
      const l = list(sample(), { prev });
      const oats = item(l, 'sobota:platki_owsiane'); // 500 g kupione, 80 g zużyte
      assert(oats.ask && /powinno zostać/.test(oats.hint), 'brak podpowiedzi dla płatków');
      assert(!item(l, 'sobota:piers_kurczaka').hint, 'nietrwałe nie przechodzą na kolejny tydzień');
    });
    t.test('eksport: linie tekstu i link do Skrótu iOS', () => {
      const l = list(sample());
      const lines = shoppingLines(l, 'środa');
      eq(lines.length, l.items.filter((i) => i.trip === 'środa').length);
      assert(lines.some((x) => x.startsWith('Łosoś wędzony')), 'brak łososia');
      const url = shortcutURL(lines);
      assert(url.startsWith('shortcuts://run-shortcut?name=Zakupy%20z%20planu&input=text&text='), url.slice(0, 80));
      assert(!url.includes('\n') && url.includes('%0A'), 'linie muszą być zakodowane');
    });
  });

  t.describe('Generator planu', () => {
    t.test('pełny plan: 7 dni × 5 posiłków, typy pasują do slotów', () => {
      const week = plan();
      week.days.forEach((day, d) => {
        for (const s of SLOTS) {
          const r = recipeMap[day.meals[s]?.recipeId];
          assert(r, `${day.date} ${s}: pusto`);
          if (s === 'lunch') eq(r.type, 'lunch');
          else if (s === 'kolacja' && d === 3) eq(r.id, 'lu_chilli');
          else if (s === 'kolacja') eq(r.type, 'kolacja');
        }
      });
    });
    t.test('lunch A nd–śr, lunch B śr kolacja + czw–sob', () => {
      const week = plan();
      eq(week.days.map((d) => d.meals.lunch.recipeId), ['lu_teriyaki', 'lu_teriyaki', 'lu_teriyaki', 'lu_teriyaki', 'lu_chilli', 'lu_chilli', 'lu_chilli']);
      eq(week.days[3].meals.kolacja.recipeId, 'lu_chilli');
    });
    t.test('dni robocze: śniadania i przekąski „do pracy”', () => {
      for (const seed of [1, 2, 3, 4]) {
        const week = plan({ seed });
        for (let d = 1; d <= 5; d++) {
          for (const s of ['sniadanie', 'przekaska']) {
            const r = recipeMap[week.days[d].meals[s].recipeId];
            assert(r.tags.includes('do pracy'), `${r.name} nie jest „do pracy”`);
          }
        }
      }
    });
    t.test('kolacje ≤ 20 min, bez „awaryjnych”, bez powtórek', () => {
      for (const seed of [1, 2, 3, 4]) {
        const week = plan({ seed });
        const ids = week.days.filter((_, d) => d !== 3).map((d) => d.meals.kolacja.recipeId);
        eq(new Set(ids).size, ids.length, 'powtórzona kolacja');
        for (const id of ids) {
          assert(recipeMap[id].timeMin <= 20, `${id} trwa ponad 20 min`);
          assert(!recipeMap[id].tags.includes('awaryjne'), `${id} jest awaryjne`);
        }
      }
    });
    t.test('reguły tygodnia spełnione (ryba, strączki, owies, orzechy, kcal, białko, budżet)', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const week = plan({ seed });
        const { checks } = checkRules(week, { recipeMap, ingMap, targets });
        const failed = checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
        eq(failed, [], `seed ${seed}`);
      }
    });
    t.test('ten sam seed → ten sam plan; inny seed → inny', () => {
      eq(plan({ seed: 7 }), plan({ seed: 7 }));
      assert(JSON.stringify(plan({ seed: 7 })) !== JSON.stringify(plan({ seed: 8 })), 'plany powinny się różnić');
    });
    t.test('wieczór z dziewczyną: porcje ×2 i bez pszenicy w roli głównej', () => {
      const calendar = normal();
      calendar[1].guest = calendar[5].guest = calendar[3].guest = true;
      for (const seed of [1, 2, 3]) {
        const week = plan({ calendar, seed });
        for (const d of [1, 3, 5]) {
          const m = week.days[d].meals.kolacja;
          eq(m.portions, 2);
          assert(guestOk(recipeMap[m.recipeId]), `${m.recipeId} nie nadaje się dla gościa`);
        }
        eq(week.days[2].meals.kolacja.portions, 1);
      }
    });
    t.test('dzień „poza domem” zostaje pusty', () => {
      const calendar = normal();
      calendar[6].mode = 'poza domem';
      const week = plan({ calendar });
      eq(SLOTS.map((s) => week.days[6].meals[s]), [null, null, null, null, null]);
      const { checks } = checkRules(week, { recipeMap, ingMap, targets });
      assert(checks.find((c) => c.id === 'full').ok, 'plan z dniem poza domem powinien być pełny');
    });
    t.test('zjazd stacjonarny: kanapki zamiast ciepłego posiłku', () => {
      const calendar = normal();
      calendar[6].mode = 'zjazd';
      const week = plan({ calendar });
      assert(isSandwich(recipeMap[week.days[6].meals.lunch.recipeId]), 'lunch na zjeździe to kanapki');
      assert(recipeMap[week.days[6].meals.sniadanie.recipeId].tags.includes('do pracy'), 'śniadanie do zabrania');
    });
    t.test('zablokowane pozycje przetrwają ponowne losowanie', () => {
      const keep = plan({ seed: 1 });
      keep.days[2].meals.kolacja = { recipeId: 'ko_pizza_tortilla', portions: 1, locked: true };
      const week = plan({ seed: 9, keep });
      eq(week.days[2].meals.kolacja.recipeId, 'ko_pizza_tortilla');
    });
    t.test('wypiek na zapas mieści się w trwałości i nie zostaje na weekend', () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const week = plan({ seed });
        for (const r of recipes.filter((x) => x.batch && x.type === 'śniadanie')) {
          const used = week.days.map((d, i) => (d.meals.sniadanie.recipeId === r.id ? i : -1)).filter((i) => i >= 0);
          if (!used.length) continue;
          assert(used[used.length - 1] - used[0] < r.fridgeDays, `${r.id}: rozstrzał ${used}`);
          assert(!used.includes(0) && !used.includes(6), `${r.id} w weekend`);
        }
      }
    });
    t.test('ręczna podmiana: lista kandydatów szersza niż w generatorze', () => {
      const day = emptyWeek(START).days[2];
      const auto = candidates(recipes, 'kolacja', 2, day);
      const manual = candidates(recipes, 'kolacja', 2, day, { auto: false });
      assert(manual.length > auto.length, 'ręcznie powinno być więcej opcji');
      assert(manual.some((r) => r.id === 'ko_pierogi') && !auto.some((r) => r.id === 'ko_pierogi'), 'pierogi tylko ręcznie');
    });
    t.test('rotacja lunchy: ostatnio używane lądują na końcu', () => {
      const weeks = { '2026-10-04': applyLunches(emptyWeek('2026-10-04'), 'lu_chilli', 'lu_teriyaki') };
      const sug = suggestLunches(recipes, weeks, START);
      eq(sug.slice(-2).map((s) => s.recipe.id).sort(), ['lu_chilli', 'lu_teriyaki']);
      eq(sug[sug.length - 1].weeksAgo, 1);
      eq(sug[0].weeksAgo, null);
      const pick = pickLunches(sug, normal());
      assert(!['lu_chilli', 'lu_teriyaki'].includes(pick.lunchA) && !['lu_chilli', 'lu_teriyaki'].includes(pick.lunchB), 'nie powtarzaj lunchu sprzed tygodnia');
    });
    t.test('lunch B (środa) do 60 min', () => {
      const sug = suggestLunches(recipes.filter((r) => ['lu_gulasz', 'lu_udon'].includes(r.id)), {}, START);
      eq(pickLunches(sug, normal()), { lunchA: 'lu_gulasz', lunchB: 'lu_udon' });
    });
    t.test('sprawdzony tydzień: zapis i odtworzenie', () => {
      const week = plan();
      const tpl = templateFromWeek(week, 'Test');
      const again = weekFromTemplate(tpl, '2026-10-18');
      eq(again.days.map((d) => SLOTS.map((s) => d.meals[s].recipeId)), week.days.map((d) => SLOTS.map((s) => d.meals[s].recipeId)));
      eq(again.days[0].date, '2026-10-18');
      eq([again.lunchA, again.lunchB], ['lu_teriyaki', 'lu_chilli']);
    });
  });

  t.describe('Przypomnienia (.ics)', () => {
    t.test('treść wynika z planu', () => {
      const ev = weekEvents(sample(), recipeMap);
      const find = (date, kind) => ev.find((e) => e.date === date && e.kind === kind)?.title;
      eq(find('2026-10-12', 'pack'), 'Spakuj: Serek wiejski + Kurczak teriyaki + Skyr pitny');
      eq(find('2026-10-13', 'snack'), 'Przekąska: Warzywa z hummusem — nie pomijaj');
      eq(find('2026-10-12', 'dinner'), 'Kolacja: Wrap z kurczakiem, ok. 15 min');
      eq(find('2026-10-11', 'prep'), 'Przygotuj na jutro: Serek wiejski, Skyr pitny');
      eq(find('2026-10-11', 'cookA'), 'Gotujesz lunch A: Kurczak teriyaki z ryżem, brokułem i marchewką');
      assert(find('2026-10-14', 'cookB').startsWith('Zakupy (lista środowa) + gotujesz lunch B: Chilli'), 'środa');
      eq(find('2026-10-17', 'weigh'), 'Ważenie + planowanie tygodnia');
      eq(find('2026-10-11', 'pack'), undefined, 'w niedzielę nic nie pakujemy');
    });
    t.test('wyłączone przypomnienia nie trafiają do pliku', () => {
      const ev = weekEvents(sample(), recipeMap, DEFAULT_REMINDERS, { sleep: true, kitchen: true });
      assert(!ev.some((e) => e.kind === 'sleep' || e.kind === 'kitchen'), 'wyłączone typy');
    });
    t.test('poprawny format: CRLF, linie ≤ 75 oktetów, alarm w każdym wydarzeniu', () => {
      const ev = weekEvents(sample(), recipeMap);
      const ics = buildICS(ev, new Date(Date.UTC(2026, 9, 10, 8, 0, 0)));
      assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'ramka kalendarza');
      const bytes = (s) => unescape(encodeURIComponent(s)).length;
      for (const line of ics.split('\r\n')) assert(bytes(line) <= 75, `za długa linia: ${line}`);
      eq(ics.split('BEGIN:VEVENT').length - 1, ev.length);
      eq(ics.split('BEGIN:VALARM').length - 1, ev.length);
      assert(ics.includes('DTSTART:20261012T070000'), 'czas lokalny bez strefy');
      assert(ics.includes('Spakuj: Serek wiejski + Kurczak teriyaki + Skyr pitny'), 'treść');
    });
  });

  t.describe('Claude — kopiuj / wklej', () => {
    const answer = (obj) => `Jasne, oto plan:\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\nSmacznego!`;
    t.test('wyciąga JSON z odpowiedzi z blokiem kodu i bez', () => {
      eq(extractJSON(answer({ a: 1 })).value, { a: 1 });
      eq(extractJSON('{"a":[1,2]}').value, { a: [1, 2] });
      assert(extractJSON('brak danych').error, 'powinien być błąd');
      assert(extractJSON('```json\n{"a": }\n```').error, 'uszkodzony JSON');
    });
    t.test('przykładowy tydzień przechodzi walidację', () => {
      const res = validatePlan(extractJSON(answer(data.sampleWeek)).value, recipeMap, normal());
      eq(res.errors, []);
      eq([res.template.lunchA, res.template.lunchB], ['lu_teriyaki', 'lu_chilli']);
      eq(res.template.days[3].kolacja, 'lu_chilli');
    });
    t.test('czytelne błędy: nieznane ID, zły typ, za mało dni', () => {
      const bad = clone(data.sampleWeek);
      bad.days[1].kolacja = 'ko_nie_ma_takiego';
      bad.days[2].sniadanie = 'lu_chilli';
      const res = validatePlan(bad, recipeMap, normal());
      assert(!res.ok, 'plan powinien być odrzucony');
      assert(res.errors.some((e) => e.includes('Poniedziałek') && e.includes('ko_nie_ma_takiego')), res.errors.join(' | '));
      assert(res.errors.some((e) => e.includes('Wtorek') && e.includes('nie pasuje')), res.errors.join(' | '));
      assert(!validatePlan({ days: bad.days.slice(0, 5) }, recipeMap).ok, '5 dni to za mało');
    });
    t.test('dzień poza domem może mieć puste sloty', () => {
      const p = clone(data.sampleWeek);
      for (const s of SLOTS) p.days[6][s] = null;
      const calendar = normal();
      assert(!validatePlan(p, recipeMap, calendar).ok, 'bez wyjątku to błąd');
      calendar[6].mode = 'poza domem';
      eq(validatePlan(p, recipeMap, calendar).errors, []);
    });
    t.test('prompt planu zawiera przepisy, reguły i wyjątki tygodnia', () => {
      const calendar = normal();
      calendar[2].guest = true;
      const p = planPrompt({ recipes, targets, rules: data.rules, startSunday: START, calendar, weeks: {} });
      for (const r of recipes) assert(p.includes(r.id), `brak ${r.id}`);
      assert(p.includes('Wtorek') && p.includes('z dziewczyną'), 'brak wyjątku');
      assert(p.includes('"lunchA"') && p.includes('1900–2100'), 'brak formatu / celów');
    });
    t.test('import przepisu: mapowanie na katalog i nowe składniki', () => {
      const res = validateRecipe(
        {
          recipe: { name: 'Tofu z brokułem', type: 'kolacja', servings: 2, timeMin: 20, ingredients: [{ id: 'tofu', g: 360 }, { id: 'brokul', g: 300 }, { id: 'ryz_basmati', g: 120 }], steps: ['Usmaż tofu.', 'Dodaj brokuł.'], tags: ['szybkie'], wheatMain: false },
          newIngredients: [{ id: 'tofu', name: 'Tofu naturalne', section: 'Nabiał i jajka', kcal: 130, protein: 14, fat: 8, satFat: 1.2, carbs: 1, fiber: 1, pricePerKg: 28, packGrams: 180, packLabel: 'kostka 180 g' }],
        },
        ingMap,
        data.shopSections,
      );
      eq(res.errors, []);
      eq(res.newIngredients.map((i) => i.id), ['tofu']);
      eq(res.recipe.ingredients.length, 3);
      const per = computePerServing(res.recipe, { ...ingMap, tofu: res.newIngredients[0] });
      assert(per.kcal > 400 && per.kcal < 600, `kcal ${per.kcal}`);
    });
    t.test('import przepisu: nieznany składnik i brak wartości to błędy', () => {
      const res = validateRecipe({ recipe: { name: 'X', type: 'obiad', servings: 0, ingredients: [{ id: 'jednorozec', g: 100 }], steps: [] } }, ingMap, data.shopSections);
      assert(!res.ok && res.errors.length >= 4, res.errors.join(' | '));
      assert(res.errors.some((e) => e.includes('jednorozec')), 'brak błędu o składniku');
    });
    t.test('prompt importu zawiera katalog składników', () => {
      const p = recipePrompt({ ingredients, sections: data.shopSections, source: 'https://example.com/przepis' });
      assert(p.includes('piers_kurczaka — Pierś z kurczaka') && p.includes('https://example.com/przepis'), 'katalog / źródło');
    });
  });

  t.describe('Start i postęp', () => {
    t.test('pierwsze uruchomienie w sobotę: plan na tydzień od niedzieli + listy zakupów', () => {
      eq(planningWeek('2026-10-10'), '2026-10-11');
      eq(planningWeek('2026-10-13'), '2026-10-11');
      const { user, catalog } = initialState(data, '2026-10-10');
      eq(Object.keys(user.weeks), ['2026-10-11']);
      eq([catalog.recipes.length, catalog.ingredients.length], [54, 81]);
      assert(user.shopping['2026-10-11'].items.length > 30, 'lista zakupów wygenerowana');
      eq(user.labs.length, 8);
      eq(user.presets.length, 10);
    });
    t.test('seria tygodni wg planu (≥ 80% posiłków)', () => {
      const mk = (start, eaten) => {
        const w = weekFromTemplate(data.sampleWeek, start);
        let n = 0;
        for (const d of w.days) for (const s of SLOTS) if (n++ < eaten) d.meals[s].status = 'zjedzone';
        return w;
      };
      const weeks = { '2026-10-11': mk('2026-10-11', 30), '2026-10-18': mk('2026-10-18', 35), '2026-10-25': mk('2026-10-25', 5) };
      eq(adherence(weeks['2026-10-11']), { planned: 35, eaten: 30, swapped: 0, skipped: 0 });
      eq(streak(weeks, '2026-10-25'), 2);
      weeks['2026-10-18'] = mk('2026-10-18', 10);
      eq(streak(weeks, '2026-10-25'), 0);
    });
    t.test('trend wagi w kg na tydzień', () => {
      const w = [0, 7, 14, 21].map((d, i) => ({ date: `2026-10-${10 + d}`, kg: 120 - i }));
      near(weightTrend(w).perWeek, -1, 0.001);
      eq(weightTrend([{ date: '2026-10-10', kg: 120 }]).perWeek, null);
    });
  });

  return t.results;
}
