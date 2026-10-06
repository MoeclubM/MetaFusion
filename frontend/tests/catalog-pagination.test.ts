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
    pages = [{ items: [{ id: "one" }, { id: "two" }], has_more: true }, { items: [{ id: "three" }], has_more: false }];
    assert.deepEqual(await fetchAllPages<{ id: string }>("/catalog/entities?medium_id=disc", 2), [
      { id: "one" }, { id: "two" }, { id: "three" },
    ]);
    assert.equal(new URL(requests[0], "http://localhost").searchParams.get("offset"), "0");
    assert.equal(new URL(requests[1], "http://localhost").searchParams.get("offset"), "2");
    assert.equal(new URL(requests[1], "http://localhost").searchParams.get("limit"), "2");

    pages = [{ items: [], has_more: false }];
    assert.deepEqual(await fetchAllPages("/catalog/entities"), []);

    for (const malformed of [{}, { items: null }, { items: {} }, null]) {
      pages = [malformed];
      await assert.rejects(fetchAllPages("/catalog/entities"), /invalid_response: entities.items/);
    }
    pages = [{ items: [{ id: "one" }, { id: "two" }], has_more: true }, {}];
    await assert.rejects(fetchAllPages("/catalog/entities", 2), /invalid_response: entities.items/);
    pages = [{ items: [{ id: "one" }, { id: "two" }], has_more: true }, new Error("offline")];
    await assert.rejects(fetchAllPages("/catalog/entities", 2), /offline/);

    // PostgreSQL may hide every hit in an indexed page after a visibility change.
    // Continue through the search cursor even when the page is empty or short.
    requests.length = 0;
    pages = [
      { items: [], has_more: true, next_cursor: "snapshot-1" },
      { items: [{ id: "visible" }], has_more: true, next_cursor: "snapshot-2" },
      { items: [{ id: "last" }], has_more: false },
    ];
    assert.deepEqual(await fetchAllPages("/catalog/entities?q=music&limit=10", 2), [{ id: "visible" }, { id: "last" }]);
    const second = new URL(requests[1], "http://localhost").searchParams;
    assert.equal(second.get("cursor"), "snapshot-1");
    assert.equal(second.has("offset"), false);
    assert.deepEqual(second.getAll("limit"), ["2"]);
    assert.equal(new URL(requests[2], "http://localhost").searchParams.get("cursor"), "snapshot-2");

    pages = [{ items: [] }];
    await assert.rejects(fetchAllPages("/catalog/entities"), /entities.has_more/);
    pages = [{ items: [], has_more: true }];
    await assert.rejects(fetchAllPages("/catalog/entities?q=music"), /entities.next_cursor/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
