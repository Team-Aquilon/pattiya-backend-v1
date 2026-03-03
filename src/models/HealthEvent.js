const mongoose = require('mongoose');

const healthEventSchema = new mongoose.Schema(
    {
        farm_id: {
            type: String,
            required: true,
            index: true,
        },
        cow_id: {
            type: String,
            required: true,
            index: true,
        },
        event_type: {
            type: String,
            enum: ['VACCINATION', 'TREATMENT', 'ARTIFICIAL_INSEMINATION', 'BIRTH', 'HEAT_DETECTED'],
            required: true,
        },
        date: {
            type: Date,
            required: true,
        },
        notes: {
            type: String,
            default: '',
        },
        cost: {
            type: Number,
            default: 0,
        },
        // Auto-populated for system-generated events (e.g., heat detection)
        auto_generated: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

healthEventSchema.index({ farm_id: 1, cow_id: 1, event_type: 1 });
healthEventSchema.index({ cow_id: 1, date: -1 });

module.exports = mongoose.model('HealthEvent', healthEventSchema);
