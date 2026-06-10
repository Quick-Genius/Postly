'use strict';

const { Worker } = require('worker_threads');
const path = require('path');
const logger = require('../utils/logger');

class QueueFullError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueFullError';
    this.status = 503;
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.status = 504;
  }
}

function createWorkerThreadPool({ minThreads = 2, maxThreads = 4, taskTimeoutMs = 30000, maxQueueSize = 100 } = {}) {
  const workerScript = path.join(__dirname, 'workerThread.js');
  const pool = [];
  const idle = [];
  const queue = [];
  let isShuttingDown = false;

  function spawn() {
    if (pool.length >= maxThreads) return null;
    const worker = new Worker(workerScript);
    const workerInfo = { worker, activeTask: null, timeoutTimer: null };
    pool.push(workerInfo);
    idle.push(workerInfo);

    worker.on('message', (msg) => {
      if (workerInfo.activeTask && workerInfo.activeTask.task.id === msg.id) {
        clearTimeout(workerInfo.timeoutTimer);
        const { resolve, reject } = workerInfo.activeTask;
        workerInfo.activeTask = null;
        workerInfo.timeoutTimer = null;
        
        if (msg.ok) {
          resolve(msg.result);
        } else {
          const err = new Error(msg.error);
          err.stack = msg.stack;
          reject(err);
        }
        
        makeIdle(workerInfo);
      }
    });

    worker.on('error', (err) => {
      logger.error('Worker thread error', { err });
      handleWorkerFailure(workerInfo, err);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && !isShuttingDown) {
        logger.error('Worker thread exited unexpectedly', { code });
        handleWorkerFailure(workerInfo, new Error(`Worker exited with code ${code}`));
      }
    });

    return workerInfo;
  }

  function handleWorkerFailure(workerInfo, err) {
    if (workerInfo.activeTask) {
      clearTimeout(workerInfo.timeoutTimer);
      // HTTP 500 equivalent rejection
      workerInfo.activeTask.reject(err);
      workerInfo.activeTask = null;
    }
    removeWorker(workerInfo);
    workerInfo.worker.terminate().catch(() => {});
    if (!isShuttingDown) {
      spawn();
      processQueue();
    }
  }

  function removeWorker(workerInfo) {
    const pIdx = pool.indexOf(workerInfo);
    if (pIdx > -1) pool.splice(pIdx, 1);
    const iIdx = idle.indexOf(workerInfo);
    if (iIdx > -1) idle.splice(iIdx, 1);
  }

  function makeIdle(workerInfo) {
    if (isShuttingDown) return;
    idle.push(workerInfo);
    processQueue();
  }

  function processQueue() {
    if (isShuttingDown || queue.length === 0) return;
    let workerInfo = idle.pop();
    if (!workerInfo && pool.length < maxThreads) {
      workerInfo = spawn();
      if (workerInfo) {
        idle.pop(); // remove from idle since it will immediately take a task
      }
    }
    
    if (workerInfo) {
      const pendingTask = queue.shift();
      assignTask(workerInfo, pendingTask);
    }
  }

  function assignTask(workerInfo, pendingTask) {
    workerInfo.activeTask = pendingTask;
    workerInfo.timeoutTimer = setTimeout(() => {
      const err = new TimeoutError(`Task timeout after ${taskTimeoutMs}ms`);
      logger.warn('Worker task timeout', { taskId: pendingTask.task.id });
      handleWorkerFailure(workerInfo, err);
    }, taskTimeoutMs);

    workerInfo.worker.postMessage(pendingTask.task);
  }

  for (let i = 0; i < minThreads; i++) {
    spawn();
  }

  return {
    async run(task) {
      if (isShuttingDown) {
        throw new Error('Pool is shutting down');
      }

      return new Promise((resolve, reject) => {
        const pendingTask = { task, resolve, reject };

        let workerInfo = idle.pop();
        if (!workerInfo && pool.length < maxThreads) {
          workerInfo = spawn();
          if (workerInfo) {
            idle.pop();
          }
        }

        if (workerInfo) {
          assignTask(workerInfo, pendingTask);
        } else {
          if (queue.length < maxQueueSize) {
            queue.push(pendingTask);
          } else {
            logger.warn('Worker thread pool queue full', { queueSize: queue.length });
            reject(new QueueFullError('Worker thread pool queue full'));
          }
        }
      });
    },

    async shutdown() {
      isShuttingDown = true;
      queue.forEach(q => q.reject(new Error('Pool shutting down')));
      queue.length = 0;
      
      const terminations = pool.map(w => w.worker.terminate());
      await Promise.all(terminations);
    },

    stats() {
      return {
        active: pool.length - idle.length,
        queued: queue.length,
        total: pool.length
      };
    }
  };
}

module.exports = {
  createWorkerThreadPool,
  QueueFullError,
  TimeoutError
};
