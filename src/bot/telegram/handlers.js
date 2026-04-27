'use strict';

/**
 * handlers.js — One handler function per bot state / command.
 *
 * Rules:
 *  - Each handler receives (ctx, sess) and is responsible for exactly one step.
 *  - Handlers call session.updateSession to advance or reset the state.
 *  - Handlers never import each other — shared logic lives in helpers below.
 *  - All errors are caught locally; the bot must never crash on bad input.
 */

const { generateContent }  = require('../../services/content.service');
const postsService         = require('../../services/posts.service');
const userService          = require('../../services/user.service');
const { verifyAccessToken } = require('../../utils/jwt');
const session              = require('./session');
const keyboards            = require('./keyboard');

const IDEA_MAX_LENGTH = 500;

// ── Platform display helpers ───────────────────────────────────────────────────

const PLATFORM_EMOJIS = {
  twitter:   '🐦',
  linkedin:  '💼',
  instagram: '📸',
  threads:   '🧵',
  facebook:  '👥',
};

const PLATFORM_HEADER = {
  twitter:   '🐦 *Twitter*',
  linkedin:  '💼 *LinkedIn*',
  instagram: '📸 *Instagram*',
  threads:   '🧵 *Threads*',
  facebook:  '👥 *Facebook*',
};

// ── Utility ───────────────────────────────────────────────────────────────────

function getChatId(ctx) {
  return String(ctx.chat?.id ?? ctx.from?.id);
}

/**
 * Silently swallow Telegram API errors on edit operations (e.g. "message not
 * modified", "message to edit not found").  These happen with stale inline
 * buttons and are harmless.
 */
async function safeEdit(fn) {
  try {
    await fn();
  } catch (err) {
    if (!err.description) throw err; // rethrow non-Telegram errors
  }
}

/**
 * Builds the multi-platform content preview text for the PREVIEW state.
 */
function buildPreviewText(generated) {
  const SEPARATOR = '\n\n─────────────\n\n';

  const sections = Object.entries(generated).map(([platform, data]) => {
    const header  = PLATFORM_HEADER[platform] ?? `📱 *${platform}*`;
    const content = data.content?.trim() || '_(no content generated)_';
    const tags    = data.hashtags?.length ? `\n\n${data.hashtags.join(' ')}` : '';
    const chars   = data.char_count != null ? `\n_${data.char_count} chars_` : '';
    return `${header}${chars}\n\n${content}${tags}`;
  });

  return `📋 *Content Preview*\n\n${sections.join(SEPARATOR)}\n\n──────────\nLooks good?`;
}

// ── /start ────────────────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const cid      = getChatId(ctx);
  const existing = await session.getSession(cid);

  if (!existing?.userId) {
    // Account not linked yet.
    await session.setSession(cid, session.blankFlow(null));
    await ctx.reply(
      '👋 *Welcome to Postly!*\n\n' +
      'To create and publish posts through this bot, first link your account:\n\n' +
      '`/link <your_api_token>`\n\n' +
      'Get your token from the Postly web app → Settings → API Token.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Linked — reset flow but preserve userId.
  await session.setSession(cid, {
    ...session.blankFlow(existing.userId),
    state: 'SELECT_TYPE',
  });

  await ctx.reply(
    '✨ *Let\'s create a post!*\n\nWhat type of content is this?',
    { parse_mode: 'Markdown', reply_markup: keyboards.typeKeyboard() },
  );
}

// ── /link <token> ─────────────────────────────────────────────────────────────

async function handleLinkCommand(ctx) {
  const cid   = getChatId(ctx);
  const parts = ctx.message?.text?.trim().split(/\s+/) ?? [];
  const token = parts[1];

  if (!token) {
    await ctx.reply(
      '⚠️ Usage: `/link <your_api_token>`\n\nGet your token from the Postly web app.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const userId  = payload.sub;

    // Confirm the user exists in the database.
    await userService.getProfile(userId);

    // Preserve any in-progress flow fields, but update userId.
    const existing = await session.getSession(cid);
    await session.setSession(cid, { ...(existing ?? session.blankFlow()), userId });

    await ctx.reply(
      '✅ Account linked successfully!\n\nType /start to create your first post.',
    );
  } catch {
    await ctx.reply(
      '❌ Invalid or expired token. Generate a new one from the Postly web app and try again.',
    );
  }
}

// ── /status ───────────────────────────────────────────────────────────────────

async function handleStatus(ctx, sess) {
  if (!sess?.userId) {
    await ctx.reply('Please link your account first: `/link <token>`', { parse_mode: 'Markdown' });
    return;
  }

  try {
    const { data: posts } = await postsService.listPosts(sess.userId, { limit: 5, page: 1 });

    if (!posts.length) {
      await ctx.reply('No posts yet. Type /start to create one!');
      return;
    }

    const lines = posts.map((post, i) => {
      const idea      = post.idea.length > 45 ? `${post.idea.slice(0, 45)}…` : post.idea;
      const platforms = post.platformPosts
        .map((pp) => `  ${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: ${pp.status}`)
        .join('\n');
      return `*${i + 1}.* [${post.status}] ${idea}\n${platforms}`;
    });

    await ctx.reply(
      `📊 *Your last ${posts.length} post(s):*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' },
    );
  } catch {
    await ctx.reply('Could not fetch posts. Please try again later.');
  }
}

// ── /accounts ─────────────────────────────────────────────────────────────────

async function handleAccounts(ctx, sess) {
  if (!sess?.userId) {
    await ctx.reply('Please link your account first: `/link <token>`', { parse_mode: 'Markdown' });
    return;
  }

  try {
    const accounts = await userService.getSocialAccounts(sess.userId);

    if (!accounts.length) {
      await ctx.reply('No connected social accounts. Add them from the Postly web app.');
      return;
    }

    const lines = accounts.map((a) => {
      const emoji = PLATFORM_EMOJIS[a.platform.toLowerCase()] ?? '📱';
      return `${emoji} *${a.platform}*: @${a.handle}`;
    });

    await ctx.reply(`🔗 *Connected accounts:*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  } catch {
    await ctx.reply('Could not fetch accounts. Please try again later.');
  }
}

// ── /help ─────────────────────────────────────────────────────────────────────

async function handleHelp(ctx) {
  await ctx.reply(
    '📖 *Postly Bot — Commands*\n\n' +
    '/start — Create a new post\n' +
    '/status — View your last 5 posts and platform statuses\n' +
    '/accounts — View connected social accounts\n' +
    '/link `<token>` — Link your Postly account\n' +
    '/help — Show this message\n\n' +
    'During post creation, use the inline buttons to navigate each step.',
    { parse_mode: 'Markdown' },
  );
}

// ── State: IDLE ───────────────────────────────────────────────────────────────

async function handleIdle(ctx) {
  await ctx.reply('Type /start to create a new post, or /help for all commands.');
}

// ── State: SELECT_TYPE ────────────────────────────────────────────────────────

async function handleSelectType(ctx, sess) {
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('type:')) return;

  const contentType = data.slice('type:'.length);
  const cid         = getChatId(ctx);

  await session.updateSession(cid, { state: 'SELECT_PLATFORMS', contentType });
  await ctx.answerCallbackQuery();

  await safeEdit(() =>
    ctx.editMessageText(
      `✅ Type: *${contentType}*\n\nSelect your target platforms (tap to toggle, then tap *Done*):`,
      { parse_mode: 'Markdown', reply_markup: keyboards.platformsKeyboard([]) },
    ),
  );
}

// ── State: SELECT_PLATFORMS ───────────────────────────────────────────────────

async function handleSelectPlatforms(ctx, sess) {
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('platform:')) return;

  const cid   = getChatId(ctx);
  const value = data.slice('platform:'.length);

  if (value === 'done') {
    if (!sess.platforms?.length) {
      await ctx.answerCallbackQuery({ text: 'Select at least one platform first!', show_alert: true });
      return;
    }

    await session.updateSession(cid, { state: 'SELECT_TONE' });
    await ctx.answerCallbackQuery();

    const platformList = sess.platforms.map((p) => PLATFORM_EMOJIS[p] ?? p).join(' ');
    await safeEdit(() =>
      ctx.editMessageText(
        `✅ Platforms: ${platformList}\n\nChoose a tone for your content:`,
        { parse_mode: 'Markdown', reply_markup: keyboards.toneKeyboard() },
      ),
    );
    return;
  }

  // Toggle the platform in the session and refresh the keyboard.
  const current = sess.platforms ?? [];
  const updated  = current.includes(value)
    ? current.filter((p) => p !== value)
    : [...current, value];

  await session.updateSession(cid, { platforms: updated });
  await ctx.answerCallbackQuery({
    text: updated.includes(value) ? `${value} added ✓` : `${value} removed`,
  });

  await safeEdit(() =>
    ctx.editMessageReplyMarkup({ reply_markup: keyboards.platformsKeyboard(updated) }),
  );
}

// ── State: SELECT_TONE ────────────────────────────────────────────────────────

async function handleSelectTone(ctx, sess) {
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('tone:')) return;

  const tone = data.slice('tone:'.length);
  const cid  = getChatId(ctx);

  await session.updateSession(cid, { state: 'SELECT_MODEL', tone });
  await ctx.answerCallbackQuery();

  await safeEdit(() =>
    ctx.editMessageText(
      `✅ Tone: *${tone}*\n\nChoose an AI model:`,
      { parse_mode: 'Markdown', reply_markup: keyboards.modelKeyboard() },
    ),
  );
}

// ── State: SELECT_MODEL ───────────────────────────────────────────────────────

async function handleSelectModel(ctx, sess) {
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('model:')) return;

  const model       = data.slice('model:'.length);
  const modelLabel  = model === 'openai' ? 'GPT-4o' : 'Claude Sonnet';
  const cid         = getChatId(ctx);

  await session.updateSession(cid, { state: 'AWAIT_IDEA', model });
  await ctx.answerCallbackQuery();

  await safeEdit(() =>
    ctx.editMessageText(
      `✅ Model: *${modelLabel}*\n\n` +
      `💡 Now send me your idea (max ${IDEA_MAX_LENGTH} characters):`,
      { parse_mode: 'Markdown' },
    ),
  );
}

// ── State: AWAIT_IDEA ─────────────────────────────────────────────────────────

async function handleAwaitIdea(ctx, sess) {
  const idea = ctx.message?.text?.trim() ?? '';
  const cid  = getChatId(ctx);

  if (!idea) {
    await ctx.reply('Please send a text message with your post idea.');
    return;
  }

  if (idea.length > IDEA_MAX_LENGTH) {
    await ctx.reply(
      `⚠️ Idea is too long (${idea.length}/${IDEA_MAX_LENGTH} chars). Please shorten it and try again.`,
    );
    return;
  }

  await session.updateSession(cid, { state: 'GENERATING', idea });

  const generatingMsg = await ctx.reply('⏳ Generating your content…');

  try {
    const result = await generateContent(
      {
        idea,
        post_type: sess.contentType,
        platforms: sess.platforms,
        tone:      sess.tone,
        model:     sess.model,
      },
      sess.userId,
    );

    await session.updateSession(cid, {
      state:            'PREVIEW',
      generatedContent: result.generated,
      modelUsed:        result.model_used,
      tokensUsed:       result.tokens_used,
    });

    await ctx.api.deleteMessage(ctx.chat.id, generatingMsg.message_id).catch(() => {});
    await ctx.reply(buildPreviewText(result.generated), {
      parse_mode:   'Markdown',
      reply_markup: keyboards.confirmKeyboard(),
    });
  } catch (err) {
    // Roll back to AWAIT_IDEA so the user can try a different idea.
    await session.updateSession(cid, { state: 'AWAIT_IDEA' });
    await ctx.api.deleteMessage(ctx.chat.id, generatingMsg.message_id).catch(() => {});
    await ctx.reply(
      `❌ Content generation failed: ${err.message}\n\n` +
      'Please adjust your idea and try again, or type /start to restart.',
    );
  }
}

// ── State: GENERATING (fallback for messages during AI call) ──────────────────

async function handleGenerating(ctx) {
  await ctx.reply('⏳ Still generating… please wait a moment.');
}

// ── State: PREVIEW (action buttons) ──────────────────────────────────────────

async function handlePreviewAction(ctx, sess) {
  const data = ctx.callbackQuery?.data ?? '';
  if (!data.startsWith('action:')) return;

  const action = data.slice('action:'.length);
  const cid    = getChatId(ctx);

  await ctx.answerCallbackQuery();

  switch (action) {
    case 'post_now':
      await doPublish(ctx, sess, cid);
      break;

    case 'edit_idea':
      await session.updateSession(cid, { state: 'AWAIT_IDEA' });
      await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }));
      await ctx.reply(`✏️ Send me your updated idea (max ${IDEA_MAX_LENGTH} characters):`);
      break;

    case 'cancel':
      await session.setSession(cid, session.blankFlow(sess.userId));
      await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }));
      await ctx.reply('❌ Post canceled. Type /start whenever you\'re ready to try again.');
      break;

    default:
      await ctx.reply('Unknown action. Please use the buttons.');
  }
}

// ── Publish ───────────────────────────────────────────────────────────────────

async function doPublish(ctx, sess, cid) {
  const { userId, platforms, generatedContent, idea, tone, model } = sess;

  if (!userId) {
    await ctx.reply('Session expired. Please /link your account and /start again.');
    return;
  }

  // Build the platforms map expected by posts.service.publishPost.
  // Shape: { TWITTER: { content: '…' }, LINKEDIN: { content: '…' }, … }
  const platformsMap = {};
  for (const p of platforms ?? []) {
    const content = generatedContent?.[p]?.content?.trim();
    if (content) platformsMap[p.toUpperCase()] = { content };
  }

  if (Object.keys(platformsMap).length === 0) {
    await ctx.reply('❌ No publishable content found. Please /start again.');
    return;
  }

  const loadingMsg = await ctx.reply('📤 Queuing your post…');

  try {
    const post = await postsService.publishPost(userId, {
      idea,
      post_type:  'TEXT',
      tone:       tone ?? undefined,
      model_used: model ?? undefined,
      platforms:  platformsMap,
    });

    // Reset session.
    await session.setSession(cid, session.blankFlow(userId));
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    // Remove the confirm buttons from the preview message.
    await safeEdit(() => ctx.editMessageReplyMarkup({ reply_markup: undefined }));

    const platformLines = post.platformPosts
      .map((pp) => `${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: queued`)
      .join('\n');

    await ctx.reply(
      `🚀 *Post queued successfully!*\n\n${platformLines}\n\nUse /status to track publishing progress.`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(
      `❌ Failed to publish: ${err.message}\n\nType /start to try again.`,
    );
  }
}

// ── Fallback ──────────────────────────────────────────────────────────────────

async function handleUnexpectedText(ctx) {
  await ctx.reply(
    '⚠️ Please use the buttons to continue. If they\'re gone, type /start to restart.',
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Commands
  handleStart,
  handleLinkCommand,
  handleStatus,
  handleAccounts,
  handleHelp,
  // State handlers
  handleIdle,
  handleSelectType,
  handleSelectPlatforms,
  handleSelectTone,
  handleSelectModel,
  handleAwaitIdea,
  handleGenerating,
  handlePreviewAction,
  handleUnexpectedText,
};
