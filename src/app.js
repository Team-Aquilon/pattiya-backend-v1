const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

// Route modules
const authRoutes = require('./routes/auth');
const cowRoutes = require('./routes/cows');
const gatewayRoutes = require('./routes/gateway');
const userRoutes = require('./routes/user');
const farmRoutes = require('./routes/farm');
const notificationRoutes = require('./routes/notifications');
const systemRoutes = require('./routes/system');

const { connectMongoDB } = require('./config/mongodb');
const { initFirebase } = require('./services/fcmService');

try {
    initFirebase();
} catch (e) {
    console.error('Firebase init failed (might already be initialized):', e.message);
}

const app = express();

// --------------- Global Middleware ---------------

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));


// --------------- Public Utility Routes ---------------

app.get('/', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'pattiya-backend',
        health: '/v1/health',
    });
});

app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
});

function healthHandler(_req, res) {
    res.json({
        status: 'ok',
        service: 'pattiya-backend',
        timestamp: new Date().toISOString(),
    });
}

app.get('/api/v1/health', healthHandler);
app.get('/v1/health', healthHandler);

const ensureMongoDB = async (_req, res, next) => {
    try {
        await connectMongoDB();
        next();
    } catch (err) {
        console.error('[MongoDB] Request blocked:', err.message);
        res.status(503).json({
            status: 'error',
            message: 'Database unavailable',
        });
    }
};

// --------------- API Routes ---------------

function mountApiRoutes(prefix) {
    app.use(`${prefix}/system`, systemRoutes);
    app.use(`${prefix}/auth`, ensureMongoDB, authRoutes);
    app.use(`${prefix}/cows`, ensureMongoDB, cowRoutes);
    app.use(`${prefix}/gateway`, ensureMongoDB, gatewayRoutes);
    app.use(`${prefix}/user`, ensureMongoDB, userRoutes);
    app.use(`${prefix}/farm`, ensureMongoDB, farmRoutes);
    app.use(`${prefix}/notifications`, ensureMongoDB, notificationRoutes);
}

mountApiRoutes('/api/v1');
mountApiRoutes('/v1');

// --------------- 404 Handler ---------------

app.use((_req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Route not found',
    });
});

// --------------- Global Error Handler ---------------

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('[Error]', err.stack || err.message);

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        status: 'error',
        message: err.isOperational ? err.message : 'Internal server error',
    });
});

module.exports = app;
