import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolve defaultSourceRoot for ESM context. */
const defaultSourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export { defaultSourceRoot };

/**
 * The per-user data directory the macOS desktop app (desktop/main.js) runs
 * with, or '' for every other launch. Its app bundle is read-only and signed,
 * so files the server writes beside the source (.env, logs) go here instead.
 */
function desktopDataDir(env = process.env) {
  return env.GEV_LAUNCHER === 'desktop' ? env.GEV_DATA_DIR || '' : '';
}

/**
 * Where provider disk caches (.gev-cache) live: the desktop data directory,
 * else the working directory every other launch starts in.
 */
function cacheRoot() {
  return desktopDataDir() || process.cwd();
}

export { cacheRoot, desktopDataDir };
