const { Point } = require('@influxdata/influxdb-client');
const { getWriteApi, getQueryApi } = require('../config/influxdb');
const config = require('../config');

// ═══════════════════════════════════════════════════════════
//  InfluxDB Service Layer
//  Separates fast time-series writes from business logic.
// ═══════════════════════════════════════════════════════════

/**
 * Write a batch of vitals telemetry points to InfluxDB.
 * This is the "fast path" — fire-and-flush, no MongoDB here.
 *
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {Array} records - Array of { mac_address, timestamp, vitals, gps }
 */
async function writeVitalsBatch(farmId, gatewayId, records) {
    const writeApi = getWriteApi();

    for (const record of records) {
        const { mac_address, timestamp, vitals } = record;
        if (!vitals) continue;

        const point = new Point('vitals')
            .tag('farm_id', farmId)
            .tag('mac', mac_address)
            .tag('gateway', gatewayId)
            .floatField('temperature', vitals.temperature || 0)
            .floatField('humidity', vitals.humidity || 0)
            .floatField('methane_ppm', vitals.methane_ppm || 0)
            .stringField('mic_mood', vitals.mic_mood || 'CALM')
            .intField('battery_percentage', vitals.battery_percentage || 0)
            .timestamp(new Date(timestamp));

        writeApi.writePoint(point);
    }

    try {
        await writeApi.flush();
        console.log(`[InfluxService] ✅ Wrote ${records.length} vitals points (farm: ${farmId})`);
    } catch (err) {
        console.error('[InfluxService] ❌ Vitals flush error:', err.message);
    }
}

/**
 * Write a batch of activity telemetry points to InfluxDB.
 *
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {Array} records - Array of { mac_address, activity }
 * @param {string} batchTimestamp
 */
async function writeActivityBatch(farmId, gatewayId, records, batchTimestamp) {
    const writeApi = getWriteApi();

    for (const record of records) {
        const { mac_address, activity } = record;
        if (!activity) continue;

        const point = new Point('activity')
            .tag('farm_id', farmId)
            .tag('mac', mac_address)
            .tag('gateway', gatewayId)
            .intField('step_count', activity.step_count || 0)
            .intField('high_motion_events', activity.high_motion_events || 0)
            .intField('resting_time_mins', activity.resting_time_mins || 0)
            .timestamp(new Date(batchTimestamp));

        writeApi.writePoint(point);
    }

    try {
        await writeApi.flush();
        console.log(`[InfluxService] ✅ Wrote ${records.length} activity points (farm: ${farmId})`);
    } catch (err) {
        console.error('[InfluxService] ❌ Activity flush error:', err.message);
    }
}

/**
 * Query methane PPM data for a specific cow's collar MAC.
 *
 * @param {string} mac     - Collar MAC address
 * @param {string} range   - Flux range string, e.g. '-24h', '-7d'
 * @param {string} window  - Aggregation window, e.g. '15m', '1h'
 * @returns {Array<{ time: string, value: number }>}
 */
async function queryMethaneHistory(mac, range = '-24h', window = '15m') {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "vitals"
          and r.mac == "${mac}"
          and r._field == "methane_ppm")
      |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
      |> sort(columns: ["_time"])
  `;

    const rows = [];
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                rows.push({
                    time: o._time,
                    value: Math.round(o._value * 100) / 100,
                });
            },
            error: reject,
            complete: resolve,
        });
    });

    return rows;
}

/**
 * Query the latest vitals snapshot for a cow.
 *
 * @param {string} mac
 * @returns {{ temperature, humidity, methane_ppm, mic_mood, battery_percentage } | null}
 */
async function queryLatestVitals(mac) {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "vitals" and r.mac == "${mac}")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

    let result = null;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                result = tableMeta.toObject(row);
            },
            error: reject,
            complete: resolve,
        });
    });

    return result;
}

// ═══════════════════════════════════════════════════════════
//  Environment (DHT22) — Farm-level ambient climate data
// ═══════════════════════════════════════════════════════════

/**
 * Write a single environment data point from the gateway's DHT22 sensor.
 * Stored as measurement "environment" (separate from per-cow "vitals").
 *
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {number} temperature   - Ambient temp in °C
 * @param {number} humidity      - Relative humidity %
 * @param {number} thi           - Pre-computed THI value
 * @param {string} timestamp     - ISO timestamp
 */
async function writeEnvironmentData(farmId, gatewayId, temperature, humidity, thi, timestamp) {
    const writeApi = getWriteApi();

    const point = new Point('environment')
        .tag('farm_id', farmId)
        .tag('gateway', gatewayId)
        .floatField('ambient_temperature', temperature)
        .floatField('ambient_humidity', humidity)
        .floatField('thi', thi)
        .timestamp(new Date(timestamp));

    writeApi.writePoint(point);

    try {
        await writeApi.flush();
    } catch (err) {
        console.error('[InfluxService] ❌ Environment write error:', err.message);
    }
}

/**
 * Query the latest environment reading for a farm.
 * Returns the most recent ambient_temperature, ambient_humidity, and THI.
 *
 * @param {string} farmId
 * @returns {{ ambient_temperature, ambient_humidity, thi, time } | null}
 */
async function queryLatestEnvironment(farmId) {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "environment" and r.farm_id == "${farmId}")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

    let result = null;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                result = tableMeta.toObject(row);
            },
            error: reject,
            complete: resolve,
        });
    });

    return result;
}

/**
 * Query environment history for a farm (for charts).
 *
 * @param {string} farmId
 * @param {string} range    - e.g. '-24h', '-7d'
 * @param {string} window   - e.g. '30m', '1h'
 * @returns {Array<{ time, ambient_temperature, ambient_humidity, thi }>}
 */
async function queryEnvironmentHistory(farmId, range = '-24h', window = '30m') {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "environment" and r.farm_id == "${farmId}")
      |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
  `;

    const rows = [];
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                rows.push({
                    time: o._time,
                    ambient_temperature: Math.round((o.ambient_temperature || 0) * 10) / 10,
                    ambient_humidity: Math.round((o.ambient_humidity || 0) * 10) / 10,
                    thi: Math.round((o.thi || 0) * 10) / 10,
                });
            },
            error: reject,
            complete: resolve,
        });
    });

    return rows;
}

module.exports = {
    writeVitalsBatch,
    writeActivityBatch,
    queryMethaneHistory,
    queryLatestVitals,
    writeEnvironmentData,
    queryLatestEnvironment,
    queryEnvironmentHistory,
};
