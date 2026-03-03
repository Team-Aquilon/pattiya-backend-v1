const jwt = require('jsonwebtoken');
const config = require('../config');
const Gateway = require('../models/Gateway');

/**
 * Authenticate ESP32 gateways via JWT.
 *
 * Supports two header formats (per PART B spec):
 *   1. Authorization: Bearer <token>        ← standard
 *   2. x-gateway-token: <token>             ← ESP32 convenience header
 *
 * Attaches req.gateway, req.farmId, and req.gatewayId.
 */
const gatewayAuth = async (req, res, next) => {
    try {
        let token = null;

        // Priority 1: Authorization Bearer header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }

        // Priority 2: x-gateway-token header (ESP32 convenience)
        if (!token && req.headers['x-gateway-token']) {
            token = req.headers['x-gateway-token'];
        }

        if (!token) {
            return res.status(401).json({
                status: 'error',
                message: 'Gateway access token required. Provide via "Authorization: Bearer <token>" or "x-gateway-token: <token>"',
            });
        }

        const decoded = jwt.verify(token, config.jwt.secret);

        if (decoded.type !== 'gateway') {
            return res.status(401).json({ status: 'error', message: 'Invalid gateway token type' });
        }

        const gateway = await Gateway.findOne({ gateway_id: decoded.gatewayId, is_active: true });
        if (!gateway) {
            return res.status(401).json({ status: 'error', message: 'Gateway not found or inactive' });
        }

        // Update last seen
        gateway.last_seen = new Date();
        await gateway.save();

        req.gateway = gateway;
        req.gatewayId = decoded.gatewayId;
        req.farmId = decoded.farmId;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ status: 'error', message: 'Gateway token expired — call POST /gateway/auth/login to re-authenticate' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ status: 'error', message: 'Invalid gateway token' });
        }
        next(err);
    }
};

module.exports = { gatewayAuth };
