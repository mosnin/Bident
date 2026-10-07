#!/usr/bin/env node
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPinokioEnvironment } from './pinokio-environment.mjs';
import { currentLauncher } from './launcher.mjs';
import { formatSetupReport, inspectSetup, npmProcessSpec } from './setup-doctor.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = realpathSync(path.resolve(path.dirname(MODULE_PATH), '..'));
// tartarus/.installed or pinokio/.installed: each launcher records its own install.
const readyFile = () => path.join(ROOT, currentLauncher().dir, '.installed');

export function runChecked(command, args, { shell = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
    shell,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

export function installPinokioDependencies() {
  applyPinokioEnvironment();
  const launcher = currentLauncher();
  rmSync(readyFile(), { force: true });
  const npm = npmProcessSpec();
  runChecked(npm.command, ['ci'], { shell: npm.shell });

  // Pinokio starts Vite directly and loads only its ENVIRONMENT file plus the
  // normal dotenv ladder. Unlike dev-fresh.sh, it does not import macOS
  // Keychain items, so its install report must describe that exact runtime.
  const report = inspectSetup({
    includeKeychain: false,
    // The raw app ENVIRONMENT file was applied above. Even an empty field now
    // shadows Vite's dotenv ladder, so diagnosis must stop there instead of
    // claiming a dotenv-only value will reach the launched app.
    authoritativeEnvironment: true,
  });
  console.log(`\n${formatSetupReport(report, {
    readyMessage: `Ready. Return to ${launcher.label} and choose Start.`,
  })}\n`);
  if (!report.ready) process.exit(1);

  writeFileSync(readyFile(), `${new Date().toISOString()}\n`, { mode: 0o600 });
  console.log(`[${launcher.label}] Installation ready.`);
}

export function isDirectInvocation(
  invokedPath = process.argv[1],
  modulePath = MODULE_PATH,
) {
  if (typeof invokedPath !== 'string' || invokedPath.length === 0) return false;
  if (typeof modulePath !== 'string' || modulePath.length === 0) return false;
  try {
    return realpathSync(path.resolve(invokedPath)) === realpathSync(path.resolve(modulePath));
  } catch {
    return path.resolve(invokedPath) === path.resolve(modulePath);
  }
}

if (isDirectInvocation()) {
  installPinokioDependencies();
}
