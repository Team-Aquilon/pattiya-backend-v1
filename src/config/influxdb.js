const { InfluxDB } = require('@influxdata/influxdb-client');
const config = require('./index');

/*
 * InfluxDB 2.x Client
 *
 * RETENTION POLICY: Set the `sensor_data` bucket retention to 90 days
 * (7776000 seconds) via the InfluxDB Admin UI or CLI:
 *   influx bucket update --name sensor_data --retention 7776000s
 *
 * This ensures raw telemetry older than 3 months is auto-deleted
 * to keep storage costs low as specified in the project brief.
 */

let influxClient = null;

/**
 * Get or create the shared InfluxDB client instance.
 */
function getInfluxClient() {
    if (!influxClient) {
        influxClient = new InfluxDB({
            url: config.influx.url,
            token: config.influx.token,
        });
    }
    return influxClient;
}

/**
 * Returns a WriteApi scoped to the configured org & bucket.
 * Uses batching (default: 5 000 points / 1 s flush) for high throughput.
 */
function getWriteApi() {
    return getInfluxClient().getWriteApi(config.influx.org, config.influx.bucket, 'ms');
}

/**
 * Returns a QueryApi scoped to the configured org.
 */
function getQueryApi() {
    return getInfluxClient().getQueryApi(config.influx.org);
}

/**
 * Verify InfluxDB is reachable by running a simple health check.
 * Non-fatal in dev — logs a warning and continues.
 */
async function pingInfluxDB() {
    try {
        // InfluxDB 2.x health endpoint
        const fetch = globalThis.fetch || require('node:http').get;
        const res = await globalThis.fetch(`${config.influx.url}/health`);
        const body = await res.json();

        if (body.status === 'pass') {
            console.log('[InfluxDB] ✅ Connected successfully →', config.influx.url);
        } else {
            console.warn('[InfluxDB] ⚠️  Health check returned:', body.status);
        }
    } catch (err) {
        console.warn('[InfluxDB] ⚠️  Could not reach InfluxDB — skipping ping:', err.message);
        if (config.server.env === 'production') {
            process.exit(1);
        }
    }
}

module.exports = {
    getInfluxClient,
    getWriteApi,
    getQueryApi,
    pingInfluxDB,
};
