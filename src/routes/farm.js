const express = require('express');
const router = express.Router();
const farmController = require('../controllers/farmController');
const { auth } = require('../middleware/auth');

router.use(auth);

// Geofence
router.put('/settings/geofence', farmController.updateGeofence);

// Environment (DHT22 dashboard)
router.get('/environment/current', farmController.getEnvironment);
router.get('/environment/history', farmController.getEnvironmentHistory);

module.exports = router;
