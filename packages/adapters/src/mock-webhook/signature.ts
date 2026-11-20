/// <reference types="node" />
/**
 * Webhook signing and the reference verifier (contract: `interfaces/webhook.ts`).
 * The README in this folder shows how a receiver uses `verifyWebhookSignature`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WEBHOOK_SIGNATURE_VERSION,
  WEBHOOK_TOLERANCE_SECONDS,
  webhookSigningInput,
} from '../interfaces/index.js';

const SECRET_RE = /^[A-Za-z0-9_-]{43,}$/; // 64+ hex chars and 43+ base64url chars both match

/**
 * The strength rule for `WEBHOOK_SECRET` (and the previous key): at least 32 random bytes,
 * encoded as 64+ hex or 43+ base64url characters. An empty string never passes.
 */
export function isStrongWebhookSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && SECRET_RE.test(secret);
}

/** Lowercase hex HMAC-SHA256 over `"<timestamp>.<rawBody>"`, key = secret as UTF-8 bytes. */
export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(webhookSigningInput(timestampSeconds, rawBody), 'utf8')
    .digest('hex');
}

/** `v1=<hex>` for the current secret, plus `,v1=<hex>` for the previous one during rotation. */
export function buildSignatureHeader(
  secrets: readonly string[],
  timestampSeconds: number,
  rawBody: string,
): string {
  return secrets
    .map((s) => `${WEBHOOK_SIGNATURE_VERSION}=${signWebhook(s, timestampSeconds, rawBody)}`)
    .join(',');
}

export interface VerifyWebhookInput {
  /**
   * Your `WEBHOOK_SECRET` (and, while rotating, the old one too). Must be non-empty, and every
   * entry must pass {@link isStrongWebhookSecret}, or the call throws.
   */
  readonly secrets: readonly string[];
  /** Value of `X-PWP-Timestamp`. */
  readonly timestampHeader: string;
  /** Value of `X-PWP-Signature`. */
  readonly signatureHeader: string;
  /** The exact request body bytes as a UTF-8 string. Verify BEFORE parsing JSON. */
  readonly rawBody: string;
  /** Current Unix time in seconds. Defaults to the system clock. */
  readonly nowSeconds?: number;
  /** Defaults to `WEBHOOK_TOLERANCE_SECONDS` (300). */
  readonly toleranceSeconds?: number;
}

/**
 * Receiver-side check. Returns `true` only when the timestamp is inside the tolerance and some
 * `v1=` entry equals the HMAC for some secret (constant-time compare). Entries with an unknown
 * version are ignored. Replay defence is separate: also de-duplicate `X-PWP-Idempotency-Key`.
 *
 * Throws a `TypeError` when `secrets` is empty or any entry fails the strength rule (for
 * example an unset `WEBHOOK_SECRET` read as `''`): with an empty key anyone could forge a
 * valid signature, so a misconfigured receiver must fail loudly instead of accepting requests.
 * The message never contains a secret.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  if (
    !Array.isArray(input.secrets) ||
    input.secrets.length === 0 ||
    !input.secrets.every(isStrongWebhookSecret)
  ) {
    throw new TypeError('webhook secret is missing or too weak');
  }
  if (!/^\d{1,15}$/.test(input.timestampHeader)) return false;
  const timestamp = Number(input.timestampHeader);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const prefix = `${WEBHOOK_SIGNATURE_VERSION}=`;
  const candidates = input.signatureHeader
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(prefix))
    .map((s) => s.slice(prefix.length))
    .filter((s) => /^[0-9a-f]{64}$/.test(s));
  if (candidates.length === 0) return false;

  let ok = false;
  for (const secret of input.secrets) {
    const expected = Buffer.from(signWebhook(secret, timestamp, input.rawBody), 'hex');
    for (const c of candidates) {
      // No early exit: keep the work independent of which entry matched.
      if (timingSafeEqual(expected, Buffer.from(c, 'hex'))) ok = true;
    }
  }
  return ok;
}
