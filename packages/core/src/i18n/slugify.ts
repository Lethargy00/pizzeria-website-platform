import { MAX_SLUG_LENGTH } from '@pwp/schema/primitives';

/** Letters that Unicode decomposition does not reduce to a base letter. */
const SPECIAL: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  đ: 'd',
  ı: 'i',
};

/**
 * Turns a name into a URL slug that satisfies `Slug` in `@pwp/schema/primitives`: lowercase
 * `a-z0-9` in groups joined by single hyphens, no leading or trailing hyphen, at most
 * `maxLength` (default `MAX_SLUG_LENGTH`) characters.
 *
 * Swedish letters become their base letter: å and ä to `a`, ö to `o`
 * (`"Pizzeria Årsta Gård"` is `pizzeria-arsta-gard`). Other accents are dropped. Characters with
 * no Latin form (for example CJK) are dropped, so the result can be empty: the caller decides
 * what to do then.
 */
export function slugify(text: string, maxLength: number = MAX_SLUG_LENGTH): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[æœøßðþłđı]/g, (c) => SPECIAL[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/, '');
}
