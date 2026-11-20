/// <reference types="node" />
/**
 * Address vetting for the SSRF rules in the `webhook.ts` contract header (THREAT-MODEL T14).
 * Pure functions, no I/O. Anything that does not parse is treated as blocked (fail closed).
 */

import { isIP } from 'node:net';

type Bytes4 = readonly [number, number, number, number];

function parseIPv4(s: string): Bytes4 | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out as unknown as Bytes4;
}

/** Parses a valid IPv6 text form (as accepted by `isIP`) into 16 bytes. */
function parseIPv6(input: string): number[] | null {
  let s = input;
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct); // zone id does not change the address class
  // Embedded dotted IPv4 tail (`::ffff:127.0.0.1`) becomes two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const rest = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] ?? '').split(':')) : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function isBlockedIPv4([a, b]: Bytes4): boolean {
  return (
    a === 0 || // 0.0.0.0/8 (unspecified, "this network")
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    a >= 224 // multicast 224/4 and reserved/broadcast 240/4
  );
}

function isBlockedIPv6(b: readonly number[]): boolean {
  const at = (i: number): number => b[i] ?? 0;
  const v4At = (i: number): Bytes4 => [at(i), at(i + 1), at(i + 2), at(i + 3)];
  const zeros = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);

  if (zeros(0, 16)) return true; // ::
  if (zeros(0, 15) && at(15) === 1) return true; // ::1
  if (zeros(0, 10) && at(10) === 0xff && at(11) === 0xff) return isBlockedIPv4(v4At(12)); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return isBlockedIPv4(v4At(12)); // deprecated IPv4-compatible ::a.b.c.d
  // NAT64 64:ff9b::/96 embeds an IPv4 address.
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b && zeros(4, 12)) {
    return isBlockedIPv4(v4At(12));
  }
  if (at(0) === 0x20 && at(1) === 0x02) return isBlockedIPv4(v4At(2)); // 6to4 2002::/16
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0xc0) return true; // fec0::/10 deprecated site-local
  if ((at(0) & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (at(0) === 0xff) return true; // ff00::/8 multicast
  return false;
}

/** `true` when a delivery to this address must be refused. Unparseable input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const v4 = parseIPv4(address);
    return v4 === null ? true : isBlockedIPv4(v4);
  }
  if (kind === 6) {
    const v6 = parseIPv6(address);
    return v6 === null ? true : isBlockedIPv6(v6);
  }
  return true;
}

/** Strips the brackets `URL.hostname` keeps around an IPv6 literal. */
export function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export function isIpLiteral(host: string): boolean {
  return isIP(host) !== 0;
}
