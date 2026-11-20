/// <reference types="node" />
/**
 * Mock email adapter (ADR 0001, #49). The default in dev and tests.
 *
 * - Never touches the network. "Sent" messages are kept in an in-memory outbox that tests read.
 * - Never logs `@pii` fields. The only log line holds `messageId`, `tags` and `locale`.
 * - Enforces the contract's input rules, so code that passes against the mock also passes
 *   against a real provider's validation.
 * - Until `@pwp/schema` `Email` (#22) lands, addresses are checked here: CR/LF and any other
 *   control character, whitespace, `<`, `>`, `,`, `;` and quotes are rejected (header injection).
 *   A display `name` with CR/LF or any other control character, or longer than
 *   {@link MAX_EMAIL_NAME}, is rejected too.
 * - Idempotency keys are capped at {@link MAX_IDEMPOTENCY_KEY} characters and at most
 *   {@link MAX_REMEMBERED_MESSAGES} are remembered (oldest forgotten first).
 */

import { randomUUID } from 'node:crypto';
import { AdapterError, EMAIL_ENV } from '../interfaces/index.js';
import type {
  AdapterEnv,
  AdapterFactory,
  EmailAddress,
  EmailMessage,
  EmailSendResult,
  EmailSender,
} from '../interfaces/index.js';

const NAME = 'mock-email' as const;
const MAX_RECIPIENTS = 10;
const MAX_SUBJECT = 200;
const MAX_TEXT = 20_000;
const MAX_TAGS = 5;
const MAX_ADDRESS = 254;
/** Display name cap (characters). */
export const MAX_EMAIL_NAME = 128;
/** Idempotency key cap (characters). A submission id or UUID fits easily. */
export const MAX_IDEMPOTENCY_KEY = 128;
/**
 * At most this many idempotency keys (and outbox entries) are remembered. When full, the oldest
 * key and its outbox entry are forgotten, so memory stays bounded in a long-lived dev server.
 */
export const MAX_REMEMBERED_MESSAGES = 1000;
const TAG_RE = /^[a-z0-9-]{1,32}$/;
/* eslint-disable no-control-regex */
const ADDRESS_RE =
  /^[^\s<>,;"()[\]\\\u0000-\u001f\u007f@]+@[^\s<>,;"()[\]\\\u0000-\u001f\u007f@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/* eslint-enable no-control-regex */

/** One message as the mock "delivered" it. Holds PII: only for tests, never log it. */
export interface MockSentEmail {
  readonly messageId: string;
  readonly from: string;
  readonly message: EmailMessage;
}

/** Log sink. Receives only non-PII fields. */
export interface MockEmailLogger {
  info(entry: {
    readonly messageId: string;
    readonly tags: readonly string[];
    readonly locale: string;
  }): void;
}

export interface MockEmailSender extends EmailSender {
  /**
   * Messages accepted so far, oldest first (one entry per idempotency key). Holds at most
   * {@link MAX_REMEMBERED_MESSAGES}.
   */
  readonly outbox: readonly MockSentEmail[];
  /** Forget everything, including remembered idempotency keys. */
  reset(): void;
}

export interface MockEmailOptions {
  /** Sender address. Required, as `EMAIL_FROM` is for real adapters. */
  readonly from: string;
  /** Defaults to a logger that prints `messageId`, `tags` and `locale` with `console.warn`. */
  readonly logger?: MockEmailLogger;
}

const defaultLogger: MockEmailLogger = {
  info(entry) {
    // `console.warn` is the only non-error channel the lint config allows. This line has no PII.
    console.warn(
      `[mock-email] accepted messageId=${entry.messageId} locale=${entry.locale} tags=${entry.tags.join(',')}`,
    );
  },
};

function invalid(message: string): AdapterError {
  return new AdapterError('email', NAME, 'invalid_input', message);
}

function checkAddress(a: EmailAddress, field: string): void {
  if (typeof a.address !== 'string' || a.address.length === 0 || a.address.length > MAX_ADDRESS) {
    throw invalid(`${field}: invalid address`);
  }
  // Named separately so the failure reason is clear. Messages never echo the address (PII).
  if (/[\r\n]/.test(a.address)) throw invalid(`${field}: address contains CR/LF`);
  if (!ADDRESS_RE.test(a.address)) throw invalid(`${field}: invalid address`);
  if (a.name !== undefined) {
    if (typeof a.name !== 'string' || a.name.length > MAX_EMAIL_NAME) {
      throw invalid(`${field}: invalid name`);
    }
    // Real adapters strip these; the mock rejects them so callers find the problem early.
    if (/[\r\n]/.test(a.name)) throw invalid(`${field}: name contains CR/LF`);
    if (CONTROL_CHARS.test(a.name)) throw invalid(`${field}: name contains control characters`);
  }
}

function validate(message: EmailMessage): void {
  if (!Array.isArray(message.to) || message.to.length < 1 || message.to.length > MAX_RECIPIENTS) {
    throw invalid(`to: expected 1..${String(MAX_RECIPIENTS)} recipients`);
  }
  for (const a of message.to) checkAddress(a, 'to');
  if (message.replyTo !== undefined) checkAddress(message.replyTo, 'replyTo');
  if (typeof message.subject !== 'string' || message.subject.length === 0) {
    throw invalid('subject: required');
  }
  if (message.subject.length > MAX_SUBJECT) throw invalid('subject: too long');
  if (CONTROL_CHARS.test(message.subject)) throw invalid('subject: contains CR/LF');
  if (typeof message.text !== 'string' || message.text.length === 0)
    throw invalid('text: required');
  if (message.text.length > MAX_TEXT) throw invalid('text: too long');
  if (message.locale !== 'sv' && message.locale !== 'en')
    throw invalid('locale: expected sv or en');
  if (typeof message.idempotencyKey !== 'string' || message.idempotencyKey.length === 0) {
    throw invalid('idempotencyKey: required');
  }
  if (message.idempotencyKey.length > MAX_IDEMPOTENCY_KEY)
    throw invalid('idempotencyKey: too long');
  if (message.tags !== undefined) {
    if (message.tags.length > MAX_TAGS) throw invalid('tags: too many');
    if (!message.tags.every((t) => TAG_RE.test(t))) throw invalid('tags: invalid tag');
  }
}

/** Builds the mock. `from` is validated like a real adapter would validate `EMAIL_FROM`. */
export function createMockEmailSender(options: MockEmailOptions): MockEmailSender {
  const from = options.from;
  if (typeof from !== 'string' || from.trim() === '' || CONTROL_CHARS.test(from)) {
    throw new AdapterError(
      'email',
      NAME,
      'misconfigured',
      `${EMAIL_ENV.from} is missing or invalid`,
    );
  }
  const logger = options.logger ?? defaultLogger;
  const outbox: MockSentEmail[] = [];
  const byKey = new Map<string, string>();

  return {
    name: NAME,
    get outbox() {
      return outbox;
    },
    reset() {
      outbox.length = 0;
      byKey.clear();
    },
    send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        validate(message);
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : invalid('invalid message'));
      }
      const seen = byKey.get(message.idempotencyKey);
      if (seen !== undefined) return Promise.resolve({ messageId: seen });
      const messageId = `mock-${randomUUID()}`;
      if (byKey.size >= MAX_REMEMBERED_MESSAGES) {
        // Map keeps insertion order, and outbox has one entry per key in the same order.
        const oldest = byKey.keys().next();
        if (oldest.done !== true) byKey.delete(oldest.value);
        outbox.shift();
      }
      byKey.set(message.idempotencyKey, messageId);
      outbox.push({ messageId, from, message });
      logger.info({ messageId, tags: message.tags ?? [], locale: message.locale });
      return Promise.resolve({ messageId });
    },
  };
}

/** `AdapterFactory` for site config discovery. Reads only `EMAIL_FROM`. */
export const factory: AdapterFactory<'email', EmailSender> = {
  kind: 'email',
  name: NAME,
  env: [
    {
      name: EMAIL_ENV.from,
      secret: false,
      required: true,
      description: 'Sender address, e.g. "Pizzeria Exempel" <no-reply@example.se>.',
    },
  ],
  create(env: AdapterEnv): EmailSender {
    return createMockEmailSender({ from: env[EMAIL_ENV.from] ?? '' });
  },
};
