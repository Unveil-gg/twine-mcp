/**
 * Project-mode MCP tools: create_project, build_story, validate_story,
 * import_from_twine, move_passage, list_files, export_for_twine.
 *
 * These tools require a WorkspaceStore and operate on individual game
 * projects within the workspace. Most accept a `story` parameter that
 * identifies which game to operate on.
 */

import * as z from 'zod/v4';
import fs from 'fs';
import path from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Story,
  Passage,
  parseTwine2HTML,
  generateIFID,
} from 'extwee';
import { hasExistingTweeProject, type WorkspaceStore } from
  '../workspace-store.js';
import {
  resolveFormat,
  resolveFormatFile,
  DEFAULT_FORMAT_VERSIONS,
} from '../format-manager.js';
import {
  resolveTweego,
  tweegoFormatId,
  ensureFormatOverride,
  runTweego,
} from '../tweego-manager.js';
import { scanProjectAssets } from '../util/asset-scan.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg, passageNotFoundMsg } from '../util/errors.js';
import type { ValidationIssue } from '../types.js';

/** Special passage names that carry story metadata. */
const SPECIAL_PASSAGES = new Set([
  'StoryData', 'StoryTitle', 'StoryJavaScript', 'StoryStylesheet',
  'StoryMenu', 'StoryCaption', 'StoryBanner', 'StorySubtitle',
  'StoryInit', 'StoryShare', 'StorySettings',
]);

/**
 * Registers all project-mode tools on the MCP server.
 *
 * @param server    - McpServer instance
 * @param workspace - WorkspaceStore instance
 */
export function registerProjectTools(
  server: McpServer,
  workspace: WorkspaceStore,
): void {
  /** create_project */
  server.registerTool(
    'create_project',
    {
      description:
        'Scaffold a new Twee project directory with src/, StoryData.twee, ' +
        'Start.twee, dist/, assets/, and .gitignore. Downloads and caches ' +
        'the story format. Run this once per game before any other tools. ' +
        'Put image/audio/video/font files under src/ to have build_story ' +
        'bundle them automatically (SugarCube only); use assets/ instead ' +
        'for files you want to reference by relative URL, left untouched ' +
        'by the compiler.',
      inputSchema: {
        project_dir: z
          .string()
          .describe('Absolute path for the new project directory'),
        story_name: z.string().describe('Title of the story'),
        format: z
          .enum(['Harlowe', 'SugarCube', 'Chapbook', 'Snowman'])
          .optional()
          .default('SugarCube')
          .describe('Story format (default: SugarCube)'),
        format_version: z
          .string()
          .optional()
          .describe('Format version. Omit to use the bundled default.'),
      },
    },
    async ({ project_dir, story_name, format, format_version }) => {
      if (fs.existsSync(project_dir) && hasExistingTweeProject(project_dir)) {
        return err(
          `Directory "${project_dir}" already contains a Twee project ` +
          '(found StoryData.twee or src/*.twee). Refusing to overwrite ' +
          'existing work.',
        );
      }

      const srcDir = path.join(project_dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(path.join(project_dir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(project_dir, 'assets'), { recursive: true });

      const fmtKey = format.toLowerCase();
      const resolvedVersion =
        format_version ?? DEFAULT_FORMAT_VERSIONS[fmtKey] ?? '1.0.0';
      const ifid = generateIFID();

      const storyDataContent =
        `:: StoryTitle\n${story_name}\n\n` +
        `:: StoryData\n` +
        `{\n` +
        `  "ifid": "${ifid}",\n` +
        `  "format": "${format}",\n` +
        `  "format-version": "${resolvedVersion}",\n` +
        `  "start": "Start",\n` +
        `  "zoom": 1\n` +
        `}\n`;

      const startContent = `:: Start\nYour story begins here.\n`;
      const gitignore = `dist/\n.twine-mcp/\n.tweenode/\nnode_modules/\n`;

      fs.writeFileSync(
        path.join(srcDir, 'StoryData.twee'), storyDataContent, 'utf-8',
      );
      fs.writeFileSync(
        path.join(srcDir, 'Start.twee'), startContent, 'utf-8',
      );
      const gitignorePath = path.join(project_dir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
      }

      // Download format JS in background (don't fail if offline)
      let formatCached = false;
      try {
        await resolveFormat(format, resolvedVersion);
        formatCached = true;
      } catch {
        // Will retry on next build_story call
      }

      // Pick up the new project immediately, no restart required, even
      // if project_dir isn't already covered by a workspace root.
      workspace.adoptRoot(project_dir);

      return ok({
        projectDir: project_dir,
        storyName: story_name,
        format,
        formatVersion: resolvedVersion,
        ifid,
        formatCached,
        files: [
          'src/StoryData.twee',
          'src/Start.twee',
          '.gitignore',
          'dist/',
          'assets/',
        ],
        note: 'Project is now discoverable — call list_stories to confirm.',
      });
    },
  );

  /** validate_story */
  server.registerTool(
    'validate_story',
    {
      description:
        'Validate a story: checks for broken links, missing start passage, ' +
        'IFID, and format. ' +
        'THEN: build_story (only when valid=true).',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = workspace.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, workspace));

      const issues: ValidationIssue[] = [];
      const names = new Set(full.passages.map((p) => p.name));

      if (!full.ifid) {
        issues.push({ type: 'error', message: 'Missing IFID in StoryData.' });
      }
      if (!full.format) {
        issues.push({ type: 'error', message: 'Missing format in StoryData.' });
      }
      if (!names.has(full.startPassage)) {
        issues.push({
          type: 'error',
          message: `Start passage "${full.startPassage}" does not exist.`,
        });
      }

      for (const p of full.passages) {
        for (const link of p.links) {
          if (!names.has(link)) {
            issues.push({
              type: 'warning',
              message: `Broken link to "${link}"`,
              passage: p.name,
            });
          }
        }
      }

      const errors = issues.filter((i) => i.type === 'error');
      const warnings = issues.filter((i) => i.type === 'warning');

      return ok({
        valid: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length,
        issues,
      });
    },
  );

  /** build_story */
  server.registerTool(
    'build_story',
    {
      description:
        'Compile the project into a playable HTML file using the Tweego ' +
        'compiler. Writes to dist/<story-name>.html. Also bundles any ' +
        'image/audio/video/font files found under src/ as embedded ' +
        'passages, the same way Tweego does natively (SugarCube only; ' +
        'other formats don\'t consume them, so they\'re skipped — see ' +
        'skippedAssets in the response). ' +
        'Always run validate_story first.',
      inputSchema: {
        story: z.string().describe('Story name'),
        output_path: z
          .string()
          .optional()
          .describe(
            'Absolute output path. Defaults to dist/<story-name>.html.',
          ),
      },
    },
    async ({ story, output_path }) => {
      const ps = workspace.getProjectStore(story);
      if (!ps) return err(storyNotFoundMsg(story, workspace));
      const storyObj = ps.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, workspace));

      const format = storyObj.format || 'Harlowe';
      const version = storyObj.formatVersion || undefined;

      let tweego;
      try {
        tweego = await resolveTweego();
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e));
      }

      let formatFile;
      try {
        formatFile = await resolveFormatFile(format, version);
      } catch (e) {
        return err(
          `Could not load story format "${format}" ${version ?? ''}: ` +
          String(e),
        );
      }

      const formatId = tweegoFormatId(format, formatFile.version);
      const formatsDir = ensureFormatOverride(formatId, formatFile.path);

      const authoredNames = new Set(
        (storyObj.passages as Passage[]).map((p) => p.name),
      );
      const formatSupportsMedia = format.toLowerCase() === 'sugarcube';
      const { sources, bundled, skipped } = scanProjectAssets(
        ps.srcDir, authoredNames, formatSupportsMedia,
      );
      if (sources.length === 0) {
        return err(`No compilable source files found under "${ps.srcDir}".`);
      }

      const outDir = path.join(ps.projectRoot, 'dist');
      fs.mkdirSync(outDir, { recursive: true });
      const safeName = storyObj.name.replace(/[^\w\s-]/g, '').trim();
      const dest =
        output_path ?? path.join(outDir, `${safeName || 'story'}.html`);

      const result = await runTweego(
        tweego.binPath, ['-f', formatId, '-o', dest, ...sources], formatsDir,
      );
      if (result.code !== 0) {
        return err(
          `Tweego compilation failed (exit ${result.code}): ` +
          (result.stderr.trim() || result.stdout.trim() || 'no output'),
        );
      }

      return ok({
        outputPath: dest,
        format,
        formatVersion: formatFile.version,
        passageCount: (storyObj.passages as Passage[]).length,
        byteSize: fs.statSync(dest).size,
        bundledAssets: bundled,
        skippedAssets: skipped,
      });
    },
  );

  /** import_from_twine */
  server.registerTool(
    'import_from_twine',
    {
      description:
        'Import a Twine desktop story HTML file into a Twee project directory. ' +
        'Detects format, preserves IFID and passage positions, ' +
        'and downloads the format for future builds.',
      inputSchema: {
        html_path: z
          .string()
          .describe('Absolute path to the Twine story .html file'),
        target_dir: z
          .string()
          .describe(
            'Target project directory (absolute path). ' +
            'Will be created if it does not exist.',
          ),
      },
    },
    async ({ html_path, target_dir }) => {
      if (!fs.existsSync(html_path)) {
        return err(`File not found: "${html_path}"`);
      }
      const html = fs.readFileSync(html_path, 'utf-8');
      let imported: Story;
      try {
        imported = parseTwine2HTML(html) as Story;
      } catch (e) {
        return err(`Failed to parse Twine HTML: ${String(e)}`);
      }

      const srcDir = path.join(target_dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(path.join(target_dir, 'dist'), { recursive: true });

      const special: Passage[] = [];
      const storyPassages: Passage[] = [];
      for (const p of imported.passages as Passage[]) {
        if (
          SPECIAL_PASSAGES.has(p.name) ||
          p.tags.includes('script') ||
          p.tags.includes('stylesheet')
        ) {
          special.push(p);
        } else {
          storyPassages.push(p);
        }
      }

      const storyDataContent =
        `:: StoryTitle\n${imported.name}\n\n` +
        `:: StoryData\n` +
        `{\n` +
        `  "ifid": "${imported.IFID}",\n` +
        `  "format": "${imported.format}",\n` +
        `  "format-version": "${imported.formatVersion}",\n` +
        `  "start": "${imported.start}",\n` +
        `  "zoom": 1\n` +
        `}\n` +
        (special.length
          ? '\n' + special.map((p) => p.toTwee()).join('\n\n') + '\n'
          : '');
      fs.writeFileSync(
        path.join(srcDir, 'StoryData.twee'), storyDataContent, 'utf-8',
      );

      const byGroup = new Map<string, Passage[]>();
      for (const p of storyPassages) {
        const group = p.tags[0] ?? 'passages';
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group)!.push(p);
      }

      const filesWritten: string[] = ['src/StoryData.twee'];
      for (const [group, passages] of byGroup) {
        const fileName = `${group}.twee`;
        const content = passages.map((p) => p.toTwee()).join('\n\n') + '\n';
        fs.writeFileSync(path.join(srcDir, fileName), content, 'utf-8');
        filesWritten.push(`src/${fileName}`);
      }

      if (!fs.existsSync(path.join(target_dir, '.gitignore'))) {
        fs.writeFileSync(
          path.join(target_dir, '.gitignore'),
          'dist/\n.twine-mcp/\n.tweenode/\n',
          'utf-8',
        );
        filesWritten.push('.gitignore');
      }

      let formatCached = false;
      try {
        await resolveFormat(imported.format, imported.formatVersion);
        formatCached = true;
      } catch { /* retry on build */ }

      // Pick up the new project immediately, no restart required, even
      // if target_dir isn't already covered by a workspace root.
      workspace.adoptRoot(target_dir);

      return ok({
        storyName: imported.name,
        format: imported.format,
        formatVersion: imported.formatVersion,
        passageCount: (imported.passages as Passage[]).length,
        filesWritten,
        formatCached,
        note: 'Project is now discoverable — call list_stories to confirm.',
      });
    },
  );

  /** move_passage */
  server.registerTool(
    'move_passage',
    {
      description:
        'Move a passage from its current .twee file to a different one. ' +
        'Links are not changed — this is a file organization operation only.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name to move'),
        target_file: z
          .string()
          .describe(
            'Target .twee file path relative to project root, ' +
            'e.g. "src/chapters/act2.twee"',
          ),
      },
    },
    async ({ story, passage, target_file }) => {
      const ps = workspace.getProjectStore(story);
      if (!ps) return err(storyNotFoundMsg(story, workspace));
      const storyObj = ps.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, workspace));
      if (!storyObj.getPassageByName(passage)) {
        return err(
          passageNotFoundMsg(passage, story, storyObj.passages as Passage[]),
        );
      }

      const absTarget = path.isAbsolute(target_file)
        ? target_file
        : path.join(ps.projectRoot, target_file);

      const currentFile = ps.getPassageFile(passage);
      ps.setPassageFile(passage, absTarget);
      ps.saveStory(storyObj);

      return ok({
        passage,
        movedFrom: currentFile
          ? path.relative(ps.projectRoot, currentFile)
          : null,
        movedTo: path.relative(ps.projectRoot, absTarget),
      });
    },
  );

  /** list_files */
  server.registerTool(
    'list_files',
    {
      description:
        'List all .twee source files in a project with passage and word ' +
        'counts per file. Cheapest way to understand project structure.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const ps = workspace.getProjectStore(story);
      if (!ps) return err(storyNotFoundMsg(story, workspace));
      const files = ps.listFiles();
      return ok({
        projectRoot: ps.projectRoot,
        fileCount: files.length,
        totalPassages: files.reduce((s, f) => s + f.passageCount, 0),
        totalWords: files.reduce((s, f) => s + f.wordCount, 0),
        files,
      });
    },
  );

  /** export_for_twine */
  server.registerTool(
    'export_for_twine',
    {
      description:
        'Export the project as a Twine-importable archive HTML file ' +
        'with passage positions preserved. Drag this file into Twine ' +
        'to visualize the story graph.',
      inputSchema: {
        story: z.string().describe('Story name'),
        output_path: z
          .string()
          .optional()
          .describe(
            'Absolute output path. Defaults to dist/<name>-archive.html.',
          ),
      },
    },
    async ({ story, output_path }) => {
      const ps = workspace.getProjectStore(story);
      if (!ps) return err(storyNotFoundMsg(story, workspace));
      const storyObj = ps.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, workspace));

      const archiveHtml = storyObj.toTwine2HTML();
      const wrapped =
        `<!DOCTYPE html><html><head><meta charset="utf-8">` +
        `<title>${storyObj.name} — Archive</title></head>` +
        `<body>${archiveHtml}</body></html>`;

      const outDir = path.join(ps.projectRoot, 'dist');
      fs.mkdirSync(outDir, { recursive: true });
      const safeName = storyObj.name.replace(/[^\w\s-]/g, '').trim();
      const dest =
        output_path ??
        path.join(outDir, `${safeName || 'story'}-archive.html`);
      fs.writeFileSync(dest, wrapped, 'utf-8');

      return ok({
        outputPath: dest,
        passageCount: (storyObj.passages as Passage[]).length,
        note: 'Import this file into Twine via File → Import Story.',
      });
    },
  );
}
