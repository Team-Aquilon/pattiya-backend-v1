const mongoose = require('mongoose');

const milkRecordSchema = new mongoose.Schema(
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
        date: {
            type: Date,
            required: true,
        },
        session: {
            type: String,
            enum: ['MORNING', 'EVENING'],
            required: true,
        },
        liters: {
            type: Number,
            required: true,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
);

// Prevent duplicate entries for same cow + date + session
milkRecordSchema.index({ cow_id: 1, date: 1, session: 1 }, { unique: true });
milkRecordSchema.index({ farm_id: 1, cow_id: 1, date: -1 });

module.exports = mongoose.model('MilkRecord', milkRecordSchema);
