const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const asyncHandler = require('../middleware/asyncHandler');
const { buildCloudinaryFolder, uploadImage: uploadCloudinaryImage } = require('../services/cloudinaryService');

function formatUserProfile(user) {
    return {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        farm_id: user.farm_id,
        profile_image_url: user.profile_image_url || '',
        image_url: user.profile_image_url || '',
        notification_settings: user.notification_settings,
    };
}

// 5.3 Get User Profile
exports.getProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('-password -reset_code -reset_code_expires');

    res.json({
        status: 'success',
        data: formatUserProfile(user),
    });
});

// 5.4 Update User Profile
exports.updateProfile = asyncHandler(async (req, res) => {
    const { name, phone } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });

    res.json({
        status: 'success',
        data: formatUserProfile(user),
    });
});

// 5.5 Upload User Profile Image
exports.uploadProfileImage = asyncHandler(async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'Image file is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const folder = buildCloudinaryFolder('farms', user.farm_id, 'users');
    const uploaded = await uploadCloudinaryImage(req.file, {
        folder,
        publicId: user._id.toString(),
    });

    user.profile_image_url = uploaded.url;
    user.profile_image_public_id = uploaded.public_id || '';
    await user.save();

    res.json({
        status: 'success',
        data: {
            profile_image_url: user.profile_image_url,
            image_url: user.profile_image_url,
            public_id: user.profile_image_public_id,
        },
    });
});

// 5.6 Delete Account
exports.deleteAccount = asyncHandler(async (req, res) => {
    const { password, reason } = req.body;

    if (!password) {
        return res.status(400).json({ status: 'error', message: 'Password is required to confirm deletion' });
    }

    // Verify identity
    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    // Schedule deletion (30 days from now as per app store policy)
    user.deletion_scheduled_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    user.is_active = false;
    await user.save();

    // Revoke all tokens
    await RefreshToken.updateMany({ user_id: user._id }, { is_revoked: true });

    res.json({
        status: 'success',
        message: 'Account scheduled for deletion in 30 days.',
    });
});

module.exports = exports;
