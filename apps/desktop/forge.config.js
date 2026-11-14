const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

// Runtime (non-bundled) dependencies used by the main process. Angular and
// @micropos/* are bundled into the renderer, so only these need shipping.
// Forge's dependency walker can't resolve hoisted workspace deps, so we copy
// them from the workspace root's node_modules ourselves.
// The main process also imports values from @micropos/core (pricing, quantities, payment methods), so its compiled
// dist ships too.
// Printing: the receipt encoder (and its dependencies) and the QR code maker. `usb` is left out: it is loaded only when
// a USB printer is used (its native binding is not built here), and without it USB printing reports an error.
const RUNTIME_MODULES = [
  'better-sqlite3',
  'drizzle-orm',
  '@micropos/core',
  'ws',
  'qrcode-generator',
  '@point-of-sale/receipt-printer-encoder',
  '@point-of-sale/codepage-encoder',
  '@canvas/image-data',
  'canvas-dither',
  'canvas-flatten',
  'resize-image-data',
];
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
    // A workspace package is a symlink in node_modules: ship its files, not the link.
    dereference: name.startsWith('@micropos/'),
    filter: (src) => {
      if (name.startsWith('@micropos/')) {
        const rel = path.relative(from, src);
        const [top] = rel.split(path.sep);
        return rel === '' || top === 'package.json' || top === 'dist'; // not its sources, tests or build info
      }
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

const LINUX_MAKERS = [
  { name: '@electron-forge/maker-zip', platforms: ['linux'] },
  { name: '@electron-forge/maker-rpm', config: { options: { name: 'micropos', productName: 'MicroPOS', genericName: 'Point of sale', icon: path.join(__dirname, 'assets', 'icon.png'), bin: 'micropos', specTemplate: path.join(__dirname, 'rpm-spec.ejs') } } },
];

// Used when building on Windows. Same Squirrel id and executable name as the first MicroPOS (`micropos`,
// micropos.exe), so Setup installs over it as an upgrade instead of beside it. `name` is set because the package name
// is scoped and not a valid id.
const WINDOWS_MAKERS = [{ name: '@electron-forge/maker-squirrel', config: { name: 'micropos', setupIcon: path.join(__dirname, 'assets', 'icon.ico') } }];

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    // The package name is scoped (@micropos/desktop), which is not a usable file name: name the program explicitly.
    executableName: 'micropos',
    // The app icon (the nav rail's collapsed mark): .ico on Windows, the .png is read at runtime and by the rpm.
    icon: './assets/icon',
    // Generated SQL migrations, applied on startup (resources/migrations).
    // (and icon.png, read at runtime for the window icon on Linux: resources/icon.png)
    extraResource: ['./electron/db/migrations', './assets/icon.png'],
    // See RUNTIME_MODULES above: no pruning, node_modules excluded, runtime deps copied in afterCopy.
    prune: false,
    ignore: [
      /^\/(src|electron|public|assets|node_modules|\.angular|\.vscode|out|local-data)(\/|$)/,
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
  // The Squirrel installer on Windows, a zip and an rpm on Linux. The deb maker is left out because it needs `dpkg`,
  // which Fedora and other rpm systems do not have; add it where `dpkg` exists.
  makers: process.platform === 'win32' ? WINDOWS_MAKERS : LINUX_MAKERS,
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
