/**
 * Email contract (DECISIONS #42, #52). Used by functions to notify the pizzeria about a form
 * submission and, optionally, to send the visitor a receipt. Owner: architect.
 *
 * PII: recipients, reply-to, subject and body all may contain personal data (`@pii`).
 */

import type { Email, LocaleCode } from '@pwp/schema/primitives';
import type { EmailAdapterName } from '@pwp/schema/adapters';
import type { AdapterCallOptions, AdapterEnvVarName } from './index.js';

/** Closed set of email adapter names (= folder names). Canonical in `@pwp/schema/adapters` (#64). */
export { EMAIL_ADAPTER_NAMES, type EmailAdapterName } from '@pwp/schema/adapters';

/** Env vars shared by every email adapter. Provider adapters add their own `EMAIL_*` vars. */
export const EMAIL_ENV = {
  /** Sender address, e.g. `"Pizzeria Exempel" <no-reply@example.se>`. Not secret. Required. */
  from: 'EMAIL_FROM',
} as const satisfies Record<string, AdapterEnvVarName<'email'>>;

export interface EmailAddress {
  /** @pii Address only, no display name, already validated by `@pwp/schema` `Email` (#22). */
  readonly address: Email;
  /** @pii Optional display name. Adapters strip CR/LF before putting it in a header. */
  readonly name?: string;
}

/**
 * One message. **Plain text only**: no HTML body in v1, so no tenant or visitor input can be
 * rendered as HTML in a mail client.
 *
 * The sender (`From`) is **not** part of the message. It comes from `EMAIL_FROM`, so callers
 * can never spoof it with form input. A visitor's address goes in `replyTo`.
 */
export interface EmailMessage {
  /** @pii 1..10 recipients. Usually the pizzeria's own address from site config. */
  readonly to: readonly [EmailAddress, ...EmailAddress[]];
  /** @pii The visitor, so the pizzeria can answer directly. */
  readonly replyTo?: EmailAddress;
  /** @pii Single line; adapters reject CR/LF (`invalid_input`). Max 200 characters. */
  readonly subject: string;
  /** @pii Plain text body, max 20 000 characters. */
  readonly text: string;
  /** Language of the message, for the `Content-Language` header (`@pwp/schema` `LocaleCode`). */
  readonly locale: LocaleCode;
  /**
   * Stable per logical message (e.g. the form submission id). Retries reuse it; adapters that
   * support it pass it to the provider so a retried send is delivered once. Not PII.
   */
  readonly idempotencyKey: string;
  /** Non-PII labels for provider-side filtering, e.g. `['contact']`. Max 5, `[a-z0-9-]{1,32}`. */
  readonly tags?: readonly string[];
}

export interface EmailSendResult {
  /** Provider message id (mock: generated). Not PII; safe to log. */
  readonly messageId: string;
}

/**
 * Sends one email.
 *
 * - Resolves once the provider has **accepted** the message (not when it is delivered).
 * - Rejects only with `AdapterError` (`invalid_input`, `misconfigured`, `rejected`, `throttled`,
 *   `timeout`, `unavailable`). Retrying is the caller's choice, with the same `idempotencyKey`.
 * - Never logs `@pii` fields. Mocks log at most `messageId`, `tags` and `locale`.
 */
export interface EmailSender {
  readonly name: EmailAdapterName;
  send(message: EmailMessage, options?: AdapterCallOptions): Promise<EmailSendResult>;
}
