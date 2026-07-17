/**
 * asset-scan — decide which files under a project's src/ tree get
 * handed to Tweego as compile sources.
 *
 * Tweego natively bundles images/audio/video/fonts/vtt files it finds
 * under the directories it's pointed at (base64-embedded as tagged
 * passages), the same way it bundles .twee/.css/.js. We don't
 * reimplement that encoding — we just decide, per file, whether it
 * should be included in the source list we pass to the Tweego
 * process, based on two things Tweego itself has no way to know:
 * whether the name collides with an authored passage, and whether
 * the target story format natively consumes media passages at all.
 */

import fs from 'fs';
import path from 'path';

const TWEE_EXTS = new Set(['.tw', '.twee', '.tw2', '.twee2', '.htm', '.html']);
const BUNDLE_EXTS = new Set(['.css', '.js', '.otf', '.ttf', '.woff', '.woff2']);
const IMAGE_EXTS = new Set(
  ['.gif', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp'],
);
const AUDIO_EXTS = new Set(
  ['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wave',
    '.weba'],
);
const VIDEO_EXTS = new Set(['.mp4', '.ogv', '.webm']);
const VTT_EXTS = new Set(['.vtt']);

type MediaCategory = 'image' | 'audio' | 'video' | 'vtt';

/** Tag Tweego gives each media passage type, per its documentation. */
const MEDIA_TAGS: Record<MediaCategory, string> = {
  image: 'Twine.image',
  audio: 'Twine.audio',
  video: 'Twine.video',
  vtt: 'Twine.vtt',
};

function mediaCategory(ext: string): MediaCategory | null {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (VTT_EXTS.has(ext)) return 'vtt';
  return null;
}

export interface BundledAsset {
  name: string;
  file: string;
  tag: string;
}

export interface SkippedAsset {
  name: string;
  file: string;
  reason: string;
}

export interface AssetScanResult {
  /** Absolute file paths to pass to Tweego as compile sources. */
  sources: string[];
  /** Media files expected to be bundled as tagged passages. */
  bundled: BundledAsset[];
  /** Media files deliberately excluded from the source list. */
  skipped: SkippedAsset[];
}

/** Recursively list regular files under a directory. */
function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return entries
    .map((f) => path.join(dir, f))
    .filter((f) => {
      try {
        return fs.statSync(f).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Scan a project's src/ tree and decide which files to hand to
 * Tweego, per the caller's known passage names and target format.
 *
 * @param srcDir - Absolute path to the project's src/ directory
 * @param authoredNames - Passage names already defined by the author;
 *   a media file whose derived passage name collides with one of
 *   these is skipped rather than silently overwriting authored work
 * @param formatSupportsMedia - True if the target story format
 *   natively consumes Twine.image/audio/video/vtt passages. Per
 *   Tweego's docs this is a SugarCube-only feature (plus vanilla
 *   Twine 1 ≥1.4 for images) — Harlowe/Chapbook/Snowman ignore them.
 * @returns Filtered source list plus bundled/skipped reports for the
 *   build_story response
 */
export function scanProjectAssets(
  srcDir: string,
  authoredNames: Set<string>,
  formatSupportsMedia: boolean,
): AssetScanResult {
  const sources: string[] = [];
  const bundled: BundledAsset[] = [];
  const skipped: SkippedAsset[] = [];

  for (const file of walk(srcDir)) {
    const ext = path.extname(file).toLowerCase();

    if (TWEE_EXTS.has(ext) || BUNDLE_EXTS.has(ext)) {
      sources.push(file);
      continue;
    }

    const category = mediaCategory(ext);
    if (!category) continue;
    const base = path.basename(file, ext);

    if (!formatSupportsMedia) {
      skipped.push({
        name: base,
        file,
        reason:
          `Target story format does not natively support ` +
          `${MEDIA_TAGS[category]} passages (a SugarCube-specific ` +
          'feature per Tweego\'s docs).',
      });
      continue;
    }
    if (authoredNames.has(base)) {
      skipped.push({
        name: base,
        file,
        reason:
          `A passage named "${base}" already exists; rename the file ` +
          'or the passage to bundle this asset.',
      });
      continue;
    }

    sources.push(file);
    bundled.push({ name: base, file, tag: MEDIA_TAGS[category] });
  }

  return { sources, bundled, skipped };
}
