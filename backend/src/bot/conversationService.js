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
const prisma                = require('../config/prisma');
const { verifyAccessToken } = require('../utils/jwt');
const getBotSession         = () => require('./botSession');
const env                   = require('../config/env');
const crypto                = require('crypto');
const logger                = require('../utils/logger').child('Conversation');

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

function platformName(value) {
  const found = PLATFORM_LIST.find((p) => p.value === value);
  if (!found) return value;
  return found.label.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();
}

function selectedPlatformsText(platforms = []) {
  if (!platforms.length) return 'none';
  return platforms.map((p) => platformName(p)).join(', ');
}

/**
 * Validates that the userId stored in the bot session still maps to a real,
 * consistent user in the database.
 *
 * If the session was restored from a stale TelegramConnection record that
 * points to a different user, the userId and userEmail will not match — this
 * guard catches that and returns false, prompting the user to re-link.
 *
 * @param {{ userId: string|null, userEmail: string|null }} session
 * @returns {Promise<boolean>} true if the session identity is valid
 */
async function validateSessionUser(session) {
  if (!session?.userId) return false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true },
    });
    if (!user) return false;

    // If the session was seeded with an email (from DB restore), verify it
    // matches the email on the user record.  A mismatch means the
    // TelegramConnection still points to the old user after a re-link.
    if (session.userEmail && user.email !== session.userEmail) {
      logger.warn('Session userId/email mismatch — possible stale TelegramConnection', {
        sessionUserId:    session.userId,
        sessionUserEmail: session.userEmail,
        dbUserEmail:      user.email,
      });
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the set of platform values (lowercase, e.g. "twitter") for which
 * the user has a connected social account.
 */
async function getConnectedPlatforms(userId) {
  if (!userId) return new Set();
  try {
    const accounts = await userService.getSocialAccounts(userId);
    return new Set(accounts.map((a) => a.platform.toLowerCase()));
  } catch {
    return new Set();
  }
}

function notConnectedText(value, platform) {
  return `⚠️ Your ${platformName(value)} account isn't connected yet.\nConnect it here: ${env.frontendUrl}/platforms?from=${platform}\n\nThen come back and select it again.`;
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

function getHelpText(pfx) {
  return `📖 Postly Bot — Commands\n\n` +
    `${pfx}start — Create a new post / Link account\n` +
    `${pfx}restart — Restart from the first prompt\n` +
    `${pfx}end — End the current conversation\n` +
    `${pfx}status — View last 5 posts\n` +
    `${pfx}accounts — View connected social accounts\n` +
    `${pfx}help — Show this message`;
}

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
      // restart behaves like start after wiping in-progress flow state
      // while preserving the linked user.
      const resetBase = getBotSession().blankFlow(userId, session?.userEmail ?? null);

      if (!userId) {
        const token = crypto.randomUUID();
        await getBotSession().setLinkToken(token, platform, chatId);
        const linkUrl = `${env.frontendUrl}/auth?bot_link=${token}`;

        return reply(
          `👋 Welcome to Postly!\n\n` +
          `Please link your account to get started:\n` +
          `${linkUrl}\n\n` +
          `Once authenticated, you'll be able to create posts directly from here.\n\n` +
          getHelpText(pfx),
          null, null, session,
        );
      }

      // Validate that the userId stored in this session still corresponds to a
      // real, consistent user. If not, force a re-link to prevent cross-user leakage.
      const isValidUser = await validateSessionUser(session);
      if (!isValidUser) {
        const token = crypto.randomUUID();
        await getBotSession().setLinkToken(token, platform, chatId);
        const linkUrl = `${env.frontendUrl}/auth?bot_link=${token}`;
        return reply(
          `⚠️ Your session has expired or your account link has changed.\n\n` +
          `Please re-link your account:\n${linkUrl}`,
          null, null, null,
        );
      }

      const newSess = { ...resetBase, state: 'SELECT_TYPE', pendingChoices: TYPE_CHOICES };
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(
        `✨ Let's create a post!\n\nWhat type of content is this?\n\n` + getHelpText(pfx),
        TYPE_CHOICES, 'type', newSess,
      );
    }

    // ── restart ───────────────────────────────────────────────────────────────
    case 'restart': {
      if (!userId) {
        const token = crypto.randomUUID();
        await getBotSession().setLinkToken(token, platform, chatId);
        const linkUrl = `${env.frontendUrl}/auth?bot_link=${token}`;

        return reply(
          `👋 Welcome to Postly!\n\n` +
          `Please link your account to get started:\n` +
          `${linkUrl}\n\n` +
          `Once authenticated, you'll be able to create posts directly from here.`,
          null, null, session,
        );
      }
      const newSess = { ...getBotSession().blankFlow(userId), state: 'SELECT_TYPE', pendingChoices: TYPE_CHOICES };
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(
        '🔁 Flow restarted.\n\nWhat type of content is this?',
        TYPE_CHOICES, 'type', newSess,
      );
    }

    // ── end ───────────────────────────────────────────────────────────────────
    case 'end': {
      const newSess = { ...getBotSession().blankFlow(userId), state: 'ENDED' };
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(
        `🛑 Conversation ended.\n\nSend ${pfx}restart to begin again.`,
        null, null, newSess,
      );
    }

    // ── status ────────────────────────────────────────────────────────────────
    case 'status': {
      if (!userId) return reply(`Please link your account first by typing ${pfx}start`, null, null, session);
      try {
        const { data: posts } = await postsService.listPosts(userId, { limit: 5, page: 1 });
        if (!posts.length) return reply('No posts yet. Send start to create one!', null, null, session);
        const lines = posts.map((p, i) => {
          const idea = p.idea.length > 45 ? `${p.idea.slice(0, 45)}…` : p.idea;
          const platforms = p.platformPosts
            .map((pp) => {
              const base = `  ${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: ${pp.status}`;
              if (pp.publishedUrl) return `${base}\n    🔗 ${pp.publishedUrl}`;
              return base;
            })
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
      if (!userId) return reply(`Please link your account first by typing ${pfx}start`, null, null, session);
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
        getHelpText(pfx),
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
  const log    = logger.child('processMessage', { platform, chatId, state, action });

  // ── IDLE ────────────────────────────────────────────────────────────────────
  if (state === 'IDLE') {
    if (!userId) {
      return reply(
        `Welcome! Please link your account first by typing ${cmdPrefix(platform)}start`,
        null, null, session,
      );
    }

    // Direct Prompt Detection: if user sends a long message, assume it's a post idea
    if (text && text.length > 20) {
      const newSess = { 
        ...getBotSession().blankFlow(userId), 
        state: 'SELECT_TYPE', 
        idea: text, // save the text as the idea immediately
        pendingChoices: TYPE_CHOICES 
      };
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(
        `I've captured your idea: "${text.slice(0, 50)}..."\n\nTo continue, what type of content is this?`,
        TYPE_CHOICES, 'type', newSess,
      );
    }

    return reply(
      `Send ${cmdPrefix(platform)}start to create a post, or simply send your post idea here!`,
      null, null, session,
    );
  }

  // ── ENDED ───────────────────────────────────────────────────────────────────
  if (state === 'ENDED') {
    return reply(
      `Conversation is ended. Send ${cmdPrefix(platform)}restart to start again.`,
      null, null, session,
    );
  }

  // ── SELECT_TYPE ─────────────────────────────────────────────────────────────
  if (state === 'SELECT_TYPE') {
    if (!action?.startsWith('type:')) {
      return reply(
        '✨ Let\'s create a post!\n\nWhat type of content?\nChoose an option by typing keyword or number.',
        TYPE_CHOICES, 'type', session,
      );
    }
    const contentType = action.slice('type:'.length);
    const choices     = buildPlatformChoices([]);
    const newSess     = { ...session, state: 'SELECT_PLATFORMS', contentType, pendingChoices: choices };
    await getBotSession().setSession(platform, chatId, newSess);
    log.info('State transition', { from: 'SELECT_TYPE', to: 'SELECT_PLATFORMS', contentType });
    return reply(
      `✅ Type: ${contentType}\n\nSelect platforms (you can choose multiple):`,
      choices, 'platform', newSess,
    );
  }

  // ── SELECT_PLATFORMS ────────────────────────────────────────────────────────
  if (state === 'SELECT_PLATFORMS') {
    if (!action?.startsWith('platform:')) {
      const choices = buildPlatformChoices(session.platforms ?? []);
      return reply(
        `Select platforms (you can choose multiple).\n\nSelected: ${selectedPlatformsText(session.platforms ?? [])}`,
        choices, 'platform', session,
      );
    }

    const value = action.slice('platform:'.length);
    const allowedPlatforms = new Set(PLATFORM_LIST.map((p) => p.value));

    if (value.startsWith('multi_done:') || value.startsWith('multi:')) {
      const isMultiDone = value.startsWith('multi_done:');
      const rawPlatforms = value.slice(isMultiDone ? 'multi_done:'.length : 'multi:'.length);
      const requested = rawPlatforms
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => allowedPlatforms.has(p));

      const connectedPlatforms = await getConnectedPlatforms(userId);
      const notConnected = requested.filter((p) => !connectedPlatforms.has(p));
      const toAdd = requested.filter((p) => connectedPlatforms.has(p));
      const notConnectedNote = notConnected.length
        ? `\n\n${notConnected.map((p) => notConnectedText(p, platform)).join('\n')}`
        : '';

      const current = session.platforms ?? [];
      const updated = [...new Set([...current, ...toAdd])];
      const choices = buildPlatformChoices(updated);
      const newSess = { ...session, platforms: updated, pendingChoices: choices };
      await getBotSession().setSession(platform, chatId, newSess);
      log.info('Platform selection updated (multi)', { selectedPlatforms: updated, notConnected });

      if (isMultiDone) {
        if (!updated.length) {
          return reply(`⚠️ Select at least one platform first.${notConnectedNote}`, choices, 'platform', newSess);
        }
        const toneSess = { ...newSess, state: 'SELECT_TONE', pendingChoices: TONE_CHOICES };
        await getBotSession().setSession(platform, chatId, toneSess);
        return reply(
          `✅ Platforms: ${selectedPlatformsText(updated)}${notConnectedNote}\n\nChoose a tone for your content:`,
          TONE_CHOICES, 'tone', toneSess,
        );
      }

      return reply(
        `✅ Updated selection.\nSelected: ${selectedPlatformsText(updated)}${notConnectedNote}\nType another platform or "done".`,
        choices, 'platform', newSess,
      );
    }

    if (value === 'done') {
      if (!session.platforms?.length) {
        const choices = buildPlatformChoices([]);
        return reply('⚠️ Select at least one platform first.', choices, 'platform', session);
      }
      const newSess      = { ...session, state: 'SELECT_TONE', pendingChoices: TONE_CHOICES };
      await getBotSession().setSession(platform, chatId, newSess);
      log.info('State transition', { from: 'SELECT_PLATFORMS', to: 'SELECT_TONE', platforms: session.platforms });
      return reply(
        `✅ Platforms: ${selectedPlatformsText(session.platforms)}\n\nChoose a tone for your content:`,
        TONE_CHOICES, 'tone', newSess,
      );
    }

    if (!allowedPlatforms.has(value)) {
      const choices = buildPlatformChoices(session.platforms ?? []);
      return reply('Please select a valid platform option.', choices, 'platform', session);
    }

    // WhatsApp quick-reply taps can be duplicated by clients/retries.
    // Keep WhatsApp idempotent; preserve toggle UX for Telegram buttons.
    const current  = session.platforms ?? [];
    const alreadySelected = current.includes(value);

    // Only block *new* selections — removing an already-selected platform
    // (or re-tapping it on WhatsApp) never needs a connection check.
    if (!alreadySelected) {
      // Guard: verify session user is still the correct user before checking
      // platform connections — prevents cross-user leakage if the session
      // userId belongs to a stale TelegramConnection.
      const isValidUser = await validateSessionUser(session);
      if (!isValidUser) {
        const token = crypto.randomUUID();
        await getBotSession().setLinkToken(token, platform, chatId);
        const linkUrl = `${env.frontendUrl}/auth?bot_link=${token}`;
        return reply(
          `⚠️ Session identity mismatch. Please re-link your account:\n${linkUrl}`,
          null, null, null,
        );
      }
      const connectedPlatforms = await getConnectedPlatforms(userId);
      if (!connectedPlatforms.has(value)) {
        const choices = buildPlatformChoices(current);
        return reply(
          `${notConnectedText(value, platform)}\n\nSelected: ${selectedPlatformsText(current)}`,
          choices, 'platform', session,
        );
      }
    }

    const updated  = platform === 'whatsapp'
      ? (alreadySelected ? current : [...current, value])
      : (alreadySelected ? current.filter((p) => p !== value) : [...current, value]);
    const choices  = buildPlatformChoices(updated);
    const newSess  = { ...session, platforms: updated, pendingChoices: choices };
    await getBotSession().setSession(platform, chatId, newSess);
    log.info('Platform selection updated', { selectedPlatforms: updated });
    const toggleMsg = platform === 'whatsapp'
      ? (alreadySelected
        ? `ℹ️ ${platformName(value)} already selected.\nSelected: ${selectedPlatformsText(updated)}\nType another platform or "done".`
        : `✅ Added ${platformName(value)}.\nSelected: ${selectedPlatformsText(updated)}\nType another platform or "done".`)
      : (updated.includes(value) ? `${value} added ✓` : `${value} removed`);
    return reply(toggleMsg, choices, 'platform', newSess);
  }

  // ── SELECT_TONE ─────────────────────────────────────────────────────────────
  if (state === 'SELECT_TONE') {
    if (!action?.startsWith('tone:')) {
      return reply('Please select a tone from the options.', TONE_CHOICES, 'tone', session);
    }
    const tone    = action.slice('tone:'.length);
    const newSess = { ...session, state: 'SELECT_MODEL', tone, pendingChoices: MODEL_CHOICES };
    await getBotSession().setSession(platform, chatId, newSess);
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
    await getBotSession().setSession(platform, chatId, newSess);
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
    await getBotSession().setSession(platform, chatId, { ...session, state: 'GENERATING', idea });

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
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(buildPreviewText(result.generated), CONFIRM_CHOICES, 'confirm', newSess);
    } catch (err) {
      // Roll back so the user can retry.
      await getBotSession().setSession(platform, chatId, { ...session, state: 'AWAIT_IDEA', idea });
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
      return reply(
        'What would you like to do?',
        CONFIRM_CHOICES, 'confirm', session,
      );
    }

    const confirmAction = action.slice('action:'.length);

    if (confirmAction === 'edit_idea') {
      const newSess = { ...session, state: 'AWAIT_IDEA', pendingChoices: null };
      await getBotSession().setSession(platform, chatId, newSess);
      return reply(`✏️ Send me your updated idea (max ${IDEA_MAX_LENGTH} characters):`, null, null, newSess);
    }

    if (confirmAction === 'cancel') {
      const newSess = getBotSession().blankFlow(userId);
      await getBotSession().setSession(platform, chatId, newSess);
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
      const allTopics = new Set();

      for (const p of selectedPlatforms ?? []) {
        const platformData = generatedContent?.[p];
        const content = platformData?.content?.trim();
        if (content) {
          platformsMap[p.toUpperCase()] = { content };
          // Simple topic extraction: words starting with # or common keywords
          if (platformData.hashtags) {
            platformData.hashtags.forEach(tag => allTopics.add(tag.replace('#', '').toLowerCase()));
          }
        }
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
          topics:     Array.from(allTopics),
        });

        const newSess = getBotSession().blankFlow(userId);
        await getBotSession().setSession(platform, chatId, newSess);

        const platformLines = post.platformPosts
          .map((pp) => `${PLATFORM_EMOJIS[pp.platform.toLowerCase()] ?? '📱'} ${pp.platform}: queued`)
          .join('\n');

        return reply(
          `🚀 Post queued!\n\n${platformLines}\n\nSend ${cmdPrefix(platform)}status to track progress and view published links.`,
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
