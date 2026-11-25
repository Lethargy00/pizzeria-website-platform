# @pwp/schema

Zod schemas: tenant config, theme tokens, menu, hours, locations, pages. The source of every contract.

May import: no other `@pwp/*` package. Enforced by `pnpm check-boundaries` (ADR 0001).

## Validation errors (`src/errors/`, contract #23)

Every tool reports problems in tenant files as `ValidationIssue`s:

```ts
interface ValidationIssue {
  file: string; // e.g. tenants/demo/site.config.yaml
  line?: number; // filled in by the YAML loader (#53)
  column?: number;
  path: (string | number)[]; // e.g. ['pages', 'home', 'sections', 0, 'variant']
  code: ValidationIssueCode; // closed list: VALIDATION_ISSUE_CODES
  message: string; // what is wrong and what was expected
  hint?: string; // how to fix it
}
```

`toValidationIssues(zodError, file)` maps a Zod error to that shape. Parse with `schema.safeParse(value, { reportInput: true })` so messages can say what was found and tell a missing field (`missing_field`) from a wrong one (`wrong_type`). Positions are added later by the loader, which maps `path` to a line and column.

Checks in `@pwp/schema` (the #22 primitives and later schemas) never write user-facing text. They raise a Zod `custom` issue with `params` of type `CustomIssueParams`, and the mapping turns the code into a message and hint:

```ts
z.string().refine(isSafeUrl, { params: { pwpCode: 'unsafe_url' } satisfies CustomIssueParams });
```

The custom codes are `missing_locale` (with `locale`), `unsafe_url` (optionally `allowedSchemes`) and `unsafe_path` (optionally `allowedExtensions`). A custom issue without a known `pwpCode` keeps its own message under the code `invalid`. New codes are added to the contract through a `type:contract` issue.

### Message guidelines

The reader is a developer editing YAML or Markdown, not a TypeScript developer.

- **Message: what is wrong, then what was expected.** One English sentence that ends with a period, for example ``"splitt" is not an allowed value for `variant`.``. Use the words of the file format ("text", "a number", "a list", "a block of fields", "an empty value"), not Zod or TypeScript type names.
- **Hint: how to fix it, as concretely as possible.** Name the allowed values (`Allowed: split, fullbleed, minimal.`), suggest the closest one when it looks like a typo (``Did you mean `split`?``), or show an example of a valid value (``Write the date as `YYYY-MM-DD`, for example `2026-12-24`.``).
- **Quoting.** Values from the tenant's file are in double quotes (`"splitt"`). Names the platform defines (fields, allowed values, locales) are in backticks.
- **Never echo tenant values in full.** A value is cut to `MAX_PREVIEW_CHARS` (40) characters plus `…`, so no message contains more than 80 characters of tenant input. Lists and blocks are described ("got a list"), not printed. Control, zero-width and bidi characters are escaped (right-to-left override becomes `\u202e`), so a value cannot rewrite the terminal or hide text.
- **Don't repeat the path.** The formatter prints the file, line and path; the message says what is wrong at that spot.
- **No secrets, no stack traces, no internal file paths** in messages or hints.
