/**
 * Helpers that turn tenant values and schema names into safe, short message fragments.
 * Messages end up in terminals and CI logs, so every tenant value is quoted, cut to
 * `MAX_PREVIEW_CHARS` characters and stripped of control and bidi characters.
 */

/** The most characters of a tenant value a message shows (contract #23 allows at most 80). */
export const MAX_PREVIEW_CHARS = 40;

// C0/C1 controls, zero-width characters, line/paragraph separators, bidi controls, BOM.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

function escapeUnsafe(text: string): string {
  return text.replace(UNSAFE_CHARS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Cuts `text` to `max` characters (code points, so emoji are never split) and adds `…`. */
export function truncate(text: string, max = MAX_PREVIEW_CHARS): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

/** Free text (for example a schema author's message) cut to `max` characters and escaped. */
export function cleanText(text: string, max = MAX_PREVIEW_CHARS): string {
  return escapeUnsafe(truncate(text, max));
}

/** A tenant value for a message: quoted text, a plain number or a short description. */
export function previewValue(value: unknown): string {
  if (typeof value === 'string') {
    const escaped = escapeUnsafe(truncate(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
    return `"${escaped}"`;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return truncate(String(value));
  }
  if (value === null) return 'an empty value';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  return 'a block of fields';
}

/** A schema-defined name (field, enum value, locale) in backticks, cut and escaped like a value. */
export function name(value: unknown): string {
  return `\`${escapeUnsafe(truncate(String(value)))}\``;
}

/** What a value is, for "got …" in a wrong-type message. */
export function describeReceived(value: unknown): string {
  if (typeof value === 'string') return `text (${previewValue(value)})`;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return `the number ${previewValue(value)}`;
  }
  if (typeof value === 'boolean') return name(value);
  return previewValue(value);
}

const EXPECTED: Record<string, { phrase: string; hint: string }> = {
  string: {
    phrase: 'text',
    hint: 'Write text, for example `Margherita`. Put it in quotes if it contains `: ` or ` #`.',
  },
  number: { phrase: 'a number', hint: 'Write a number without quotes, for example `6`.' },
  int: { phrase: 'a whole number', hint: 'Write a whole number without quotes, for example `6`.' },
  bigint: {
    phrase: 'a whole number',
    hint: 'Write a whole number without quotes, for example `6`.',
  },
  boolean: { phrase: '`true` or `false`', hint: 'Write `true` or `false` without quotes.' },
  array: { phrase: 'a list', hint: 'Write a list with one `- item` per line.' },
  tuple: { phrase: 'a list', hint: 'Write a list with one `- item` per line.' },
  set: { phrase: 'a list', hint: 'Write a list with one `- item` per line.' },
  object: {
    phrase: 'a block of fields',
    hint: 'Write `key: value` lines, indented under this field.',
  },
  record: {
    phrase: 'a block of fields',
    hint: 'Write `key: value` lines, indented under this field.',
  },
  map: {
    phrase: 'a block of fields',
    hint: 'Write `key: value` lines, indented under this field.',
  },
  date: { phrase: 'a date', hint: 'Write the date as `YYYY-MM-DD`, for example `2026-12-24`.' },
  null: { phrase: 'an empty value', hint: 'Leave the value after the colon empty.' },
};

export const FALLBACK_HINT = 'Check the documentation for this field.';

/** "text", "a number", … for a Zod `expected` type name. */
export function expectedPhrase(expected: unknown): string {
  const known = typeof expected === 'string' ? EXPECTED[expected] : undefined;
  return known ? known.phrase : `a value of type ${name(expected)}`;
}

/** How to write a value of the expected type. */
export function expectedHint(expected: unknown): string {
  const known = typeof expected === 'string' ? EXPECTED[expected] : undefined;
  return known ? known.hint : FALLBACK_HINT;
}

/** Lists allowed values, at most `max` of them. */
export function listValues(values: readonly unknown[], max = 12): string {
  const shown = values.slice(0, max).map((v) => escapeUnsafe(truncate(String(v))));
  return values.length > max ? `${shown.join(', ')}, …` : shown.join(', ');
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

/**
 * The allowed value closest to `input` (ignoring case), if it is close enough to be a likely
 * typo: at most one edit per three characters, and at least one.
 */
export function closest(input: unknown, candidates: readonly unknown[]): string | undefined {
  if (typeof input !== 'string' || input.length > 100) return undefined;
  const needle = input.toLowerCase();
  let best: { value: string; d: number } | undefined;
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const d = distance(needle, c.toLowerCase());
    const limit = Math.max(1, Math.floor(Math.max(needle.length, c.length) / 3));
    if (d <= limit && (!best || d < best.d)) best = { value: c, d };
  }
  return best?.value;
}
