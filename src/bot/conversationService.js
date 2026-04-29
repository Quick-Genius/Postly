'use strict';

/**
 * conversationService.js — Platform-agnostic conversation brain.
 *
 * This module owns ALL business logic for the Postly bot flow:
 *  - Command handling (/start, /link, /status, /accounts, /help)
 *  - State-machine transitions (SELECT_TYPE → … → PREVIEW)
 *  - AI content generation (delegates to content.service)
 *  - Post publishing (delegates to posts.service)
 *  - Session persistence (via botSession)
 *
 * Telegram and WhatsApp are pure adapters: they parse platform-specific input,
 * call this service, and format the returned { replyText, options, choicesType }
 * into their platform's native response format.
 *
 * Nothing in this file is aware of grammy, Twilio, ctx, TwiML, or HTTP.
 */

const { generateContent }   = require('../services/content.service');
const postsService          = require('../services/posts.service');
const userService           = require('../services/user.service');
const { verifyAccessToken } = require('../utils/jwt');
const botSession            = require('./botSession');

const IDEA_MAX_LENGTH = 500;

// ── Choice menus (shared between all adapters) ────────────────────────────────

const TYPE_CHOICES = [
  { label: '📢 Announcement', value: 'type:announcement' },
  { label: '🧵 Thread',       value: 'type:thread'       },
  { label: '📖 Story',        value: 'type:story'        },
  { label: '📣 Promotional',  value: 'type:promotional'  },
  { label: '📚 Educational',  value: 'type:educational'  },
  { label: '💡 Opinion',      value: 'type:opinion'      },
];

const TONE_CHOICES = [
  { label: '👔 Professional',  value: 'tone:professional'  },
  { label: '😊 Casual',        value: 'tone:casual'        },
  { label: '😄 Witty',         value: 'tone:witty'         },
  { label: '💪 Authoritative', value: 'tone:authoritative' },
  { label: '🤝 Friendly',      value: 'tone:friendly'      },
];

const MODEL_CHOICES = [
  { label: '🤖 GPT-4o',        value: 'model:openai'    },
  { label: '🧠 Claude Sonnet', value: 'model:anthropic' },
];

const CONFIRM_CHOICES = [
  { label: '🚀 Post Now',   value: 'action:post_now'   },
  { label: '✏️ Edit Idea',  value: 'action:edit_idea'  },
  { label: '❌ Cancel',     value: 'action:cancel'     },
];

const PLATFORM_LIST = [
  { label: '🐦 Twitter',   value: 'twitter'   },
  { label: '💼 LinkedIn',  value: 'linkedin'  },
  // { label: '📸 Instagram', value: 'instagram' },
  // { label: '🧵 Threads',   value: 'threads'   },
  // { label: '👥 Facebook',  value: 'facebook'  },
];

const PLATFORM_EMOJIS = {
  twitter: '🐦',
  linkedin: '💼',
  // instagram: '📸',
  // threads: '🧵',
  // facebook: '👥',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds the platform choice list, marking currently-selected ones with ✅.
 * Always appends a "Done" option at the end.
 */
function buildPlatformChoices(selected = []) {
  const choices = PLATFORM_LIST.map((p) => ({
    label:    selected.includes(p.value) ? `✅ ${p.label}` : p.label,
    value:    `platform:${p.value}`,
    selected: selected.includes(p.value),
  }));
  choices.push({
    label: `✓ Done${selected.length ? ` (${selected.length})` : ''}`,
    value: 'platform:done',
  });
  return choices;
}

/**
 * Plain-text content preview — readable on any platform (no Markdown markers).
 */
function buildPreviewText(generated) {
  const LABELS = {
    twitter: '🐦 Twitter', linkedin: '💼 LinkedIn',
    instagram: '📸 Instagram', threads: '🧵 Threads', facebook: '👥 Facebook',
  };

  const sections = Object.entries(generated).map(([platform, data]) => {
    const label   = LABELS[platform] ?? platform;
    const content = data.content?.trim() || '(no content generated)';
    const tags    = data.hashtags?.length ? '\n' + data.hashtags.join(' ') : '';
    const chars   = data.char_count != null ? ` [${data.char_count} chars]` : '';
    return `${label}${chars}\n${content}${tags}`;
  });

  return `📋 Content Preview\n${'─'.repeat(22)}\n\n${sections.join('\n\n─────\n\n')}\n\nLooks good?`;
}

/** Builds the normalized service response object. */
function reply(replyText, options = null, choicesType = null, updatedSession) {
  return { replyText, options, choicesType, updatedSession };
}

/** Returns the platform-specific start/help command prefix. */
const cmdPrefix = (platform) => (platform === 'telegram' ? '/' : '');

// ── Command handler ───────────────────────────────────────────────────────────

/**
 * Handles top-level commands: start, link, status, accounts, help.
 *
 * @param {{ command, args, platform, chatId, session }} input
 * @returns {Promise<{ replyText, options, choicesType, updatedSession }>}
 */
async function handleCommand({ command, args, platform, chatId, session }) {
  const userId = session?.userId ?? null;
  const pfx    = cmdPrefix(platform);

  switch (command) {
    // ── start ─────────────────────────────────────────────────────────────────
    case 'start': {
      if (!userId) {
        return reply(
          `👋 Welcome to Postly!\n\n` +
          `Link your account to get started:\n${pfx}link <your_api_token>\n\n` +
          `Get your token from the Postly web app → Settings → API Token.`,
          null, null, session,
        );
      }
      const newSess = { ...botSession.blankFlow(userId), state: 'SELECT_TYPE', pendingChoices: TYPE_CHOICES };
      await botSession.setSession(platform, chatId, newSess);
      return reply(
        '✨ Let\'s create a post!\n\nWhat type of content is this?',
        TYPE_CHOICES, 'type', newSess,
      );
    }

    // ── link ──────────────────────────────────────────────────────────────────
    case 'link': {
      const token = args[0];
      if (!token) {
        return reply(
          `Usage: ${pfx}link <your_api_token>\n\nGet your token from the Postly web app.`,
          null, null, session,
        );
      }
      try {
        const payload = verifyAccessToken(token);
        await userService.getProfile(payload.sub); // ensure user exists
        const newSess = { ...(session ?? botSession.blankFlow()), userId: payload.sub };
        await botSession.setSession(platform, chatId, newSess);
        return reply(
          `✅ Account linked!\n\nSend ${pfx}start to create your first post.`,
          null, null, newSess,
        );
      } catch {
        return reply(
          '❌ Invalid or expired token. Generate a new one from the Postly web app.',
          null, null, session,
        );
      }
    }

    // ── status ────────────────────────────────────────────────────────────────
    case 'status': {
      if (!userId) return reply(`Link your account first: ${pfx}link <token>`, null, null, session);
      try {
        const { data: posts } = await postsService.listPosts(userId, { limit: 5, page: 1 });
        if (!posts.length) return reply('No posts yet. Send start to create one!', null, null, session);
        const lines = posts.map((p, i) => {
          const idea = p.idea.length > 45 ? `${p.idea.slice(0, 45)}…` : p.idea;
          const platforms = p.platformPosts
            .map((pp) => `  ${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: ${pp.status}`)
            .join('\n');
          return `${i + 1}. [${p.status}] ${idea}\n${platforms}`;
        });
        return reply(`📊 Last ${posts.length} post(s):\n\n${lines.join('\n\n')}`, null, null, session);
      } catch {
        return reply('Could not fetch posts. Please try again.', null, null, session);
      }
    }

    // ── accounts ──────────────────────────────────────────────────────────────
    case 'accounts': {
      if (!userId) return reply(`Link your account first: ${pfx}link <token>`, null, null, session);
      try {
        const accounts = await userService.getSocialAccounts(userId);
        if (!accounts.length) return reply('No connected accounts. Add them from the Postly web app.', null, null, session);
        const lines = accounts.map((a) => `${PLATFORM_EMOJIS[a.platform.toLowerCase()] ?? '📱'} ${a.platform}: @${a.handle}`);
        return reply(`🔗 Connected accounts:\n\n${lines.join('\n')}`, null, null, session);
      } catch {
        return reply('Could not fetch accounts. Please try again.', null, null, session);
      }
    }

    // ── help ──────────────────────────────────────────────────────────────────
    case 'help': {
      return reply(
        `📖 Postly Bot — Commands\n\n` +
        `${pfx}start — Create a new post\n` +
        `${pfx}status — View last 5 posts\n` +
        `${pfx}accounts — View connected social accounts\n` +
        `${pfx}link <token> — Link your account\n` +
        `${pfx}help — Show this message`,
        null, null, session,
      );
    }

    default:
      return reply(`Unknown command. Try ${pfx}help.`, null, null, session);
  }
}

// ── State-machine message handler ─────────────────────────────────────────────

/**
 * Drives the conversation flow based on the current session state.
 * `action` is a structured choice value (e.g. "type:announcement", "platform:twitter").
 * `text` is raw free-form input (only consumed in AWAIT_IDEA state).
 *
 * @param {{ platform, chatId, session, action, text }} input
 * @returns {Promise<{ replyText, options, choicesType, updatedSession }>}
 */
async function processMessage({ platform, chatId, session, action, text }) {
  const state  = session?.state ?? 'IDLE';
  const userId = session?.userId ?? null;

  // ── IDLE ────────────────────────────────────────────────────────────────────
  if (state === 'IDLE') {
    return reply(
      `Send ${cmdPrefix(platform)}start to create a post, or ${cmdPrefix(platform)}help for commands.`,
      null, null, session,
    );
  }

  // ── SELECT_TYPE ─────────────────────────────────────────────────────────────
  if (state === 'SELECT_TYPE') {
    if (!action?.startsWith('type:')) {
      return reply('Please select a content type from the options.', TYPE_CHOICES, 'type', session);
    }
    const contentType = action.slice('type:'.length);
    const choices     = buildPlatformChoices([]);
    const newSess     = { ...session, state: 'SELECT_PLATFORMS', contentType, pendingChoices: choices };
    await botSession.setSession(platform, chatId, newSess);
    return reply(
      `✅ Type: ${contentType}\n\nSelect your target platforms (choose multiple, then confirm):`,
      choices, 'platform', newSess,
    );
  }

  // ── SELECT_PLATFORMS ────────────────────────────────────────────────────────
  if (state === 'SELECT_PLATFORMS') {
    if (!action?.startsWith('platform:')) {
      const choices = buildPlatformChoices(session.platforms ?? []);
      return reply('Please select a platform from the options.', choices, 'platform', session);
    }

    const value = action.slice('platform:'.length);

    if (value === 'done') {
      if (!session.platforms?.length) {
        const choices = buildPlatformChoices([]);
        return reply('⚠️ Select at least one platform first.', choices, 'platform', session);
      }
      const platformList = session.platforms.map((p) => PLATFORM_EMOJIS[p] ?? p).join(' ');
      const newSess      = { ...session, state: 'SELECT_TONE', pendingChoices: TONE_CHOICES };
      await botSession.setSession(platform, chatId, newSess);
      return reply(
        `✅ Platforms: ${platformList}\n\nChoose a tone for your content:`,
        TONE_CHOICES, 'tone', newSess,
      );
    }

    // Toggle
    const current  = session.platforms ?? [];
    const updated  = current.includes(value)
      ? current.filter((p) => p !== value)
      : [...current, value];
    const choices  = buildPlatformChoices(updated);
    const newSess  = { ...session, platforms: updated, pendingChoices: choices };
    await botSession.setSession(platform, chatId, newSess);
    const toggleMsg = updated.includes(value) ? `${value} added ✓` : `${value} removed`;
    return reply(toggleMsg, choices, 'platform', newSess);
  }

  // ── SELECT_TONE ─────────────────────────────────────────────────────────────
  if (state === 'SELECT_TONE') {
    if (!action?.startsWith('tone:')) {
      return reply('Please select a tone from the options.', TONE_CHOICES, 'tone', session);
    }
    const tone    = action.slice('tone:'.length);
    const newSess = { ...session, state: 'SELECT_MODEL', tone, pendingChoices: MODEL_CHOICES };
    await botSession.setSession(platform, chatId, newSess);
    return reply(`✅ Tone: ${tone}\n\nChoose an AI model:`, MODEL_CHOICES, 'model', newSess);
  }

  // ── SELECT_MODEL ────────────────────────────────────────────────────────────
  if (state === 'SELECT_MODEL') {
    if (!action?.startsWith('model:')) {
      return reply('Please select a model from the options.', MODEL_CHOICES, 'model', session);
    }
    const model      = action.slice('model:'.length);
    const modelLabel = model === 'openai' ? 'GPT-4o' : 'Claude Sonnet';
    const newSess    = { ...session, state: 'AWAIT_IDEA', model, pendingChoices: null };
    await botSession.setSession(platform, chatId, newSess);
    return reply(
      `✅ Model: ${modelLabel}\n\n💡 Send me your idea (max ${IDEA_MAX_LENGTH} characters):`,
      null, null, newSess,
    );
  }

  // ── AWAIT_IDEA ──────────────────────────────────────────────────────────────
  if (state === 'AWAIT_IDEA') {
    const idea = text?.trim() ?? '';

    if (!idea) {
      return reply('Please send your idea as a text message.', null, null, session);
    }
    if (idea.length > IDEA_MAX_LENGTH) {
      return reply(
        `⚠️ Idea too long (${idea.length}/${IDEA_MAX_LENGTH} chars). Please shorten it.`,
        null, null, session,
      );
    }

    // Persist GENERATING before the async AI call so concurrent messages are handled.
    await botSession.setSession(platform, chatId, { ...session, state: 'GENERATING', idea });

    try {
      const result = await generateContent(
        { idea, post_type: session.contentType, platforms: session.platforms, tone: session.tone, model: session.model },
        userId,
      );

      const newSess = {
        ...session,
        state:            'PREVIEW',
        idea,
        generatedContent: result.generated,
        modelUsed:        result.model_used,
        tokensUsed:       result.tokens_used,
        pendingChoices:   CONFIRM_CHOICES,
      };
      await botSession.setSession(platform, chatId, newSess);
      return reply(buildPreviewText(result.generated), CONFIRM_CHOICES, 'confirm', newSess);
    } catch (err) {
      // Roll back so the user can retry.
      await botSession.setSession(platform, chatId, { ...session, state: 'AWAIT_IDEA', idea });
      return reply(
        `❌ Generation failed: ${err.message}\n\nPlease try a different idea.`,
        null, null, { ...session, state: 'AWAIT_IDEA' },
      );
    }
  }

  // ── GENERATING ──────────────────────────────────────────────────────────────
  if (state === 'GENERATING') {
    return reply('⏳ Still generating… please wait a moment.', null, null, session);
  }

  // ── PREVIEW ─────────────────────────────────────────────────────────────────
  if (state === 'PREVIEW') {
    if (!action?.startsWith('action:')) {
      return reply('Please select an option from the choices.', CONFIRM_CHOICES, 'confirm', session);
    }

    const confirmAction = action.slice('action:'.length);

    if (confirmAction === 'edit_idea') {
      const newSess = { ...session, state: 'AWAIT_IDEA', pendingChoices: null };
      await botSession.setSession(platform, chatId, newSess);
      return reply(`✏️ Send me your updated idea (max ${IDEA_MAX_LENGTH} characters):`, null, null, newSess);
    }

    if (confirmAction === 'cancel') {
      const newSess = botSession.blankFlow(userId);
      await botSession.setSession(platform, chatId, newSess);
      return reply(
        `❌ Post canceled. Send ${cmdPrefix(platform)}start whenever you're ready.`,
        null, null, newSess,
      );
    }

    if (confirmAction === 'post_now') {
      if (!userId) {
        return reply('Session expired. Please link your account again.', null, null, session);
      }

      const { platforms: selectedPlatforms, generatedContent, idea, tone, model } = session;
      const platformsMap = {};
      for (const p of selectedPlatforms ?? []) {
        const content = generatedContent?.[p]?.content?.trim();
        if (content) platformsMap[p.toUpperCase()] = { content };
      }

      if (!Object.keys(platformsMap).length) {
        return reply('❌ No publishable content found. Please start over.', null, null, session);
      }

      try {
        const post = await postsService.publishPost(userId, {
          idea,
          post_type:  'TEXT',
          tone:       tone  ?? undefined,
          model_used: model ?? undefined,
          platforms:  platformsMap,
        });

        const newSess = botSession.blankFlow(userId);
        await botSession.setSession(platform, chatId, newSess);

        const platformLines = post.platformPosts
          .map((pp) => `${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: queued`)
          .join('\n');

        return reply(
          `🚀 Post queued!\n\n${platformLines}\n\nSend ${cmdPrefix(platform)}status to track progress.`,
          null, null, newSess,
        );
      } catch (err) {
        return reply(`❌ Failed to publish: ${err.message}\n\nPlease try again.`, null, null, session);
      }
    }

    return reply('Unknown action. Please use the provided options.', CONFIRM_CHOICES, 'confirm', session);
  }

  // Safety net — unknown state
  return reply(
    `Something went wrong. Send ${cmdPrefix(platform)}start to begin again.`,
    null, null, session,
  );
}

module.exports = {
  handleCommand,
  processMessage,
  IDEA_MAX_LENGTH,
  TYPE_CHOICES,
  TONE_CHOICES,
  MODEL_CHOICES,
  CONFIRM_CHOICES,
};
