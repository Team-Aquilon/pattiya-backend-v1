const mongoose = require('mongoose');
const config = require('./index');

/**
 * Connect to MongoDB using Mongoose.
 * Retries are handled internally by Mongoose (serverSelectionTimeoutMS).
 */
async function connectMongoDB() {
    try {
        await mongoose.connect(config.mongo.uri, {
            // Mongoose 8 defaults are sensible; override only what we need
            serverSelectionTimeoutMS: 5000, // Fail fast if Mongo is unreachable
            maxPoolSize: 10,
        });
        console.log('[MongoDB] ✅ Connected successfully →', config.mongo.uri);
    } catch (err) {
        console.error('[MongoDB] ❌ Connection failed:', err.message);
        // In production we want the container to crash so the orchestrator
        // restarts it. In dev, we let it run so you can start Mongo later.
        if (config.server.env === 'production') {
            process.exit(1);
        }
    }

    // Surface connection events after initial connect
    mongoose.connection.on('disconnected', () => {
        console.warn('[MongoDB] ⚠️  Disconnected. Mongoose will auto-reconnect.');
    });
    mongoose.connection.on('reconnected', () => {
        console.log('[MongoDB] 🔄 Reconnected.');
    });
    mongoose.connection.on('error', (err) => {
        console.error('[MongoDB] Connection error:', err.message);
    });
}

module.exports = { connectMongoDB };
