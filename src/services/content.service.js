'use strict';

/**
 * content.service.js — Orchestrator for AI content generation.
 *
 * Pipeline:
 *  1. Validate input (idea length, platform set, enum values).
 *  2. Detect language (franc) if not provided by the caller.
 *  3. Resolve AI keys: user's stored key → system .env fallback.
 *  4. Build platform-aware prompt via promptBuilder.
 *  5. Dispatch to the requested AI provider (OpenAI or Anthropic).
 *  6. Parse, validate, and format the structured JSON response.
 *  7. Return a clean response object — never raw AI output.
 *
 * Security:
 *  - resolveAiKeys() is an internal-only function; keys are never exposed in responses.
 *  - No AI key material appears in logs or error messages.
 */

const { franc } = require('franc');

const { buildPrompt, VALID_POST_TYPES, VALID_TONES, VALID_PLATFORMS } = require('../utils/promptBuilder');
const { generateWithOpenAI }    = require('./openai.service');
const { generateWithAnthropic } = require('./anthropic.service');
const { generateWithGroq }      = require('./groq.service');
const { resolveAiKeys }         = require('./user.service');
const { enforce: enforcePlatformRules, validateAiShape } = require('../utils/platformRules');
const env                       = require('../config/env');
const logger                    = require('../utils/logger').child('ContentService');

// ── Constants ─────────────────────────────────────────────────────────────────

const IDEA_MAX_LENGTH = 500;

/**
 * franc returns ISO 639-3 codes; map common ones to ISO 639-1 for the prompt.
 * Unmapped codes fall through as-is — the model still understands them.
 */
const FRANC_TO_ISO1 = {
  eng: 'en', fra: 'fr', deu: 'de', spa: 'es', ita: 'it',
  por: 'pt', rus: 'ru', jpn: 'ja', zho: 'zh', kor: 'ko',
  ara: 'ar', hin: 'hi', nld: 'nl', swe: 'sv', nor: 'no',
  dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', vie: 'vi',
  ind: 'id', tha: 'th', heb: 'he', fas: 'fa', ukr: 'uk',
};

// ── Domain error ──────────────────────────────────────────────────────────────

class ContentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name  = 'ContentError';
    this.status = status;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates the raw request body against all business rules.
 * Throws ContentError (400) on the first violation found.
 *
 * @param {object} body  Raw req.body
 * @returns {{ idea, post_type, platforms, tone, language, model }}
 */
function validateInput(body) {
  const { idea, post_type, platforms, tone, language, model } = body || {};

  // idea
  if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
    throw new ContentError('idea is required and must be a non-empty string');
  }
  if (idea.trim().length > IDEA_MAX_LENGTH) {
    throw new ContentError(`idea exceeds the maximum length of ${IDEA_MAX_LENGTH} characters`);
  }

  // post_type
  if (!post_type || !VALID_POST_TYPES.has(post_type)) {
    throw new ContentError(
      `post_type must be one of: ${[...VALID_POST_TYPES].join(', ')}`,
    );
  }

  // platforms
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new ContentError('platforms must be a non-empty array');
  }
  const invalidPlatforms = platforms.filter((p) => !VALID_PLATFORMS.has(p));
  if (invalidPlatforms.length > 0) {
    throw new ContentError(
      `Invalid platform(s): ${invalidPlatforms.join(', ')}. Allowed: ${[...VALID_PLATFORMS].join(', ')}`,
    );
  }

  // tone
  if (!tone || !VALID_TONES.has(tone)) {
    throw new ContentError(
      `tone must be one of: ${[...VALID_TONES].join(', ')}`,
    );
  }

  // model
  const validModels = ['openai', 'anthropic'];
  if (!model || !validModels.includes(model)) {
    throw new ContentError(`model must be one of: ${validModels.join(', ')}`);
  }

  return {
    idea:      idea.trim(),
    post_type,
    platforms: [...new Set(platforms)],  // deduplicate
    tone,
    language:  language && typeof language === 'string' ? language.trim() : null,
    model,
  };
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Returns an ISO language code for use in prompts.
 * Uses caller-provided language if present; falls back to franc auto-detection.
 *
 * @param {string|null} providedLanguage
 * @param {string}      idea
 * @returns {string}  e.g. "en", "fr", "de"
 */
function resolveLanguage(providedLanguage, idea) {
  if (providedLanguage) return providedLanguage;

  const detected = franc(idea, { minLength: 5 });

  // franc returns 'und' when it cannot determine the language.
  if (!detected || detected === 'und') return 'en';

  return FRANC_TO_ISO1[detected] || detected;
}

// ── Response formatting ───────────────────────────────────────────────────────

/**
 * Parses the raw JSON string returned by the AI model and normalises each
 * platform block into the canonical response shape.
 *
 * Adds char_count where the platform includes it but the model omitted it.
 * Ensures hashtag arrays are always arrays of strings.
 *
 * @param {string}   raw        Raw JSON string from AI provider.
 * @param {string[]} platforms  Requested platform list.
 * @returns {object}  The `generated` object ready for the HTTP response.
 */
function formatGeneratedContent(raw, platforms) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('AI returned malformed JSON. Please retry.');
    err.status = 502;
    throw err;
  }

  const generated = {};

  for (const platform of platforms) {
    const block = parsed[platform];
    if (!block || typeof block !== 'object') {
      generated[platform] = { content: '', error: 'Model did not generate content for this platform.' };
      continue;
    }

    // Run the model output through the platform-rule enforcer so we never
    // emit content that exceeds char limits or violates hashtag counts.
    const enforced = enforcePlatformRules(platform, {
      content:  block.content,
      hashtags: sanitiseHashtags(block.hashtags),
    });

    if (enforced.warnings.length > 0) {
      logger.warn('Platform rule warnings', { platform, warnings: enforced.warnings.join('; ') });
    }

    switch (platform) {
      case 'twitter':
      case 'linkedin':
        generated[platform] = {
          content:    enforced.content,
          char_count: enforced.char_count,
          hashtags:   enforced.hashtags,
        };
        break;

      case 'instagram':
        generated.instagram = {
          content:  enforced.content,
          hashtags: enforced.hashtags,
        };
        break;

      case 'threads':
        generated.threads = { content: enforced.content };
        break;

      default:
        generated[platform] = { content: enforced.content };
    }
  }

  return generated;
}

/**
 * Ensures hashtags is an array of '#'-prefixed strings.
 * Accepts array or undefined/null from the model.
 */
function sanitiseHashtags(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h) => typeof h === 'string' && h.trim().length > 0)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Generates platform-specific social media content using the requested AI model.
 *
 * @param {object} rawBody   req.body from the HTTP layer.
 * @param {string} userId    Authenticated user ID (used to resolve stored AI keys).
 *
 * @returns {Promise<{
 *   generated:   object,
 *   model_used:  string,
 *   tokens_used: number,
 * }>}
 */
async function generateContent(rawBody, userId) {
  // 1. Validate
  const { idea, post_type, platforms, tone, language: rawLanguage, model } = validateInput(rawBody);

  // 2. Language detection
  const language = resolveLanguage(rawLanguage, idea);

  // 3. Resolve AI keys (user key takes precedence over system fallback)
  const userKeys = userId ? await resolveAiKeys(userId) : { openai_key: null, anthropic_key: null };

  // 4. Build prompt
  const prompt = buildPrompt({ idea, post_type, platforms, tone, language });

  // 5. Run the fallback chain
  const { result, generated } = await runFallbackChain({ prompt, platforms, model, userKeys });

  // 6. Return structured response
  return {
    generated,
    model_used:  result.model_used,
    tokens_used: result.tokens_used,
  };
}

// ── Provider fallback chain ───────────────────────────────────────────────────

/**
 * Builds the ordered list of provider attempts based on what's available.
 *
 * Priority:
 *   1. User-provided key for the requested model (OpenAI or Anthropic)
 *   2. System OpenAI key
 *   3. System Anthropic key
 *   4. Groq (final fallback)
 *
 * Each attempt is a thin closure returning a Promise of the provider result.
 */
function buildAttempts({ prompt, model, userKeys }) {
  const attempts = [];
  const seen = new Set();

  const push = (label, key, fn) => {
    if (!key) return;
    const id = `${label}:${key.slice(-6)}`;
    if (seen.has(id)) return;       // skip duplicate (e.g. user key === system key)
    seen.add(id);
    attempts.push({ label, run: () => fn(prompt, key) });
  };

  // 1. User-provided key for the requested model
  if (model === 'openai') {
    push('user-openai',    userKeys.openai_key,    generateWithOpenAI);
  } else if (model === 'anthropic') {
    push('user-anthropic', userKeys.anthropic_key, generateWithAnthropic);
  }

  // 2. System OpenAI
  push('system-openai',    env.openaiApiKey,    generateWithOpenAI);

  // 3. System Anthropic
  push('system-anthropic', env.anthropicApiKey, generateWithAnthropic);

  // 4. Groq (final fallback)
  push('groq',             env.groqApiKey,      generateWithGroq);

  return attempts;
}

/**
 * Tries each provider in order. For every attempt:
 *   - If the call throws, log and move on to the next provider.
 *   - If it returns malformed JSON, retry the same provider once, then move on.
 *
 * If every provider fails, throws a ContentError with the last seen status.
 */
async function runFallbackChain({ prompt, platforms, model, userKeys }) {
  const attempts = buildAttempts({ prompt, model, userKeys });

  if (attempts.length === 0) {
    throw new ContentError(
      'No AI provider is available. Add your OpenAI or Anthropic key under Settings → AI Keys.',
      422,
    );
  }

  let lastError = null;

  for (const attempt of attempts) {
    for (let tryNum = 1; tryNum <= 2; tryNum++) {
      try {
        const result = await attempt.run();
        const generated = tryParseAndFormat(result.raw, platforms);
        if (generated) {
          return { result, generated };
        }
        // JSON invalid → retry the same provider once, then break to next
        logger.warn('AI provider returned invalid JSON', { provider: attempt.label, attempt: tryNum });
      } catch (err) {
        // Log without leaking key material; provider services already strip secrets.
        logger.warn('AI provider call failed', { provider: attempt.label, error: err.message });
        lastError = err;
        break;  // move to next provider — do not retry on transport/auth errors
      }
    }
  }

  // All providers exhausted.
  const err = new ContentError(
    'All AI providers failed to generate content. Please retry shortly.',
    lastError?.status || 502,
  );
  throw err;
}

/**
 * Attempts to parse + format the raw provider response.
 * Returns the formatted `generated` object on success, or null on JSON failure
 * so the caller can retry / fall through.
 */
function tryParseAndFormat(raw, platforms) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;  // malformed JSON — caller will retry/fallback
  }

  // Schema validation: require a block per requested platform with non-empty content.
  const shape = validateAiShape(parsed, platforms);
  if (!shape.valid) {
    logger.warn('AI output failed shape validation', { reason: shape.reason });
    return null;
  }

  return formatGeneratedContent(raw, platforms);
}

module.exports = { generateContent, ContentError };
