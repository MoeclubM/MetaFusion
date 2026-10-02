import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPARE_BASKET_KEY, COMPARE_MAX_SLOTS, compareHref, normalizeBasket, readCompareBasket, writeCompareBasket } from "../src/lib/compareBasket";

const first = "01a0fd18-a9c7-76e2-be2f-16feb7ed0b3c";
const second = "01a0fe41-8b03-727f-8684-741fc877d82c";

function withStorage(raw: string | null, check: (storage: { value: string | null; writes: number }) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = { value: raw, writes: 0 };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => key === COMPARE_BASKET_KEY ? storage.value : null,
    setItem: (key: string, value: string) => {
      assert.equal(key, COMPARE_BASKET_KEY);
      storage.value = value;
      storage.writes++;
    },
  } } });
  try { check(storage); }
  finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("reading a saved comparison preserves its order without rewriting storage", () => {
  const raw = JSON.stringify([` ${first} `, null, first, 42, "", second]);
  withStorage(raw, storage => {
    assert.deepEqual(readCompareBasket(), [first, second]);
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  });
});

test("malformed comparison storage falls back to empty without deleting saved data", () => {
  for (const raw of ["not-json", "{}", "null"]) withStorage(raw, storage => {
    assert.deepEqual(readCompareBasket(), []);
    assert.equal(storage.value, raw);
    assert.equal(storage.writes, 0);
  });
});

test("restoring the same selection performs no repeated storage writes", () => {
  withStorage(JSON.stringify([first]), storage => {
    for (let i = 0; i < 10; i++) assert.deepEqual(writeCompareBasket([first]), [first]);
    assert.equal(storage.writes, 0);
    assert.deepEqual(writeCompareBasket([first, second]), [first, second]);
    assert.equal(storage.writes, 1);
    writeCompareBasket([first, second]);
    assert.equal(storage.writes, 1);
    writeCompareBasket([]);
    assert.equal(storage.value, "[]");
    assert.equal(storage.writes, 2);
  });
});

test("shared comparison URLs preserve normalized order and the slot limit", () => {
  assert.equal(compareHref([` ${first} `, first, second]), `/compare?ids=${encodeURIComponent([first, second].join(","))}`);
  assert.equal(compareHref(["", " "]), "/compare");
  const ids = Array.from({ length: COMPARE_MAX_SLOTS + 2 }, (_, i) => `${first.slice(0, -1)}${i}`);
  assert.deepEqual(normalizeBasket(ids), ids.slice(0, COMPARE_MAX_SLOTS));
});
