// Uruchamianie testów bez przeglądarki: ./tests/run.sh (JavaScriptCore wbudowany w macOS).
/* global readFile, print, quit */
import { runAll } from './all.js';

const data = JSON.parse(readFile('data/przepisy.json'));
const results = runAll(data);
let group = '';
for (const r of results) {
  if (r.group !== group) {
    group = r.group;
    print(`\n${group}`);
  }
  print(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
}
const failed = results.filter((r) => !r.ok).length;
print(`\n${results.length - failed}/${results.length} testów OK`);
if (failed) quit(1);
