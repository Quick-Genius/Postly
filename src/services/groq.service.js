'use strict';

/**
 * groq.service.js — Final-fallback provider using Groq's OpenAI-compatible API.
 *
 * Used by content.service when the user's key, system OpenAI, and system
 * Anthropic keys are all unavailable or fail. Groq's free, low-latency Llama
 * models keep the system functional even when the primary providers are down.
 *
 * Security:
 *  - API key is never logged or surfaced in error messages.
 *  - A new client is instantiated per call (consistent with the other providers).
 */

const OpenAI = require('openai');

const MODEL    = 'llama-3.3-70b-versatile';
const BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Calls Groq with the given prompt pair using JSON mode.
 *
 * @param {{ system: string, user: string }} prompt
 * @param {string} apiKey  System Groq key.
 *
 * @returns {Promise<{ raw: string, tokens_used: number, model_used: string }>}
 */
async function generateWithGroq(prompt, apiKey) {
  if (!apiKey) {
    const err = new Error('No Groq API key configured.');
    err.status = 422;
    throw err;
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL });

  let response;
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user   },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2048,
    });
  } catch (err) {
    const status  = err.status || 502;
    const message = err.message?.toLowerCase().includes('invalid api key')
      ? 'Invalid Groq API key.'
      : `Groq API error: ${err.message || 'Unknown error'}`;

    const wrapped = new Error(message);
    wrapped.status = status;
    throw wrapped;
  }

  const choice = response.choices?.[0];
  if (!choice?.message?.content) {
    const err = new Error('Groq returned an empty response.');
    err.status = 502;
    throw err;
  }

  return {
    raw:         stripMarkdownFences(choice.message.content.trim()),
    tokens_used: response.usage?.total_tokens ?? 0,
    model_used:  MODEL,
  };
}

/**
 * Llama models occasionally wrap JSON in markdown fences despite JSON mode.
 * Strip them defensively so downstream parsing is robust.
 */
function stripMarkdownFences(text) {
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
}

module.exports = { generateWithGroq };
