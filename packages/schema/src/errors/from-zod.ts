import {
  FALLBACK_HINT,
  cleanText,
  closest,
  describeReceived,
  expectedHint,
  expectedPhrase,
  listValues,
  name,
  previewValue,
} from './format.js';
import type { ValidationIssue, ValidationIssueCode, ZodIssueLike } from './validation-issue.js';

type Path = (string | number)[];
type Draft = Omit<ValidationIssue, 'file'>;

const DEFAULT_URL_HINT =
  'Use a full link that starts with `https://`, or a `mailto:` or `tel:` link. ' +
  '`http:`, `javascript:`, `data:` and links that start with `//` are not allowed.';

const PATH_HINT =
  'Use a path inside your tenant folder, such as `assets/hero.jpg`, ' +
  'without `..`, a leading `/` or backslashes.';

/**
 * Maps a Zod error to `ValidationIssue`s for one file. Pass the error from
 * `schema.safeParse(value, { reportInput: true })`: with the input available, messages can
 * say what was found and tell a missing field from a wrong value. Values are never echoed in
 * full (see `previewValue`); `path` stays exact so the loader (#53) can find the line.
 */
export function toValidationIssues(
  zodError: { readonly issues: readonly ZodIssueLike[] },
  file: string,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const draft of mapIssues(zodError.issues, [])) {
    const key = JSON.stringify([draft.path, draft.code, draft.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, ...draft });
  }
  return out;
}

function isIssue(value: unknown): value is ZodIssueLike {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')
    ? value
    : undefined;
}

function mapIssues(issues: readonly unknown[], prefix: Path): Draft[] {
  return issues.filter(isIssue).flatMap((issue) => mapIssue(issue, prefix));
}

function toPath(prefix: Path, path: unknown): Path {
  const rest = Array.isArray(path)
    ? path.map((p: unknown) =>
        typeof p === 'number' ? p : typeof p === 'symbol' ? (p.description ?? '') : String(p),
      )
    : [];
  return [...prefix, ...rest];
}

function make(path: Path, code: ValidationIssueCode, message: string, hint: string): Draft {
  return { path, code, message, hint };
}

function hasInput(issue: ZodIssueLike): boolean {
  return Object.hasOwn(issue, 'input');
}

function lastKey(path: Path): string | undefined {
  const last = path[path.length - 1];
  return typeof last === 'string' ? last : undefined;
}

/** The tenant value as the subject of a sentence: `"abc" is not …`. */
function subject(issue: ZodIssueLike): string {
  return hasInput(issue) ? previewValue(issue.input) : 'The value';
}

function missing(path: Path, what: string): Draft {
  const field = lastKey(path);
  return field === undefined
    ? make(path, 'missing_field', 'A required value is missing.', `Add ${what}.`)
    : make(
        path,
        'missing_field',
        `Missing required field ${name(field)}.`,
        `Add ${name(`${field}:`)} followed by ${what}.`,
      );
}

function joinOr(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1] ?? ''}`;
}

function mapIssue(issue: ZodIssueLike, prefix: Path): Draft[] {
  const path = toPath(prefix, issue.path);
  switch (issue.code) {
    case 'unrecognized_keys': {
      const keys = Array.isArray(issue.keys) ? issue.keys : [];
      if (!keys.length) return [fallback(issue, path)];
      return keys.map((key: unknown) =>
        make(
          [...path, String(key)],
          'unknown_key',
          `Unknown field ${previewValue(String(key))}.`,
          'Remove it, or fix its spelling. Field names are case-sensitive.',
        ),
      );
    }
    case 'invalid_type':
      return [wrongType(issue, path)];
    case 'invalid_value':
      return [invalidValue(issue, path, Array.isArray(issue.values) ? issue.values : [])];
    case 'too_small':
    case 'too_big':
      return [size(issue, path)];
    case 'invalid_format':
      return [format(issue, path)];
    case 'not_multiple_of':
      return [multipleOf(issue, path)];
    case 'invalid_union':
      return union(issue, path);
    case 'invalid_key':
      return [nested(issue, path, 'invalid_key', 'Invalid field name.')];
    case 'invalid_element':
      return [nested(issue, path, 'invalid_entry', 'Invalid entry.')];
    case 'custom':
      return [custom(issue, path)];
    default:
      return [fallback(issue, path)];
  }
}

function wrongType(issue: ZodIssueLike, path: Path): Draft {
  const expected = issue.expected;
  const phrase = expectedPhrase(expected);
  if (!hasInput(issue)) {
    return make(path, 'wrong_type', `Expected ${phrase}.`, expectedHint(expected));
  }
  if (issue.input === undefined && expected !== 'undefined') return missing(path, phrase);
  const hint =
    issue.input === null
      ? `Fill in ${phrase} after the colon, or remove the line if the field is optional.`
      : expectedHint(expected);
  return make(
    path,
    'wrong_type',
    `Expected ${phrase}, got ${describeReceived(issue.input)}.`,
    hint,
  );
}

function invalidValue(issue: ZodIssueLike, path: Path, values: readonly unknown[]): Draft {
  if (hasInput(issue) && issue.input === undefined) {
    return missing(path, values.length === 1 ? name(values[0]) : `one of: ${listValues(values)}`);
  }
  const field = lastKey(path);
  const forField = field === undefined ? '' : ` for ${name(field)}`;
  const message = `${subject(issue)} is not an allowed value${forField}.`;
  if (values.length === 1) return make(path, 'invalid_value', message, `Use ${name(values[0])}.`);
  if (!values.length) return make(path, 'invalid_value', message, FALLBACK_HINT);
  const guess = hasInput(issue) ? closest(issue.input, values) : undefined;
  const didYouMean = guess === undefined ? '' : `Did you mean ${name(guess)}? `;
  return make(path, 'invalid_value', message, `${didYouMean}Allowed: ${listValues(values)}.`);
}

function plural(n: string, unit: string): string {
  return `${n} ${n === '1' ? unit : `${unit}s`}`;
}

function size(issue: ZodIssueLike, path: Path): Draft {
  const small = issue.code === 'too_small';
  const code = small ? 'too_small' : 'too_big';
  const raw = small ? issue.minimum : issue.maximum;
  const n = typeof raw === 'number' || typeof raw === 'bigint' ? String(raw) : '';
  const bound =
    issue.exact === true
      ? 'exactly'
      : issue.inclusive === false
        ? small
          ? 'more than'
          : 'less than'
        : small
          ? 'at least'
          : 'at most';
  const inclusiveOne = small && n === '1' && issue.exact !== true && issue.inclusive !== false;
  switch (issue.origin) {
    case 'string':
      if (inclusiveOne) return make(path, code, 'Must not be empty.', 'Fill in a value.');
      return make(
        path,
        code,
        `${small ? 'Too short' : 'Too long'}: must be ${bound} ${plural(n, 'character')}.`,
        small
          ? `Add text so it has ${bound} ${plural(n, 'character')}.`
          : `Shorten it to ${bound} ${plural(n, 'character')}.`,
      );
    case 'array':
    case 'set':
      if (inclusiveOne) {
        return make(path, code, 'The list must not be empty.', 'Add at least one item.');
      }
      return make(
        path,
        code,
        `${small ? 'Too few' : 'Too many'} items: must be ${bound} ${n}.`,
        `${small ? 'Add' : 'Remove'} items so the list has ${bound} ${plural(n, 'item')}.`,
      );
    case 'number':
    case 'int':
    case 'bigint':
      return make(
        path,
        code,
        `${small ? 'Too small' : 'Too large'}: must be ${bound} ${n}.`,
        `Use a number that is ${bound} ${n}.`,
      );
    case 'date': {
      const day = typeof raw === 'number' ? new Date(raw).toISOString().slice(0, 10) : n;
      return make(
        path,
        code,
        `${small ? 'Too early' : 'Too late'}: must be ${bound} ${day}.`,
        `Use a date that is ${bound} ${day}.`,
      );
    }
    default:
      return make(
        path,
        code,
        small ? 'The value is too small.' : 'The value is too large.',
        FALLBACK_HINT,
      );
  }
}

function format(issue: ZodIssueLike, path: Path): Draft {
  const s = subject(issue);
  const at = (message: string, hint: string): Draft => make(path, 'invalid_format', message, hint);
  switch (issue.format) {
    case 'email':
      return at(`${s} is not a valid email address.`, 'Write an address like `name@example.com`.');
    case 'url':
      return at(`${s} is not a valid link.`, 'Write a full link that starts with `https://`.');
    case 'e164':
      return at(
        `${s} is not a valid phone number.`,
        'Write it in international format without spaces, for example `+46701740605`.',
      );
    case 'date':
      return at(
        `${s} is not a valid date.`,
        'Write the date as `YYYY-MM-DD`, for example `2026-12-24`.',
      );
    case 'time':
      return at(
        `${s} is not a valid time.`,
        'Write the time as `HH:MM` on the 24-hour clock, for example `17:30`.',
      );
    case 'datetime':
      return at(
        `${s} is not a valid date and time.`,
        'Write it as `YYYY-MM-DDTHH:MM`, for example `2026-12-24T17:30`.',
      );
    case 'starts_with':
      return at(
        `${s} must start with ${name(issue.prefix)}.`,
        `Add ${name(issue.prefix)} at the start.`,
      );
    case 'ends_with':
      return at(
        `${s} must end with ${name(issue.suffix)}.`,
        `Add ${name(issue.suffix)} at the end.`,
      );
    case 'includes':
      return at(`${s} must contain ${name(issue.includes)}.`, `Add ${name(issue.includes)}.`);
    case 'lowercase':
      return at(`${s} must be lowercase.`, 'Use only lowercase letters.');
    case 'uppercase':
      return at(`${s} must be uppercase.`, 'Use only uppercase letters.');
    default:
      return at(`${s} is not in the expected format.`, FALLBACK_HINT);
  }
}

/** Decimal places allowed by a step like 0.01, or undefined if the step is not 10^-k. */
function decimalsOf(step: number): number | undefined {
  for (let k = 0; k <= 10; k++) if (Math.abs(step * 10 ** k - 1) < 1e-9) return k;
  return undefined;
}

function multipleOf(issue: ZodIssueLike, path: Path): Draft {
  const step = typeof issue.divisor === 'number' ? issue.divisor : undefined;
  const decimals = step === undefined ? undefined : decimalsOf(step);
  if (decimals !== undefined) {
    return make(
      path,
      'not_multiple_of',
      `${subject(issue)} has too many decimals.`,
      decimals === 0
        ? 'Use a whole number.'
        : `Use at most ${plural(String(decimals), 'decimal')}, for example \`${(89.5).toFixed(decimals)}\`.`,
    );
  }
  const by = step === undefined ? 'the required step' : String(step);
  return make(
    path,
    'not_multiple_of',
    `${subject(issue)} must be a multiple of ${by}.`,
    `Use a multiple of ${by}.`,
  );
}

function depth(issue: unknown): number {
  return isIssue(issue) && Array.isArray(issue.path) ? issue.path.length : 0;
}

function union(issue: ZodIssueLike, path: Path): Draft[] {
  const branches = (Array.isArray(issue.errors) ? issue.errors : []).filter(
    (b: unknown): b is unknown[] => Array.isArray(b) && b.length > 0,
  );
  if (!branches.length) {
    const key = typeof issue.discriminator === 'string' ? issue.discriminator : undefined;
    if (key !== undefined) {
      return [
        make(
          path,
          'no_matching_option',
          `Unknown or missing ${name(key)}.`,
          `Set ${name(key)} to one of the values listed in the documentation for this section.`,
        ),
      ];
    }
    return [
      make(path, 'no_matching_option', `${subject(issue)} matches no allowed form.`, FALLBACK_HINT),
    ];
  }
  const all = branches.flat().filter(isIssue);
  const atRoot = all.every(
    (i) => depth(i) === 0 && (i.code === 'invalid_type' || i.code === 'invalid_value'),
  );
  if (atRoot) {
    const values = all.flatMap((i) =>
      i.code === 'invalid_value' && Array.isArray(i.values) ? i.values : [],
    );
    if (all.every((i) => i.code === 'invalid_value')) return [invalidValue(issue, path, values)];
    const phrases = [
      ...new Set(
        all
          .map((i) => (i.code === 'invalid_type' ? expectedPhrase(i.expected) : ''))
          .filter(Boolean),
      ),
      ...values.map((v) => name(v)),
    ];
    if (hasInput(issue) && issue.input === undefined) return [missing(path, joinOr(phrases))];
    const got = hasInput(issue) ? `, got ${describeReceived(issue.input)}` : '';
    return [
      make(
        path,
        'no_matching_option',
        `Expected ${joinOr(phrases)}${got}.`,
        'Write the value in one of these forms.',
      ),
    ];
  }
  // Report the branch that got furthest into the value: deepest issue first, then fewest issues.
  let best = branches[0] ?? [];
  for (const b of branches.slice(1)) {
    const d = Math.max(...b.map(depth));
    const bestD = Math.max(...best.map(depth));
    if (d > bestD || (d === bestD && b.length < best.length)) best = b;
  }
  return mapIssues(best, path);
}

function nested(issue: ZodIssueLike, path: Path, code: ValidationIssueCode, base: string): Draft {
  const inner = Array.isArray(issue.issues) ? mapIssues(issue.issues, path) : [];
  const first = inner[0];
  return first
    ? make(path, code, `${base} ${first.message}`, first.hint ?? FALLBACK_HINT)
    : make(path, code, base, FALLBACK_HINT);
}

function custom(issue: ZodIssueLike, path: Path): Draft {
  const params = isRecord(issue.params) ? issue.params : {};
  switch (params['pwpCode']) {
    case 'missing_locale': {
      const locale = typeof params['locale'] === 'string' ? params['locale'] : undefined;
      return locale === undefined
        ? make(
            path,
            'missing_locale',
            'A translation is missing.',
            'Add a translation for every locale listed in `locales` in `site.config.yaml`.',
          )
        : make(
            path,
            'missing_locale',
            `Missing the ${name(locale)} translation.`,
            `Add a line ${name(`${locale}: …`)} under this field, or remove ${name(locale)} ` +
              'from `locales` in `site.config.yaml`.',
          );
    }
    case 'unsafe_url': {
      const schemes = stringList(params['allowedSchemes']);
      return make(
        path,
        'unsafe_url',
        `${subject(issue)} is not an allowed link.`,
        schemes ? `Use a link that starts with one of: ${listValues(schemes)}.` : DEFAULT_URL_HINT,
      );
    }
    case 'unsafe_path': {
      const exts = stringList(params['allowedExtensions']);
      return make(
        path,
        'unsafe_path',
        `${subject(issue)} is not an allowed file path.`,
        exts ? `${PATH_HINT} Allowed file types: ${listValues(exts)}.` : PATH_HINT,
      );
    }
    default:
      return fallback(issue, path);
  }
}

function fallback(issue: ZodIssueLike, path: Path): Draft {
  const text =
    typeof issue.message === 'string' && issue.message ? cleanText(issue.message, 200) : '';
  const message = !text ? 'Invalid value.' : /[.!?]$/.test(text) ? text : `${text}.`;
  return make(path, 'invalid', message, FALLBACK_HINT);
}
