const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        farm_id: {
            type: String,
            required: true,
            index: true,
        },
        username: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        password: {
            type: String,
            required: true,
            minlength: 6,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        phone: {
            type: String,
            default: '',
        },
        role: {
            type: String,
            enum: ['admin', 'user'],
            default: 'user',
        },
        // FCM push notification settings
        fcm_tokens: [
            {
                token: String,
                device_os: { type: String, enum: ['android', 'ios'], default: 'android' },
                created_at: { type: Date, default: Date.now },
            },
        ],
        notification_settings: {
            alert_heat: { type: Boolean, default: true },
            alert_theft: { type: Boolean, default: true },
            alert_low_battery: { type: Boolean, default: true },
        },
        // Password reset
        reset_code: String,
        reset_code_expires: Date,
        // Account deletion
        deletion_scheduled_at: Date,
        is_active: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound unique index: username must be unique within a farm
userSchema.index({ farm_id: 1, username: 1 }, { unique: true });
userSchema.index({ farm_id: 1, email: 1 }, { unique: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// Instance method to verify password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Strip password from JSON output
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    delete obj.reset_code;
    delete obj.reset_code_expires;
    return obj;
};

module.exports = mongoose.model('User', userSchema);
