'use strict';

/**
 * openai.service.js — Clean abstraction over the OpenAI Chat Completions API.
 *
 * Responsibilities:
 *  - Instantiate the OpenAI client with the correct API key (user > system).
 *  - Call GPT-4o with JSON mode enforced via response_format.
 *  - Return { raw, tokens_used } so the caller can parse and format.
 *
 * Security:
 *  - API keys are never logged or included in error messages.
 *  - A new client is instantiated per call so user keys don't persist in memory
 *    across requests.
 */

const OpenAI = require('openai');

const MODEL = 'gpt-4o';

/**
 * Calls GPT-4o with the given prompt pair.
 *
 * @param {{ system: string, user: string }} prompt  Built by promptBuilder.buildPrompt().
 * @param {string|null} apiKey                       User's key, or null to use system key.
 *
 * @returns {Promise<{ raw: string, tokens_used: number }>}
 * @throws  {ContentGenerationError} on API or parse failure.
 */
async function generateWithOpenAI(prompt, apiKey) {
  const resolvedKey = apiKey || process.env.OPENAI_API_KEY;

  if (!resolvedKey) {
    const err = new Error('No OpenAI API key available. Add your key under Settings → AI Keys.');
    err.status = 422;
    throw err;
  }

  // Instantiate per-request so user keys do not leak between requests.
  const client = new OpenAI({ apiKey: resolvedKey });

  let response;
  try {
    response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user',   content: prompt.user   },
      ],
      // Force JSON output — the model will never wrap the response in prose.
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2048,
    });
  } catch (err) {
    // Surface a clean error; never expose the raw key in the message.
    const status = err.status || 502;
    const message = err.message?.includes('Incorrect API key')
      ? 'Invalid OpenAI API key. Please update your key under Settings → AI Keys.'
      : `OpenAI API error: ${err.message || 'Unknown error'}`;

    const wrapped = new Error(message);
    wrapped.status = status;
    throw wrapped;
  }

  const choice = response.choices?.[0];
  if (!choice?.message?.content) {
    const err = new Error('OpenAI returned an empty response. Please retry.');
    err.status = 502;
    throw err;
  }

  return {
    raw:         choice.message.content,
    tokens_used: response.usage?.total_tokens ?? 0,
    model_used:  MODEL,
  };
}

module.exports = { generateWithOpenAI };
