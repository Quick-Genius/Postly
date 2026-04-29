'use strict';

/**
 * whatsapp.service.js — WhatsApp adapter for the Postly bot.
 *
 * Responsibilities:
 *  1. Parse a raw Twilio message body into the normalized input shape that
 *     conversationService expects.
 *  2. Map user's button/list/text replies to structured action values using the
 *     session's pendingChoices list (set by conversationService on every step).
 *  3. Call conversationService.handleCommand or conversationService.processMessage.
 *  4. Format the returned { replyText, options } into a WhatsApp-friendly
 *     text fallback for clients/channels where interactive UI isn't available.
 *
 * WhatsApp UX rules:
 *  - Twilio interactive taps are parsed via ButtonPayload/ButtonText/ListTitle.
 *  - Text fallback remains available for clients without interactive support.
 *  - Legacy numeric input remains supported for backward compatibility.
 *  - User types free text only during the AWAIT_IDEA state.
 *  - Commands are sent without a "/" prefix (e.g. "start", "help").
 */

const botSession          = require('../botSession');
const conversationService = require('../conversationService');
const logger              = require('../../utils/logger').child('WhatsAppService');

const PLATFORM = 'whatsapp';

// ── Command aliases (WhatsApp users don't type "/") ───────────────────────────

const COMMANDS = new Set(['start', 'restart', 'end', 'status', 'accounts', 'help']);
const PLATFORM_ACTION_BY_NUMBER = {
  '1': 'platform:twitter',
  '2': 'platform:linkedin',
  '3': 'platform:done',
};
const TYPE_ACTION_BY_NUMBER = {
  '1': 'type:announcement',
  '2': 'type:thread',
  '3': 'type:story',
  '4': 'type:promotional',
  '5': 'type:educational',
  '6': 'type:opinion',
};
const FINAL_ACTION_BY_NUMBER = {
  '1': 'action:post_now',
  '2': 'action:edit_idea',
  '3': 'action:cancel',
};

const DIRECT_ACTION_BY_TEXT = {
  announcement: 'type:announcement',
  thread: 'type:thread',
  story: 'type:story',
  promotional: 'type:promotional',
  educational: 'type:educational',
  opinion: 'type:opinion',
  twitter: 'platform:twitter',
  linkedin: 'platform:linkedin',
  done: 'platform:done',
  'post now': 'action:post_now',
  'edit idea': 'action:edit_idea',
  cancel: 'action:cancel',
};

const normalizeState = (state) => {
  switch (state) {
    case 'platform_selection': return 'SELECT_PLATFORMS';
    case 'type_selection': return 'SELECT_TYPE';
    case 'tone_selection': return 'SELECT_TONE';
    case 'model_selection': return 'SELECT_MODEL';
    case 'await_idea': return 'AWAIT_IDEA';
    default: return state;
  }
};

const stripDecorations = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // emoji blocks
  .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function actionFromDirectText(cleanedText) {
  if (!cleanedText) return null;
  if (DIRECT_ACTION_BY_TEXT[cleanedText]) return DIRECT_ACTION_BY_TEXT[cleanedText];
  for (const [key, action] of Object.entries(DIRECT_ACTION_BY_TEXT)) {
    if (cleanedText.startsWith(key)) return action;
  }
  return null;
}

function actionFromPendingChoices(cleanedText, choices = []) {
  if (!cleanedText || !Array.isArray(choices)) return null;
  const match = choices.find((choice) => {
    const choiceText = stripDecorations(choice?.label || '');
    return choiceText === cleanedText || cleanedText.startsWith(choiceText);
  });
  return match?.value || null;
}

function extractInboundSelection(inbound = {}) {
  const buttonPayload = String(inbound.buttonPayload ?? inbound.ButtonPayload ?? '').trim();
  const buttonText    = String(inbound.buttonText ?? inbound.ButtonText ?? '').trim();
  const listTitle     = String(inbound.listTitle ?? inbound.ListTitle ?? '').trim();
  const body          = String(inbound.body ?? inbound.Body ?? '').trim();

  if (buttonPayload) return { selectedText: buttonPayload, source: 'ButtonPayload' };
  if (buttonText) return { selectedText: buttonText, source: 'ButtonText' };
  if (listTitle) return { selectedText: listTitle, source: 'ListTitle' };
  return { selectedText: body, source: 'Body' };
}

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
function parseInput(rawInput, session) {
  const raw   = String(rawInput ?? '').trim();
  const lower = raw.toLowerCase();
  const state = normalizeState(session?.state ?? 'IDLE');
  const cleaned = stripDecorations(raw);

  if (!raw) {
    return { command: null, args: null, action: null, text: '' };
  }

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

  if (raw.includes(':') && /^([a-z_]+:[a-z0-9_]+)$/i.test(raw)) {
    return { command: null, args: null, action: raw.toLowerCase(), text: null };
  }

  const directAction = actionFromDirectText(cleaned);
  if (directAction) {
    return { command: null, args: null, action: directAction, text: null };
  }

  const pendingAction = actionFromPendingChoices(cleaned, session?.pendingChoices);
  if (pendingAction) {
    return { command: null, args: null, action: pendingAction, text: null };
  }

  // ── "done" shorthand for platform confirmation ────────────────────────────
  if (state === 'SELECT_PLATFORMS' && lower === 'done') {
    return { command: null, args: null, action: 'platform:done', text: null };
  }

  // Guard rail for WhatsApp platform selection:
  // 1 => twitter, 2 => linkedin, 3 => done
  if (state === 'SELECT_PLATFORMS' && PLATFORM_ACTION_BY_NUMBER[raw]) {
    return { command: null, args: null, action: PLATFORM_ACTION_BY_NUMBER[raw], text: null };
  }

  // Backward compatibility: old numeric menus
  if (state === 'SELECT_TYPE' && TYPE_ACTION_BY_NUMBER[raw]) {
    return { command: null, args: null, action: TYPE_ACTION_BY_NUMBER[raw], text: null };
  }
  if (state === 'PREVIEW' && FINAL_ACTION_BY_NUMBER[raw]) {
    return { command: null, args: null, action: FINAL_ACTION_BY_NUMBER[raw], text: null };
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
 *   Tap a button/list option or type the option name.
 */
function formatReply(replyText, options) {
  if (!options?.length) return replyText;
  const lines = options.map((opt) => `• ${opt.label}`);
  const prompt = options.length <= 3
    ? 'Tap a button (or type the option name).'
    : 'Open the list and pick an option (or type the option name).';
  return `${replyText}\n\n${lines.join('\n')}\n\n${prompt}`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Processes one inbound WhatsApp message end-to-end.
 *
 * @param {{ from: string, body?: string, inbound?: object }} params
 *   from — normalised phone number (Twilio's "From" with "whatsapp:" stripped)
 *   body — message text
 * @returns {Promise<string>} The text to send back to the user.
 */
async function handleWebhook({ from, body, inbound = {} }) {
  const log = logger.child('handleWebhook', { from });
  try {
    const session = (await botSession.getSession(PLATFORM, from)) ?? botSession.blankFlow(null);
    const normalizedSession = { ...session, state: normalizeState(session.state ?? 'IDLE') };
    if (normalizedSession.state !== session.state) {
      await botSession.setSession(PLATFORM, from, normalizedSession);
    }

    const incoming = { body, ...inbound };
    const { selectedText, source } = extractInboundSelection(incoming);

    log.info('Incoming WhatsApp message', {
      selectedText,
      source,
      state: normalizedSession.state,
      pendingChoices: (normalizedSession.pendingChoices ?? []).map((c) => c.value),
    });

    const { command, args, action, text } = parseInput(selectedText, normalizedSession);
    log.info('Parsed input', { command, args, action, hasText: Boolean(text) });

    let result;
    if (command) {
      result = await conversationService.handleCommand({
        command, args, platform: PLATFORM, chatId: from, session: normalizedSession,
      });
    } else {
      result = await conversationService.processMessage({
        platform: PLATFORM, chatId: from, session: normalizedSession, action, text,
      });
    }

    const nextState = result?.updatedSession?.state ?? normalizedSession.state;
    log.info('Conversation step completed', { fromState: normalizedSession.state, toState: nextState });
    return formatReply(result.replyText, result.options);
  } catch (err) {
    log.error('Failed to process WhatsApp webhook', { err, body });
    return '⚠️ Something went wrong. Send "start" to try again.';
  }
}

module.exports = { handleWebhook };
