const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Runtime (non-bundled) dependencies used by the main process. Angular and
// @micropos/* are bundled into the renderer, so only these need shipping.
// Forge's dependency walker can't resolve hoisted workspace deps, so we copy
// them from the workspace root's node_modules ourselves.
const RUNTIME_MODULES = ['better-sqlite3', 'drizzle-orm'];
// Build-only parts of better-sqlite3 that don't need to be shipped.
const SKIP_IN_MODULE = new Set(['deps', 'src', 'binding.gyp', 'node_modules']);

// Hoisted workspace layout: modules live in the repo root's node_modules.
function resolveModuleDir(name) {
  const candidates = [
    path.join(__dirname, 'node_modules', name),
    path.join(__dirname, '..', '..', 'node_modules', name),
  ];
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!found) throw new Error(`Runtime module "${name}" not found in: ${candidates.join(', ')}`);
  return found;
}

function copyModule(name, buildPath, platform, arch) {
  const from = resolveModuleDir(name);
  const to = path.join(buildPath, 'node_modules', name);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      if (name !== 'better-sqlite3') return true;
      const rel = path.relative(from, src);
      const [top, file] = rel.split(path.sep);
      if (SKIP_IN_MODULE.has(top)) return false;
      // Ship only the prebuilt binary for the target platform/arch.
      if (top === 'prebuilds' && file) return file === `${platform}-${arch}.node`;
      return true;
    },
  });
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    // Generated SQL migrations, applied on startup (resources/migrations).
    extraResource: ['./electron/db/migrations'],
    // See RUNTIME_MODULES above: no pruning, node_modules excluded, runtime deps copied in afterCopy.
    prune: false,
    ignore: [
      /^\/(src|electron|public|node_modules|\.angular|\.vscode|out|local-data)(\/|$)/,
      // Dev-only dummy data tooling (needs faker, which is not shipped).
      /^\/dist\/electron\/db\/(factories|seed-cli)/,
      /^\/(angular\.json|drizzle\.config\.ts|tsconfig.*\.json|forge\.config\.js|CLAUDE\.md|README\.md|\.mcp\.json)$/,
    ],
    afterCopy: [
      async ({ buildPath, platform, arch }) => {
        RUNTIME_MODULES.forEach((m) => copyModule(m, buildPath, platform, arch));
      },
    ],
  },
  makers: [
    { name: '@electron-forge/maker-squirrel', config: {} },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
