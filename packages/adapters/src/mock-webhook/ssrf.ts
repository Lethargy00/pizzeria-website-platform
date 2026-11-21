/// <reference types="node" />
/**
 * Address vetting for the SSRF rules in the `webhook.ts` contract header (THREAT-MODEL T14).
 * Pure functions, no I/O. Anything that does not parse is treated as blocked (fail closed).
 *
 * This is an **allow-list**: an address is accepted only when it is global unicast. Everything
 * else is refused, so a range that is missing from a list cannot slip through (#100).
 * - IPv4: allowed unless it is in {@link IPV4_NOT_GLOBAL}, the IANA IPv4 special-purpose
 *   registry entries that are not globally reachable, plus multicast and 240/4.
 * - IPv6: only `2000::/3` (global unicast) is allowed, minus {@link IPV6_NOT_GLOBAL}. Outside
 *   `2000::/3` only two forms that carry an IPv4 address are accepted, and only when that
 *   IPv4 address is allowed: IPv4-mapped `::ffff:0:0/96` (how dual-stack resolvers report an A
 *   record) and well-known NAT64 `64:ff9b::/96`. Every other form, including IPv4-translated
 *   `::ffff:0:0:0/96`, IPv4-compatible `::/96`, local-use NAT64 `64:ff9b:1::/48` and discard
 *   `100::/64`, is refused.
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

/** `[network, prefix length]` in the IPv4 space. */
type Cidr4 = readonly [Bytes4, number];

/**
 * IPv4 ranges that are not global unicast (IANA IPv4 special-purpose address registry, plus
 * multicast and the reserved 240/4). The few registry entries that are globally reachable
 * (AS112, AMT) are not listed, so they stay allowed.
 */
export const IPV4_NOT_GLOBAL: readonly Cidr4[] = Object.freeze([
  [[0, 0, 0, 0], 8], // "this network", unspecified
  [[10, 0, 0, 0], 8], // RFC 1918
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, cloud metadata
  [[172, 16, 0, 0], 12], // RFC 1918
  [[192, 0, 0, 0], 24], // IETF protocol assignments (incl. DS-Lite, NAT64 discovery)
  [[192, 0, 2, 0], 24], // documentation TEST-NET-1
  [[192, 88, 99, 0], 24], // deprecated 6to4 relay anycast
  [[192, 168, 0, 0], 16], // RFC 1918
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation TEST-NET-2
  [[203, 0, 113, 0], 24], // documentation TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. 255.255.255.255 broadcast
] satisfies Cidr4[]);

/** `[network as 16 bytes, prefix length]` in the IPv6 space. */
type Cidr6 = readonly [readonly number[], number];

function v6(hextets: readonly number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const h = hextets[i] ?? 0;
    bytes.push(h >> 8, h & 0xff);
  }
  return bytes;
}

/** Ranges inside `2000::/3` that are not global unicast (IANA IPv6 special-purpose registry). */
export const IPV6_NOT_GLOBAL: readonly Cidr6[] = Object.freeze([
  [v6([0x2001]), 23], // IETF protocol assignments, incl. Teredo 2001::/32 and benchmarking
  [v6([0x2001, 0x0db8]), 32], // documentation
  [v6([0x2002]), 16], // 6to4 (embeds an IPv4 address; not globally reachable)
  [v6([0x3fff]), 20], // documentation (RFC 9637)
] satisfies Cidr6[]);

function inPrefix(bytes: readonly number[], network: readonly number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((network[i] ?? 0) & mask)) return false;
  }
  return true;
}

function isGlobalIPv4(v4: Bytes4): boolean {
  return !IPV4_NOT_GLOBAL.some(([net, prefix]) => inPrefix(v4, net, prefix));
}

function isGlobalIPv6(b: readonly number[]): boolean {
  const at = (i: number): number => b[i] ?? 0;
  const v4At = (i: number): Bytes4 => [at(i), at(i + 1), at(i + 2), at(i + 3)];
  const zeros = (from: number, to: number): boolean => b.slice(from, to).every((x) => x === 0);

  // IPv4-mapped ::ffff:a.b.c.d (exactly ::ffff:0:0/96; not the translated ::ffff:0:a.b.c.d).
  if (zeros(0, 10) && at(10) === 0xff && at(11) === 0xff) return isGlobalIPv4(v4At(12));
  // Well-known NAT64 64:ff9b::/96 (exactly; not the local-use 64:ff9b:1::/48).
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b && zeros(4, 12)) {
    return isGlobalIPv4(v4At(12));
  }
  if ((at(0) & 0xe0) !== 0x20) return false; // outside 2000::/3
  return !IPV6_NOT_GLOBAL.some(([net, prefix]) => inPrefix(b, net, prefix));
}

/**
 * `true` when a delivery to this address must be refused, that is, whenever the address is not
 * global unicast. Unparseable input is blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const v4 = parseIPv4(address);
    return v4 === null ? true : !isGlobalIPv4(v4);
  }
  if (kind === 6) {
    const bytes = parseIPv6(address);
    return bytes === null ? true : !isGlobalIPv6(bytes);
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
