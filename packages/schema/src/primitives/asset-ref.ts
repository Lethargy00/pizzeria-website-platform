import { z } from 'zod';
import type { PrimitiveIssueParams } from './issue-params.js';

/** Image types a tenant may ship. No SVG until a sanitizer lands (ADR 0001). */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'] as const;
/** Font types a tenant may ship: self-hosted WOFF2 only. */
export const FONT_EXTENSIONS = ['.woff2'] as const;
/** Every extension an {@link AssetRef} may end in. Matches `ALLOWED_EXT` in `scripts/tenant-guard.mjs`. */
export const ASSET_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FONT_EXTENSIONS] as const;

/** Every asset reference starts with this folder. */
export const ASSET_DIR = 'assets/';
/** Maximum length of an asset reference. */
export const MAX_ASSET_REF_LENGTH = 200;

/**
 * One path segment: starts with a lowercase letter or digit, then lowercase letters, digits,
 * `-`, `_` or `.`. This alone excludes `..`, `.`, hidden files, `%` (URL-encoded traversal),
 * `\`, `:`, `~`, spaces, uppercase and every non-ASCII character.
 */
const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * True if `value` is a safe path to a file in the tenant's `assets/` folder whose extension is in
 * `extensions`, e.g. `assets/hero.jpg` or `assets/fonts/display.woff2`.
 */
export function isSafeAssetPath(
  value: string,
  extensions: readonly string[] = ASSET_EXTENSIONS,
): boolean {
  if (value.length > MAX_ASSET_REF_LENGTH || !value.startsWith(ASSET_DIR)) return false;
  const segments = value.split('/');
  if (!segments.every((segment) => SEGMENT.test(segment) && !segment.includes('..'))) return false;
  const file = segments[segments.length - 1] ?? '';
  return (
    segments.length >= 2 && extensions.some((ext) => file.endsWith(ext) && file.length > ext.length)
  );
}

function assetRefOf(extensions: readonly string[]) {
  return z.string().refine((value) => isSafeAssetPath(value, extensions), {
    error: `Use a path inside the assets/ folder ending in ${extensions.join(', ')}.`,
    params: {
      pwpCode: 'unsafe_path',
      allowedExtensions: extensions,
    } satisfies PrimitiveIssueParams,
  });
}

/**
 * A reference to a file inside the tenant folder, relative to the tenant root and always under
 * `assets/`, e.g. `assets/hero.jpg`. Lowercase ASCII only. Rejects `..`, `.` and hidden segments,
 * absolute paths, backslashes, URL-encoded characters (`%2e%2e`), URLs, empty segments
 * (`assets//x.jpg`) and any extension outside {@link ASSET_EXTENSIONS} (no SVG).
 *
 * The schema checks the string only. The build resolves it against `tenants/<slug>/` and fails
 * if the file is missing or resolves outside that folder (ADR 0001, build isolation).
 */
export const AssetRef = assetRefOf(ASSET_EXTENSIONS);
export type AssetRef = z.infer<typeof AssetRef>;

/** An {@link AssetRef} that must be an image (`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`). */
export const ImageRef = assetRefOf(IMAGE_EXTENSIONS);
export type ImageRef = z.infer<typeof ImageRef>;

/** An {@link AssetRef} that must be a WOFF2 font. */
export const FontRef = assetRefOf(FONT_EXTENSIONS);
export type FontRef = z.infer<typeof FontRef>;
