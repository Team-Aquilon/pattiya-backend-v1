const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        farm_id: {
            type: String,
            required: true,
            index: true,
        },
        cow_id: {
            type: String,
            default: '',
        },
        type: {
            type: String,
            enum: ['HEAT_DETECTED', 'GEOFENCE_BREACH', 'LOW_BATTERY', 'OFFLINE', 'SYSTEM'],
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        severity: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            default: 'MEDIUM',
        },
        is_read: {
            type: Boolean,
            default: false,
        },
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

notificationSchema.index({ farm_id: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
