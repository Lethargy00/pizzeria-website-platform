import { z } from 'zod';
import { Email } from './contact.js';
import type { PrimitiveIssueParams } from './issue-params.js';

/**
 * The WHATWG `URL` class, present in Node and every browser. Declared here because this package
 * compiles without DOM or Node types; only the members used below are typed.
 */
declare const URL: new (input: string) => {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly host: string;
};

/** The only URL schemes a tenant may use (PROMPT.md §6, ADR 0002). */
export const SAFE_URL_SCHEMES = ['https:', 'mailto:', 'tel:'] as const;
export type SafeUrlScheme = (typeof SAFE_URL_SCHEMES)[number];

/** Maximum length of a link. */
export const MAX_URL_LENGTH = 2048;

/**
 * Control, format (zero-width, bidi), whitespace and separator characters. None of them may
 * appear anywhere in a link: browsers strip some of them before reading the scheme, which is how
 * `java\tscript:` and `\u0000javascript:` get through naive checks.
 */
const INVISIBLE_OR_SPACE = /[\p{Cc}\p{Cf}\p{Z}]/u;

const MAILTO_QUERY_PARAM = /^(?:subject|body)=[A-Za-z0-9%._~!$'()*+,;:@/?-]*$/;
const TEL_BODY = /^\+?[0-9().-]{3,32}$/;

/**
 * The canonical authority a tenant must write: lowercase ASCII host, optional port. No userinfo,
 * no percent-encoding, no Unicode (an IDN must be written in its visible `xn--` form), no
 * fullwidth or ideographic dots.
 */
const RAW_AUTHORITY = /^[a-z0-9.-]+(:\d{1,5})?$/;
/** One DNS label: not empty, and no hyphen at the start or end. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A top-level label that is all digits or `0x…` means the parser read the host as an IPv4 address. */
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/;

/** In `subject`: any percent-encoded C0 control (including CR, LF, NUL) or DEL. */
const SUBJECT_ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f)/i;
/** In `body`: CR, LF and TAB are allowed (RFC 6068 line breaks); NUL, other C0 controls and DEL are not. */
const BODY_ENCODED_CONTROL = /%(?:0[0-8bcef]|1[0-9a-f]|7f)/i;

/**
 * The authority exactly as written: the text after `https://` up to the first `/`, `?` or `#`.
 * Backslashes were already rejected, so the parser and this split agree on where it ends.
 */
function rawAuthority(value: string): string {
  const rest = value.slice('https://'.length);
  const end = rest.search(/[/?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function isSafeHost(hostname: string): boolean {
  const labels = hostname.split('.');
  return (
    labels.length >= 2 &&
    labels.every((label) => DNS_LABEL.test(label)) &&
    // No IP literals in any form (`127.0.0.1`, `2130706433`, `0x7f.1`): a TLD is never numeric.
    !NUMERIC_LABEL.test(labels[labels.length - 1] ?? '')
  );
}

function isSafeHttps(value: string): boolean {
  // The literal `https://` prefix matters: `new URL('https:evil.example')` also parses.
  if (!value.startsWith('https://') || value.startsWith('https:///')) return false;
  // Validate what the tenant wrote, not what the parser normalised it to (#107 F1): the raw
  // string is what ends up in `href`.
  const authority = rawAuthority(value);
  if (!RAW_AUTHORITY.test(authority)) return false;
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    // No credentials: `https://bank.example@evil.example` is a phishing pattern.
    url.username === '' &&
    url.password === '' &&
    // The parser changed nothing: no IPv4 rewriting, no default-port stripping (`:443`).
    url.host === authority &&
    isSafeHost(url.hostname)
  );
}

function isSafeMailto(value: string): boolean {
  const rest = value.slice('mailto:'.length);
  const queryStart = rest.indexOf('?');
  const address = queryStart === -1 ? rest : rest.slice(0, queryStart);
  if (!Email.safeParse(address).success) return false;
  if (queryStart === -1) return true;
  const query = rest.slice(queryStart + 1);
  // Only `subject` and `body`: no `cc`/`bcc`/`to` header injection. No encoded CR/LF/NUL in
  // `subject` (THREAT-MODEL T16, #107 F2), and no encoded NUL in `body`.
  return query.split('&').every((param) => {
    if (!MAILTO_QUERY_PARAM.test(param)) return false;
    if (param.startsWith('subject=')) return !SUBJECT_ENCODED_CONTROL.test(param);
    return !BODY_ENCODED_CONTROL.test(param);
  });
}

function isSafeTel(value: string): boolean {
  const number = value.slice('tel:'.length);
  return TEL_BODY.test(number) && (number.match(/[0-9]/g)?.length ?? 0) >= 3;
}

/**
 * True if `value` is a link a tenant may use: `https://…` with a canonical lowercase ASCII host
 * (no IP address, no userinfo, no percent-encoding, IDNs only as `xn--`),
 * `mailto:<address>` (optionally `?subject=…&body=…`) or `tel:<number>`.
 *
 * The scheme must be written in lowercase and come first. Everything else is rejected, including
 * `http:`, `javascript:`, `vbscript:`, `data:`, `file:`, relative and protocol-relative (`//`)
 * links, backslashes, and any control, zero-width, bidi or whitespace character anywhere (so
 * mixed-case and whitespace-obfuscated schemes fail too). Does not rely on `z.url()`, which
 * accepts `javascript:`. `renderMarkdown` (#47) uses this for every `href`.
 */
export function isSafeUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (INVISIBLE_OR_SPACE.test(value) || value.includes('\\')) return false;
  if (value.startsWith('https:')) return isSafeHttps(value);
  if (value.startsWith('mailto:')) return isSafeMailto(value);
  if (value.startsWith('tel:')) return isSafeTel(value);
  return false;
}

/** A link a tenant may use. See {@link isSafeUrl} for the exact rules. */
export const SafeUrl = z.string().refine(isSafeUrl, {
  error: 'Only https:, mailto: and tel: links are allowed.',
  params: { pwpCode: 'unsafe_url' } satisfies PrimitiveIssueParams,
});
export type SafeUrl = z.infer<typeof SafeUrl>;
