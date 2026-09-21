/** Playground packing of TAP-10 request id (draft request-response.md §4). */

const KIND = new TextEncoder().encode("deweb.req/v0");
const CHAIN_ID = 56;

export function parseEndpoint(display: string): { tokenId: number; cpu: number } {
  const m = /^#(\d+)@(\d+)$/.exec(display);
  if (!m) return { tokenId: 0, cpu: 0 };
  return { tokenId: Number(m[1]), cpu: Number(m[2]) };
}

/** uint32(0) ‖ uint64(chainId) ‖ 20-byte container (demo packing). */
export function endpointID(display: string, chainId = CHAIN_ID): Uint8Array {
  const { tokenId, cpu } = parseEndpoint(display);
  const b = new Uint8Array(32);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0);
  v.setUint32(4, 0);
  v.setUint32(8, chainId);
  b[12] = cpu & 0xff;
  v.setUint32(28, tokenId);
  return b;
}

export function randomNonce(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export function toHex(bytes: Uint8Array): string {
  return `0x${[...bytes].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** RFC 8785 JCS subset for objects/arrays/strings/ints. */
export function jcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(rec[k])}`).join(",")}}`;
  }
  return "null";
}

export async function requestIdHex(args: {
  from: string;
  to: string;
  nonce: Uint8Array;
  params: unknown;
}): Promise<string> {
  const paramsBytes = new TextEncoder().encode(jcs(args.params ?? {}));
  const pre = new Uint8Array(12 + 32 + 32 + 32 + paramsBytes.length);
  pre.set(KIND, 0);
  pre.set(endpointID(args.from), 12);
  pre.set(endpointID(args.to), 44);
  pre.set(args.nonce, 76);
  pre.set(paramsBytes, 108);
  const digest = await crypto.subtle.digest("SHA-256", pre);
  return toHex(new Uint8Array(digest));
}
