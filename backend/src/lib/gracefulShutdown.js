'use strict';

/**
 * Registers SIGTERM handler and a 30-second hard kill timer.
 *
 * @param {object} opts
 * @param {string} opts.subsystem
 * @param {Function} opts.drainFn
 * @param {Function} opts.closeFn
 * @param {number} opts.drainTimeoutMs
 */
function registerGracefulShutdown({ subsystem, drainFn, closeFn, drainTimeoutMs }) {
  process.on('SIGTERM', async () => {
    const killTimer = setTimeout(() => {
      process.exit(1);
    }, 30000);
    killTimer.unref();

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      if (drainFn) {
        await Promise.race([drainFn(), wait(drainTimeoutMs)]);
      }
      if (closeFn) {
        await Promise.race([closeFn(), wait(3000)]);
      }
    } catch (e) {
      // ignore errors during shutdown
    } finally {
      clearTimeout(killTimer);
      process.exit(0);
    }
  });
}

module.exports = {
  registerGracefulShutdown
};
