import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suggestNames, storyNotFoundMsg } from '../src/util/errors.js';
import { toPassageView } from '../src/util/passage-view.js';
import { buildManifest } from '../src/resources/payloads.js';
import { applyTextPatch } from '../src/tools/passage-patch.js';
import {
  ResourceSubscriptions,
  notifyStoryUpdated,
} from '../src/resources/subscriptions.js';
import {
  isStorySource,
  watchStorySources,
} from '../src/util/story-watch.js';
import type { PassageFull, StoryFull, StoryMeta } from '../src/types.js';

const passage: PassageFull = {
  name: 'Start',
  tags: ['intro'],
  wordCount: 2,
  position: '100,200',
  size: '100,100',
  preview: 'Hello there',
  text: 'Hello there',
  links: ['Hall'],
};

function story(): StoryFull {
  const meta: StoryMeta = {
    name: 'Demo',
    ifid: 'ABC',
    format: 'Harlowe',
    formatVersion: '3.3.9',
    startPassage: 'Start',
    passageCount: 1,
    wordCount: 2,
    filePath: '/tmp/demo',
    lastModified: '2026-01-01T00:00:00.000Z',
  };
  return {
    ...meta,
    passages: [passage],
    tagColors: {},
    storyJavaScript: 'console.log(1)',
    storyStylesheet: 'body { color: red }',
  };
}

describe('suggestNames', () => {
  const names = ['The Dark Cavern', 'Cave Entrance', 'Kitchen'];

  it('suggests close titles and ignores unrelated ones', () => {
    expect(suggestNames('The Dark Cave', names)).toEqual([
      'The Dark Cavern',
      'Cave Entrance',
    ]);
  });

  it('returns no suggestions for a distant query', () => {
    expect(suggestNames('zzzzz', names)).toEqual([]);
  });
});

describe('storyNotFoundMsg', () => {
  it('returns a StoryNotFound payload', () => {
    const store = {
      listStories: () => [{ name: 'Demo' } as StoryMeta],
    };
    expect(storyNotFoundMsg('Dmo', store as never)).toEqual({
      error: 'StoryNotFound',
      message: "Story 'Dmo' does not exist.",
      suggestions: ['Demo'],
    });
  });
});

describe('toPassageView', () => {
  it('omits layout unless requested', () => {
    const view = toPassageView(passage, false);
    expect(view).not.toHaveProperty('position');
    expect(view).not.toHaveProperty('size');
    expect(toPassageView(passage, true)).toMatchObject({
      position: '100,200',
      size: '100,100',
    });
  });
});

describe('buildManifest', () => {
  it('has no passage text or layout', () => {
    const manifest = buildManifest(story());
    const encoded = JSON.stringify(manifest);
    expect(encoded).not.toContain('position');
    expect(encoded).not.toContain('storyJavaScript');
    expect(encoded).not.toContain('Hello there');
    expect(manifest['passages']).toEqual([{
      name: 'Start',
      tags: ['intro'],
      wordCount: 2,
      links: ['Hall'],
    }]);
  });
});

describe('applyTextPatch', () => {
  it('replaces one exact match', () => {
    const result = applyTextPatch('Hello cave', 'cave', 'cavern', false);
    expect(result).toEqual({
      ok: true,
      text: 'Hello cavern',
      replacements: 1,
    });
  });

  it('reports a miss without echoing the passage', () => {
    const result = applyTextPatch('Hello', 'cave', 'cavern', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.error).toBe('PassagePatchMiss');
      expect(JSON.stringify(result.error)).not.toContain('Hello');
    }
  });

  it('reports an ambiguous match', () => {
    const result = applyTextPatch('a a a', 'a', 'b', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        error: 'PassagePatchAmbiguous',
        matchCount: 3,
      });
    }
  });

  it('replaces every match when replace_all is set', () => {
    const result = applyTextPatch('a a a', 'a', 'b', true);
    expect(result).toEqual({ ok: true, text: 'b b b', replacements: 3 });
  });
});

describe('ResourceSubscriptions', () => {
  it('emits only subscribed URIs for the changed story', async () => {
    const subs = new ResourceSubscriptions();
    subs.subscribe('twine://stories/Foo/manifest');
    subs.subscribe('twine://stories/Bar/graph');
    subs.subscribe('twine://stories');
    const sent: string[] = [];
    await notifyStoryUpdated(
      {
        sendResourceUpdated: async ({ uri }) => {
          sent.push(uri);
        },
      },
      subs,
      'Foo',
    );
    expect(sent.sort()).toEqual([
      'twine://stories',
      'twine://stories/Foo/manifest',
    ]);
  });
});

describe('story source watch', () => {
  it('ignores non-story filenames', () => {
    expect(isStorySource('notes.txt')).toBe(false);
    expect(isStorySource('Start.twee')).toBe(true);
    expect(isStorySource(null)).toBe(true);
  });

  it('fires after a twee file is written', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-watch-'));
    const src = path.join(root, 'src');
    fs.mkdirSync(src);
    let hits = 0;
    const handle = watchStorySources([root], () => {
      hits++;
    });
    try {
      fs.writeFileSync(path.join(src, 'note.txt'), 'nope', 'utf-8');
      await delay(400);
      expect(hits).toBe(0);
      fs.writeFileSync(path.join(src, 'Start.twee'), ':: Start\nHi\n', 'utf-8');
      await waitFor(() => hits > 0, 3000);
    } finally {
      handle.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/** Pause for a number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until a condition is true or the timeout elapses. */
async function waitFor(
  ready: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for file watch');
    }
    await delay(50);
  }
}
