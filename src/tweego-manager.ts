/**
 * TweegoManager — download-on-first-use Tweego compiler binary.
 *
 * Mirrors format-manager.ts's lazy-download-and-cache pattern: the
 * official platform release zip is fetched once and cached under
 * ~/.twine-mcp/tweego/<version>/, then reused on every build_story
 * call. Set TWINE_MCP_TWEEGO_BIN to point at an already-installed
 * Tweego binary (e.g. a self-built Apple Silicon binary) to skip the
 * download entirely.
 *
 * build_story shells out to this binary rather than reimplementing
 * Tweego's asset-bundling/trimming/font-face logic on top of
 * extwee's compiler — that avoids subtle divergence from what real
 * Tweego output looks like.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';

const TWEEGO_VERSION = '2.1.1';
const RELEASE_BASE =
  `https://github.com/tmedwards/tweego/releases/download/v${TWEEGO_VERSION}`;

/** Env var to point at a pre-installed Tweego binary, bypassing the
 * downloader entirely. Not to be confused with Tweego's own
 * TWEEGO_PATH variable, which names story-format search directories
 * — that one we set ourselves when spawning the compiler. */
const BIN_OVERRIDE_ENV = 'TWINE_MCP_TWEEGO_BIN';

/** Maps `${os.platform()}-${os.arch()}` to Tweego's release asset name. */
const PLATFORM_ASSETS: Record<string, string> = {
  'win32-x64': 'windows-x64',
  'win32-ia32': 'windows-x86',
  'darwin-x64': 'macos-x64',
  'linux-x64': 'linux-x64',
  'linux-ia32': 'linux-x86',
};

function cacheRoot(): string {
  return path.join(os.homedir(), '.twine-mcp', 'tweego', TWEEGO_VERSION);
}

/** Directory holding per-format override format.js files (see
 * ensureFormatOverride). Tweego's own TWEEGO_PATH search step treats
 * each configured directory as a direct parent of format-id folders
 * (unlike its program/home/cwd search, which looks for a literal
 * "storyformats" subfolder) — so this is the value we pass as
 * TWEEGO_PATH itself. */
function overridesRoot(): string {
  return path.join(os.homedir(), '.twine-mcp', 'tweego', 'overrides');
}

function binaryName(): string {
  return os.platform() === 'win32' ? 'tweego.exe' : 'tweego';
}

/**
 * Explain why a platform has no downloadable build and how to work
 * around it. Apple Silicon Macs are the known gap — Tweego's
 * maintainer has never shipped a native arm64 macOS build (tracked
 * upstream at tmedwards/tweego#30, open since 2021).
 */
function unsupportedPlatformMessage(platform: string, arch: string): string {
  if (platform === 'darwin' && arch === 'arm64') {
    return (
      'No native Tweego build is available for Apple Silicon (arm64) ' +
      'Macs — this is an upstream gap (tmedwards/tweego#30, open since ' +
      '2021), not something twine-mcp can currently download for you. ' +
      'Options: (1) run under Rosetta 2 (supported through macOS 27); ' +
      '(2) build Tweego yourself — `git clone ' +
      'https://github.com/tmedwards/tweego && cd tweego && ' +
      'GOOS=darwin GOARCH=arm64 go build` — then set ' +
      `${BIN_OVERRIDE_ENV} to the resulting binary's path.`
    );
  }
  return (
    `No prebuilt Tweego binary is available for ${platform}/${arch}. ` +
    'Build Tweego from source (https://github.com/tmedwards/tweego) ' +
    `and set ${BIN_OVERRIDE_ENV} to point at the binary.`
  );
}

/**
 * Download a Tweego release zip and extract it into the cache dir.
 *
 * @param asset - Release asset platform suffix, e.g. "windows-x64"
 * @param dest  - Cache directory to extract into
 */
async function downloadAndExtract(
  asset: string,
  dest: string,
): Promise<void> {
  const url = `${RELEASE_BASE}/tweego-${TWEEGO_VERSION}-${asset}.zip`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Tweego ${TWEEGO_VERSION} (${asset}): ` +
      `HTTP ${response.status} from ${url}`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < 1024) {
    throw new Error(
      `Downloaded Tweego archive from ${url} looks truncated ` +
      `(${buffer.byteLength} bytes) — refusing to extract it.`,
    );
  }

  fs.mkdirSync(dest, { recursive: true });
  const zip = new AdmZip(buffer);
  zip.extractAllTo(dest, true);
}

export interface ResolvedTweego {
  /** Absolute path to the Tweego binary. */
  binPath: string;
  /** Absolute path to the storyformats/ dir bundled alongside the
   * binary (Tweego 2.1.1 ships Harlowe/SugarCube/Chapbook/Snowman
   * out of the box), or null if none was found. */
  bundledFormatsDir: string | null;
}

/**
 * Resolve the Tweego binary, downloading and caching the official
 * release on first use. Honors TWINE_MCP_TWEEGO_BIN to bypass the
 * download entirely.
 *
 * @returns Binary path and its bundled story-formats directory, if any
 */
export async function resolveTweego(): Promise<ResolvedTweego> {
  const override = process.env[BIN_OVERRIDE_ENV];
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(
        `${BIN_OVERRIDE_ENV} is set to "${override}", but no file ` +
        'exists there.',
      );
    }
    const bundled = path.join(path.dirname(override), 'storyformats');
    return {
      binPath: override,
      bundledFormatsDir: fs.existsSync(bundled) ? bundled : null,
    };
  }

  const key = `${os.platform()}-${os.arch()}`;
  const asset = PLATFORM_ASSETS[key];
  if (!asset) {
    throw new Error(unsupportedPlatformMessage(os.platform(), os.arch()));
  }

  const dest = cacheRoot();
  const binPath = path.join(dest, binaryName());
  const bundledFormatsDir = path.join(dest, 'storyformats');

  if (!fs.existsSync(binPath)) {
    await downloadAndExtract(asset, dest);
  }
  if (os.platform() !== 'win32') {
    fs.chmodSync(binPath, 0o755);
  }

  return {
    binPath,
    bundledFormatsDir:
      fs.existsSync(bundledFormatsDir) ? bundledFormatsDir : null,
  };
}

/**
 * Derive Tweego's own story-format ID (directory/-f name) from a
 * format name and version — e.g. ("SugarCube", "2.37.3") → "sugarcube-2".
 * Matches the directory naming Tweego's bundled formats already use.
 *
 * @param format  - Format name (case-insensitive)
 * @param version - Semantic version string
 * @returns Tweego-style format ID
 */
export function tweegoFormatId(format: string, version: string): string {
  const name = format.toLowerCase().replace(/\s+\d.*$/, '').trim();
  const major = version.split('.')[0] || '1';
  return `${name}-${major}`;
}

/**
 * Copy a freshly-cached format.js into the Tweego override directory
 * so a newer version takes precedence over whatever Tweego 2.1.1
 * ships bundled (Tweego's search order registers directories found
 * via TWEEGO_PATH last, so same-named directories there win).
 *
 * @param formatId    - Tweego-style format ID, e.g. "sugarcube-2"
 * @param formatJsPath - Path to the format.js to install
 * @returns The overrides root directory — pass this as TWEEGO_PATH
 */
export function ensureFormatOverride(
  formatId: string,
  formatJsPath: string,
): string {
  const root = overridesRoot();
  const dir = path.join(root, formatId);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(formatJsPath, path.join(dir, 'format.js'));
  return root;
}

export interface TweegoRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the Tweego binary with the given arguments, pointing its own
 * TWEEGO_PATH story-format search variable at formatsDir.
 *
 * @param binPath   - Absolute path to the Tweego binary
 * @param args      - Command-line arguments (see Tweego's -h output)
 * @param formatsDir - Directory to set as Tweego's TWEEGO_PATH
 * @returns Exit code plus captured stdout/stderr
 */
export function runTweego(
  binPath: string,
  args: string[],
  formatsDir: string,
): Promise<TweegoRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, {
      env: { ...process.env, TWEEGO_PATH: formatsDir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
