import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CUSTOM_ISSUE_CODES,
  MAX_PREVIEW_CHARS,
  VALIDATION_ISSUE_CODES,
  previewValue,
  toValidationIssues,
  type CustomIssueParams,
  type ValidationIssue,
  type ValidationIssueCode,
  type ZodIssueLike,
} from './index.js';

const FILE = 'tenants/demo-trattoria/site.config.yaml';
const FALLBACK = 'Check the documentation for this field.';
const URL_HINT =
  'Use a full link that starts with `https://`, or a `mailto:` or `tel:` link. ' +
  '`http:`, `javascript:`, `data:` and links that start with `//` are not allowed.';

/** Every result the tests produce, for the shape checks at the end. */
const produced: ValidationIssue[] = [];

function issuesOf(schema: z.ZodType, input: unknown): ValidationIssue[] {
  const result = schema.safeParse(input, { reportInput: true });
  if (result.success) throw new Error('expected the input to be invalid');
  const issues = toValidationIssues(result.error, FILE);
  produced.push(...issues);
  return issues;
}

function fromIssues(...issues: ZodIssueLike[]): ValidationIssue[] {
  const out = toValidationIssues({ issues }, FILE);
  produced.push(...out);
  return out;
}

function expected(
  path: (string | number)[],
  code: ValidationIssueCode,
  message: string,
  hint: string,
): ValidationIssue {
  return { file: FILE, path, code, message, hint };
}

const Variant = z.enum(['split', 'fullbleed', 'minimal']);
const Hero = z.strictObject({
  type: z.literal('hero'),
  variant: Variant,
  limit: z.number().optional(),
});
const SafeLink = z.string().refine((s) => /^(https:|mailto:|tel:)/.test(s), {
  params: { pwpCode: 'unsafe_url' } satisfies CustomIssueParams,
});
const Localized = z
  .strictObject({ sv: z.string(), en: z.string().optional() })
  .refine((v) => v.en !== undefined, {
    path: ['en'],
    params: { pwpCode: 'missing_locale', locale: 'en' } satisfies CustomIssueParams,
  });

describe('unknown keys', () => {
  it('reports each unknown key with its full path', () => {
    const schema = z.strictObject({ hero: z.strictObject({ headline: z.string() }) });
    expect(issuesOf(schema, { hero: { headline: 'Hej', colour: 'red', size: 2 } })).toStrictEqual([
      expected(
        ['hero', 'colour'],
        'unknown_key',
        'Unknown field "colour".',
        'Remove it, or fix its spelling. Field names are case-sensitive.',
      ),
      expected(
        ['hero', 'size'],
        'unknown_key',
        'Unknown field "size".',
        'Remove it, or fix its spelling. Field names are case-sensitive.',
      ),
    ]);
  });
});

describe('wrong types and missing fields', () => {
  it('names the expected and the received type', () => {
    expect(issuesOf(Hero, { type: 'hero', variant: 'split', limit: 'six' })).toStrictEqual([
      expected(
        ['limit'],
        'wrong_type',
        'Expected a number, got text ("six").',
        'Write a number without quotes, for example `6`.',
      ),
    ]);
  });

  it('explains an empty value', () => {
    expect(issuesOf(z.strictObject({ name: z.string() }), { name: null })).toStrictEqual([
      expected(
        ['name'],
        'wrong_type',
        'Expected text, got an empty value.',
        'Fill in text after the colon, or remove the line if the field is optional.',
      ),
    ]);
  });

  it('describes lists and blocks instead of echoing them', () => {
    const [issue] = issuesOf(z.strictObject({ name: z.string() }), { name: ['a', 'b'] });
    expect(issue?.message).toBe('Expected text, got a list.');
  });

  it('tells a missing field from a wrong one', () => {
    expect(issuesOf(z.strictObject({ name: z.string() }), {})).toStrictEqual([
      expected(
        ['name'],
        'missing_field',
        'Missing required field `name`.',
        'Add `name:` followed by text.',
      ),
    ]);
  });

  it('still gives a message and hint when the input was not reported', () => {
    const result = z.number().safeParse('x');
    if (result.success) throw new Error('expected failure');
    expect(toValidationIssues(result.error, FILE)).toStrictEqual([
      expected(
        [],
        'wrong_type',
        'Expected a number.',
        'Write a number without quotes, for example `6`.',
      ),
    ]);
  });
});

describe('enum values and variants', () => {
  it('suggests the closest allowed value', () => {
    expect(issuesOf(Hero, { type: 'hero', variant: 'splitt' })).toStrictEqual([
      expected(
        ['variant'],
        'invalid_value',
        '"splitt" is not an allowed value for `variant`.',
        'Did you mean `split`? Allowed: split, fullbleed, minimal.',
      ),
    ]);
  });

  it('ignores case when suggesting', () => {
    const [issue] = issuesOf(Hero, { type: 'hero', variant: 'Minimal' });
    expect(issue?.hint).toBe('Did you mean `minimal`? Allowed: split, fullbleed, minimal.');
  });

  it('lists the allowed values when nothing is close', () => {
    const [issue] = issuesOf(Hero, { type: 'hero', variant: 'video' });
    expect(issue?.hint).toBe('Allowed: split, fullbleed, minimal.');
  });

  it('reports a missing variant with the allowed values', () => {
    expect(issuesOf(Hero, { type: 'hero' })).toStrictEqual([
      expected(
        ['variant'],
        'missing_field',
        'Missing required field `variant`.',
        'Add `variant:` followed by one of: split, fullbleed, minimal.',
      ),
    ]);
  });

  it('names the only allowed value of a literal', () => {
    expect(issuesOf(Hero, { type: 'footer', variant: 'split' })).toStrictEqual([
      expected(
        ['type'],
        'invalid_value',
        '"footer" is not an allowed value for `type`.',
        'Use `hero`.',
      ),
    ]);
  });
});

describe('custom issues from @pwp/schema checks', () => {
  it('reports a missing locale', () => {
    expect(
      issuesOf(z.strictObject({ headline: Localized }), { headline: { sv: 'Välkommen' } }),
    ).toStrictEqual([
      expected(
        ['headline', 'en'],
        'missing_locale',
        'Missing the `en` translation.',
        'Add a line `en: …` under this field, or remove `en` from `locales` in `site.config.yaml`.',
      ),
    ]);
  });

  it('reports a bad URL', () => {
    expect(
      issuesOf(z.strictObject({ cta: SafeLink }), { cta: 'javascript:alert(1)' }),
    ).toStrictEqual([
      expected(['cta'], 'unsafe_url', '"javascript:alert(1)" is not an allowed link.', URL_HINT),
    ]);
  });

  it('uses the allowed schemes and extensions a check passes along', () => {
    const [url, path] = fromIssues(
      {
        code: 'custom',
        path: ['link'],
        message: 'Invalid input',
        input: 'ftp://example.com',
        params: { pwpCode: 'unsafe_url', allowedSchemes: ['https:'] },
      },
      {
        code: 'custom',
        path: ['logo'],
        message: 'Invalid input',
        input: '../other/logo.svg',
        params: { pwpCode: 'unsafe_path', allowedExtensions: ['.png', '.webp'] },
      },
    );
    expect(url?.hint).toBe('Use a link that starts with one of: https:.');
    expect(path).toStrictEqual(
      expected(
        ['logo'],
        'unsafe_path',
        '"../other/logo.svg" is not an allowed file path.',
        'Use a path inside your tenant folder, such as `assets/hero.jpg`, without `..`, ' +
          'a leading `/` or backslashes. Allowed file types: .png, .webp.',
      ),
    );
  });

  it('keeps a custom message when there is no known code', () => {
    const schema = z.string().refine(() => false, { message: 'Opening must be before closing' });
    expect(issuesOf(schema, '10:00')).toStrictEqual([
      expected([], 'invalid', 'Opening must be before closing.', FALLBACK),
    ]);
  });

  it('covers every custom code', () => {
    for (const pwpCode of CUSTOM_ISSUE_CODES) {
      const [issue] = fromIssues({ code: 'custom', path: [], message: '', params: { pwpCode } });
      expect(issue?.code).toBe(pwpCode);
    }
  });
});

describe('unions', () => {
  const Text = z.union([z.string(), z.strictObject({ sv: z.string() })]);

  it('combines root type errors into one message', () => {
    expect(issuesOf(Text, 42)).toStrictEqual([
      expected(
        [],
        'no_matching_option',
        'Expected text or a block of fields, got the number 42.',
        'Write the value in one of these forms.',
      ),
    ]);
  });

  it('reports the branch that got furthest', () => {
    expect(issuesOf(Text, { sv: 1 })).toStrictEqual([
      expected(
        ['sv'],
        'wrong_type',
        'Expected text, got the number 1.',
        'Write text, for example `Margherita`. Put it in quotes if it contains `: ` or ` #`.',
      ),
    ]);
  });

  it('merges the values of literal branches', () => {
    const [issue] = issuesOf(z.union([z.literal('pickup'), z.literal('delivery')]), 'pikup');
    expect(issue?.code).toBe('invalid_value');
    expect(issue?.hint).toBe('Did you mean `pickup`? Allowed: pickup, delivery.');
  });

  it('names the discriminator when no option matches', () => {
    const [issue] = fromIssues({
      code: 'invalid_union',
      path: ['sections', 0],
      message: 'Invalid input',
      errors: [],
      discriminator: 'type',
      input: { type: 'herro' },
    });
    expect(issue?.path).toStrictEqual(['sections', 0]);
    expect(issue?.message).toBe('Unknown or missing `type`.');
  });
});

describe('sizes, steps and formats', () => {
  it('maps length, count and range limits', () => {
    expect(issuesOf(z.string().min(1), '')[0]).toStrictEqual(
      expected([], 'too_small', 'Must not be empty.', 'Fill in a value.'),
    );
    expect(issuesOf(z.string().max(5), 'abcdefg')[0]).toStrictEqual(
      expected(
        [],
        'too_big',
        'Too long: must be at most 5 characters.',
        'Shorten it to at most 5 characters.',
      ),
    );
    expect(issuesOf(z.array(z.string()).max(2), ['a', 'b', 'c'])[0]).toStrictEqual(
      expected(
        [],
        'too_big',
        'Too many items: must be at most 2.',
        'Remove items so the list has at most 2 items.',
      ),
    );
    expect(issuesOf(z.number().min(0), -1)[0]).toStrictEqual(
      expected(
        [],
        'too_small',
        'Too small: must be at least 0.',
        'Use a number that is at least 0.',
      ),
    );
  });

  it('explains a decimal step', () => {
    expect(issuesOf(z.number().multipleOf(0.01), 1.234)[0]).toStrictEqual(
      expected(
        [],
        'not_multiple_of',
        '1.234 has too many decimals.',
        'Use at most 2 decimals, for example `89.50`.',
      ),
    );
  });

  it('explains string formats', () => {
    expect(issuesOf(z.email(), 'pizza')[0]).toStrictEqual(
      expected(
        [],
        'invalid_format',
        '"pizza" is not a valid email address.',
        'Write an address like `name@example.com`.',
      ),
    );
    const [phone] = fromIssues({
      code: 'invalid_format',
      format: 'e164',
      path: ['phone'],
      message: 'Invalid input',
      input: '070-123',
    });
    expect(phone?.message).toBe('"070-123" is not a valid phone number.');
  });
});

describe('value previews', () => {
  const long = 'x'.repeat(300);

  it('never echoes a long tenant value in full', () => {
    const results = [
      ...issuesOf(Hero, { type: 'hero', variant: long }),
      ...issuesOf(Hero, { type: 'hero', variant: 'split', limit: long }),
      ...issuesOf(z.strictObject({ a: z.string() }), { a: 'b', [long]: 1 }),
      ...issuesOf(z.strictObject({ cta: SafeLink }), { cta: `javascript:${long}` }),
      ...issuesOf(z.email(), long),
    ];
    expect(results).toHaveLength(5);
    for (const issue of results) {
      expect(`${issue.message} ${issue.hint ?? ''}`).not.toContain(
        'x'.repeat(MAX_PREVIEW_CHARS + 1),
      );
    }
    expect(MAX_PREVIEW_CHARS).toBeLessThanOrEqual(80);
  });

  it('cuts by characters, not UTF-16 units', () => {
    expect(previewValue('a'.repeat(50))).toBe(`"${'a'.repeat(40)}…"`);
    expect(previewValue('🍕'.repeat(45))).toBe(`"${'🍕'.repeat(40)}…"`);
  });

  it('escapes quotes, control and bidi characters', () => {
    const bs = '\\';
    const value = `a"b${String.fromCodePoint(0x202e)}c${String.fromCodePoint(0x1b)}[31m`;
    expect(previewValue(value)).toBe(`"a${bs}"b${bs}u202ec${bs}u001b[31m"`);
  });
});

describe('fallbacks and output shape', () => {
  it('maps unknown Zod issue codes and symbol path keys', () => {
    expect(
      fromIssues({ code: 'something_new', path: [Symbol('key'), 0], message: 'Odd input' }),
    ).toStrictEqual([expected(['key', 0], 'invalid', 'Odd input.', FALLBACK)]);
  });

  it('drops duplicate issues', () => {
    const dup: ZodIssueLike = { code: 'something_new', path: ['a'], message: 'Same' };
    expect(fromIssues(dup, dup)).toHaveLength(1);
  });

  it('gives every issue a known code, a sentence and a hint, and no position', () => {
    expect(produced.length).toBeGreaterThan(20);
    for (const issue of produced) {
      expect(VALIDATION_ISSUE_CODES).toContain(issue.code);
      expect(issue.file).toBe(FILE);
      expect(issue.message).toMatch(/[.?!]$/);
      expect(issue.hint ?? '').toMatch(/\S/);
      expect(Object.hasOwn(issue, 'line') || Object.hasOwn(issue, 'column')).toBe(false);
    }
  });
});
