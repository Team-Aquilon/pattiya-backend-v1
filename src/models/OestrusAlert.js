const mongoose = require('mongoose');

const oestrusAlertSchema = new mongoose.Schema(
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
        gateway_id: {
            type: String,
            default: '',
        },
        decision: {
            type: String,
            required: true,
            enum: ['LIKELY_OESTRUS', 'WATCH', 'NORMAL'],
        },
        sound_label: {
            type: String,
            default: 'normal',
        },
        sound_probability: {
            type: Number,
            default: 0,
        },
        activity_label: {
            type: String,
            default: 'unknown',
        },
        activity_state: {
            type: String,
            default: 'normal_activity',
            enum: ['high_activity', 'normal_activity'],
        },
        temperature_c: {
            type: Number,
            default: 0,
        },
        humidity_percent: {
            type: Number,
            default: 0,
        },
        rssi_dbm: {
            type: Number,
            default: 0,
        },
        snr_db: {
            type: Number,
            default: 0,
        },
        resolved_at: {
            type: Date,
            default: null,
        },
        dismissed_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

oestrusAlertSchema.pre('save', function setRealtimeAction(next) {
    if (this.isNew) {
        this.$locals.realtimeAction = 'created';
    } else if (this.isModified('resolved_at') && this.resolved_at) {
        this.$locals.realtimeAction = 'resolved';
    } else if (this.isModified('dismissed_at') && this.dismissed_at) {
        this.$locals.realtimeAction = 'dismissed';
    } else {
        this.$locals.realtimeAction = 'updated';
    }
    next();
});

oestrusAlertSchema.post('save', function emitRealtimeAlert(doc) {
    if (doc.decision === 'NORMAL') return;
    const { emitOestrusAlert } = require('../services/socketService');
    emitOestrusAlert(doc.$locals.realtimeAction || 'updated', doc);
});
// Indexes
oestrusAlertSchema.index({ farm_id: 1, decision: 1, createdAt: -1 });
oestrusAlertSchema.index({ farm_id: 1, cow_id: 1, createdAt: -1 });
oestrusAlertSchema.index({ farm_id: 1, resolved_at: 1, dismissed_at: 1 });

module.exports = mongoose.model('OestrusAlert', oestrusAlertSchema);
