const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const User = require('../models/User');
const Farm = require('../models/Farm');
const RefreshToken = require('../models/RefreshToken');
const asyncHandler = require('../middleware/asyncHandler');

// ─── Helpers ───────────────────────────────────────────────

function generateAccessToken(userId, farmId, role) {
    return jwt.sign(
        { userId, farmId, role, type: 'user' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
}

function generateRefreshTokenValue() {
    return crypto.randomBytes(40).toString('hex');
}

function parseExpiry(str) {
    const match = str.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
    const num = parseInt(match[1], 10);
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return num * (unit[match[2]] || 86400000);
}

// ─── 1.1 Resolve Tenant ────────────────────────────────────

exports.resolveTenant = asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).json({ status: 'error', message: 'Farm code is required' });
    }

    const farm = await Farm.findOne({ farm_code: code.toUpperCase(), is_active: true });
    if (!farm) {
        return res.status(404).json({ status: 'error', message: 'Farm not found' });
    }

    res.json({
        status: 'success',
        data: {
            farm_id: farm.farm_id,
            farm_name: farm.farm_name,
            logo_url: farm.logo_url,
            theme_color: farm.theme_color,
        },
    });
});

// ─── 1.2 Login ─────────────────────────────────────────────

exports.login = asyncHandler(async (req, res) => {
    const { farm_id, username, password } = req.body;

    if (!farm_id || !username || !password) {
        return res.status(400).json({ status: 'error', message: 'farm_id, username, and password are required' });
    }

    // Verify farm exists
    const farm = await Farm.findOne({ farm_id, is_active: true });
    if (!farm) {
        return res.status(404).json({ status: 'error', message: 'Farm not found' });
    }

    // Find user within this farm
    const user = await User.findOne({ farm_id, username: username.toLowerCase(), is_active: true });
    if (!user) {
        return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    // Generate tokens
    const access_token = generateAccessToken(user._id, farm_id, user.role);
    const refreshTokenValue = generateRefreshTokenValue();

    // Store refresh token in DB
    await RefreshToken.create({
        token: refreshTokenValue,
        user_id: user._id,
        farm_id,
        expires_at: new Date(Date.now() + parseExpiry(config.jwt.refreshExpiresIn)),
    });

    res.json({
        status: 'success',
        data: {
            access_token,
            refresh_token: refreshTokenValue,
            expires_in: parseInt(config.jwt.expiresIn) || 900,
            user: {
                id: user._id,
                name: user.name,
                role: user.role,
            },
        },
    });
});

// ─── 1.3 Refresh Token ────────────────────────────────────

exports.refresh = asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        return res.status(400).json({ status: 'error', message: 'Refresh token is required' });
    }

    const tokenDoc = await RefreshToken.findOne({ token: refresh_token, is_revoked: false });
    if (!tokenDoc || tokenDoc.expires_at < new Date()) {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(tokenDoc.user_id);
    if (!user || !user.is_active) {
        return res.status(401).json({ status: 'error', message: 'User not found' });
    }

    // Rotate: revoke old, issue new
    tokenDoc.is_revoked = true;
    await tokenDoc.save();

    const access_token = generateAccessToken(user._id, tokenDoc.farm_id, user.role);
    const newRefreshToken = generateRefreshTokenValue();

    await RefreshToken.create({
        token: newRefreshToken,
        user_id: user._id,
        farm_id: tokenDoc.farm_id,
        expires_at: new Date(Date.now() + parseExpiry(config.jwt.refreshExpiresIn)),
    });

    res.json({
        status: 'success',
        data: {
            access_token,
            refresh_token: newRefreshToken,
            expires_in: parseInt(config.jwt.expiresIn) || 900,
        },
    });
});

// ─── 1.4 Logout ────────────────────────────────────────────

exports.logout = asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    if (refresh_token) {
        await RefreshToken.findOneAndUpdate({ token: refresh_token }, { is_revoked: true });
    }

    res.json({ status: 'success', message: 'Logged out successfully' });
});

// ─── 6.1 Forgot Password ──────────────────────────────────

exports.forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), is_active: true });
    if (!user) {
        // Don't reveal whether email exists
        return res.json({ status: 'success', message: 'If the email exists, a reset code has been sent' });
    }

    // Generate 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.reset_code = resetCode;
    user.reset_code_expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await user.save();

    // In production: send via email/SMS. In dev: log to console.
    console.log(`[Auth] Password reset code for ${email}: ${resetCode}`);

    res.json({ status: 'success', message: 'If the email exists, a reset code has been sent' });
});

// ─── 6.2 Reset Password ───────────────────────────────────

exports.resetPassword = asyncHandler(async (req, res) => {
    const { email, reset_code, new_password } = req.body;

    if (!email || !reset_code || !new_password) {
        return res.status(400).json({ status: 'error', message: 'email, reset_code, and new_password are required' });
    }

    const user = await User.findOne({
        email: email.toLowerCase(),
        reset_code,
        reset_code_expires: { $gt: new Date() },
        is_active: true,
    });

    if (!user) {
        return res.status(400).json({ status: 'error', message: 'Invalid or expired reset code' });
    }

    user.password = new_password; // pre-save hook will hash it
    user.reset_code = undefined;
    user.reset_code_expires = undefined;
    await user.save();

    // Revoke all refresh tokens for security
    await RefreshToken.updateMany({ user_id: user._id }, { is_revoked: true });

    res.json({ status: 'success', message: 'Password reset successfully' });
});
