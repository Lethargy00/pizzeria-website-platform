import type { z } from 'zod';
import { strictObject } from '../primitives/index.js';
import { EmailAdapterName, RateLimitAdapterName, WebhookAdapterName } from './names.js';

/**
 * Which adapter a tenant uses per kind, chosen **by name** in site config (#52).
 *
 * - `email` and `webhook` are optional: notifications are off when absent.
 * - `rateLimit` is required: every tenant with forms needs a rate-limit store.
 * - Unknown keys are errors (`strictObject`), so a misspelt kind is never ignored.
 *
 * The CSP generator (#56) derives allowed origins from the selected names.
 */
export const AdapterSelection = strictObject({
  email: EmailAdapterName.optional(),
  webhook: WebhookAdapterName.optional(),
  rateLimit: RateLimitAdapterName,
});
export type AdapterSelection = z.infer<typeof AdapterSelection>;
