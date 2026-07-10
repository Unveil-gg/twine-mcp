/**
 * Workspace root resolution for twine-mcp.
 *
 * Reads TWINE_PROJECT from the environment and resolves the path,
 * expanding ~ and environment variable references for both POSIX
 * and Windows conventions.
 */

import path from 'path';
import os from 'os';

/**
 * Expand ~ and environment variable references in a path string.
 * Handles POSIX ($HOME, ${VAR}) and Windows (%VAR%) conventions.
 *
 * @param input - Raw path string from user or env var
 * @returns Absolute, fully-expanded path
 */
export function expandPath(input: string): string {
  let p = input.trim();

  // %VAR% — Windows style
  p = p.replace(/%([^%]+)%/g, (_, name: string) =>
    process.env[name] ?? `%${name}%`,
  );

  // ${VAR} or $VAR — POSIX style
  p = p.replace(
    /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (orig, braced: string | undefined, plain: string | undefined) => {
      const name = braced ?? plain ?? '';
      return process.env[name] ?? orig;
    },
  );

  // Leading ~ → home directory
  if (p.startsWith('~')) {
    p = os.homedir() + p.slice(1);
  }

  return path.resolve(p);
}

/**
 * Returns the workspace root from the TWINE_PROJECT environment variable.
 * Expands ~ and environment variable references before resolving.
 * Throws a descriptive error if TWINE_PROJECT is not set.
 *
 * @returns Absolute path to the workspace root
 * @throws Error if TWINE_PROJECT is not set
 */
export function requireWorkspaceRoot(): string {
  const raw = process.env['TWINE_PROJECT'];
  if (!raw) {
    throw new Error(
      'TWINE_PROJECT is not set.\n' +
      'Run "twine-mcp setup" or add TWINE_PROJECT to your MCP config env block.',
    );
  }
  return expandPath(raw);
}
