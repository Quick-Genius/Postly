'use strict';

const Redis = require('ioredis');

/**
 * Create a publisher that can send messages to postly:events.
 * Uses a dedicated ioredis connection (not the app's redis client).
 *
 * @param {string} redisUrl
 */
function createPublisher(redisUrl) {
  const publisher = new Redis(redisUrl);

  return {
    /**
     * Publish a structured event to the IPC channel.
     * Fire-and-forget; publisher does NOT retry on failure.
     *
     * @param {Object} msg
     */
    async publish(msg) {
      if (!msg.type || !msg.payload || !msg.timestamp) {
        throw new Error('Message must contain type, payload, and timestamp fields');
      }
      
      const parsedDate = new Date(msg.timestamp);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new Error('Timestamp must be a valid ISO-8601 date');
      }

      await publisher.publish('postly:events', JSON.stringify(msg));
    },
    async close() {
      await publisher.quit();
    }
  };
}

/**
 * Create a subscriber that listens on postly:events.
 *
 * @param {string} redisUrl
 * @param {Function} onMessage
 */
function createSubscriber(redisUrl, onMessage) {
  const subscriber = new Redis(redisUrl, { autoResubscribe: true });

  subscriber.on('message', (channel, messageStr) => {
    try {
      const parsedMsg = JSON.parse(messageStr);
      onMessage(channel, parsedMsg);
    } catch (err) {
      // discard non-JSON
    }
  });

  return {
    async connect() {
      await subscriber.subscribe('postly:events');
    },
    async close() {
      await subscriber.unsubscribe('postly:events');
      await subscriber.quit();
    }
  };
}

module.exports = {
  createPublisher,
  createSubscriber
};
