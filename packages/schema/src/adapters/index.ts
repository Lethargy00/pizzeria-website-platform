/**
 * `@pwp/schema/adapters`: the canonical adapter names and the per-tenant adapter selection (#64).
 *
 * `@pwp/adapters/interfaces` re-exports these names (#82); `SiteConfig` (#52) uses
 * {@link AdapterSelection}. Names are referenced from config by string only (ADR 0001).
 */
export {
  EMAIL_ADAPTER_NAMES,
  WEBHOOK_ADAPTER_NAMES,
  RATE_LIMIT_ADAPTER_NAMES,
  EmailAdapterName,
  WebhookAdapterName,
  RateLimitAdapterName,
  ADAPTER_KINDS,
  ADAPTER_NAMES,
  ADAPTER_PRODUCTION_SUPPORTS,
  ADAPTER_PRODUCTION_SUPPORT,
  type AdapterKind,
  type AdapterNameByKind,
  type AdapterName,
  type AdapterProductionSupport,
} from './names.js';
export { AdapterSelection } from './selection.js';
