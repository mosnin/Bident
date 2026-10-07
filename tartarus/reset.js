module.exports = {
  run: [
    {
      method: 'shell.run',
      params: {
        path: '..',
        env: { GEV_LAUNCHER: 'tartarus' },
        message: 'node scripts/pinokio-reset.mjs',
      },
    },
  ],
};
