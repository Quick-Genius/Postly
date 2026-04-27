'use strict';

/**
 * keyboard.js — Inline keyboard builders for the Telegram bot.
 *
 * Each function returns a grammy InlineKeyboard instance ready to pass
 * as `reply_markup` in any ctx.reply / ctx.editMessageText call.
 *
 * Callback data format: "<namespace>:<value>"
 *   type:announcement | type:thread | …
 *   platform:twitter  | platform:done | …
 *   tone:professional | …
 *   model:openai      | model:anthropic
 *   action:post_now   | action:edit_idea | action:cancel
 */

const { InlineKeyboard } = require('grammy');

// ── Post type ─────────────────────────────────────────────────────────────────

function typeKeyboard() {
  return new InlineKeyboard()
    .text('📢 Announcement', 'type:announcement').text('🧵 Thread',      'type:thread').row()
    .text('📖 Story',        'type:story')       .text('📣 Promotional', 'type:promotional').row()
    .text('📚 Educational',  'type:educational') .text('💡 Opinion',     'type:opinion');
}

// ── Platform multi-select ─────────────────────────────────────────────────────

const PLATFORMS = [
  { label: '🐦 Twitter',   value: 'twitter'   },
  { label: '💼 LinkedIn',  value: 'linkedin'  },
  { label: '📸 Instagram', value: 'instagram' },
  { label: '🧵 Threads',   value: 'threads'   },
  { label: '👥 Facebook',  value: 'facebook'  },
];

/**
 * Builds the platform selector keyboard with checkmarks on selected items.
 *
 * Layout: 2 per row, last item solo if count is odd, Done button on its own row.
 *
 * @param {string[]} selected  Currently selected platform values.
 */
function platformsKeyboard(selected = []) {
  const kb = new InlineKeyboard();

  PLATFORMS.forEach((p, i) => {
    const checked = selected.includes(p.value);
    kb.text(checked ? `✅ ${p.label}` : p.label, `platform:${p.value}`);
    if (i % 2 === 1) kb.row(); // break after every 2nd button
  });

  // If PLATFORMS count is odd, the last button is alone on its row — add explicit row().
  if (PLATFORMS.length % 2 === 1) kb.row();

  const countHint = selected.length > 0 ? ` (${selected.length} selected)` : '';
  kb.text(`✓ Done${countHint}`, 'platform:done');

  return kb;
}

// ── Tone ──────────────────────────────────────────────────────────────────────

function toneKeyboard() {
  return new InlineKeyboard()
    .text('👔 Professional', 'tone:professional').text('😊 Casual',        'tone:casual').row()
    .text('😄 Witty',        'tone:witty')       .text('💪 Authoritative', 'tone:authoritative').row()
    .text('🤝 Friendly',     'tone:friendly');
}

// ── AI model ─────────────────────────────────────────────────────────────────

function modelKeyboard() {
  return new InlineKeyboard()
    .text('🤖 GPT-4o',       'model:openai').row()
    .text('🧠 Claude Sonnet', 'model:anthropic');
}

// ── Post confirmation ─────────────────────────────────────────────────────────

function confirmKeyboard() {
  return new InlineKeyboard()
    .text('🚀 Post Now',   'action:post_now').row()
    .text('✏️ Edit Idea',  'action:edit_idea').row()
    .text('❌ Cancel',      'action:cancel');
}

module.exports = {
  typeKeyboard,
  platformsKeyboard,
  toneKeyboard,
  modelKeyboard,
  confirmKeyboard,
};
