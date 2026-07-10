/**
 * FormatManager — download-on-first-use Twine story format JS files.
 *
 * Downloads format.js from the Story Format Archive and caches to
 * ~/.twine-mcp/storyformats/<format>/<version>/format.js.
 * Returns a parsed StoryFormat object ready for compileTwine2HTML().
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { StoryFormat } from 'extwee';

/** Archive base URL for official Twine 2 story formats. */
const ARCHIVE_BASE =
  'https://videlais.github.io/story-formats-archive/official/twine2';

/**
 * Direct CDN URLs for known format/version combos that may not be
 * in the archive (e.g. very recent releases).
 */
const DIRECT_URLS: Record<string, string> = {
  'chapbook-2.3.1':
    'https://klembot.github.io/chapbook/use/2.3.1/format.js',
  'chapbook-2.2.0':
    'https://klembot.github.io/chapbook/use/2.2.0/format.js',
};

/**
 * Default versions to use when the caller omits the version.
 * These are the versions shipped with Twine 2.9+.
 */
export const DEFAULT_FORMAT_VERSIONS: Record<string, string> = {
  harlowe: '3.3.9',
  sugarcube: '2.37.3',
  chapbook: '2.3.1',
  snowman: '2.0.2',
};

/** Cache directory: ~/.twine-mcp/storyformats/ */
function cacheDir(): string {
  return path.join(os.homedir(), '.twine-mcp', 'storyformats');
}

/** Absolute path to the cached format.js file. */
function cachedPath(format: string, version: string): string {
  return path.join(cacheDir(), format.toLowerCase(), version, 'format.js');
}

/**
 * Derive the download URL for a format + version pair.
 *
 * @param format  - Canonical format name (e.g. "SugarCube")
 * @param version - Semantic version string (e.g. "2.37.3")
 * @returns Download URL
 */
function downloadUrl(format: string, version: string): string {
  const key = `${format.toLowerCase()}-${version}`;
  return (
    DIRECT_URLS[key] ??
    `${ARCHIVE_BASE}/${format.toLowerCase()}/${version}/format.js`
  );
}

/**
 * Parse a Twine 2 format.js JSONP file into a StoryFormat object.
 *
 * Format.js files use the JSONP pattern:
 *   window.storyFormat({ "name": "...", "source": "..." })
 *
 * @param content - Raw format.js file content
 * @returns Populated StoryFormat instance
 */
function parseFormatJs(content: string): StoryFormat {
  const match = content.match(
    /(?:window\.)?storyFormat\s*\(\s*(\{[\s\S]*\})\s*\)/,
  );
  if (!match?.[1]) {
    throw new Error('Cannot parse format.js: invalid JSONP wrapper');
  }
  const data = JSON.parse(match[1]) as Record<string, unknown>;
  const fmt = new StoryFormat();
  Object.assign(fmt, {
    name: String(data['name'] ?? ''),
    version: String(data['version'] ?? ''),
    source: String(data['source'] ?? ''),
    proofing: Boolean(data['proofing'] ?? false),
    author: String(data['author'] ?? ''),
    description: String(data['description'] ?? ''),
    url: String(data['url'] ?? ''),
  });
  return fmt;
}

/**
 * Download a format.js file from the web, write it to the cache,
 * and return its content.
 *
 * @param format  - Canonical format name
 * @param version - Semantic version string
 * @returns Raw format.js content
 */
async function downloadAndCache(
  format: string,
  version: string,
): Promise<string> {
  const url = downloadUrl(format, version);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${format} ${version}: ` +
      `HTTP ${response.status} from ${url}`,
    );
  }
  const content = await response.text();

  const dest = cachedPath(format, version);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf-8');
  return content;
}

/**
 * Resolve a story format, loading from cache or downloading as needed.
 *
 * @param format  - Format name (case-insensitive, e.g. "SugarCube")
 * @param version - Version string; if omitted, uses DEFAULT_FORMAT_VERSIONS
 * @returns Parsed StoryFormat object ready for compileTwine2HTML()
 */
export async function resolveFormat(
  format: string,
  version?: string,
): Promise<StoryFormat> {
  const normalizedFormat = format.toLowerCase().replace(/\s+\d.*$/, '').trim();
  const resolvedVersion =
    version ??
    DEFAULT_FORMAT_VERSIONS[normalizedFormat] ??
    '1.0.0';

  const cached = cachedPath(normalizedFormat, resolvedVersion);

  let content: string;
  if (fs.existsSync(cached)) {
    content = fs.readFileSync(cached, 'utf-8');
  } else {
    content = await downloadAndCache(normalizedFormat, resolvedVersion);
  }

  return parseFormatJs(content);
}

/**
 * Check if a format/version is already cached locally.
 *
 * @param format  - Format name (case-insensitive)
 * @param version - Version string
 * @returns true if the format is cached
 */
export function isFormatCached(format: string, version: string): boolean {
  const normalizedFormat = format.toLowerCase().replace(/\s+\d.*$/, '').trim();
  return fs.existsSync(cachedPath(normalizedFormat, version));
}

/**
 * List all locally cached formats with their versions.
 *
 * @returns Array of { format, version } objects
 */
export function listCachedFormats(): Array<{
  format: string;
  version: string;
}> {
  const base = cacheDir();
  if (!fs.existsSync(base)) return [];
  const result: Array<{ format: string; version: string }> = [];
  for (const fmt of fs.readdirSync(base)) {
    const fmtDir = path.join(base, fmt);
    if (!fs.statSync(fmtDir).isDirectory()) continue;
    for (const ver of fs.readdirSync(fmtDir)) {
      const verDir = path.join(fmtDir, ver);
      if (
        fs.statSync(verDir).isDirectory() &&
        fs.existsSync(path.join(verDir, 'format.js'))
      ) {
        result.push({ format: fmt, version: ver });
      }
    }
  }
  return result;
}
