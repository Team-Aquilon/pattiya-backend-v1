const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const config = require('../config');
const { connectMongoDB } = require('../config/mongodb');
const User = require('../models/User');

let io = null;

function farmRoom(farmId) {
    return `farm:${farmId}`;
}

function serialize(value) {
    if (!value) return null;
    const raw = typeof value.toObject === 'function'
        ? value.toObject({ versionKey: false })
        : value;
    return JSON.parse(JSON.stringify(raw));
}

function getSocketToken(socket) {
    const authToken = socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) return authToken;

    const bearer = socket.handshake.headers.authorization;
    if (bearer && bearer.startsWith('Bearer ')) return bearer.slice(7);

    const queryToken = socket.handshake.query && socket.handshake.query.token;
    return Array.isArray(queryToken) ? queryToken[0] : queryToken;
}

function initSocketServer(server, options = {}) {
    if (io) return io;

    const socketPath = options.path || process.env.SOCKET_IO_PATH || '/socket.io';

    io = new Server(server, {
        path: socketPath,
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
    });

    io.use(async (socket, next) => {
        try {
            const token = getSocketToken(socket);
            if (!token) return next(new Error('Authentication required'));

            const decoded = jwt.verify(token, config.jwt.secret);
            await connectMongoDB();
            if (!decoded.userId || !decoded.farmId) {
                return next(new Error('Invalid socket token'));
            }

            const user = await User.findById(decoded.userId).select('_id is_active farm_id').lean();
            if (!user || !user.is_active || user.farm_id !== decoded.farmId) {
                return next(new Error('User not found or inactive'));
            }

            socket.data.userId = decoded.userId;
            socket.data.farmId = decoded.farmId;
            return next();
        } catch (error) {
            return next(new Error('Invalid socket token'));
        }
    });

    io.on('connection', (socket) => {
        const { farmId } = socket.data;
        socket.join(farmRoom(farmId));
        socket.emit('alerts:connected', {
            status: 'success',
            farm_id: farmId,
            connected_at: new Date().toISOString(),
        });
    });

    console.log('[Socket.IO] Realtime alert server initialized at ' + socketPath);
    return io;
}

function emitToFarm(farmId, eventName, payload) {
    if (!io || !farmId) return;

    io.to(farmRoom(farmId)).emit(eventName, {
        farm_id: farmId,
        emitted_at: new Date().toISOString(),
        ...payload,
    });
}

function emitNotificationAlert(action, notification) {
    const normalized = serialize(notification);
    if (!normalized) return;

    emitToFarm(normalized.farm_id, 'alerts:updated', {
        action,
        notification: normalized,
    });
}

function emitOestrusAlert(action, alert) {
    const normalized = serialize(alert);
    if (!normalized) return;

    emitToFarm(normalized.farm_id, 'alerts:updated', {
        action,
        oestrus_alert: normalized,
    });
}

module.exports = {
    initSocketServer,
    emitNotificationAlert,
    emitOestrusAlert,
};
