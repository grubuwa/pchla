# pchła

Aplikacja webowa (PWA) do planowania posiłków, przepisów i list zakupów — wg założeń z `Plan_zywieniowy_zalozenia.pdf`, zasilana danymi z `data/przepisy.json`.

Czysty HTML/CSS/JS (moduły ES), bez zależności i bez kroku budowania. Dane są wyłącznie na urządzeniu (IndexedDB) + kopia zapasowa JSON.

## Uruchomienie na Macu

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Potem otwórz <http://localhost:5173>. (Plik `index.html` otwarty bezpośrednio z dysku nie zadziała — moduły ES wymagają serwera.)

## Testy

Logika (wartości odżywcze, lista zakupów, generator planu, .ics, import z Claude) ma testy bez Node — na JavaScriptCore wbudowanym w macOS:

```bash
./tests/run.sh
```

Te same testy w przeglądarce: <http://localhost:5173/tests/>.

## Na iPhonie

1. Wrzuć cały folder na darmowy hosting statyczny (GitHub Pages albo Cloudflare Pages) — bez kompilacji, katalog główny = ten folder.
2. Otwórz adres w Safari → Udostępnij → **Dodaj do ekranu początkowego**.
3. Aplikacja działa offline (service worker), więc lista zakupów jest dostępna także bez zasięgu.

Po każdej zmianie plików podbij `CACHE` w `sw.js` (np. `pchla-v2`), żeby telefony pobrały nową wersję.

## Struktura

| Plik | Co robi |
| --- | --- |
| `js/planner.js` | generator planu tygodnia i sprawdzanie reguł (rozdz. 5 i 9.4) |
| `js/shopping.js` | lista zakupów: sumowanie, opakowania, sobota / środa, spiżarnia |
| `js/nutrition.js` | kcal, białko i koszt liczone ze składników |
| `js/ics.js` | przypomnienia jako plik .ics do Kalendarza |
| `js/claude.js` | prompty do claude.ai i walidacja wklejonych odpowiedzi |
| `js/seed.js` | dane startowe z `przepisy.json` |
| `js/store.js`, `js/model.js` | stan aplikacji, zapis w IndexedDB, operacje na planie |
| `js/views/*` | ekrany: Dziś, Tydzień (+ kreator), Przepisy, Zakupy, Postęp, Ustawienia |
| `tests/` | testy logiki |
