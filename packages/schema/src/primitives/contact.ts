import { z } from 'zod';

/** Maximum length of an email address (RFC 5321 path limit). */
export const MAX_EMAIL_LENGTH = 254;

/** Maximum length of the local part, before the `@` (RFC 5321 §4.5.3.1.1). */
export const MAX_EMAIL_LOCAL_LENGTH = 64;

/** A domain label must not start or end with a hyphen (RFC 1035). */
const HYPHEN_AT_LABEL_EDGE = /(?:^|[.@])-|-(?:$|\.)/;

function hasValidParts(value: string): boolean {
  const at = value.lastIndexOf('@');
  return at <= MAX_EMAIL_LOCAL_LENGTH && !HYPHEN_AT_LABEL_EDGE.test(value.slice(at));
}

/**
 * An email address, e.g. `info@pizzeria-roma.se`. ASCII only, a domain with a dot and a top-level
 * domain of at least two letters. No display names (`Roma <info@…>`), no IP-literal domains, a local
 * part of at most 64 characters and no domain label that starts or ends with a hyphen.
 */
export const Email = z
  .email()
  .max(MAX_EMAIL_LENGTH)
  .refine(hasValidParts, { error: 'Invalid email address.' });
export type Email = z.infer<typeof Email>;

/**
 * A phone number in E.164 form: `+`, a country code and the number, digits only, no spaces,
 * e.g. `+46812345678`. Formatting for display is done by `@pwp/core`.
 */
export const PhoneNumber = z.e164();
export type PhoneNumber = z.infer<typeof PhoneNumber>;
