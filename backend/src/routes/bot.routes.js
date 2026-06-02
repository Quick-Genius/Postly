'use strict';

const { Router } = require('express');
const botController = require('../controllers/bot.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

router.post('/link', requireAuth, botController.linkBot);

module.exports = router;
