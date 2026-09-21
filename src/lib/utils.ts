import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBem(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
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

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return (
    "0x" +
    [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function shortHex(hex: string, left = 6, right = 4) {
  if (hex.length <= left + right + 2) return hex;
  return `${hex.slice(0, left + 2)}…${hex.slice(-right)}`;
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
