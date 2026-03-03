const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');

/**
 * Authenticate mobile app users via JWT Bearer token.
 * Attaches req.user (full user doc) and req.farmId.
 */
const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ status: 'error', message: 'Access token required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, config.jwt.secret);

        const user = await User.findById(decoded.userId);
        if (!user || !user.is_active) {
            return res.status(401).json({ status: 'error', message: 'User not found or inactive' });
        }

        req.user = user;
        req.farmId = decoded.farmId;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ status: 'error', message: 'Token expired' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ status: 'error', message: 'Invalid token' });
        }
        next(err);
    }
};

/**
 * Restrict access to specific roles.
 * Usage: authorize('admin')
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ status: 'error', message: 'Insufficient permissions' });
        }
        next();
    };
};

module.exports = { auth, authorize };
