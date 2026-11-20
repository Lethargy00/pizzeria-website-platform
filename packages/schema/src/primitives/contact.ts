import { z } from 'zod';

/** Maximum length of an email address (RFC 5321 path limit). */
export const MAX_EMAIL_LENGTH = 254;

/**
 * An email address, e.g. `info@pizzeria-roma.se`. ASCII only, a domain with a dot and a top-level
 * domain of at least two letters. No display names (`Roma <info@…>`), no IP-literal domains.
 */
export const Email = z.email().max(MAX_EMAIL_LENGTH);
export type Email = z.infer<typeof Email>;

/**
 * A phone number in E.164 form: `+`, a country code and the number, digits only, no spaces,
 * e.g. `+46812345678`. Formatting for display is done by `@pwp/core`.
 */
export const PhoneNumber = z.e164();
export type PhoneNumber = z.infer<typeof PhoneNumber>;
