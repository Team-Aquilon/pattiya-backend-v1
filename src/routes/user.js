const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { auth } = require('../middleware/auth');
const { uploadSingleImage } = require('../middleware/imageUpload');

router.use(auth);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/profile/image', uploadSingleImage('image'), userController.uploadProfileImage);
router.delete('/profile/image', userController.deleteProfileImage);
router.delete('/account', userController.deleteAccount);

module.exports = router;
