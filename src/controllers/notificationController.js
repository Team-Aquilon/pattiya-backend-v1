const mongoose = require('mongoose');
const User = require('../models/User');
const Cow = require('../models/Cow');
const Notification = require('../models/Notification');
const OestrusAlert = require('../models/OestrusAlert');
const asyncHandler = require('../middleware/asyncHandler');

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

async function findFarmNotification(req, res) {
    const { notification_id: notificationId } = req.params;
    if (!isValidId(notificationId)) {
        res.status(404).json({ status: 'error', message: 'Notification not found' });
        return null;
    }

    const notification = await Notification.findOne({ _id: notificationId, farm_id: req.farmId });
    if (!notification) {
        res.status(404).json({ status: 'error', message: 'Notification not found' });
        return null;
    }

    return notification;
}

function markRead(notification, at = new Date()) {
    notification.is_read = true;
    notification.read_at = notification.read_at || at;
}

async function syncHeatOestrusAlerts(notification, updates) {
    if (notification.type !== 'HEAT_DETECTED' || !notification.cow_id) return;

    await OestrusAlert.updateMany(
        {
            farm_id: notification.farm_id,
            cow_id: notification.cow_id,
            decision: { $ne: 'NORMAL' },
            resolved_at: null,
            dismissed_at: null,
        },
        { $set: updates }
    );
}

function statusAfterHeatResolution(cow) {
    const batteryPercentage = Number(cow.battery_percentage) || 0;
    if (cow.battery_status === 'CRITICAL' || (batteryPercentage > 0 && batteryPercentage <= 10)) {
        return 'LOW_BATTERY';
    }
    return 'HEALTHY';
}

async function clearResolvedHeatStatus(notification) {
    if (notification.type !== 'HEAT_DETECTED' || !notification.cow_id) return;

    const heatFilter = {
        farm_id: notification.farm_id,
        cow_id: notification.cow_id,
        type: 'HEAT_DETECTED',
        resolved_at: null,
        dismissed_at: null,
    };
    const alertFilter = {
        farm_id: notification.farm_id,
        cow_id: notification.cow_id,
        decision: { $ne: 'NORMAL' },
        resolved_at: null,
        dismissed_at: null,
    };

    const [activeNotification, activeAlert] = await Promise.all([
        Notification.exists(heatFilter),
        OestrusAlert.exists(alertFilter),
    ]);
    if (activeNotification || activeAlert) return;

    const cow = await Cow.findOne({
        farm_id: notification.farm_id,
        cow_id: notification.cow_id,
        status: 'HEAT_DETECTED',
    }).select('battery_percentage battery_status status');
    if (!cow) return;

    cow.status = statusAfterHeatResolution(cow);
    cow.last_update = new Date();
    await cow.save();
}

// 3.1 Register Device for Alerts
exports.registerDevice = asyncHandler(async (req, res) => {
    const { fcm_token, device_os } = req.body;

    if (!fcm_token) {
        return res.status(400).json({ status: 'error', message: 'fcm_token is required' });
    }

    const user = await User.findById(req.user._id);

    const exists = user.fcm_tokens.some((t) => t.token === fcm_token);
    if (!exists) {
        user.fcm_tokens.push({ token: fcm_token, device_os: device_os || 'android' });
        await user.save();
    }

    res.json({ status: 'success', message: 'Device registered for notifications' });
});

// 3.2 Get Notification History
exports.getNotifications = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const filter = {
        farm_id: req.farmId,
        resolved_at: null,
        dismissed_at: null,
    };

    const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    const total = await Notification.countDocuments(filter);

    res.json({
        status: 'success',
        data: {
            notifications,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
    });
});

exports.markRead = asyncHandler(async (req, res) => {
    const notification = await findFarmNotification(req, res);
    if (!notification) return;

    markRead(notification);
    await notification.save();

    res.json({ status: 'success', data: notification });
});

exports.resolveNotification = asyncHandler(async (req, res) => {
    const notification = await findFarmNotification(req, res);
    if (!notification) return;

    const now = new Date();
    markRead(notification, now);
    notification.resolved_at = notification.resolved_at || now;
    await notification.save();
    await syncHeatOestrusAlerts(notification, { resolved_at: now });
    await clearResolvedHeatStatus(notification);

    res.json({ status: 'success', data: notification });
});

exports.dismissNotification = asyncHandler(async (req, res) => {
    const notification = await findFarmNotification(req, res);
    if (!notification) return;

    const now = new Date();
    markRead(notification, now);
    notification.dismissed_at = notification.dismissed_at || now;
    await notification.save();
    await syncHeatOestrusAlerts(notification, { dismissed_at: now });
    await clearResolvedHeatStatus(notification);

    res.json({ status: 'success', data: notification });
});

// 3.3 Notification Settings
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
