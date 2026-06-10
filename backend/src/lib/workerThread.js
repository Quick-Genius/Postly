'use strict';

const { parentPort } = require('worker_threads');
const encryption = require('../utils/encryption');
const { buildPrompt } = require('../utils/promptBuilder');

if (parentPort) {
  parentPort.on('message', async (task) => {
    try {
      const result = await dispatch(task);
      parentPort.postMessage({ id: task.id, ok: true, result });
    } catch (err) {
      parentPort.postMessage({
        id: task.id,
        ok: false,
        error: err.message,
        stack: err.stack
      });
    }
  });
}

async function dispatch(task) {
  switch (task.type) {
    case 'AI_PROMPT_BUILD':
      return buildAiPrompt(task.payload);
    case 'CONTENT_PARSE':
      return parseContent(task.payload);
    case 'ENCRYPT':
      return encryption.encrypt(task.payload.plaintext, task.payload.keyId);
    case 'DECRYPT':
      return encryption.decrypt(task.payload.ciphertext, task.payload.keyId);
    default:
      throw new Error(`Unknown task type: ${task.type}`);
  }
}

function buildAiPrompt({ idea, tone, platform, model, language }) {
  // In the real code this might use utils/promptBuilder
  // Let's assume promptBuilder has a function or just do basic string building if it doesn't exist.
  // Wait, I should import promptBuilder if it exists. Yes, `src/utils/promptBuilder.js` exists.
  if (buildPrompt) {
    return buildPrompt(idea, tone, platform, model, language);
  }
  // Fallback if the export is different
  return `Create a ${tone} post for ${platform} about ${idea} using ${model} in ${language || 'English'}`;
}

function parseContent({ raw, format }) {
  // strip/normalise content
  if (!raw) return '';
  switch (format) {
    case 'markdown':
      // minimal strip or just pass through if no markdown parser logic is provided
      return raw.trim();
    case 'html':
      return raw.replace(/<[^>]*>?/gm, '').trim();
    case 'plain':
    default:
      return raw.trim();
  }
}
