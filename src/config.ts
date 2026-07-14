/**
 * Workspace root resolution for twine-mcp.
 *
 * Statically configured roots come from (in combined, deduped order):
 *   1. ~/.twine-mcp/config.json → { "workspaceRoots": [...] }
 *   2. TWINE_WORKSPACE_ROOTS env var — comma- or semicolon-separated paths
 *   3. TWINE_PROJECT env var — legacy singular var, kept for backwards
 *      compatibility; contributes one more root.
 *
 * These are only part of the story: WorkspaceStore also merges in
 * roots advertised by the MCP client itself (see the `roots` capability
 * in workspace-store.ts). Configured roots are never dropped just
 * because a client did or didn't advertise its own roots.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

/** Path to the optional multi-root config file. */
export const CONFIG_FILE_PATH = path.join(
  os.homedir(), '.twine-mcp', 'config.json',
);

/** Shape of the optional ~/.twine-mcp/config.json file. */
interface ConfigFile {
  workspaceRoots?: unknown;
}

/**
 * Expand ~ and environment variable references in a path string.
 * Handles POSIX ($HOME, ${VAR}) and Windows (%VAR%) conventions.
 *
 * @param input - Raw path string from user, env var, or config file
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
 * Split an env-var-style path list on commas or semicolons.
 *
 * @param raw - Raw env var value, possibly undefined/empty
 * @returns Trimmed, non-empty path strings
 */
function splitPathList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Read `workspaceRoots` from the optional JSON config file.
 * Missing file, malformed JSON, or an invalid shape all resolve to
 * an empty list rather than throwing — the config file is optional.
 *
 * @returns Raw (unexpanded) path strings from the config file
 */
function readConfigFile(): string[] {
  try {
    if (!fs.existsSync(CONFIG_FILE_PATH)) return [];
    const raw = JSON.parse(
      fs.readFileSync(CONFIG_FILE_PATH, 'utf-8'),
    ) as ConfigFile;
    if (!Array.isArray(raw.workspaceRoots)) return [];
    return raw.workspaceRoots.filter(
      (r): r is string => typeof r === 'string' && r.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Build the dedupe key for a resolved absolute path: resolves symlinks
 * when the path already exists on disk, and lowercases on Windows
 * since its filesystem is case-insensitive.
 *
 * @param absPath - Absolute path to key (need not exist yet)
 * @returns Comparison key for deduplication
 */
function rootKey(absPath: string): string {
  let real = absPath;
  try {
    real = fs.realpathSync.native(absPath);
  } catch {
    // Path may not exist yet (e.g. a project not yet scaffolded) —
    // fall back to the resolved-but-unlinked path.
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/**
 * Deduplicate a list of absolute paths, keeping the first occurrence's
 * original casing/form and dropping later duplicates.
 *
 * @param roots - Absolute paths, possibly containing duplicates
 * @returns Deduplicated list, order preserved
 */
export function dedupeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const r of roots) {
    const key = rootKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

/**
 * Resolve statically configured workspace roots from the config file
 * and environment variables. Does not throw when nothing is configured
 * — an MCP client that advertises the `roots` capability may supply
 * the effective roots at runtime instead (see WorkspaceStore).
 *
 * @returns Deduplicated, absolute, expanded workspace root paths
 */
export function resolveConfiguredRoots(): string[] {
  const raw: string[] = [
    ...readConfigFile(),
    ...splitPathList(process.env['TWINE_WORKSPACE_ROOTS']),
    ...splitPathList(process.env['TWINE_PROJECT']),
  ];
  return dedupeRoots(raw.map(expandPath));
}
