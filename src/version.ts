/**
 * Package version — single source of truth from package.json.
 * Avoids hardcoding the version in multiple source files.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** Current @unveil-gg/twine-mcp version from package.json. */
export const VERSION = (
  require('../package.json') as { version: string }
).version;
