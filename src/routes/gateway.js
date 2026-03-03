const express = require('express');
const router = express.Router();
const gatewayController = require('../controllers/gatewayController');
const { gatewayAuth } = require('../middleware/gatewayAuth');

// Public: gateway boot login (no token yet)
router.post('/auth/login', gatewayController.gatewayLogin);

// Protected: requires gateway JWT
router.get('/whitelist', gatewayAuth, gatewayController.getWhitelist);
router.post('/telemetry/vitals/batch', gatewayAuth, gatewayController.batchVitals);
router.post('/telemetry/activity/batch', gatewayAuth, gatewayController.batchActivity);
router.get('/settings/geofence', gatewayAuth, gatewayController.getGeofence);
router.post('/alerts/emergency', gatewayAuth, gatewayController.emergencyAlert);

module.exports = router;
