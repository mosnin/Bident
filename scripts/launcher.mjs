/**
 * Which one-click launcher is driving this process: Tartarus or Pinokio.
 *
 * Both launchers run the same scripts (scripts/pinokio-*.mjs). Each keeps its
 * own app-scoped state next to its launcher files — `tartarus/ENVIRONMENT`
 * and `tartarus/.installed`, or `pinokio/ENVIRONMENT` and
 * `pinokio/.installed` — so the two never read or overwrite each other.
 *
 * The launcher's own scripts say which one they are by passing
 * `GEV_LAUNCHER=tartarus`. Anything else, including no value, is Pinokio,
 * which never set the variable itself.
 *
 * @module scripts/launcher
 */

/** @typedef {'tartarus' | 'pinokio'} LauncherId */

const LAUNCHERS = Object.freeze({
  tartarus: Object.freeze({
    id: 'tartarus',
    dir: 'tartarus',
    label: 'Tartarus',
  }),
  pinokio: Object.freeze({ id: 'pinokio', dir: 'pinokio', label: 'Pinokio' }),
});

/**
 * @param {Record<string, string|undefined>} [env] - Environment to read.
 * @returns {{id: LauncherId, dir: string, label: string}} The active launcher.
 */
export function currentLauncher(env = process.env) {
  return env.GEV_LAUNCHER === 'tartarus'
    ? LAUNCHERS.tartarus
    : LAUNCHERS.pinokio;
}

/**
 * @param {unknown} value - A launcher marker, such as a boot-time GEV_LAUNCHER.
 * @returns {boolean} Whether it names a launcher that owns an app store.
 */
export function isLauncherId(value) {
  return value === 'tartarus' || value === 'pinokio';
}

/** Every launcher, for checks that must cover both. */
export const ALL_LAUNCHERS = Object.freeze(Object.values(LAUNCHERS));
