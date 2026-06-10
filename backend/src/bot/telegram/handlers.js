'use strict';

/**
 * handlers.js — Telegram adapter layer.
 *
 * Each function here is a thin adapter:
 *   1. Extract structured input from the grammy ctx object.
 *   2. Call conversationService (all business logic lives there).
 *   3. Format the service's plain-text response using Telegram keyboards.
 *
 * No domain logic, no session writes, no AI calls exist in this file.
 */

const conversationService              = require('../conversationService');
const { IDEA_MAX_LENGTH }              = conversationService;
const botSession                       = require('../botSession');
const keyboards                        = require('./keyboard');

const PLATFORM = 'telegram';

// ── Utilities ─────────────────────────────────────────────────────────────────

function getChatId(ctx) {
  return String(ctx.chat?.id ?? ctx.from?.id);
}

async function safeEdit(fn) {
  try { await fn(); } catch (err) { if (!err.description) throw err; }
}

/**
 * Maps the service's choicesType → the appropriate grammy InlineKeyboard.
 * Keyboard layout is presentation-layer — it belongs here, not in the service.
 */
function buildReplyMarkup(result) {
  switch (result.choicesType) {
    case 'type':     return keyboards.typeKeyboard();
    case 'platform': return keyboards.platformsKeyboard(result.updatedSession?.platforms ?? []);
    case 'tone':     return keyboards.toneKeyboard();
    case 'model':    return keyboards.modelKeyboard();
    case 'confirm':  return keyboards.confirmKeyboard();
    default:         return undefined;
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const cid  = getChatId(ctx);
  const sess = await botSession.getSession(PLATFORM, cid);
  const result = await conversationService.handleCommand({
    command: 'start', args: [], platform: PLATFORM, chatId: cid, session: sess,
  });
  await ctx.reply(result.replyText, { reply_markup: buildReplyMarkup(result) });
}

async function handleStatus(ctx, sess) {
  const result = await conversationService.handleCommand({
    command: 'status', args: [], platform: PLATFORM, chatId: getChatId(ctx), session: sess,
  });
  await ctx.reply(result.replyText);
}

async function handleAccounts(ctx, sess) {
  const result = await conversationService.handleCommand({
    command: 'accounts', args: [], platform: PLATFORM, chatId: getChatId(ctx), session: sess,
  });
  await ctx.reply(result.replyText);
}

async function handleHelp(ctx) {
  const result = await conversationService.handleCommand({
    command: 'help', args: [], platform: PLATFORM, chatId: getChatId(ctx), session: null,
  });
  await ctx.reply(result.replyText);
}

// ── State handlers (called by stateMachine.dispatch) ─────────────────────────

async function handleIdle(ctx, sess) {
  const result = await conversationService.processMessage({
    platform: PLATFORM,
    chatId: getChatId(ctx),
    session: sess,
    action: null,
    text: ctx.message?.text ?? null,
  });
  await ctx.reply(result.replyText, { reply_markup: buildReplyMarkup(result) });
}

async function handleSelectType(ctx, sess) {
  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: getChatId(ctx), session: sess,
    action: ctx.callbackQuery?.data ?? '', text: null,
  });
  await ctx.answerCallbackQuery();
  await safeEdit(() =>
    ctx.editMessageText(result.replyText, { reply_markup: buildReplyMarkup(result) }),
  );
}

async function handleSelectPlatforms(ctx, sess) {
  const action = ctx.callbackQuery?.data ?? '';
  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: getChatId(ctx), session: sess, action, text: null,
  });

  const isToggle = action.startsWith('platform:') && action !== 'platform:done';
  if (isToggle) {
    // Show toast with the toggle confirmation; update only the keyboard in-place.
    await ctx.answerCallbackQuery({ text: result.replyText });
    await safeEdit(() =>
      ctx.editMessageReplyMarkup({ reply_markup: buildReplyMarkup(result) }),
    );
  } else {
    // "Done" (or re-prompt with error) — replace the full message.
    await ctx.answerCallbackQuery();
    await safeEdit(() =>
      ctx.editMessageText(result.replyText, { reply_markup: buildReplyMarkup(result) }),
    );
  }
}

async function handleSelectTone(ctx, sess) {
  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: getChatId(ctx), session: sess,
    action: ctx.callbackQuery?.data ?? '', text: null,
  });
  await ctx.answerCallbackQuery();
  await safeEdit(() =>
    ctx.editMessageText(result.replyText, { reply_markup: buildReplyMarkup(result) }),
  );
}

async function handleSelectModel(ctx, sess) {
  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: getChatId(ctx), session: sess,
    action: ctx.callbackQuery?.data ?? '', text: null,
  });
  await ctx.answerCallbackQuery();
  await safeEdit(() =>
    ctx.editMessageText(result.replyText, { reply_markup: buildReplyMarkup(result) }),
  );
}

async function handleAwaitIdea(ctx, sess) {
  const text = (ctx.message?.text ?? '').trim();
  const cid  = getChatId(ctx);

  // Pre-check: only show the loading indicator when the idea will trigger an AI call.
  // This avoids a visible flicker for validation errors (empty / too long).
  const willGenerate = text.length > 0 && text.length <= IDEA_MAX_LENGTH;
  const loadingMsg   = willGenerate ? await ctx.reply('⏳ Generating your content…') : null;

  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: cid, session: sess, action: null, text,
  });

  if (loadingMsg) {
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
  }
  await ctx.reply(result.replyText, { reply_markup: buildReplyMarkup(result) });
}

async function handleGenerating(ctx) {
  await ctx.reply('⏳ Still generating… please wait a moment.');
}

async function handlePreviewAction(ctx, sess) {
  const result = await conversationService.processMessage({
    platform: PLATFORM, chatId: getChatId(ctx), session: sess,
    action: ctx.callbackQuery?.data ?? '', text: null,
  });
  await ctx.answerCallbackQuery();
  // Strip buttons from the preview message, then send the new reply.
  await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }));
  await ctx.reply(result.replyText, { reply_markup: buildReplyMarkup(result) });
}

async function handleUnexpectedText(ctx) {
  await ctx.reply('⚠️ Please use the buttons to continue. Type /start to restart if needed.');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  handleStart, handleStatus, handleAccounts, handleHelp,
  handleIdle, handleSelectType, handleSelectPlatforms, handleSelectTone,
  handleSelectModel, handleAwaitIdea, handleGenerating, handlePreviewAction,
  handleUnexpectedText,
};
