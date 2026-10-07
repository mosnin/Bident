#!/usr/bin/env node
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentLauncher } from './launcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = currentLauncher();
for (const target of ['node_modules', 'dist', `${launcher.dir}/.installed`]) {
  rmSync(path.join(ROOT, target), { recursive: true, force: true });
}
console.log(`[${launcher.label}] Installation reset. Local credentials were preserved.`);
