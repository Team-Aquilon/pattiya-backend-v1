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
        read_at: {
            type: Date,
            default: null,
        },
        resolved_at: {
            type: Date,
            default: null,
        },
        dismissed_at: {
            type: Date,
            default: null,
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

notificationSchema.pre('save', function setRealtimeAction(next) {
    if (this.isNew) {
        this.$locals.realtimeAction = 'created';
    } else if (this.isModified('resolved_at') && this.resolved_at) {
        this.$locals.realtimeAction = 'resolved';
    } else if (this.isModified('dismissed_at') && this.dismissed_at) {
        this.$locals.realtimeAction = 'dismissed';
    } else if (this.isModified('is_read') || this.isModified('read_at')) {
        this.$locals.realtimeAction = 'read';
    } else {
        this.$locals.realtimeAction = 'updated';
    }
    next();
});

notificationSchema.post('save', function emitRealtimeAlert(doc) {
    const { emitNotificationAlert } = require('../services/socketService');
    emitNotificationAlert(doc.$locals.realtimeAction || 'updated', doc);
});
notificationSchema.index({ farm_id: 1, createdAt: -1 });
notificationSchema.index({ farm_id: 1, resolved_at: 1, dismissed_at: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
