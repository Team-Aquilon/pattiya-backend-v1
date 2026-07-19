const { InfluxDB, HttpError } = require('@influxdata/influxdb-client');
const config = require('./index');

/*
 * InfluxDB 2.x Client
 *
 * RETENTION POLICY: Set the `sensor_data` bucket retention to 90 days
 * (7776000 seconds) via the InfluxDB Admin UI or CLI:
 *   influx bucket update --name sensor_data --retention 7776000s
 */

let influxClient = null;

function getInfluxClient() {
    if (!influxClient) {
        influxClient = new InfluxDB({
            url: config.influx.url,
            token: config.influx.token,
        });
    }
    return influxClient;
}

function getWriteApi() {
    return getInfluxClient().getWriteApi(config.influx.org, config.influx.bucket, 'ms');
}

function getQueryApi() {
    return getInfluxClient().getQueryApi(config.influx.org);
}

async function pingInfluxDB({ required = config.influx.required } = {}) {
    if (!config.influx.token) {
        const message = 'INFLUXDB_TOKEN is not configured';
        if (required) throw new Error(message);
        console.warn(`[InfluxDB] ${message}. Telemetry reads/writes may fail until it is set.`);
        return false;
    }

    try {
        const queryApi = getQueryApi();
        const query = `from(bucket: "${config.influx.bucket}") |> range(start: -1s) |> limit(n: 1)`;

        await new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next() {},
                error(err) {
                    if (err.message && err.message.includes('no results')) {
                        resolve();
                    } else {
                        reject(err);
                    }
                },
                complete() { resolve(); },
            });
        });

        console.log('[InfluxDB] Connected successfully ->', config.influx.url);
        return true;
    } catch (err) {
        if (err instanceof HttpError && (err.statusCode === 401 || err.statusCode === 403)) {
            console.error('[InfluxDB] Authentication failed. Check INFLUXDB_TOKEN and INFLUXDB_ORG.');
        } else {
            console.warn('[InfluxDB] Could not verify connection:', err.message || err);
        }

        if (required) throw err;

        console.warn('[InfluxDB] Continuing because INFLUXDB_REQUIRED is not true.');
        return false;
    }
}

module.exports = {
    getInfluxClient,
    getWriteApi,
    getQueryApi,
    pingInfluxDB,
};
