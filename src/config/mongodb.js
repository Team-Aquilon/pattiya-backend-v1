const mongoose = require('mongoose');
const config = require('./index');

mongoose.set('bufferCommands', false);

let connectionPromise = null;
let eventsRegistered = false;

function redactMongoUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.username) parsed.username = '***';
        if (parsed.password) parsed.password = '***';
        return parsed.toString();
    } catch {
        return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//***:***@');
    }
}

function registerConnectionEvents() {
    if (eventsRegistered) return;
    eventsRegistered = true;

    mongoose.connection.on('disconnected', () => {
        connectionPromise = null;
        console.warn('[MongoDB] Disconnected. Mongoose will auto-reconnect.');
    });
    mongoose.connection.on('reconnected', () => {
        console.log('[MongoDB] Reconnected.');
    });
    mongoose.connection.on('error', (err) => {
        console.error('[MongoDB] Connection error:', err.message);
    });
}

/**
 * Connect to MongoDB using Mongoose.
 * The promise is cached so concurrent serverless requests share one connection attempt.
 */
async function connectMongoDB({ exitOnFailure = false } = {}) {
    registerConnectionEvents();

    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (mongoose.connection.readyState === 2) {
        return connectionPromise || mongoose.connection.asPromise();
    }

    if (config.mongo.required && !process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required because MONGODB_REQUIRED is true');
    }

    connectionPromise = mongoose.connect(config.mongo.uri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
        bufferCommands: false,
    })
        .then(() => {
            connectionPromise = null;
            console.log('[MongoDB] Connected successfully ->', redactMongoUri(config.mongo.uri));
            return mongoose.connection;
        })
        .catch((err) => {
            connectionPromise = null;
            console.error('[MongoDB] Connection failed:', err.message);

            if (exitOnFailure && config.mongo.required) {
                process.exit(1);
            }

            throw err;
        });

    return connectionPromise;
}

module.exports = { connectMongoDB };

