import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** BNB's own smallest unit (wei): below this the ledger holds nothing. */
export const BNB_DECIMALS = 18;

/**
 * Where the noise a binary float leaves behind stops mattering. Sums and
 * differences of ledger amounts land on values like 0.049700000000000001;
 * twelve significant digits round that back to the 0.0497 the ledger means,
 * while still carrying a tiny amount like 0.000000000000000001 as itself.
 */
const BNB_QUIET_DIGITS = 12;

/**
 * A ledger amount in BNB, printed as the amount it is.
 *
 * The prices here are small on purpose (0.0002–0.0003 BNB a call), and the
 * fixed two-decimal form this replaced turned every one of them into "0.00":
 * a button advertised a price in place of the charge, and the confirmation
 * said a real charge would be nothing. Two decimals are the floor — and past
 * that the formatter prints as many as the amount actually has, so a balance
 * that paid one 0.0003 call reads 0.0497 rather than a 0.05 that hides it.
 */
export function formatBnb(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const quiet = Number(n.toPrecision(BNB_QUIET_DIGITS));
  if (quiet === 0) return "0.00";
  let decimals = 0;
  while (decimals < BNB_DECIMALS && Number(quiet.toFixed(decimals)) !== quiet) decimals += 1;
  return quiet.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, decimals),
  });
}

export function formatUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n >= 10 ? 2 : 4,
    maximumFractionDigits: n >= 10 ? 2 : 4,
  });
}

export function formatBlock(n: number) {
  return n.toLocaleString("en-US");
}

/**
 * A clock stamp for "last read" lines. Fixed to en-GB/24h rather than the
 * visitor's locale: the value is painted from client state after hydration,
 * and a locale-dependent format would make the same instant read differently
 * in two languages.
 */
export function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function shortHex(hex: string, left = 6, right = 4) {
  if (hex.length <= left + right + 2) return hex;
  return `${hex.slice(0, left + 2)}…${hex.slice(-right)}`;
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
