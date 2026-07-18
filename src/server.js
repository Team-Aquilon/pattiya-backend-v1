const config = require('./config');
const { connectMongoDB } = require('./config/mongodb');
const { pingInfluxDB } = require('./config/influxdb');
const { connectMQTT } = require('./config/mqtt');
const { initFirebase } = require('./services/fcmService');
const { initMQTTHandler } = require('./services/mqttHandler');
const { startHeatDetectionCron } = require('./services/heatDetectionCron');
const { initSocketServer } = require('./services/socketService');
const app = require('./app');

/**
 * Boot sequence:
 *  1. Connect to MongoDB
 *  2. Ping InfluxDB (non-blocking in dev)
 *  3. Initialize Firebase Admin SDK
 *  4. Connect to MQTT broker + subscribe to topics
 *  5. Start heat detection cron job
 *  6. Start Express HTTP server
 */
async function startServer() {
    console.log('═══════════════════════════════════════════');
    console.log('  🐄 Pattiya Smart Cattle Backend');
    console.log(`  Environment : ${config.server.env}`);
    console.log('═══════════════════════════════════════════\n');

    // 1. MongoDB
    await connectMongoDB({ exitOnFailure: true });

    // 2. InfluxDB
    await pingInfluxDB();

    // 3. Firebase (for push notifications)
    initFirebase();

    // 4. MQTT
    const mqttClient = connectMQTT();

    // Wait briefly for MQTT to connect, then subscribe
    mqttClient.on('connect', () => {
        initMQTTHandler();
    });

    // 5. Heat Detection Cron
    startHeatDetectionCron();

    // 6. Express
    const server = app.listen(config.server.port, () => {
        console.log(`\n[Server] 🚀 Pattiya Backend listening on port ${config.server.port}`);
        console.log(`[Server] Health check → http://localhost:${config.server.port}/api/v1/health\n`);
        console.log('Routes mounted:');
        console.log('  /api/v1/auth          → Auth & Multi-Tenancy');
        console.log('  /api/v1/cows          → Cow Management');
        console.log('  /api/v1/gateway       → Gateway & Telemetry');
        console.log('  /api/v1/user          → User Profile');
        console.log('  /api/v1/farm          → Farm Settings');
        console.log('  /api/v1/notifications → Push Alerts');
        console.log('  /api/v1/system        → Metadata & Version');
        console.log('');
    });

    initSocketServer(server);

    // --------------- Graceful Shutdown ---------------

    const shutdown = async (signal) => {
        console.log(`\n[Server] ${signal} received — shutting down gracefully...`);

        server.close(() => {
            console.log('[Server] HTTP server closed.');
        });

        try {
            const mongoose = require('mongoose');
            await mongoose.connection.close();
            console.log('[MongoDB] Connection closed.');
        } catch { /* already closed */ }

        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((err) => {
    console.error('[Server] Fatal error during boot:', err);
    process.exit(1);
});
