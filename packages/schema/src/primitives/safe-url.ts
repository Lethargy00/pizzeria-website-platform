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

function isSafeHttps(value: string): boolean {
  // The literal `https://` prefix matters: `new URL('https:evil.example')` also parses.
  if (!value.startsWith('https://') || value.startsWith('https:///')) return false;
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
    url.hostname.includes('.') &&
    !url.hostname.startsWith('.') &&
    !url.hostname.endsWith('.')
  );
}

function isSafeMailto(value: string): boolean {
  const rest = value.slice('mailto:'.length);
  const queryStart = rest.indexOf('?');
  const address = queryStart === -1 ? rest : rest.slice(0, queryStart);
  if (!Email.safeParse(address).success) return false;
  if (queryStart === -1) return true;
  const query = rest.slice(queryStart + 1);
  // Only `subject` and `body`: no `cc`/`bcc`/`to` header injection.
  return query.split('&').every((param) => MAILTO_QUERY_PARAM.test(param));
}

function isSafeTel(value: string): boolean {
  const number = value.slice('tel:'.length);
  return TEL_BODY.test(number) && (number.match(/[0-9]/g)?.length ?? 0) >= 3;
}

/**
 * True if `value` is a link a tenant may use: `https://…` with a host and no credentials,
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
