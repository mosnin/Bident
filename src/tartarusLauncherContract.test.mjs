import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ALL_LAUNCHERS,
  currentLauncher,
  isLauncherId,
} from '../scripts/launcher.mjs';
import { defaultEnvironmentFile } from '../scripts/pinokio-environment.mjs';

const require = createRequire(import.meta.url);
const ROOT = realpathSync(new URL('..', import.meta.url));

const APP_VALUE_FIELDS = [
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_SERVER_API_KEY',
  'CESIUM_ION_TOKEN',
  'OPENAI_API_KEY',
  'AISSTREAM_API_KEY',
  'FIRMS_MAP_KEY',
  'TOMTOM_API_KEY',
  'OPENSKY_CLIENT_ID',
  'OPENSKY_CLIENT_SECRET',
  'LL2_API_TOKEN',
  'GEV_RATELIMIT_OPENAI_PER_MIN',
  'GEV_RATELIMIT_GOOGLE_PER_MIN',
];

test('the launcher marker selects Tartarus only when a Tartarus script says so', () => {
  assert.equal(currentLauncher({ GEV_LAUNCHER: 'tartarus' }).id, 'tartarus');
  assert.equal(currentLauncher({ GEV_LAUNCHER: 'tartarus' }).label, 'Tartarus');
  for (const value of [
    undefined,
    '',
    'pinokio',
    'dev-fresh',
    'desktop',
    'TARTARUS',
  ]) {
    assert.equal(currentLauncher({ GEV_LAUNCHER: value }).id, 'pinokio');
  }
  assert.deepEqual(
    ALL_LAUNCHERS.map((launcher) => launcher.dir),
    ['tartarus', 'pinokio'],
  );
  assert.equal(isLauncherId('tartarus'), true);
  assert.equal(isLauncherId('pinokio'), true);
  for (const value of ['dev-fresh', 'desktop', '', undefined, '../pinokio']) {
    assert.equal(isLauncherId(value), false);
  }
});

test('each launcher keeps its ENVIRONMENT in its own folder', () => {
  assert.equal(
    defaultEnvironmentFile({ GEV_LAUNCHER: 'tartarus' }),
    path.join(ROOT, 'tartarus', 'ENVIRONMENT'),
  );
  assert.equal(
    defaultEnvironmentFile({}),
    path.join(ROOT, 'pinokio', 'ENVIRONMENT'),
  );
});

test('every Tartarus script runs the shared launcher script as a Tartarus launch', () => {
  for (const [file, command] of [
    ['install.js', 'node scripts/pinokio-install.mjs'],
    ['start.js', 'node scripts/pinokio-start.mjs'],
    ['update.js', 'node scripts/pinokio-update.mjs'],
    ['reset.js', 'node scripts/pinokio-reset.mjs'],
  ]) {
    const script = require(`../tartarus/${file}`);
    const step = script.run.at(file === 'start.js' ? 0 : -1);
    assert.equal(step.method, 'shell.run', file);
    assert.equal(step.params.path, '..', file);
    assert.equal(step.params.message, command, file);
    assert.equal(step.params.env.GEV_LAUNCHER, 'tartarus', file);
  }
});

test('Tartarus scripts forward the same app fields as the Pinokio scripts', () => {
  for (const file of ['install.js', 'start.js', 'update.js']) {
    const tartarus = require(`../tartarus/${file}`);
    const pinokio = require(`../pinokio/${file}`);
    const index = file === 'start.js' ? 0 : -1;
    const tartarusEnv = { ...tartarus.run.at(index).params.env };
    delete tartarusEnv.GEV_LAUNCHER;
    assert.deepEqual(tartarusEnv, pinokio.run.at(index).params.env, file);
    for (const field of APP_VALUE_FIELDS) {
      assert.equal(
        tartarusEnv[field],
        `{{env.${field} || ""}}`,
        `${file} ${field}`,
      );
    }
  }
  const install = require('../tartarus/install.js');
  assert.equal(install.run[0].when, "{{!kernel.exists(cwd, 'ENVIRONMENT')}}");
  assert.deepEqual(install.run[0].params, {
    src: '_ENVIRONMENT',
    dest: 'ENVIRONMENT',
  });
});

test('Tartarus start waits for the Tartarus ready line and records the URL', () => {
  const script = require('../tartarus/start.js');
  const ready = new RegExp(script.run[0].params.on[0].event.slice(1, -1));
  const match = '[Tartarus] Ready at http://127.0.0.1:4173/'.match(ready);
  assert.equal(match?.[1], 'http://127.0.0.1:4173/');
  assert.equal('[Pinokio] Ready at http://127.0.0.1:4173/'.match(ready), null);
  assert.equal(script.daemon, true);
  assert.equal(script.run[1].method, 'local.set');
  assert.equal(script.run[1].params.url, '{{input.event[1]}}');
  assert.equal('PINOKIO_SHARE_PASSCODE' in script.run[0].params.env, false);
});

test('the Tartarus ENVIRONMENT template ships the same settings as Pinokio', async () => {
  const settings = (text) =>
    text.split('\n').filter((line) => line && !line.startsWith('#'));
  const tartarus = await readFile(
    new URL('../tartarus/_ENVIRONMENT', import.meta.url),
    'utf8',
  );
  const pinokio = await readFile(
    new URL('../pinokio/_ENVIRONMENT', import.meta.url),
    'utf8',
  );
  assert.deepEqual(settings(tartarus), settings(pinokio));
  assert.match(tartarus, /^PINOKIO_SHARE_CLOUDFLARE=false$/m);
});

test('the Tartarus menu reads tartarus/.installed and exposes each lifecycle state', async (t) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'gev-tartarus-menu-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const launcherDir = path.join(fixture, 'app', 'tartarus');
  const launcherPath = path.join(launcherDir, 'tartarus.js');
  const markerPath = path.join(launcherDir, '.installed');
  await mkdir(launcherDir, { recursive: true });
  await copyFile(
    new URL('../tartarus/tartarus.js', import.meta.url),
    launcherPath,
  );

  const existsCalls = [];
  const kernel = {
    exists: async (...chunks) => {
      existsCalls.push(chunks);
      try {
        await access(path.resolve(...chunks));
        return true;
      } catch {
        return false;
      }
    },
  };
  const runtime = { running: null, url: null };
  const info = {
    running: (href) => runtime.running === href,
    local: () => (runtime.url ? { url: runtime.url } : {}),
  };
  const launcher = require(launcherPath);
  assert.equal(launcher.title, 'Bident');
  assert.equal(launcher.icon, 'icon.png');
  await access(new URL('../tartarus/icon.png', import.meta.url));
  const render = async ({ installed, running = null, url = null }) => {
    if (installed) await writeFile(markerPath, 'ready\n');
    else await rm(markerPath, { force: true });
    runtime.running = running;
    runtime.url = url;
    const items = await launcher.menu(kernel, info);
    assert.equal(items.filter((item) => item.default).length, 1);
    return items.map(({ text, href }) => ({ text, href }));
  };

  assert.deepEqual(await render({ installed: false }), [
    { text: 'Install', href: 'install.js' },
  ]);
  assert.deepEqual(await render({ installed: true }), [
    { text: 'Start', href: 'start.js' },
    { text: 'Update', href: 'update.js' },
    { text: 'Repair installation', href: 'reset.js' },
  ]);
  assert.deepEqual(await render({ installed: true, running: 'update.js' }), [
    { text: 'Updating', href: 'update.js' },
  ]);
  assert.deepEqual(
    await render({
      installed: true,
      running: 'start.js',
      url: 'http://127.0.0.1:4173/',
    }),
    [
      { text: 'Open Bident', href: 'http://127.0.0.1:4173/' },
      { text: 'Server', href: 'start.js' },
    ],
  );
  const resolvedLauncherDir = realpathSync(launcherDir);
  for (const chunks of existsCalls) {
    assert.deepEqual(chunks, [resolvedLauncherDir, '.installed']);
  }
});

test('Tartarus keeps its credentials and install marker out of git', async () => {
  const gitignore = await readFile(
    new URL('../.gitignore', import.meta.url),
    'utf8',
  );
  assert.match(gitignore, /^tartarus\/ENVIRONMENT$/m);
  assert.match(gitignore, /^tartarus\/\.installed$/m);
});

// Provider Settings captures the launcher at module load, so this runs in a
// child process that boots exactly as a Tartarus launch does.
test('Provider Settings saves keys to tartarus/ENVIRONMENT under a Tartarus launch', async (t) => {
  const { execFile } = await import('node:child_process');
  const sourceRoot = await mkdtemp(
    path.join(os.tmpdir(), 'gev-tartarus-store-'),
  );
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  // A Tartarus install always has its launcher folder.
  await mkdir(path.join(sourceRoot, 'tartarus'));
  const child = `
    import { Readable } from 'node:stream';
    import { keySetupEndpoint } from ${JSON.stringify(path.join(ROOT, 'server/standalone/key-setup.js'))};
    const routes = new Map();
    keySetupEndpoint({ sourceRoot: process.argv[1] }).configureServer({
      middlewares: { use: (route, handler) => routes.set(route, handler) },
      restart: async () => {},
    });
    const call = (route, method, body = '') => new Promise((resolve, reject) => {
      const req = Readable.from(body ? [Buffer.from(body)] : []);
      Object.assign(req, {
        method, url: '/',
        headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json' },
        socket: { remoteAddress: '127.0.0.1' },
      });
      const res = {
        statusCode: 200, setHeader() {}, writeHead(status) { this.statusCode = status; },
        end(text = '') { resolve({ status: this.statusCode, body: JSON.parse(String(text) || '{}') }); },
      };
      Promise.resolve(routes.get(route)(req, res)).catch(reject);
    });
    const saved = await call('/api/setup/keys', 'POST', JSON.stringify({ OPENAI_API_KEY: 'sk-fixture-only-not-a-real-key' }));
    const status = await call('/api/setup/status', 'GET');
    console.log(JSON.stringify({ saved: saved.status, store: status.body.store }));
  `;
  const output = await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', child, sourceRoot],
      { env: { PATH: process.env.PATH, GEV_LAUNCHER: 'tartarus' } },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    );
  });
  const result = JSON.parse(output.trim().split('\n').at(-1));
  assert.deepEqual(result, { saved: 200, store: 'tartarus-environment' });
  assert.match(
    await readFile(path.join(sourceRoot, 'tartarus', 'ENVIRONMENT'), 'utf8'),
    /^OPENAI_API_KEY=sk-fixture-only-not-a-real-key$/m,
  );
  await assert.rejects(access(path.join(sourceRoot, 'pinokio', 'ENVIRONMENT')));
  await assert.rejects(access(path.join(sourceRoot, '.env')));
});
