const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

// Public routes (no auth required)
router.get('/metadata', systemController.getMetadata);
router.get('/version', systemController.getVersion);

module.exports = router;
