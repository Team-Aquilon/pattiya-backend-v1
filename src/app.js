const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

// Route modules
const authRoutes = require('./routes/auth');
const cowRoutes = require('./routes/cows');
const gatewayRoutes = require('./routes/gateway');
const userRoutes = require('./routes/user');
const farmRoutes = require('./routes/farm');
const notificationRoutes = require('./routes/notifications');
const systemRoutes = require('./routes/system');

// Initialize Databases for Serverless environments (like Vercel)
const { connectMongoDB } = require('./config/mongodb');
const { initFirebase } = require('./services/fcmService');

// Connect to MongoDB immediately
connectMongoDB().catch(console.error);
try {
    initFirebase();
} catch (e) {
    console.error("Firebase init failed (might already be initialized):", e.message);
}

const app = express();

// --------------- Global Middleware ---------------

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving for cow images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// --------------- Health-check Route ---------------

app.get('/api/v1/health', (_req, res) => {
    res.json({
        status: 'ok',
        service: 'pattiya-backend',
        timestamp: new Date().toISOString(),
    });
});

// --------------- API Routes ---------------

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cows', cowRoutes);
app.use('/api/v1/gateway', gatewayRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/farm', farmRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/system', systemRoutes);

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
