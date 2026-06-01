'use strict';

const { Router } = require('express');
const adminController = require('../controllers/admin.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');

const router = Router();

// All admin routes require authentication and ADMIN role
router.use(requireAuth);
router.use(requireRole(['ADMIN']));

router.get('/stats', adminController.getGlobalStats);
router.get('/users', adminController.getUserAnalytics);

module.exports = router;
