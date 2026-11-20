# mock-webhook

Recording webhook adapter with real HMAC signing. It makes **no network calls**: the default
transport only answers `200`. Tests inject a transport and a resolver.

## Verify a delivery (receiver snippet)

```ts
import { verifyWebhookSignature } from './index.js'; // or copy signWebhook's 5 lines

// rawBody: the exact request body as a UTF-8 string. Verify BEFORE JSON.parse.
// Throws if a secret is empty or weak (e.g. WEBHOOK_SECRET unset or set to ''): never catch
// that and accept the request. Treat it as a server misconfiguration (500).
const ok = verifyWebhookSignature({
  secrets: [process.env.WEBHOOK_SECRET ?? ''], // add the old key while rotating
  timestampHeader: headers['x-pwp-timestamp'],
  signatureHeader: headers['x-pwp-signature'],
  rawBody,
});
if (!ok) return respond(401);
// Then de-duplicate on X-PWP-Idempotency-Key (keep keys >= 300 s, 24 h recommended).
```

Without this package: `hex = HMAC_SHA256(key = secret as UTF-8, message = "<timestamp>.<rawBody>")`,
compare in constant time with every `v1=` entry in `X-PWP-Signature`, ignore other versions,
and reject when `|now - timestamp| > 300` seconds. Refuse to start (or answer 500) when the
secret is empty or shorter than 64 hex / 43 base64url characters: an empty HMAC key lets
anyone forge a valid signature.

## Retry policy

3 attempts per `notify`; wait 1 s after the first failure and 4 s after the second. Retried:
`throttled` (429), `timeout` (10 s per attempt, or 408), `unavailable` (5xx, network). Not
retried: `rejected` (other 4xx, 3xx), `misconfigured` (including every SSRF refusal). Each
attempt gets a fresh timestamp and signature, and the same `X-PWP-Idempotency-Key`.

## SSRF rules

Implemented in `ssrf.ts` and `index.ts`, one test per rule in `mock-webhook.test.ts`.
Address vetting is an allow-list: a delivery goes ahead only when **every** resolved address is
global unicast (public IPv4, or IPv6 in `2000::/3` outside the special-purpose ranges, or the
IPv4-mapped / well-known NAT64 form of a public IPv4). Documentation ranges such as
`203.0.113.0/24` are refused too, so the default resolver answers `8.8.8.8` for host names
(nothing connects to it).
