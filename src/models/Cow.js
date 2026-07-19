const mongoose = require('mongoose');

const cowSchema = new mongoose.Schema(
    {
        farm_id: {
            type: String,
            required: true,
            index: true,
        },
        cow_id: {
            type: String,
            required: true,
            unique: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        image_url: {
            type: String,
            default: '',
        },
        image_public_id: {
            type: String,
            default: '',
        },
        breed: {
            type: String,
            default: '',
        },
        dob: {
            type: Date,
        },
        weight_kg: {
            type: Number,
            default: 0,
        },
        collar_mac: {
            type: String,
            default: '',
            uppercase: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['HEALTHY', 'HEAT_DETECTED', 'SICK', 'THEFT_ALERT', 'LOW_BATTERY', 'OFFLINE'],
            default: 'HEALTHY',
        },
        battery_percentage: {
            type: Number,
            default: 100,
        },
        battery_status: {
            type: String,
            enum: ['NORMAL', 'LOW', 'CRITICAL'],
            default: 'NORMAL',
        },
        // Latest known GPS position
        last_location: {
            lat: { type: Number, default: 0 },
            lng: { type: Number, default: 0 },
        },
        last_update: {
            type: Date,
            default: Date.now,
        },
        // Geofence per-cow override (optional)
        radius_meters: {
            type: Number,
            default: 1000,
        },
        // Unpair / withdrawal
        is_active: {
            type: Boolean,
            default: true,
        },
        unpair_reason: {
            type: String,
            enum: ['SOLD', 'DIED', 'COLLAR_BROKEN', 'MISTAKE', ''],
            default: '',
        },
        unpair_notes: {
            type: String,
            default: '',
        },
        unpaired_at: Date,
    },
    {
        timestamps: true,
    }
);

cowSchema.pre('save', function setRealtimeAction(next) {
    this.$locals.realtimeAction = this.isNew ? 'created' : 'updated';
    next();
});

function emitCowUpdate(doc, action = 'updated') {
    if (!doc || !doc.farm_id) return;

    const { emitFarmUpdate } = require('../services/socketService');
    emitFarmUpdate(doc.farm_id, {
        action: doc.$locals?.realtimeAction || action,
        source: 'cow',
        entity: 'cow',
        cow_id: doc.cow_id,
    });
}

cowSchema.post('save', function emitRealtimeCowUpdate(doc) {
    emitCowUpdate(doc);
});

cowSchema.post('findOneAndUpdate', function emitRealtimeCowFindOneUpdate(doc) {
    emitCowUpdate(doc, 'updated');
});
// Indexes for queries
cowSchema.index({ farm_id: 1, status: 1 });
cowSchema.index({ farm_id: 1, collar_mac: 1 });
cowSchema.index({ farm_id: 1, is_active: 1 });

module.exports = mongoose.model('Cow', cowSchema);
