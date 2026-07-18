const express = require('express');
const router = express.Router();
const cowController = require('../controllers/cowController');
const { auth } = require('../middleware/auth');
const { uploadSingleImage } = require('../middleware/imageUpload');

// All cow routes require user authentication
router.use(auth);

// Dashboard & inventory
router.get('/dashboard', cowController.dashboard);
router.get('/locations', cowController.getLocations);
router.get('/', cowController.listCows);

// Registration
router.post('/register', cowController.registerCow);

// Single cow
// Active oestrus alerts (must be before /:cow_id to avoid route conflict)
router.get('/oestrus/active', cowController.getActiveOestrusAlerts);
router.patch('/oestrus/alerts/:alert_id/resolve', cowController.resolveOestrusAlert);
router.patch('/oestrus/alerts/:alert_id/dismiss', cowController.dismissOestrusAlert);
router.get('/:cow_id', cowController.getCow);
router.put('/:cow_id', cowController.updateCow);
router.get('/:cow_id/history', cowController.getCowHistory);
router.post('/:cow_id/image', uploadSingleImage('image'), cowController.uploadImage);
router.delete('/:cow_id/image', cowController.deleteImage);
router.post('/:cow_id/unpair', cowController.unpairCow);

// Health events
router.post('/:cow_id/events', cowController.addHealthEvent);
router.get('/:cow_id/events', cowController.getHealthEvents);

// Methane monitoring
router.get('/:cow_id/methane/history', cowController.getMethaneHistory);

// Milk tracking
router.post('/:cow_id/milk', cowController.addMilkRecord);
router.get('/:cow_id/milk/stats', cowController.getMilkStats);

// AI Predictions
router.get('/:cow_id/predictions/latest', cowController.getLatestPredictions);
router.get('/:cow_id/predictions/history', cowController.getPredictionHistory);

// Oestrus fusion alerts
router.get('/:cow_id/oestrus/alerts', cowController.getOestrusAlerts);

module.exports = router;
