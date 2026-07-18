const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');

router.use(auth);

router.post('/device', notificationController.registerDevice);
router.get('/', notificationController.getNotifications);
router.put('/settings', notificationController.updateSettings);
router.patch('/:notification_id/read', notificationController.markRead);
router.patch('/:notification_id/resolve', notificationController.resolveNotification);
router.patch('/:notification_id/dismiss', notificationController.dismissNotification);

module.exports = router;
