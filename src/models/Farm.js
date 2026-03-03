const mongoose = require('mongoose');

const farmSchema = new mongoose.Schema(
    {
        farm_id: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        farm_code: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },
        farm_name: {
            type: String,
            required: true,
            trim: true,
        },
        logo_url: {
            type: String,
            default: '',
        },
        theme_color: {
            type: String,
            default: '#4CAF50',
        },
        // Geofence settings
        geofence: {
            center_lat: { type: Number, default: 0 },
            center_lng: { type: Number, default: 0 },
            radius_meters: { type: Number, default: 500 },
            is_active: { type: Boolean, default: false },
        },
        is_active: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Farm', farmSchema);
