import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertJevServerOnly } from "./server-only.ts";

/** The JEV key lives in `client.server.ts`; nothing may pull it into a page. */
describe("assertJevServerOnly", () => {
  it("passes on the server (no window)", () => {
    assert.equal(typeof globalThis.window, "undefined");
    assert.doesNotThrow(() => assertJevServerOnly());
  });

  it("throws as soon as a browser global exists", () => {
    const scope = globalThis as { window?: unknown };
    scope.window = {};
    try {
      assert.throws(() => assertJevServerOnly(), /server-only/);
      assert.throws(() => assertJevServerOnly("@/lib/jev/client.server"), /server-only/);
    } finally {
      delete scope.window;
    }
  });
});
