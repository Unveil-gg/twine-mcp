import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanProjectAssets } from '../src/util/asset-scan.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-assets-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write an empty placeholder file at the given relative path. */
function touch(relPath: string): void {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '', 'utf-8');
}

describe('scanProjectAssets', () => {
  it('always includes .twee/.css/.js sources regardless of format', () => {
    touch('Start.twee');
    touch('style.css');
    touch('main.js');

    const result = scanProjectAssets(tmpDir, new Set(), false);
    expect(result.sources).toHaveLength(3);
    expect(result.bundled).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('bundles image/audio/video/vtt files when the format supports ' +
    'media', () => {
    touch('logo.png');
    touch('theme.mp3');
    touch('intro.mp4');
    touch('captions.vtt');

    const result = scanProjectAssets(tmpDir, new Set(), true);
    expect(result.sources).toHaveLength(4);
    expect(result.skipped).toHaveLength(0);
    expect(result.bundled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'logo', tag: 'Twine.image' }),
        expect.objectContaining({ name: 'theme', tag: 'Twine.audio' }),
        expect.objectContaining({ name: 'intro', tag: 'Twine.video' }),
        expect.objectContaining({ name: 'captions', tag: 'Twine.vtt' }),
      ]),
    );
  });

  it('skips media files when the target format does not support ' +
    'media passages', () => {
    touch('logo.png');

    const result = scanProjectAssets(tmpDir, new Set(), false);
    expect(result.sources).toHaveLength(0);
    expect(result.bundled).toHaveLength(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ name: 'logo', reason: expect.any(String) }),
    ]);
  });

  it('skips a media file whose derived name collides with an ' +
    'authored passage, without overwriting it', () => {
    touch('logo.png');

    const result = scanProjectAssets(tmpDir, new Set(['logo']), true);
    expect(result.sources).toHaveLength(0);
    expect(result.bundled).toHaveLength(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ name: 'logo', reason: expect.any(String) }),
    ]);
  });

  it('ignores files with unsupported extensions', () => {
    touch('notes.txt');
    touch('design.psd');

    const result = scanProjectAssets(tmpDir, new Set(), true);
    expect(result.sources).toHaveLength(0);
    expect(result.bundled).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('scans nested subdirectories recursively', () => {
    touch('chapters/act1/scene1.twee');
    touch('images/characters/hero.png');

    const result = scanProjectAssets(tmpDir, new Set(), true);
    expect(result.sources).toHaveLength(2);
    expect(result.bundled).toEqual([
      expect.objectContaining({ name: 'hero' }),
    ]);
  });
});
