'use strict';

/**
 * anthropic.service.js — Clean abstraction over the Anthropic Messages API.
 *
 * Responsibilities:
 *  - Instantiate the Anthropic client with the correct API key (user > system).
 *  - Call claude-sonnet-4-5 with a strict JSON-only system instruction.
 *  - Parse the text response into a raw JSON string.
 *  - Return { raw, tokens_used } so the caller can parse and format.
 *
 * Security:
 *  - API keys are never logged or included in error messages.
 *  - A new client is instantiated per call so user keys don't persist in memory.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-5';

/**
 * Calls Claude Sonnet 4.5 with the given prompt pair.
 *
 * @param {{ system: string, user: string }} prompt  Built by promptBuilder.buildPrompt().
 * @param {string|null} apiKey                       User's key, or null to use system key.
 *
 * @returns {Promise<{ raw: string, tokens_used: number, model_used: string }>}
 * @throws  On API failure or unusable response.
 */
async function generateWithAnthropic(prompt, apiKey) {
  const resolvedKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!resolvedKey) {
    const err = new Error('No Anthropic API key available. Add your key under Settings → AI Keys.');
    err.status = 422;
    throw err;
  }

  // Per-request client — user keys must not bleed across requests.
  const client = new Anthropic({ apiKey: resolvedKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: prompt.system,
      messages: [
        { role: 'user', content: prompt.user },
      ],
    });
  } catch (err) {
    const status = err.status || 502;
    const message = err.message?.toLowerCase().includes('authentication')
      ? 'Invalid Anthropic API key. Please update your key under Settings → AI Keys.'
      : `Anthropic API error: ${err.message || 'Unknown error'}`;

    const wrapped = new Error(message);
    wrapped.status = status;
    throw wrapped;
  }

  // Claude returns an array of content blocks; we expect a single text block.
  const textBlock = response.content?.find((block) => block.type === 'text');
  if (!textBlock?.text) {
    const err = new Error('Anthropic returned an empty or non-text response. Please retry.');
    err.status = 502;
    throw err;
  }

  // Claude sometimes wraps JSON in markdown fences despite instructions.
  // Strip them defensively.
  const raw = stripMarkdownFences(textBlock.text.trim());

  const tokens_used =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  return {
    raw,
    tokens_used,
    model_used: MODEL,
  };
}

/**
 * Strips leading/trailing markdown code fences (```json … ``` or ``` … ```)
 * from a string, returning the inner content.
 *
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFences(text) {
  // Match ```json\n...\n``` or ```\n...\n```
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
}

module.exports = { generateWithAnthropic };
