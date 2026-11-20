import { z } from 'zod';

/**
 * An object schema that rejects unknown keys. Every tenant-input and request-body schema uses this
 * at **every** level, never `z.object()` (which silently strips unknown keys, ADR 0002).
 *
 * An unknown key raises one `unrecognized_keys` issue whose `keys` names the key and whose `path`
 * is the path of the object that contains it, e.g. `{ path: ['contact'], keys: ['emial'] }`.
 */
export function strictObject<Shape extends z.ZodRawShape>(
  shape: Shape,
): z.ZodObject<Shape, z.core.$strict> {
  return z.strictObject(shape);
}
