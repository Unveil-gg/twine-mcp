/**
 * MCP tool annotations. destructiveHint defaults to true in the spec,
 * so non-destructive tools must set it explicitly.
 */

import type { ToolAnnotations } from
  '@modelcontextprotocol/sdk/types.js';

/** Read tools that do not change the story or workspace. */
export const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
};

/** Writes that keep existing passages. */
export const mutating: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
};

/** Deletes a story or passage. */
export const destructive: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};
