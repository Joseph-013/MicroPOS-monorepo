// Copies the barcode decoder (WebAssembly) from zxing-wasm into public/zxing/ so the build serves it from the till itself
// (the camera scanner on paired phones loads it from there, never from the internet). Run before every build and dev server.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasm = createRequire(join(root, 'package.json')).resolve('zxing-wasm/reader/zxing_reader.wasm');
mkdirSync(join(root, 'public', 'zxing'), { recursive: true });
copyFileSync(wasm, join(root, 'public', 'zxing', 'zxing_reader.wasm'));
