#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPinokioEnvironment } from './pinokio-environment.mjs';
import { isDirectInvocation } from './pinokio-install.mjs';
import { validatePinokioSharing } from './pinokio-preflight.mjs';
import { currentLauncher } from './launcher.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = realpathSync(path.resolve(path.dirname(MODULE_PATH), '..'));

function launchPort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${currentLauncher().label} did not supply a valid local port.`);
  }
  return port;
}

export async function loadViteFromCanonicalRoot(
  root = ROOT,
  loadVite = () => import('vite'),
) {
  process.chdir(realpathSync(path.resolve(root)));
  return loadVite();
}

async function start() {
  // Read before applying the app ENVIRONMENT, which may not name the launcher.
  const launcher = currentLauncher();
  applyPinokioEnvironment();
  validatePinokioSharing();
  const port = launchPort(process.env.PORT);
  // Provider Settings routes credential writes to this launcher's ENVIRONMENT
  // (tartarus/ or pinokio/, never .env). The marker is set here — after
  // applyPinokioEnvironment, before Vite snapshots process.env — so the
  // dev-server endpoint knows which store this launch owns.
  process.env.GEV_LAUNCHER = launcher.id;
  console.log(`[${launcher.label}] Local-only launch.`);

  // Import Vite only after app-scoped blank fields have replaced any merged
  // Pinokio-global values. Vite snapshots process.env during configuration.
  const { createServer } = await loadViteFromCanonicalRoot();
  const server = await createServer({
    root: ROOT,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  });
  await server.listen();
  server.printUrls();
  console.log(`[${launcher.label}] Ready at http://127.0.0.1:${port}/`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

if (isDirectInvocation(process.argv[1], MODULE_PATH)) {
  start().catch((error) => {
    console.error(`[${currentLauncher().label}] Start refused: ${error.message}`);
    process.exitCode = 1;
  });
}
