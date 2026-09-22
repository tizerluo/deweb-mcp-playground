/**
 * Printing a ledger amount.
 *
 * The review found the panel's prices (0.0002–0.0003 BNB a call) printed as
 * "0.00": the /s/game button advertised the charge as nothing, and the /mcp
 * confirmation told the visitor a real charge would be nothing. These
 * assertions pin the contract that replaced the fixed two-decimal form — two
 * decimals as the floor, every digit the amount really has above it, and never
 * zero for any amount the ledger can hold.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BNB_DECIMALS, formatBnb } from "./utils.ts";

/** What the formatter printed, as a number again. */
function value(printed: string): number {
  return Number(printed.replace(/,/g, ""));
}

describe("formatBnb", () => {
  it("prints the prices this ledger charges instead of rounding them away", () => {
    assert.equal(formatBnb(0.0002), "0.0002");
    assert.equal(formatBnb(0.0003), "0.0003");
  });

  it("keeps two decimals as the floor", () => {
    assert.equal(formatBnb(0), "0.00");
    assert.equal(formatBnb(0.05), "0.05");
    assert.equal(formatBnb(2), "2.00");
    assert.equal(formatBnb(0.01), "0.01");
  });

  it("prints the digits the amount has, so a charge cannot hide in a balance", () => {
    // What the header shows right after a paid 0.0003 call: 0.05 minus the
    // charge, float noise and all. "0.05" here would hide the charge.
    assert.equal(formatBnb(0.05 - 0.0003), "0.0497");
    assert.equal(formatBnb(0.0102), "0.0102");
    assert.equal(formatBnb(0.00025), "0.00025");
  });

  it("never prints an amount the ledger can hold as zero", () => {
    for (let decimals = 0; decimals <= BNB_DECIMALS; decimals += 1) {
      const amount = 10 ** -decimals;
      const printed = formatBnb(amount);
      assert.notEqual(printed, "0.00", `${amount} printed as zero`);
      assert.ok(value(printed) > 0, `${amount} printed as ${printed}`);
    }
  });

  it("reads an unreadable amount as no amount at all", () => {
    assert.equal(formatBnb(Number.NaN), "—");
    assert.equal(formatBnb(Number.POSITIVE_INFINITY), "—");
  });
});
