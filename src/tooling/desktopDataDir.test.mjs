import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheRoot,
  desktopDataDir,
} from '../../server/providers/common/source-root.js';

test('only the desktop launcher redirects writes to its data directory', () => {
  assert.equal(
    desktopDataDir({ GEV_LAUNCHER: 'desktop', GEV_DATA_DIR: '/data/Bident' }),
    '/data/Bident',
  );
  assert.equal(desktopDataDir({ GEV_LAUNCHER: 'desktop' }), '');
  // A stray data dir without the launcher marker never moves a checkout's files.
  assert.equal(desktopDataDir({ GEV_DATA_DIR: '/data/Bident' }), '');
  assert.equal(
    desktopDataDir({ GEV_LAUNCHER: 'pinokio', GEV_DATA_DIR: '/data/Bident' }),
    '',
  );
});

test('provider caches follow the desktop data directory, else the working directory', () => {
  const saved = { ...process.env };
  try {
    delete process.env.GEV_LAUNCHER;
    delete process.env.GEV_DATA_DIR;
    assert.equal(cacheRoot(), process.cwd());
    Object.assign(process.env, {
      GEV_LAUNCHER: 'desktop',
      GEV_DATA_DIR: '/data/Bident',
    });
    assert.equal(cacheRoot(), '/data/Bident');
  } finally {
    for (const key of ['GEV_LAUNCHER', 'GEV_DATA_DIR']) {
      if (key in saved) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
});
