'use strict';

/**
 * content.controller.js — HTTP boundary for the AI content generation endpoint.
 *
 * Responsibilities:
 *  - Parse request body (no business logic here).
 *  - Delegate entirely to content.service.generateContent().
 *  - Return a consistent, structured JSON response.
 *  - Forward errors to the global error handler via next().
 *
 * The controller is intentionally thin. All validation, orchestration, and
 * formatting live in content.service.js.
 */

const contentService = require('../services/content.service');

/**
 * POST /api/content/generate
 *
 * Body:
 *  {
 *    idea:      string (max 500 chars),
 *    post_type: "announcement" | "thread" | "story" | "promotional" | "educational" | "opinion",
 *    platforms: ("twitter" | "linkedin" | "instagram" | "threads")[],
 *    tone:      "professional" | "casual" | "witty" | "authoritative" | "friendly",
 *    language:  string (optional — auto-detected via franc if omitted),
 *    model:     "openai" | "anthropic",
 *  }
 *
 * Response 200:
 *  {
 *    generated: {
 *      twitter?:   { content, char_count, hashtags },
 *      linkedin?:  { content, char_count, hashtags },
 *      instagram?: { content, hashtags },
 *      threads?:   { content },
 *    },
 *    model_used:  string,
 *    tokens_used: number,
 *  }
 */
async function generateContent(req, res, next) {
  try {
    const result = await contentService.generateContent(req.body, req.userId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { generateContent };
