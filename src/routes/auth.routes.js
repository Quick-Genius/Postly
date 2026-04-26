const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
