/**
 * The tool list the site declares, and the page blocks that show those tools.
 *
 * The site pane names a tool on each of its three data blocks. That mapping is
 * a promise about the same tool list the agent calls, so it is pinned here: a
 * renamed tool, or a block pointing at a tool the site never declared, fails
 * the suite instead of shipping a label nobody can act on.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_MANIFEST,
  MCP_TOOLS,
  PAGE_BLOCKS,
  isFileVia,
  toolEndpoint,
  toolPriceBem,
} from "./mcp-manifest.ts";
import { MESSAGES } from "../i18n.ts";

describe("the declared tool list", () => {
  it("declares exactly the three tools the page shows", () => {
    assert.deepEqual(
      MCP_TOOLS.map((tool) => tool.name),
      ["get_price", "jev_decide", "save_score"],
    );
  });

  it("gives every page block a tool the site really declares", () => {
    const declared = new Set(MCP_TOOLS.map((tool) => tool.name));
    for (const [block, tool] of Object.entries(PAGE_BLOCKS)) {
      assert.ok(declared.has(tool), `block ${block} names undeclared tool ${tool}`);
    }
  });

  it("routes each tool to a container and a price the catalog knows", () => {
    for (const tool of MCP_TOOLS) {
      // The confirmation dialog prints both of these; an empty endpoint or a
      // price nobody can resolve would make it name a call that cannot happen.
      assert.match(toolEndpoint(tool.via), /^#\d+@\d+$/, tool.name);
      assert.ok(Number.isFinite(toolPriceBem(tool.via)), tool.name);
    }
    assert.equal(MCP_MANIFEST.tools, MCP_TOOLS);
    assert.ok(
      MCP_TOOLS.some((tool) => isFileVia(tool.via)),
      "at least one read-only tool",
    );
  });

  it("keeps the manifest's own copy translated in all four languages", () => {
    for (const tool of MCP_TOOLS) {
      // The pane's per-block hint under the agent's tool picker.
      const key = isFileVia(tool.via) ? "mcp.fileHint" : "mcp.sendHint";
      for (const loc of ["zh", "en", "ja", "ko"] as const) {
        assert.ok(MESSAGES[loc][key], `${loc} is missing ${key}`);
      }
    }
  });
});
