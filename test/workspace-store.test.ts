import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  discoverProjects,
  hasExistingTweeProject,
  isProject,
  WorkspaceStore,
} from '../src/workspace-store.js';

/** Scaffold a minimal Twee project directory with a StoryTitle. */
function makeProject(dir: string, title: string): void {
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'StoryData.twee'),
    `:: StoryTitle\n${title}\n\n:: StoryData\n{"ifid":"x"}\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(srcDir, 'Start.twee'),
    ':: Start\nHello.\n',
    'utf-8',
  );
}

let tmpBase: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-ws-'));
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('isProject / hasExistingTweeProject', () => {
  it('is false for an empty directory', () => {
    expect(isProject(tmpBase)).toBe(false);
    expect(hasExistingTweeProject(tmpBase)).toBe(false);
  });

  it('is false for a directory with only scaffolding files', () => {
    fs.writeFileSync(path.join(tmpBase, 'README.md'), '# hi', 'utf-8');
    fs.writeFileSync(path.join(tmpBase, '.gitignore'), 'dist/', 'utf-8');
    fs.mkdirSync(path.join(tmpBase, '.git'));
    expect(hasExistingTweeProject(tmpBase)).toBe(false);
  });

  it('is true once src/ has a .twee file', () => {
    makeProject(tmpBase, 'My Game');
    expect(isProject(tmpBase)).toBe(true);
    expect(hasExistingTweeProject(tmpBase)).toBe(true);
  });
});

describe('discoverProjects', () => {
  it('finds the root itself when it is a project', () => {
    makeProject(tmpBase, 'Root Game');
    expect(discoverProjects(tmpBase)).toEqual([path.resolve(tmpBase)]);
  });

  it('finds child project directories', () => {
    const child = path.join(tmpBase, 'game-a');
    makeProject(child, 'Game A');
    expect(discoverProjects(tmpBase)).toEqual([path.resolve(child)]);
  });

  it('finds sibling project directories', () => {
    const root = path.join(tmpBase, 'root');
    const sibling = path.join(tmpBase, 'sibling');
    fs.mkdirSync(root, { recursive: true });
    makeProject(sibling, 'Sibling Game');
    expect(discoverProjects(root)).toEqual([path.resolve(sibling)]);
  });
});

describe('WorkspaceStore', () => {
  it('discovers projects under configured roots', async () => {
    const projectDir = path.join(tmpBase, 'game');
    makeProject(projectDir, 'Configured Game');

    const store = new WorkspaceStore([tmpBase]);
    await store.init();

    expect(store.listStories().map((s) => s.name)).toEqual(['Configured Game']);
    expect(store.configuredWorkspaceRoots).toEqual([tmpBase]);
    expect(store.effectiveWorkspaceRoots).toEqual([tmpBase]);
  });

  it('unions client-advertised roots with configured roots', async () => {
    const configuredDir = path.join(tmpBase, 'configured-root');
    const clientDir = path.join(tmpBase, 'client-root');
    makeProject(path.join(configuredDir, 'game-a'), 'Game A');
    makeProject(path.join(clientDir, 'game-b'), 'Game B');

    const store = new WorkspaceStore([configuredDir]);
    await store.init();
    expect(store.listStories().map((s) => s.name)).toEqual(['Game A']);

    store.setClientRoots([clientDir]);
    const names = store.listStories().map((s) => s.name).sort();
    expect(names).toEqual(['Game A', 'Game B']);
    // Configured roots must never be dropped by client roots.
    expect(store.configuredWorkspaceRoots).toEqual([configuredDir]);
    expect(store.effectiveWorkspaceRoots.sort()).toEqual(
      [configuredDir, clientDir].sort(),
    );
  });

  it('surfaces a clear error for ambiguous story names across roots', async () => {
    const rootA = path.join(tmpBase, 'root-a');
    const rootB = path.join(tmpBase, 'root-b');
    makeProject(rootA, 'Same Name');
    makeProject(rootB, 'Same Name');

    const store = new WorkspaceStore([rootA, rootB]);
    await store.init();

    // Both are visible via listStories (not silently merged).
    expect(store.listStories()).toHaveLength(2);
    expect(() => store.getStoryObject('Same Name')).toThrow(/ambiguous/i);
  });

  it('resolves ambiguous names when a matching rootHint is given', async () => {
    const rootA = path.join(tmpBase, 'root-a');
    const rootB = path.join(tmpBase, 'root-b');
    makeProject(rootA, 'Same Name');
    makeProject(rootB, 'Same Name');

    const store = new WorkspaceStore([rootA, rootB]);
    await store.init();

    expect(store.getProjectStore('Same Name', rootB)?.projectRoot).toBe(
      path.resolve(rootB),
    );
  });

  it('adoptRoot discovers a project outside any existing root', async () => {
    const unrelatedRoot = path.join(tmpBase, 'unrelated');
    fs.mkdirSync(unrelatedRoot, { recursive: true });
    const store = new WorkspaceStore([unrelatedRoot]);
    await store.init();
    expect(store.listStories()).toHaveLength(0);

    const newProjectDir = path.join(tmpBase, 'far-away', 'new-game');
    makeProject(newProjectDir, 'New Game');
    store.adoptRoot(newProjectDir);

    expect(store.listStories().map((s) => s.name)).toEqual(['New Game']);
    expect(store.configuredWorkspaceRoots).toContain(unrelatedRoot);
  });

  it('rescan picks up projects created after init without a restart', async () => {
    const root = path.join(tmpBase, 'root');
    fs.mkdirSync(root, { recursive: true });
    const store = new WorkspaceStore([root]);
    await store.init();
    expect(store.listStories()).toHaveLength(0);

    makeProject(path.join(root, 'brand-new'), 'Brand New Game');
    store.rescan();

    expect(store.listStories().map((s) => s.name)).toEqual(['Brand New Game']);
  });

  it('listStories reports ifid/format/formatVersion/startPassage for a ' +
    'freshly discovered project, before its ProjectStore is ever loaded', async () => {
    const projectDir = path.join(tmpBase, 'fresh-game');
    const srcDir = path.join(projectDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'StoryData.twee'),
      ':: StoryTitle\nFresh Game\n\n:: StoryData\n' +
      '{\n  "ifid": "ABC-123",\n  "format": "Harlowe",\n' +
      '  "format-version": "3.3.9",\n  "start": "Start",\n' +
      '  "zoom": 1\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(srcDir, 'Start.twee'), ':: Start\nHi.\n', 'utf-8',
    );

    const store = new WorkspaceStore([tmpBase]);
    await store.init();

    const [meta] = store.listStories();
    expect(meta.ifid).toBe('ABC-123');
    expect(meta.format).toBe('Harlowe');
    expect(meta.formatVersion).toBe('3.3.9');
    expect(meta.startPassage).toBe('Start');
    expect(meta.passageCount).toBe(3);
  });

  it('clientRootsSupported/clientRootsError default to false/null and ' +
    'are updated by their setters', () => {
    const store = new WorkspaceStore([tmpBase]);
    expect(store.clientRootsSupported).toBe(false);
    expect(store.clientRootsError).toBeNull();

    store.setClientRootsSupported(true);
    store.setClientRootsError('Method not found');
    expect(store.clientRootsSupported).toBe(true);
    expect(store.clientRootsError).toBe('Method not found');

    store.setClientRootsError(null);
    expect(store.clientRootsError).toBeNull();
  });
});
