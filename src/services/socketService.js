const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const config = require('../config');
const { connectMongoDB } = require('../config/mongodb');
const User = require('../models/User');

let primaryIo = null;
const socketServers = [];

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

function normalizeSocketPath(value) {
    if (!value) return null;
    let socketPath = String(value).trim();
    if (!socketPath) return null;
    if (!socketPath.startsWith('/')) socketPath = `/${socketPath}`;
    return socketPath.replace(/\/+$/, '') || '/socket.io';
}

function parseSocketPathList(value) {
    if (value === undefined) return ['/api/socket.io'];
    return String(value)
        .split(',')
        .map(normalizeSocketPath)
        .filter(Boolean);
}

function configuredSocketPaths(options = {}) {
    const primaryPath = normalizeSocketPath(options.path || process.env.SOCKET_IO_PATH || '/socket.io');
    const candidates = [
        primaryPath,
        '/socket.io',
        ...parseSocketPathList(process.env.SOCKET_IO_ALIASES),
    ];

    return [...new Set(candidates.filter(Boolean))];
}

function isOriginAllowed(origin) {
    if (!origin) return true;
    if (config.cors.origins.includes('*')) return true;
    return config.cors.origins.includes(origin);
}

function getSocketToken(socket) {
    const authToken = socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) return authToken;

    const bearer = socket.handshake.headers.authorization;
    if (bearer && bearer.startsWith('Bearer ')) return bearer.slice(7);

    const queryToken = socket.handshake.query && socket.handshake.query.token;
    return Array.isArray(queryToken) ? queryToken[0] : queryToken;
}

function registerSocketHandlers(io) {
    io.use(async (socket, next) => {
        try {
            const token = getSocketToken(socket);
            if (!token) return next(new Error('Authentication required'));

            const decoded = jwt.verify(token, config.jwt.secret);
            await connectMongoDB();
            if (!decoded.userId || !decoded.farmId || decoded.type !== 'user') {
                return next(new Error('Invalid socket token'));
            }

            const user = await User.findById(decoded.userId).select('_id is_active farm_id').lean();
            if (!user || !user.is_active || user.farm_id !== decoded.farmId) {
                return next(new Error('User not found or inactive'));
            }

            socket.data.userId = decoded.userId;
            socket.data.farmId = decoded.farmId;
            return next();
        } catch {
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
}

function createSocketServer(server, socketPath) {
    const io = new Server(server, {
        path: socketPath,
        cors: {
            origin(origin, callback) {
                callback(null, isOriginAllowed(origin));
            },
            methods: ['GET', 'POST'],
        },
    });

    registerSocketHandlers(io);
    return io;
}

function initSocketServer(server, options = {}) {
    if (primaryIo) return primaryIo;

    const paths = configuredSocketPaths(options);
    for (const socketPath of paths) {
        const io = createSocketServer(server, socketPath);
        socketServers.push(io);
        if (!primaryIo) primaryIo = io;
    }

    console.log('[Socket.IO] Realtime alert server initialized at ' + paths.join(', '));
    return primaryIo;
}

function emitToFarm(farmId, eventName, payload) {
    if (socketServers.length === 0 || !farmId) return;

    for (const io of socketServers) {
        io.to(farmRoom(farmId)).emit(eventName, {
            farm_id: farmId,
            emitted_at: new Date().toISOString(),
            ...payload,
        });
    }
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
