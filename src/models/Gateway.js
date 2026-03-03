const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const gatewaySchema = new mongoose.Schema(
    {
        gateway_id: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        farm_id: {
            type: String,
            required: true,
            index: true,
        },
        hardware_secret: {
            type: String,
            required: true,
        },
        name: {
            type: String,
            default: '',
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        last_seen: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// Hash hardware_secret before saving
gatewaySchema.pre('save', async function (next) {
    if (!this.isModified('hardware_secret')) return next();
    this.hardware_secret = await bcrypt.hash(this.hardware_secret, 10);
    next();
});

// Verify hardware_secret
gatewaySchema.methods.compareSecret = async function (candidateSecret) {
    return bcrypt.compare(candidateSecret, this.hardware_secret);
};

module.exports = mongoose.model('Gateway', gatewaySchema);
