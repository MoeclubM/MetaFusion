import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "../src/components/catalog/api";

test("catalog pagination preserves complete lists and rejects incomplete or failed responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let pages: unknown[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    const page = pages.shift();
    if (page instanceof Error) throw page;
    return Response.json(page);
  }) as typeof fetch;
  try {
    pages = [{ items: [{ id: "one" }, { id: "two" }] }, { items: [{ id: "three" }] }];
    assert.deepEqual(await fetchAllPages<{ id: string }>("/catalog/entities?medium_id=disc", 2), [
      { id: "one" }, { id: "two" }, { id: "three" },
    ]);
    assert.ok(requests[0].endsWith("?medium_id=disc&offset=0&limit=2"));
    assert.ok(requests[1].endsWith("?medium_id=disc&offset=2&limit=2"));

    pages = [{ items: [] }];
    assert.deepEqual(await fetchAllPages("/catalog/entities"), []);

    for (const malformed of [{}, { items: null }, { items: {} }, null]) {
      pages = [malformed];
      await assert.rejects(fetchAllPages("/catalog/entities"), /invalid_response: entities.items/);
    }
    pages = [{ items: [{ id: "one" }, { id: "two" }] }, {}];
    await assert.rejects(fetchAllPages("/catalog/entities", 2), /invalid_response: entities.items/);
    pages = [{ items: [{ id: "one" }, { id: "two" }] }, new Error("offline")];
    await assert.rejects(fetchAllPages("/catalog/entities", 2), /offline/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
