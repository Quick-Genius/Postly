const express = require('express');
const { getPrivacyPolicy, getTerms } = require('../controllers/legal.controller');

const router = express.Router();

router.get('/privacy', getPrivacyPolicy);
router.get('/terms', getTerms);

module.exports = router;
