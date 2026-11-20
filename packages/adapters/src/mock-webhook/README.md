# mock-webhook

Recording webhook adapter with real HMAC signing. It makes **no network calls**: the default
transport only answers `200`. Tests inject a transport and a resolver.

## Verify a delivery (receiver snippet)

```ts
import { verifyWebhookSignature } from './index.js'; // or copy signWebhook's 5 lines

// rawBody: the exact request body as a UTF-8 string. Verify BEFORE JSON.parse.
const ok = verifyWebhookSignature({
  secrets: [process.env.WEBHOOK_SECRET!], // add the old key while rotating
  timestampHeader: headers['x-pwp-timestamp'],
  signatureHeader: headers['x-pwp-signature'],
  rawBody,
});
if (!ok) return respond(401);
// Then de-duplicate on X-PWP-Idempotency-Key (keep keys >= 300 s, 24 h recommended).
```

Without this package: `hex = HMAC_SHA256(key = secret as UTF-8, message = "<timestamp>.<rawBody>")`,
compare in constant time with every `v1=` entry in `X-PWP-Signature`, ignore other versions,
and reject when `|now - timestamp| > 300` seconds.

## Retry policy

3 attempts per `notify`; wait 1 s after the first failure and 4 s after the second. Retried:
`throttled` (429), `timeout` (10 s per attempt, or 408), `unavailable` (5xx, network). Not
retried: `rejected` (other 4xx, 3xx), `misconfigured` (including every SSRF refusal). Each
attempt gets a fresh timestamp and signature, and the same `X-PWP-Idempotency-Key`.

## SSRF rules

Implemented in `ssrf.ts` and `index.ts`, one test per rule in `mock-webhook.test.ts`.
