'use strict';

/**
 * promptBuilder.js — Platform-aware prompt construction for AI content generation.
 *
 * Design principles:
 *  - All platform rules are defined in one place (PLATFORM_RULES) and never duplicated.
 *  - buildPrompt() returns a { system, user } tuple compatible with both OpenAI and Anthropic.
 *  - The system prompt is strict and instruction-first; the model is told to output JSON only.
 *  - Platform constraints (character limits, hashtag counts) are injected into the prompt
 *    so the model enforces them on its own generation rather than us truncating post-hoc.
 */

// ── Platform constraint registry ──────────────────────────────────────────────

const PLATFORM_RULES = {
  twitter: {
    maxChars: 280,
    tone: 'punchy and engaging',
    hashtagCount: '2–3',
    extraInstructions: [
      'Start with a strong hook that grabs attention in the first line.',
      'Be concise — every word must earn its place.',
      'Do NOT exceed 280 characters (including spaces and hashtags).',
    ],
    outputShape: '{ "content": string, "char_count": number, "hashtags": string[] }',
  },
  linkedin: {
    minChars: 800,
    maxChars: 1300,
    tone: 'professional and insightful',
    hashtagCount: '3–5',
    extraInstructions: [
      'Always use a professional, authoritative tone regardless of the requested tone.',
      'Structure the post: hook → body → insight/CTA.',
      'Content must be between 800 and 1300 characters.',
      'Use line breaks for readability.',
    ],
    outputShape: '{ "content": string, "char_count": number, "hashtags": string[] }',
  },
  instagram: {
    tone: 'vibrant and visual',
    hashtagCount: '10–15',
    extraInstructions: [
      'Write as a caption that pairs well with a photo or video.',
      'Use emojis naturally throughout the caption.',
      'Place all hashtags at the end of the caption, separated by a blank line.',
    ],
    outputShape: '{ "content": string, "hashtags": string[] }',
  },
  threads: {
    maxChars: 500,
    tone: 'conversational and authentic',
    hashtagCount: '0–2',
    extraInstructions: [
      'Write in a casual, conversational voice — like talking to a friend.',
      'Do NOT exceed 500 characters.',
      'Avoid excessive hashtags; 0–2 is ideal.',
    ],
    outputShape: '{ "content": string }',
  },
};

// ── Valid enum sets (mirrors controller validation) ───────────────────────────

const VALID_POST_TYPES = new Set(['announcement', 'thread', 'story', 'promotional', 'educational', 'opinion']);
const VALID_TONES      = new Set(['professional', 'casual', 'witty', 'authoritative', 'friendly']);
const VALID_PLATFORMS  = new Set(Object.keys(PLATFORM_RULES));

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Formats a single platform's rule block for inclusion in the system prompt.
 */
function formatPlatformBlock(platform) {
  const rule = PLATFORM_RULES[platform];
  const lines = [`### ${platform.toUpperCase()}`];

  if (rule.minChars && rule.maxChars) {
    lines.push(`- Character range: ${rule.minChars}–${rule.maxChars}`);
  } else if (rule.maxChars) {
    lines.push(`- Max characters: ${rule.maxChars}`);
  }

  lines.push(`- Default tone: ${rule.tone}`);
  lines.push(`- Hashtag count: ${rule.hashtagCount}`);

  for (const instruction of rule.extraInstructions) {
    lines.push(`- ${instruction}`);
  }

  lines.push(`- Output shape: ${rule.outputShape}`);

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a { system, user } prompt pair for the given generation request.
 *
 * @param {object} params
 * @param {string}   params.idea       Raw idea text from the user.
 * @param {string}   params.post_type  One of VALID_POST_TYPES.
 * @param {string[]} params.platforms  Subset of VALID_PLATFORMS.
 * @param {string}   params.tone       One of VALID_TONES.
 * @param {string}   params.language   ISO language code, e.g. "en", "fr".
 *
 * @returns {{ system: string, user: string }}
 */
function buildPrompt({ idea, post_type, platforms, tone, language }) {
  // Build the platform-specific rule blocks (only for requested platforms).
  const platformBlocks = platforms
    .filter((p) => VALID_PLATFORMS.has(p))
    .map(formatPlatformBlock)
    .join('\n\n');

  // Build the expected JSON structure instruction.
  const outputStructure = platforms
    .filter((p) => VALID_PLATFORMS.has(p))
    .map((p) => `  "${p}": ${PLATFORM_RULES[p].outputShape}`)
    .join(',\n');

  // ── System prompt ──────────────────────────────────────────────────────────
  const system = `\
You are an expert social media content strategist and copywriter.
Your job is to generate platform-optimised content that strictly adheres to each platform's rules.

## CORE DIRECTIVES
- Output ONLY valid JSON — no markdown fences, no prose, no explanations.
- Never exceed character limits. If a platform has a max, stay under it.
- Every platform key in the output MUST be present (for the requested platforms).
- Hashtags must be prefixed with "#" and returned as an array of strings.
- Write exclusively in the language specified by the user (language code: ${language}).
- Adapt the requested tone (${tone}) to each platform's style guide. LinkedIn is ALWAYS professional regardless of tone.

## PLATFORM RULES
${platformBlocks}

## OUTPUT FORMAT
Return a single JSON object with the following shape (only include keys for requested platforms):
{
${outputStructure}
}

No other text. No code fences. Just the JSON object.`;

  // ── User prompt ────────────────────────────────────────────────────────────
  const user = `\
Generate social media content for the following:

Idea: ${idea}
Post type: ${post_type}
Requested tone: ${tone}
Language: ${language}
Target platforms: ${platforms.join(', ')}

Follow ALL platform rules from your system instructions. Output JSON only.`;

  return { system, user };
}

module.exports = {
  buildPrompt,
  PLATFORM_RULES,
  VALID_POST_TYPES,
  VALID_TONES,
  VALID_PLATFORMS,
};
