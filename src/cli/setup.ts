#!/usr/bin/env node
/**
 * Interactive setup CLI for @unveil/twine-mcp.
 * Usage: twine-mcp setup
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import readline from 'readline';
import { resolveLibraryPath } from '../config.js';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// ─── Arrow-key select menu ────────────────────────────────────────────────────

/**
 * Renders an interactive arrow-key selector using raw stdin.
 *
 * @param prompt - Label shown above options
 * @param options - Array of option strings
 * @returns Index of selected option
 */
async function selectMenu(
  prompt: string,
  options: string[],
): Promise<number> {
  return new Promise((resolve) => {
    let idx = 0;

    const render = (first = false) => {
      if (!first) {
        // Move cursor up (options.length + 1) lines, clear below
        process.stdout.write(`\x1b[${options.length + 1}A\x1b[J`);
      }
      console.log(`  ${bold(prompt)}`);
      for (let i = 0; i < options.length; i++) {
        const arrow = i === idx ? cyan('❯') : ' ';
        const label = i === idx ? bold(options[i]) : `\x1b[2m${options[i]}\x1b[0m`;
        console.log(`  ${arrow} ${label}`);
      }
    };

    render(true);

    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    readline.emitKeypressEvents(stdin);

    const onKey = (
      _str: string | undefined,
      key: { name: string; ctrl: boolean } | undefined,
    ) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        if (stdin.isTTY) stdin.setRawMode(false);
        console.log('\n  Setup cancelled.');
        process.exit(1);
      }
      switch (key.name) {
        case 'up':   idx = (idx - 1 + options.length) % options.length; render(); break;
        case 'down': idx = (idx + 1) % options.length; render(); break;
        case 'return':
          if (stdin.isTTY) stdin.setRawMode(false);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stdin.off('keypress', onKey as any);
          process.stdout.write('\n');
          resolve(idx);
          break;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stdin.on('keypress', onKey as any);
  });
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

/**
 * Copies text to the system clipboard using platform-native commands.
 *
 * @param text - Content to copy
 * @returns true if copy succeeded
 */
function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else {
      execSync('xclip -selection clipboard', { input: text });
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Config file helpers ──────────────────────────────────────────────────────

/**
 * Reads an existing JSON config (if any) and merges the twine MCP block
 * into its mcpServers object, then writes the result back to disk.
 *
 * @param configPath - Absolute path to the target config file
 * @param mcpBlock   - The MCP server entry for twine
 */
function mergeConfig(
  configPath: string,
  mcpBlock: Record<string, unknown>,
): void {
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as
        Record<string, unknown>;
    } catch {
      // Overwrite malformed JSON rather than aborting
    }
  }
  const servers = (existing['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['twine'] = mcpBlock;
  existing['mcpServers'] = servers;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
}

// ─── Client definitions ───────────────────────────────────────────────────────

interface ClientDef {
  label: string;
  /** Absolute path to the MCP config file, or null if CLI-command only. */
  configPath: string;
  /** User-friendly display path shown in hints. */
  hint: string;
  /** Post-setup instruction shown to the user. */
  restartNote: string;
}

/** Returns per-editor config targets adjusted for the current OS. */
function getClients(): ClientDef[] {
  const home = os.homedir();
  const appData =
    process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');

  return [
    {
      label: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      hint: '~/.cursor/mcp.json',
      restartNote: 'Restart Cursor (or reload the MCP panel) after saving.',
    },
    {
      label: 'Claude Code',
      configPath: path.join(home, '.claude.json'),
      hint: '~/.claude.json',
      restartNote:
        'Claude Code reloads MCP config automatically on next command.',
    },
    {
      label: 'Claude Desktop',
      configPath:
        process.platform === 'win32'
          ? path.join(appData, 'Claude', 'claude_desktop_config.json')
          : process.platform === 'darwin'
            ? path.join(
                home,
                'Library',
                'Application Support',
                'Claude',
                'claude_desktop_config.json',
              )
            : path.join(home, '.config', 'claude', 'claude_desktop_config.json'),
      hint:
        process.platform === 'win32'
          ? '%APPDATA%\\Claude\\claude_desktop_config.json'
          : process.platform === 'darwin'
            ? '~/Library/Application Support/Claude/claude_desktop_config.json'
            : '~/.config/claude/claude_desktop_config.json',
      restartNote: 'Restart Claude Desktop after saving.',
    },
    {
      label: 'Codex CLI',
      configPath: path.join(home, '.codex', 'config.json'),
      hint: '~/.codex/config.json',
      restartNote: 'Codex picks up MCP config on the next session start.',
    },
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Runs the interactive setup wizard. Called from server.ts on `setup` arg. */
export async function runSetup(): Promise<void> {
  console.log(
    '\n' + bold('  twine-mcp setup') + '  ' + dim('v0.1.0'),
  );
  console.log(dim('  MCP server for Twine interactive story authoring\n'));

  // 1. Detect library path
  const libPath = resolveLibraryPath();
  const libExists = fs.existsSync(libPath);
  const libCount = libExists
    ? fs.readdirSync(libPath).filter((f) => f.endsWith('.html')).length
    : 0;

  if (libExists) {
    const storyLabel = libCount === 1 ? 'story' : 'stories';
    console.log(
      `  ${green('✓')} Twine library: ${bold(libPath)}` +
        dim(` (${libCount} ${storyLabel})`),
    );
  } else {
    console.log(
      `  ${yellow('⚠')} Library not found at ${bold(libPath)}.` +
        ' Launch Twine once to create it.',
    );
  }
  console.log();

  // 2. Select editor
  const clients = getClients();
  const clientIdx = await selectMenu(
    'Which editor or coding interface are you setting up?',
    clients.map((c) => c.label),
  );
  const client = clients[clientIdx];
  console.log(`  ${green('✓')} ${bold(client.label)} selected\n`);

  // 3. Build the config block
  const mcpBlock: Record<string, unknown> = {
    command: 'twine-mcp',
    env: { TWINE_LIBRARY: libPath },
  };
  const snippet = JSON.stringify({ mcpServers: { twine: mcpBlock } }, null, 2);

  // 4. Auto-write or manual clipboard
  const modeIdx = await selectMenu('How would you like to configure?', [
    `Auto   → write directly to ${client.hint}`,
    `Manual → copy config block to clipboard`,
  ]);
  console.log();

  if (modeIdx === 0) {
    try {
      mergeConfig(client.configPath, mcpBlock);
      console.log(`  ${green('✓')} Written to ${bold(client.hint)}`);
      console.log(`  ${dim(client.restartNote)}\n`);
    } catch (e) {
      console.log(`  ${red('✗')} Could not write: ${(e as Error).message}`);
      console.log(
        `  Add the block below manually to ${bold(client.hint)}:\n`,
      );
      console.log(snippet.split('\n').map((l) => `    ${l}`).join('\n'));
      console.log();
    }
  } else {
    const copied = copyToClipboard(snippet);
    console.log(
      copied
        ? `  ${green('✓')} Config block copied to clipboard!`
        : `  ${yellow('⚠')} Clipboard unavailable — see block below.`,
    );
    console.log(
      `\n  Paste into ${bold(client.hint)} under ${bold('"mcpServers"')}:\n`,
    );
    console.log(snippet.split('\n').map((l) => `    ${l}`).join('\n'));
    console.log(`\n  ${dim(client.restartNote)}\n`);
  }

  console.log(
    `  ${green(bold('All done!'))} ` +
      `Your editor will auto-start ${cyan('twine-mcp')} on next launch.`,
  );
  console.log(
    `  ${dim('Or start it manually with:')} ${cyan('npx @unveil/twine-mcp')}\n`,
  );
}
