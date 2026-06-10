'use strict';

const { fork } = require('child_process');
const path = require('path');
const { createCrashLoopGuard } = require('./crashLoopGuard');
const logger = require('../utils/logger');

/**
 * @param {Object} config
 */
function createProcessManager(config) {
  const slots = [];
  let isShuttingDown = false;

  function createSlot(subsystem, index, scriptPath) {
    return {
      id: `${subsystem}-${index}`,
      subsystem,
      scriptPath,
      child: null,
      pid: null,
      restartCount: 0,
      guard: createCrashLoopGuard({ windowMs: 60000, maxRestarts: 6 })
    };
  }

  function spawnSlot(slot) {
    if (isShuttingDown || slot.guard.isHalted()) return;

    slot.child = fork(slot.scriptPath, [], { env: process.env });
    slot.pid = slot.child.pid;

    logger.info(`Spawned ${slot.subsystem} process`, {
      event: 'spawn',
      subsystem: slot.subsystem,
      pid: slot.pid
    });

    slot.child.on('exit', (code, signal) => {
      onChildExitInternal(slot, code, signal);
    });
  }

  function onChildExitInternal(slot, exitCode, signal) {
    const oldPid = slot.pid;
    slot.child = null;
    slot.pid = null;

    logger.warn(`${slot.subsystem} exited`, {
      event: 'exit',
      subsystem: slot.subsystem,
      pid: oldPid,
      exitCode,
      signal
    });

    if (isShuttingDown) return;

    const halted = slot.guard.record(oldPid);
    if (halted) {
      logger.error(`Crash loop halted for ${slot.subsystem}`, {
        event: 'crash_loop_halted',
        subsystem: slot.subsystem,
        restartHistory: slot.guard.getHistory(),
        windowMs: 60000
      });
      return;
    }

    const backoffs = [1000, 2000, 4000, 8000, 16000];
    const delay = slot.restartCount < backoffs.length ? backoffs[slot.restartCount] : 30000;
    slot.restartCount += 1;

    setTimeout(() => {
      if (!isShuttingDown && !slot.guard.isHalted()) {
        logger.info(`Restarting ${slot.subsystem}`, {
          event: 'restart',
          subsystem: slot.subsystem,
          pid: null,
          restartCount: slot.restartCount
        });
        spawnSlot(slot);
      }
    }, delay);
  }

  return {
    async start() {
      const processesDir = path.join(__dirname, '..', 'processes');
      
      slots.push(createSlot('api', 0, path.join(processesDir, 'api.js')));
      
      for (let i = 0; i < config.workerReplicas; i++) {
        slots.push(createSlot('worker', i, path.join(processesDir, 'worker.js')));
      }
      for (let i = 0; i < config.botReplicas; i++) {
        slots.push(createSlot('bot', i, path.join(processesDir, 'bot.js')));
      }

      for (const slot of slots) {
        spawnSlot(slot);
      }
    },

    onChildExit(subsystem, pid, exitCode, signal) {
      // Manual trigger if needed, though child.on('exit') covers most OS exits.
      const slot = slots.find(s => s.pid === pid);
      if (slot && slot.child) {
        // If child still active, let the OS event handle it.
      }
    },

    async shutdown() {
      isShuttingDown = true;
      
      const exitPromises = slots.map(slot => {
        return new Promise(resolve => {
          if (!slot.child || slot.child.killed || slot.pid === null) {
            resolve();
            return;
          }
          
          let resolved = false;
          const onExit = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          slot.child.on('exit', onExit);
          
          slot.child.kill('SIGTERM');
          
          setTimeout(() => {
            if (!resolved && slot.child) {
              slot.child.kill('SIGKILL');
              resolved = true;
              resolve();
            }
          }, 30000);
        });
      });

      await Promise.all(exitPromises);
    },

    getActivePids() {
      const map = new Map();
      for (const slot of slots) {
        if (slot.pid !== null) {
          if (!map.has(slot.subsystem)) map.set(slot.subsystem, []);
          map.get(slot.subsystem).push(slot.pid);
        }
      }
      return map;
    }
  };
}

module.exports = {
  createProcessManager
};
