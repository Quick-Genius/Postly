'use strict';

/**
 * platformRules.js — Post-AI enforcement of per-platform constraints.
 *
 * The prompt asks the model to obey character limits and hashtag counts,
 * but we never trust raw model output. This module is the safety net:
 * after the response is parsed, every platform block is run through
 * `enforce()` to clamp content to platform limits and surface warnings.
 *
 * Source-of-truth for limits is here (mirrors promptBuilder.PLATFORM_RULES).
 */

const RULES = {
  twitter:   { maxChars: 280, minChars: null, hashtags: { min: 0,  max: 5  } },
  linkedin:  { maxChars: 1300, minChars: 800, hashtags: { min: 0,  max: 5  } },
  instagram: { maxChars: 2200, minChars: null, hashtags: { min: 10, max: 15 } },
  threads:   { maxChars: 500, minChars: null, hashtags: { min: 0,  max: 2  } },
  facebook:  { maxChars: 5000, minChars: null, hashtags: { min: 0,  max: 5  } },
};

/**
 * Trim a string to a max length without breaking the last word, when possible.
 * Falls back to a hard cut if there's no whitespace to break on.
 */
function smartTrim(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  // Only soft-break if the last space is reasonably close to the end.
  if (lastSpace > max * 0.7) return slice.slice(0, lastSpace).trimEnd();
  return slice.trimEnd();
}

/**
 * Apply platform constraints to a single platform's output.
 *
 * @param {string} platform   one of: twitter | linkedin | instagram | threads | facebook
 * @param {{ content: string, hashtags?: string[] }} block
 * @returns {{ content: string, hashtags: string[], char_count: number, warnings: string[] }}
 */
function enforce(platform, block) {
  const rule = RULES[platform];
  const warnings = [];

  let content  = typeof block?.content  === 'string' ? block.content  : '';
  let hashtags = Array.isArray(block?.hashtags) ? block.hashtags.filter((h) => typeof h === 'string') : [];

  if (!rule) {
    return { content, hashtags, char_count: content.length, warnings };
  }

  // Hard max: trim. (We never error — degraded output is better than no output.)
  if (rule.maxChars && content.length > rule.maxChars) {
    warnings.push(`content exceeded ${rule.maxChars} chars (was ${content.length}); trimmed`);
    content = smartTrim(content, rule.maxChars);
  }

  // Soft min: log only, do not pad. The model rarely under-shoots.
  if (rule.minChars && content.length < rule.minChars) {
    warnings.push(`content below recommended min ${rule.minChars} chars (was ${content.length})`);
  }

  // Hashtag count enforcement.
  if (rule.hashtags) {
    if (hashtags.length > rule.hashtags.max) {
      warnings.push(`hashtags truncated from ${hashtags.length} to ${rule.hashtags.max}`);
      hashtags = hashtags.slice(0, rule.hashtags.max);
    }
    if (hashtags.length < rule.hashtags.min) {
      warnings.push(`hashtags below recommended min ${rule.hashtags.min} (got ${hashtags.length})`);
    }
  }

  // Normalise: every hashtag begins with '#'.
  hashtags = hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`));

  return { content, hashtags, char_count: content.length, warnings };
}

/**
 * Validate the shape of an AI provider's parsed JSON response.
 * Returns { valid: boolean, reason?: string }.
 *
 * Required: parsed must be an object with a block per requested platform.
 * Each block must be an object with a non-empty `content` string.
 */
function validateAiShape(parsed, platforms) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'response is not a JSON object' };
  }
  for (const platform of platforms) {
    const block = parsed[platform];
    if (!block || typeof block !== 'object') {
      return { valid: false, reason: `missing block for platform "${platform}"` };
    }
    if (typeof block.content !== 'string' || block.content.trim().length === 0) {
      return { valid: false, reason: `platform "${platform}" has empty or non-string content` };
    }
  }
  return { valid: true };
}

module.exports = { enforce, validateAiShape, RULES };
