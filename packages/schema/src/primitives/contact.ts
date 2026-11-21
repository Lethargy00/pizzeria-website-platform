import { z } from 'zod';

/** Maximum length of an email address (RFC 5321 path limit). */
export const MAX_EMAIL_LENGTH = 254;

/** Maximum length of the local part, before the `@` (RFC 5321 §4.5.3.1.1). */
export const MAX_EMAIL_LOCAL_LENGTH = 64;

/**
 * Zod's default email pattern (zod 4.6.7 `regexes.email`) with two additions: a lookahead that
 * limits the local part to {@link MAX_EMAIL_LOCAL_LENGTH} characters, and domain labels that may
 * not start or end with a hyphen (RFC 1035). Kept inside the format check, so a bad address
 * raises exactly one `invalid_format` issue (`format: 'email'`), never a separate custom issue.
 */
const EMAIL_PATTERN = new RegExp(
  `^(?=[^@]{1,${MAX_EMAIL_LOCAL_LENGTH}}@)` +
    `(?:[A-Za-z0-9_'+\\-]+\\.)*[A-Za-z0-9_'+\\-]*[A-Za-z0-9_+-]` +
    `@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}$`,
);

/**
 * An email address, e.g. `info@pizzeria-roma.se`. ASCII only, a domain with a dot and a top-level
 * domain of at least two letters. No display names (`Roma <info@…>`), no IP-literal domains, a local
 * part of at most 64 characters and no domain label that starts or ends with a hyphen.
 */
export const Email = z.email({ pattern: EMAIL_PATTERN }).max(MAX_EMAIL_LENGTH);
export type Email = z.infer<typeof Email>;

/**
 * A phone number in E.164 form: `+`, a country code and the number, digits only, no spaces,
 * e.g. `+46812345678`. Formatting for display is done by `@pwp/core`.
 */
export const PhoneNumber = z.e164();
export type PhoneNumber = z.infer<typeof PhoneNumber>;
