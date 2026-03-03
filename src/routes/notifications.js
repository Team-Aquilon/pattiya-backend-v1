const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.post('/device', notificationController.registerDevice);
router.get('/', notificationController.getNotifications);
router.put('/settings', notificationController.updateSettings);

module.exports = router;
