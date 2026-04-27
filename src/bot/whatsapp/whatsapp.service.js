'use strict';

/**
 * whatsapp.service.js — WhatsApp adapter for the Postly bot.
 *
 * Responsibilities:
 *  1. Parse a raw Twilio message body into the normalized input shape that
 *     conversationService expects.
 *  2. Map user's number/text replies to structured action values using the
 *     session's pendingChoices list (set by conversationService on every step).
 *  3. Call conversationService.handleCommand or conversationService.processMessage.
 *  4. Format the returned { replyText, options } into a single plain-text string
 *     suitable for WhatsApp (numbered list instead of inline buttons).
 *
 * WhatsApp UX rules:
 *  - No inline keyboards. All choices are presented as a numbered list.
 *  - User replies with a number ("1", "2", …) to select an option.
 *  - User types free text only during the AWAIT_IDEA state.
 *  - Commands are sent without a "/" prefix (e.g. "start", "help").
 */

const botSession          = require('../botSession');
const conversationService = require('../conversationService');

const PLATFORM = 'whatsapp';

// ── Command aliases (WhatsApp users don't type "/") ───────────────────────────

const COMMANDS = new Set(['start', 'status', 'accounts', 'help']);

// ── Input parser ──────────────────────────────────────────────────────────────

/**
 * Translates a raw WhatsApp message body into { command?, args?, action?, text? }.
 *
 * Priority:
 *  1. Known commands (start, status, help, accounts, link <token>)
 *  2. "done" shorthand in SELECT_PLATFORMS state
 *  3. Number choice → mapped via session.pendingChoices
 *  4. Free text → forwarded only in AWAIT_IDEA state
 *  5. Anything else → { action: null, text: body } (service returns a helpful error)
 */
function parseInput(body, session) {
  const raw   = body.trim();
  const lower = raw.toLowerCase();
  const state = session?.state ?? 'IDLE';

  // ── Commands ──────────────────────────────────────────────────────────────
  if (COMMANDS.has(lower)) {
    return { command: lower, args: [], action: null, text: null };
  }
  if (lower.startsWith('link ')) {
    return { command: 'link', args: [raw.slice(5).trim()], action: null, text: null };
  }

  // ── Free-text idea ────────────────────────────────────────────────────────
  if (state === 'AWAIT_IDEA') {
    return { command: null, args: null, action: null, text: raw };
  }

  // ── "done" shorthand for platform confirmation ────────────────────────────
  if (state === 'SELECT_PLATFORMS' && lower === 'done') {
    return { command: null, args: null, action: 'platform:done', text: null };
  }

  // ── Number → pendingChoices lookup ────────────────────────────────────────
  const num     = parseInt(raw, 10);
  const choices = session?.pendingChoices ?? [];
  if (!isNaN(num) && num >= 1 && num <= choices.length) {
    return { command: null, args: null, action: choices[num - 1].value, text: null };
  }

  // ── Unrecognised ──────────────────────────────────────────────────────────
  return { command: null, args: null, action: null, text: raw };
}

// ── Response formatter ────────────────────────────────────────────────────────

/**
 * Appends a numbered menu to the service's reply text.
 * WhatsApp has no inline keyboards so every set of options becomes a list.
 *
 * Example output:
 *   Select your target platforms:
 *
 *   1. 🐦 Twitter
 *   2. ✅ 💼 LinkedIn
 *   3. 📸 Instagram
 *   ...
 *   6. ✓ Done (1 selected)
 *
 *   Reply with a number to choose.
 */
function formatReply(replyText, options) {
  if (!options?.length) return replyText;
  const lines = options.map((opt, i) => `${i + 1}. ${opt.label}`);
  return `${replyText}\n\n${lines.join('\n')}\n\nReply with a number to choose.`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Processes one inbound WhatsApp message end-to-end.
 *
 * @param {{ from: string, body: string }} params
 *   from — normalised phone number (Twilio's "From" with "whatsapp:" stripped)
 *   body — message text
 * @returns {Promise<string>} The text to send back to the user.
 */
async function handleWebhook({ from, body }) {
  const session = (await botSession.getSession(PLATFORM, from)) ?? botSession.blankFlow(null);
  const { command, args, action, text } = parseInput(body, session);

  let result;
  if (command) {
    result = await conversationService.handleCommand({
      command, args, platform: PLATFORM, chatId: from, session,
    });
  } else {
    result = await conversationService.processMessage({
      platform: PLATFORM, chatId: from, session, action, text,
    });
  }

  return formatReply(result.replyText, result.options);
}

module.exports = { handleWebhook };
