import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  dedupeRoots,
  expandPath,
  resolveConfiguredRoots,
} from '../src/config.js';

describe('expandPath', () => {
  it('expands a leading ~ to the home directory', () => {
    expect(expandPath('~/games')).toBe(path.resolve(os.homedir(), 'games'));
  });

  it('resolves relative paths to absolute', () => {
    expect(path.isAbsolute(expandPath('./games'))).toBe(true);
  });

  it('expands ${VAR} and $VAR references', () => {
    process.env['TWINE_MCP_TEST_VAR'] = 'games';
    expect(expandPath('~/${TWINE_MCP_TEST_VAR}')).toBe(
      path.resolve(os.homedir(), 'games'),
    );
    delete process.env['TWINE_MCP_TEST_VAR'];
  });
});

describe('dedupeRoots', () => {
  it('removes exact duplicates, keeping first occurrence', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-'));
    const result = dedupeRoots([tmp, tmp, tmp]);
    expect(result).toEqual([tmp]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('is case-insensitive on Windows', () => {
    if (process.platform !== 'win32') return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-'));
    const result = dedupeRoots([tmp, tmp.toUpperCase()]);
    expect(result).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps distinct paths that do not collide', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-b-'));
    expect(dedupeRoots([a, b])).toEqual([a, b]);
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });
});

describe('resolveConfiguredRoots', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv['TWINE_WORKSPACE_ROOTS'] = process.env['TWINE_WORKSPACE_ROOTS'];
    savedEnv['TWINE_PROJECT'] = process.env['TWINE_PROJECT'];
    delete process.env['TWINE_WORKSPACE_ROOTS'];
    delete process.env['TWINE_PROJECT'];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns an empty list when nothing is configured', () => {
    expect(resolveConfiguredRoots()).toEqual([]);
  });

  it('splits TWINE_WORKSPACE_ROOTS on commas and semicolons', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-b-'));
    process.env['TWINE_WORKSPACE_ROOTS'] = `${a},${b}`;
    expect(resolveConfiguredRoots()).toEqual([a, b]);
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });

  it('still honors the legacy singular TWINE_PROJECT var', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-legacy-'));
    process.env['TWINE_PROJECT'] = a;
    expect(resolveConfiguredRoots()).toEqual([a]);
    fs.rmSync(a, { recursive: true, force: true });
  });

  it('combines and dedupes both env vars', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'twine-mcp-b-'));
    process.env['TWINE_WORKSPACE_ROOTS'] = a;
    process.env['TWINE_PROJECT'] = `${a};${b}`;
    expect(resolveConfiguredRoots()).toEqual([a, b]);
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  });
});
