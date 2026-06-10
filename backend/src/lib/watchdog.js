'use strict';

const http = require('http');

/**
 * @param {object} options
 * @param {number} options.intervalMs
 * @param {number} [options.timeoutMs=500]
 * @param {number} [options.failThreshold=2]
 * @param {Object} options.processManager
 */
function createWatchdog({ intervalMs, timeoutMs = 500, failThreshold = 2, processManager }) {
  let intervalId = null;
  const registry = new Map();

  function pollHealth(entry) {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      const req = http.get(entry.healthUrl, { signal: controller.signal }, (res) => {
        clearTimeout(timeoutId);
        res.resume(); // consume data
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      });

      req.on('error', () => {
        clearTimeout(timeoutId);
        resolve(false);
      });
    });
  }

  async function checkAll() {
    for (const [subsystem, entry] of registry.entries()) {
      const ok = await pollHealth(entry);
      if (ok) {
        entry.consecutiveFailures = 0;
      } else {
        entry.consecutiveFailures += 1;
        if (entry.consecutiveFailures >= failThreshold) {
          try {
            process.kill(entry.pid, 'SIGTERM');
          } catch (e) {
            // might already be dead
          }
          
          setTimeout(() => {
            try {
              // check if still alive, process.kill with signal 0 checks existence
              process.kill(entry.pid, 0); 
              process.kill(entry.pid, 'SIGKILL');
            } catch (e) {
               // already exited
            }
          }, 5000);
          
          // processManager.onChildExit() will handle respawn
        }
      }
    }
  }

  return {
    register(subsystem, healthUrl, pid) {
      registry.set(subsystem, { healthUrl, pid, consecutiveFailures: 0 });
    },
    deregister(subsystem) {
      registry.delete(subsystem);
    },
    start() {
      if (!intervalId) {
        intervalId = setInterval(checkAll, intervalMs);
      }
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  };
}

module.exports = {
  createWatchdog
};
