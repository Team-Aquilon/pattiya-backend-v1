const { InfluxDB, HttpError } = require('@influxdata/influxdb-client');
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
 * Verify InfluxDB is reachable.
 *
 * Uses the client library's own API (a simple Flux query) instead
 * of the /health endpoint, because InfluxDB Cloud does NOT expose
 * /health publicly — it returns an HTML login page.
 */
async function pingInfluxDB() {
    try {
        const queryApi = getQueryApi();
        // Simplest possible query — just returns 1 row to confirm auth + connectivity
        const query = `from(bucket: "${config.influx.bucket}") |> range(start: -1s) |> limit(n: 1)`;

        await new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next() { /* row received — connection is alive */ },
                error(err) {
                    // "no results" is fine — it means the connection works but bucket is empty
                    if (err.message && err.message.includes('no results')) {
                        resolve();
                    } else {
                        reject(err);
                    }
                },
                complete() { resolve(); },
            });
        });

        console.log('[InfluxDB] ✅ Connected successfully →', config.influx.url);
    } catch (err) {
        // If we get a 401/403, token is wrong. Otherwise just warn.
        if (err instanceof HttpError && (err.statusCode === 401 || err.statusCode === 403)) {
            console.error('[InfluxDB] ❌ Authentication failed — check INFLUXDB_TOKEN and INFLUXDB_ORG in .env');
        } else {
            console.warn('[InfluxDB] ⚠️ Could not verify InfluxDB connection:', err.message || err);
            console.warn('[InfluxDB]    Data writes/reads may still work. Continuing...');
        }

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
