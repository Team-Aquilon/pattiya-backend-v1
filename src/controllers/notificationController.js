const User = require('../models/User');
const Notification = require('../models/Notification');
const asyncHandler = require('../middleware/asyncHandler');

// ─── 3.1 Register Device for Alerts ───────────────────────

exports.registerDevice = asyncHandler(async (req, res) => {
    const { fcm_token, device_os } = req.body;

    if (!fcm_token) {
        return res.status(400).json({ status: 'error', message: 'fcm_token is required' });
    }

    const user = await User.findById(req.user._id);

    // Avoid duplicates
    const exists = user.fcm_tokens.some((t) => t.token === fcm_token);
    if (!exists) {
        user.fcm_tokens.push({ token: fcm_token, device_os: device_os || 'android' });
        await user.save();
    }

    res.json({ status: 'success', message: 'Device registered for notifications' });
});

// ─── 3.2 Get Notification History ─────────────────────────

exports.getNotifications = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const notifications = await Notification.find({ farm_id: req.farmId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    const total = await Notification.countDocuments({ farm_id: req.farmId });

    res.json({
        status: 'success',
        data: {
            notifications,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
    });
});

// ─── 3.3 Notification Settings ────────────────────────────

exports.updateSettings = asyncHandler(async (req, res) => {
    const { alert_heat, alert_theft, alert_low_battery } = req.body;

    const updates = {};
    if (alert_heat !== undefined) updates['notification_settings.alert_heat'] = alert_heat;
    if (alert_theft !== undefined) updates['notification_settings.alert_theft'] = alert_theft;
    if (alert_low_battery !== undefined) updates['notification_settings.alert_low_battery'] = alert_low_battery;

    await User.findByIdAndUpdate(req.user._id, { $set: updates });

    res.json({ status: 'success', message: 'Notification settings updated' });
});

module.exports = exports;
