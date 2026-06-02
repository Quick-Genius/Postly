'use strict';

/**
 * stateMachine.js — Central state → handler dispatch table.
 *
 * Every update (text message or callback query) passes through `dispatch`.
 * The current state is read from the Redis session; the appropriate handler
 * is looked up in STATE_MACHINE and invoked with (ctx, session).
 *
 * Adding a new state: register it here and implement its handler in handlers.js.
 * No flow logic lives in this file — it is purely a routing table.
 *
 * States
 * ──────
 *  IDLE             — no active flow; bot idle
 *  SELECT_TYPE      — user choosing post content type
 *  SELECT_PLATFORMS — user toggling target platforms (multi-select)
 *  SELECT_TONE      — user choosing writing tone
 *  SELECT_MODEL     — user choosing AI model
 *  AWAIT_IDEA       — bot waiting for free-text idea
 *  GENERATING       — AI call in progress
 *  PREVIEW          — content shown; waiting for confirm / edit / cancel
 */

const handlers = require('./handlers');

// onText    : called for plain text messages in this state
// onCallback: called for inline-keyboard callback queries in this state
const STATE_MACHINE = {
  IDLE: {
    onText:     handlers.handleIdle,
    onCallback: null,
  },
  SELECT_TYPE: {
    onText:     handlers.handleUnexpectedText,
    onCallback: handlers.handleSelectType,
  },
  SELECT_PLATFORMS: {
    onText:     handlers.handleUnexpectedText,
    onCallback: handlers.handleSelectPlatforms,
  },
  SELECT_TONE: {
    onText:     handlers.handleUnexpectedText,
    onCallback: handlers.handleSelectTone,
  },
  SELECT_MODEL: {
    onText:     handlers.handleUnexpectedText,
    onCallback: handlers.handleSelectModel,
  },
  AWAIT_IDEA: {
    onText:     handlers.handleAwaitIdea,
    onCallback: null,
  },
  GENERATING: {
    onText:     handlers.handleGenerating,
    onCallback: null,
  },
  PREVIEW: {
    onText:     handlers.handleUnexpectedText,
    onCallback: handlers.handlePreviewAction,
  },
};

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Routes an incoming update to the correct handler based on the session state.
 *
 * @param {import('grammy').Context} ctx
 * @param {object}  sess   Current Redis session (may be empty/null for unknown chats).
 * @param {'text'|'callback'} updateType
 */
async function dispatch(ctx, sess, updateType) {
  const state = sess?.state ?? 'IDLE';
  const entry = STATE_MACHINE[state];

  if (!entry) {
    // Unknown state — safety net; should never happen in normal flow.
    await ctx.reply('Something went wrong. Type /start to begin a new post.');
    return;
  }

  const handler = updateType === 'text' ? entry.onText : entry.onCallback;

  if (!handler) {
    // State exists but has no handler for this update type (e.g., text when buttons expected).
    await ctx.reply(
      '⚠️ Use the buttons to continue, or type /start to restart.',
    );
    return;
  }

  await handler(ctx, sess);
}

module.exports = { dispatch };
