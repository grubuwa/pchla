// Minimalny runner testów — działa w przeglądarce (tests/index.html) i w jsc (tests/run.sh).

export function suite() {
  const results = [];
  let group = '';
  return {
    results,
    describe(name, fn) {
      group = name;
      fn();
    },
    test(name, fn) {
      try {
        fn();
        results.push({ group, name, ok: true });
      } catch (e) {
        results.push({ group, name, ok: false, error: String(e?.message || e) });
      }
    },
  };
}

export function assert(cond, msg = 'warunek niespełniony') {
  if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? `${msg}: ` : ''}oczekiwano ${b}, jest ${a}`);
}

export function near(actual, expected, tol, msg = '') {
  if (Math.abs(actual - expected) > tol) throw new Error(`${msg ? `${msg}: ` : ''}oczekiwano ${expected} ± ${tol}, jest ${actual}`);
}
