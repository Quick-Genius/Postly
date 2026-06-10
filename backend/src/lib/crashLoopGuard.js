'use strict';

/**
 * @param {object} options
 * @param {number} [options.windowMs=60000]
 * @param {number} [options.maxRestarts=6]
 */
function createCrashLoopGuard({ windowMs = 60000, maxRestarts = 6 } = {}) {
  let history = [];
  let halted = false;

  return {
    record(pid) {
      const now = Date.now();
      // prune entries strictly older than (now - windowMs)
      history = history.filter(entry => (now - entry.timestamp) <= windowMs);
      history.push({ pid, timestamp: now });

      if (history.length >= maxRestarts) {
        halted = true;
      }
      return halted;
    },

    isHalted() {
      return halted;
    },

    getHistory() {
      return [...history];
    },

    reset() {
      history = [];
      halted = false;
    }
  };
}

module.exports = {
  createCrashLoopGuard
};
