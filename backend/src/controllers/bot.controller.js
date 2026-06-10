'use strict';

const twilio = require('twilio');
const env = require('../config/env');
const prisma = require('../config/prisma');
const botSession = require('../bot/botSession');
const { bot: telegramBot } = require('../bot/telegram/bot');
const logger = require('../utils/logger').child('BotController');

let twilioClient = null;
if (env.twilioAccountSid && env.twilioAuthToken) {
  twilioClient = twilio(env.twilioAccountSid, env.twilioAuthToken);
}

async function linkBot(req, res, next) {
  const { linkToken } = req.body;
  const userId = req.userId;

  if (!linkToken) {
    return res.status(400).json({ error: 'Missing linkToken' });
  }

  try {
    const linkData = await botSession.getLinkToken(linkToken);
    if (!linkData) {
      return res.status(404).json({ error: 'Link token not found or expired' });
    }

    const { platform, chatId } = linkData;

    // 1. Link the user to the bot session (Redis)
    await botSession.updateSession(platform, chatId, { userId, state: 'IDLE' });

    // 2. Persist the connection in the database
    if (platform === 'telegram') {
      await prisma.telegramConnection.upsert({
        where: { telegramChatId: chatId },
        update: { userId },
        create: { telegramChatId: chatId, userId },
      });
    } else if (platform === 'whatsapp') {
      await prisma.whatsappConnection.upsert({
        where: { phoneNumber: chatId },
        update: { userId },
        create: { phoneNumber: chatId, userId },
      });
    }

    // 3. Clear the link token
    await botSession.clearLinkToken(linkToken);

    // 4. Send success message to the bot
    const successMsg = '✅ Successfully linked! Your account is now connected to Postly. Send /start to begin.';

    if (platform === 'telegram' && telegramBot) {
      await telegramBot.api.sendMessage(chatId, successMsg);
    } else if (platform === 'whatsapp' && twilioClient && env.twilioWhatsappNumber) {
      await twilioClient.messages.create({
        from: `whatsapp:${env.twilioWhatsappNumber}`,
        to: `whatsapp:${chatId}`,
        body: successMsg,
      });
    }

    logger.info('Bot linked successfully and persisted', { userId, platform, chatId });
    return res.status(200).json({ message: 'Linked successfully' });
  } catch (err) {
    logger.error('Failed to link bot', { err, userId, linkToken });
    return next(err);
  }
}

module.exports = { linkBot };
