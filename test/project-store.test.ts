import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProjectStore } from '../src/project-store.js';

/** Scaffold a Twee project with a tag-based stylesheet/script passage. */
function makeProject(dir: string): void {
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'StoryData.twee'),
    ':: StoryData\n' +
    '{ "ifid": "E5DA6D08-8A5E-4CB1-9E10-D06949E2F9E9", ' +
    '"format": "Harlowe", "start": "Start" }\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(srcDir, 'Start.twee'),
    ':: Story Stylesheet [stylesheet]\nbody { background: #f4e8ce; }\n\n' +
    ':: Story JavaScript [script]\nwindow.foo = 1;\n\n' +
    ':: Start [intro]\nHello.\n',
    'utf-8',
  );
}

let tmpBase: string;
let projectDir: string;
let store: ProjectStore;

beforeEach(() => {
  // Nest the project one level below the mkdtemp root so it is not
  // itself picked up as a "sibling project" by other test files'
  // discoverProjects() sibling-scan when tests run concurrently.
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-ps-'));
  projectDir = path.join(tmpBase, 'game');
  makeProject(projectDir);
  store = new ProjectStore(projectDir);
  store.initSync();
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('ProjectStore header tag parsing', () => {
  it('parses ordinary passage tags', () => {
    const full = store.getStoryFull('');
    const start = full!.passages.find((p) => p.name === 'Start');
    expect(start?.tags).toEqual(['intro']);
  });

  it('supports multi-tag headers and metadata combos', () => {
    fs.writeFileSync(
      path.join(projectDir, 'src', 'Extra.twee'),
      ':: Extra [tagA tagB] {"position":"10,10"}\nHi.\n',
      'utf-8',
    );
    store.reload();
    const full = store.getStoryFull('');
    const extra = full!.passages.find((p) => p.name === 'Extra');
    expect(extra?.tags).toEqual(['tagA', 'tagB']);
    expect(extra?.position).toBe('10,10');
  });
});

describe('ProjectStore stylesheet/script passage handling', () => {
  it('merges storyStylesheet/storyJavaScript across files instead of ' +
    'dropping them', () => {
    const full = store.getStoryFull('');
    expect(full?.storyStylesheet).toContain('background: #f4e8ce');
    expect(full?.storyJavaScript).toContain('window.foo = 1;');
  });

  it('does not list [stylesheet]/[script]-tagged content as a passage', () => {
    const full = store.getStoryFull('');
    const names = full!.passages.map((p) => p.name);
    expect(names).not.toContain('Story Stylesheet');
    expect(names).not.toContain('Story JavaScript');
    expect(names).toEqual(['Start']);
  });

  it('round-trips edited stylesheet content back to disk', () => {
    const storyObj = store.getStoryObject('')!;
    storyObj.storyStylesheet = 'body { color: red; }';
    store.saveStory(storyObj);

    const reloaded = new ProjectStore(projectDir);
    reloaded.initSync();
    expect(reloaded.getStoryFull('')?.storyStylesheet).toBe(
      'body { color: red; }',
    );
  });

  it('clears stylesheet content on disk when set back to empty', () => {
    const storyObj = store.getStoryObject('')!;
    storyObj.storyStylesheet = '';
    store.saveStory(storyObj);

    const reloaded = new ProjectStore(projectDir);
    reloaded.initSync();
    expect(reloaded.getStoryFull('')?.storyStylesheet).toBe('');
  });
});

describe('ProjectStore story metadata persistence', () => {
  it('persists start passage changes to StoryData.twee on disk', () => {
    fs.writeFileSync(
      path.join(projectDir, 'src', 'Splash.twee'),
      ':: Splash\nWelcome.\n',
      'utf-8',
    );
    store.reload();
    const storyObj = store.getStoryObject('')!;
    storyObj.start = 'Splash';
    store.saveStory(storyObj);

    const storyData = fs.readFileSync(
      path.join(projectDir, 'src', 'StoryData.twee'),
      'utf-8',
    );
    expect(storyData).toContain('"start": "Splash"');

    const reloaded = new ProjectStore(projectDir);
    reloaded.initSync();
    expect(reloaded.getStoryFull('')?.startPassage).toBe('Splash');
  });

  it('keeps startPassage after reload triggered by save mtimes', () => {
    fs.writeFileSync(
      path.join(projectDir, 'src', 'Splash.twee'),
      ':: Splash\nWelcome.\n',
      'utf-8',
    );
    store.reload();
    const storyObj = store.getStoryObject('')!;
    storyObj.start = 'Splash';
    store.saveStory(storyObj);

    expect(store.isStale()).toBe(false);
    store.reload();
    expect(store.getStoryFull('')?.startPassage).toBe('Splash');
  });
});

describe('ProjectStore external edit detection', () => {
  it('isStale() is false immediately after load', () => {
    expect(store.isStale()).toBe(false);
  });

  it('isStale() returns true after .twee files change on disk', () => {
    fs.writeFileSync(
      path.join(projectDir, 'src', 'New.twee'),
      ':: New Passage\nFresh text.\n',
      'utf-8',
    );
    expect(store.isStale()).toBe(true);
  });

  it('reload() picks up passages added externally', () => {
    fs.writeFileSync(
      path.join(projectDir, 'src', 'New.twee'),
      ':: New Passage\nFresh text.\n',
      'utf-8',
    );
    store.reload();
    const passage = store.getStoryFull('')!.passages.find(
      (p) => p.name === 'New Passage',
    );
    expect(passage?.text).toBe('Fresh text.');
  });

  it('reload() omits passages deleted externally', () => {
    fs.rmSync(path.join(projectDir, 'src', 'Start.twee'));
    store.reload();
    const names = store.getStoryFull('')!.passages.map((p) => p.name);
    expect(names).not.toContain('Start');
  });
});
