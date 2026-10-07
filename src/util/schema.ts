/**
 * Shared Zod helpers for bounded tool parameters.
 */

import * as z from 'zod/v4';

/**
 * Inclusive integer parameter with a default.
 *
 * @param min - Minimum accepted value
 * @param max - Maximum accepted value
 * @param fallback - Value used when the argument is omitted
 * @param description - Shown in the tool schema
 * @returns Zod integer schema
 */
export function intParam(
  min: number,
  max: number,
  fallback: number,
  description: string,
) {
  return z.int().min(min).max(max)
    .optional()
    .default(fallback)
    .describe(description);
}
