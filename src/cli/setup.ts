#!/usr/bin/env node
/**
 * Interactive setup CLI for @unveil-gg/twine-mcp.
 * Usage: twine-mcp setup
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import readline from 'readline';
import { expandPath } from '../config.js';
import { VERSION } from '../version.js';

// ─── ANSI helpers ──────────────────────────────────────────────────────────────

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// ─── Prompt helpers ────────────────────────────────────────────────────────────

/**
 * Ask the user to choose from a numbered list of options.
 * Works on all platforms without raw mode or special key handling.
 *
 * @param prompt - Question shown above the options
 * @param options - Array of option label strings
 * @returns Zero-based index of the selected option
 */
async function askMenu(
  prompt: string,
  options: string[],
): Promise<number> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n  ${bold(prompt)}`);
  options.forEach((opt, i) => {
    console.log(`    ${cyan(String(i + 1))}) ${opt}`);
  });

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(
        `  Enter number (1-${options.length}): `,
        (answer) => {
          const n = parseInt(answer.trim(), 10);
          if (n >= 1 && n <= options.length) {
            rl.close();
            resolve(n - 1);
          } else {
            console.log(
              `  ${yellow('⚠')} Please enter a number between ` +
              `1 and ${options.length}.`,
            );
            ask();
          }
        },
      );
    };
    ask();
  });
}

/**
 * Ask the user a free-text question.
 *
 * @param prompt - Question text
 * @returns Trimmed answer string
 */
async function askText(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`  ${bold(prompt)}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Clipboard helper ──────────────────────────────────────────────────────────

/**
 * Copy text to the system clipboard using platform-native commands.
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

// ─── Config file helpers ───────────────────────────────────────────────────────

/**
 * Merge the twine MCP block into an existing JSON config file.
 * Creates the file and its parent directories if needed.
 *
 * @param configPath - Absolute path to the target config file
 * @param mcpBlock   - MCP server entry to write
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

// ─── Client definitions ────────────────────────────────────────────────────────

interface ClientDef {
  label: string;
  configPath: string;
  hint: string;
  restartNote: string;
}

/** Returns per-editor config targets for the current OS. */
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
            : path.join(
                home,
                '.config',
                'claude',
                'claude_desktop_config.json',
              ),
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

// ─── Main export ───────────────────────────────────────────────────────────────

/** Run the interactive setup wizard. Called from server.ts on `setup` arg. */
export async function runSetup(): Promise<void> {
  console.log(
    '\n' + bold('  twine-mcp setup') + '  ' + dim(`v${VERSION}`),
  );
  console.log(dim('  MCP server for Twine interactive story authoring\n'));

  // 1. Ask for the workspace directory
  console.log(
    '  Point TWINE_PROJECT at the folder that contains your game projects.\n' +
    dim('  It can be a single game folder or a workspace with multiple games.\n') +
    dim('  Supports ~ and %APPDATA% style paths.\n'),
  );

  let workspacePath = await askText(
    'Workspace directory (e.g. ~/Documents/games)',
  );
  console.log();

  if (!workspacePath) {
    console.log(
      `  ${yellow('⚠')} No path entered. ` +
      `You can set TWINE_PROJECT manually in the MCP config.\n`,
    );
  } else {
    try {
      workspacePath = expandPath(workspacePath);
      if (!fs.existsSync(workspacePath)) {
        console.log(
          `  ${yellow('⚠')} Path does not exist yet: ${bold(workspacePath)}\n` +
          `     It will be created when you run create_project.\n`,
        );
      } else {
        console.log(`  ${green('✓')} ${bold(workspacePath)}\n`);
      }
    } catch {
      console.log(
        `  ${yellow('⚠')} Could not resolve path — ` +
        `stored as-is: ${workspacePath}\n`,
      );
    }
  }

  // 2. Select editor
  const clients = getClients();
  const clientIdx = await askMenu(
    'Which editor or coding interface are you setting up?',
    clients.map((c) => c.label),
  );
  const client = clients[clientIdx];
  console.log(`\n  ${green('✓')} ${bold(client.label)} selected\n`);

  // 3. Build the config block
  const env: Record<string, string> = workspacePath
    ? { TWINE_PROJECT: workspacePath }
    : {};
  const mcpBlock: Record<string, unknown> = { command: 'twine-mcp', env };
  const snippet = JSON.stringify({ mcpServers: { twine: mcpBlock } }, null, 2);

  // 4. Auto-write or manual clipboard
  const writeIdx = await askMenu(
    'How would you like to configure?',
    [
      `Auto   — write directly to ${client.hint}`,
      `Manual — copy config block to clipboard`,
    ],
  );
  console.log();

  if (writeIdx === 0) {
    try {
      mergeConfig(client.configPath, mcpBlock);
      console.log(`  ${green('✓')} Written to ${bold(client.hint)}`);
      console.log(`  ${dim(client.restartNote)}\n`);
    } catch (e) {
      console.log(
        `  ${red('✗')} Could not write: ${(e as Error).message}\n` +
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
    `Your editor will auto-start ${cyan('twine-mcp')} on next launch.\n` +
    `  ${dim('Or start manually:')} ${cyan('npx @unveil-gg/twine-mcp')}\n`,
  );
}
