import { defineConfig } from 'vitest/config';

// Only the pure TypeScript (the network client); screens and native modules are not unit tested.
export default defineConfig({ test: { include: ['src/**/*.spec.ts'], environment: 'node' } });
