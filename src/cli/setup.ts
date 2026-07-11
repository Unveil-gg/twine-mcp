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

/** Default OS workspace path — same location Twine uses for stories. */
const DEFAULT_WORKSPACE = path.join(
  os.homedir(),
  'Documents',
  'Twine',
  'Stories',
);

// ─── Text input (readline) ────────────────────────────────────────────────────

/**
 * Prompt the user for a path with a pre-filled default.
 * Pressing Enter with no input accepts the default.
 * readline is fully closed before returning so raw mode can open after.
 *
 * @param label   - Short label shown before the bracketed default
 * @param default_ - Default value shown in brackets
 * @returns Entered string, or the default if blank
 */
async function askPath(label: string, default_: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(
      `  ${bold(label)} ${dim(`[${default_}]`)}: `,
      (answer) => {
        rl.close();
        resolve(answer.trim() || default_);
      },
    );
  });
}

// ─── Arrow-key select menu ────────────────────────────────────────────────────

/**
 * Render an arrow-key selector using raw stdin.
 * Must only be called after any readline interfaces are fully closed.
 *
 * @param prompt  - Label shown above options
 * @param options - Array of option strings
 * @returns Zero-based index of the selected option
 */
async function selectMenu(
  prompt: string,
  options: string[],
): Promise<number> {
  return new Promise((resolve) => {
    let idx = 0;

    const render = (first = false) => {
      if (!first) {
        process.stdout.write(`\x1b[${options.length + 1}A\x1b[J`);
      }
      console.log(`\n  ${bold(prompt)}`);
      for (let i = 0; i < options.length; i++) {
        const arrow = i === idx ? cyan('❯') : ' ';
        const label = i === idx ? bold(options[i]) : dim(options[i]);
        console.log(`    ${arrow} ${label}`);
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
        console.log('\n\n  Setup cancelled.');
        process.exit(1);
      }
      switch (key.name) {
        case 'up':
          idx = (idx - 1 + options.length) % options.length;
          render();
          break;
        case 'down':
          idx = (idx + 1) % options.length;
          render();
          break;
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

  // 1. Workspace directory — readline must close before raw mode opens
  console.log(
    dim('  Where are your Twine game projects? Press Enter to use the default.') +
    dim(' You can change this later.\n'),
  );

  const rawPath = await askPath('Games folder', DEFAULT_WORKSPACE);
  let workspacePath: string;
  try {
    workspacePath = expandPath(rawPath);
  } catch {
    workspacePath = rawPath;
  }

  if (!fs.existsSync(workspacePath)) {
    console.log(
      `\n  ${yellow('⚠')}  ${bold(workspacePath)} doesn't exist yet — ` +
      `it will be created when you run ${cyan('create_project')}.\n`,
    );
  } else {
    console.log(`\n  ${green('✓')} ${bold(workspacePath)}\n`);
  }

  // 2. Editor — arrow-key menu (raw mode, safe because readline is closed)
  const clients = getClients();
  const clientIdx = await selectMenu(
    'Which editor or coding interface are you setting up?',
    clients.map((c) => c.label),
  );
  const client = clients[clientIdx];
  console.log(`\n  ${green('✓')} ${bold(client.label)} selected\n`);

  // 3. Build the config block
  const mcpBlock: Record<string, unknown> = {
    command: 'twine-mcp',
    env: { TWINE_PROJECT: workspacePath },
  };
  const snippet = JSON.stringify({ mcpServers: { twine: mcpBlock } }, null, 2);

  // 4. Write method — arrow-key menu
  const writeIdx = await selectMenu(
    'How would you like to apply the config?',
    [
      `Auto   — write directly to ${client.hint}`,
      `Manual — copy config snippet to clipboard`,
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
        ? `  ${green('✓')} Config snippet copied to clipboard!`
        : `  ${yellow('⚠')} Clipboard unavailable — see snippet below.`,
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
