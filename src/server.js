const http = require('http');
const mongoose = require('mongoose');
const config = require('./config');
const { connectMongoDB } = require('./config/mongodb');
const { pingInfluxDB } = require('./config/influxdb');
const { connectMQTT, getMQTTClient } = require('./config/mqtt');
const { initFirebase } = require('./services/fcmService');
const { initMQTTHandler } = require('./services/mqttHandler');
const { startHeatDetectionCron } = require('./services/heatDetectionCron');
const { initSocketServer } = require('./services/socketService');
const app = require('./app');

function logStartupBanner() {
    console.log('===========================================');
    console.log('  Pattiya Smart Cattle Backend');
    console.log(`  Environment : ${config.server.env}`);
    console.log(`  Host        : ${config.server.host}`);
    console.log(`  Port        : ${config.server.port}`);
    console.log('===========================================\n');
}

function logRoutes() {
    console.log('Routes mounted:');
    console.log('  /api/v1/auth          -> Auth & Multi-Tenancy');
    console.log('  /api/v1/cows          -> Cow Management');
    console.log('  /api/v1/gateway       -> Gateway & Telemetry');
    console.log('  /api/v1/user          -> User Profile');
    console.log('  /api/v1/farm          -> Farm Settings');
    console.log('  /api/v1/notifications -> Push Alerts');
    console.log('  /api/v1/system        -> Metadata & Version');
    console.log('');
}

function listen(server) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            server.off('error', onError);
            server.off('listening', onListening);
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        const onListening = () => {
            cleanup();
            resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(config.server.port, config.server.host);
    });
}

function describeListenError(err) {
    if (err.code === 'EADDRINUSE') {
        return [
            `[Server] Port ${config.server.port} is already in use.`,
            '[Server] Stop the existing process or set a different PORT in .env.',
            '[Server] On EC2, also update your Nginx proxy and security group if you change the port.',
        ].join('\n');
    }

    if (err.code === 'EACCES') {
        return [
            `[Server] Permission denied while binding ${config.server.host}:${config.server.port}.`,
            '[Server] Use a non-privileged port such as 5000 and put Nginx/ALB in front for ports 80/443.',
        ].join('\n');
    }

    return `[Server] Failed to listen on ${config.server.host}:${config.server.port}: ${err.message}`;
}

async function connectPrimaryDatabase() {
    try {
        await connectMongoDB({ exitOnFailure: false });
        return true;
    } catch (err) {
        if (config.mongo.required) {
            throw err;
        }

        console.warn('[MongoDB] Startup connection failed:', err.message);
        console.warn('[MongoDB] Continuing because MONGODB_REQUIRED=false. Database-backed routes will return 503 until MongoDB is reachable.');
        return false;
    }
}
async function startOptionalServices() {
    await pingInfluxDB();

    initFirebase();

    if (config.mqtt.enabled) {
        const mqttClient = connectMQTT();
        if (mqttClient) {
            mqttClient.on('connect', initMQTTHandler);
        }
    } else {
        console.log('[MQTT] Disabled by MQTT_ENABLED=false');
    }

    if (config.heatCron.enabled) {
        startHeatDetectionCron();
    } else {
        console.log('[HeatCron] Disabled by HEAT_CRON_ENABLED=false');
    }
}

function registerShutdown(server) {
    let shuttingDown = false;

    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`\n[Server] ${signal} received - shutting down gracefully...`);
        const forceExitTimer = setTimeout(() => {
            console.error('[Server] Graceful shutdown timed out. Forcing exit.');
            process.exit(1);
        }, 10000);
        forceExitTimer.unref();

        await new Promise((resolve) => server.close(resolve));
        console.log('[Server] HTTP server closed.');

        const mqttClient = getMQTTClient();
        if (mqttClient) {
            mqttClient.end(true);
            console.log('[MQTT] Connection closed.');
        }

        try {
            await mongoose.connection.close();
            console.log('[MongoDB] Connection closed.');
        } catch {
            // Connection may already be closed.
        }

        clearTimeout(forceExitTimer);
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function startServer() {
    logStartupBanner();

    await connectPrimaryDatabase();
    await startOptionalServices();

    const server = http.createServer(app);
    initSocketServer(server);

    try {
        await listen(server);
    } catch (err) {
        console.error(describeListenError(err));
        process.exit(1);
    }

    server.on('error', (err) => {
        console.error('[Server] Runtime server error:', err.message);
    });

    console.log(`\n[Server] Pattiya Backend listening on ${config.server.host}:${config.server.port}`);
    console.log(`[Server] Health check -> ${config.server.publicBaseUrl}/api/v1/health\n`);
    logRoutes();
    registerShutdown(server);
}

startServer().catch((err) => {
    console.error('[Server] Fatal error during boot:', err.message || err);
    process.exit(1);
});

module.exports = { startServer };


