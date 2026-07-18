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

/**
 * Write activity prediction.
 * 
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {object} data
 */
async function writeActivityPrediction(farmId, gatewayId, data) {
    const writeApi = getWriteApi();

    const point = new Point('activity_prediction')
        .tag('farm_id', farmId)
        .tag('mac', data.mac_address || '')
        .tag('gateway', gatewayId)
        .stringField('predicted_activity', data.predicted_activity || 'unknown')
        .stringField('activity_state', data.activity_state || 'unknown')
        .floatField('confidence', data.confidence || 0)
        .floatField('battery', data.battery || 0)
        .floatField('mean_acc', data.mean_acc || 0)
        .floatField('std_acc', data.std_acc || 0)
        .floatField('energy_acc', data.energy_acc || 0)
        .floatField('mean_gyro', data.mean_gyro || 0)
        .floatField('std_gyro', data.std_gyro || 0)
        .floatField('energy_gyro', data.energy_gyro || 0)
        .timestamp(data.timestamp ? new Date(data.timestamp) : new Date());

    writeApi.writePoint(point);

    try {
        await writeApi.flush();
    } catch (err) {
        console.error('[InfluxService] ❌ Activity prediction write error:', err.message);
    }
}

/**
 * Write sound prediction.
 *
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {object} data
 */
async function writeSoundPrediction(farmId, gatewayId, data) {
    const writeApi = getWriteApi();

    const point = new Point('sound_prediction')
        .tag('farm_id', farmId)
        .tag('mac', data.mac_address || '')
        .tag('gateway', gatewayId)
        .floatField('oestrus_probability', data.oestrus_probability || 0)
        .stringField('label', data.label || 'unknown')
        .intField('event_start_ms', data.event_start_ms || 0)
        .timestamp(data.timestamp ? new Date(data.timestamp) : new Date());

    writeApi.writePoint(point);

    try {
        await writeApi.flush();
    } catch (err) {
        console.error('[InfluxService] ❌ Sound prediction write error:', err.message);
    }
}

/**
 * Write oestrus fusion.
 *
 * @param {string} farmId
 * @param {string} gatewayId
 * @param {object} data
 */
async function writeOestrusFusion(farmId, gatewayId, data) {
    const writeApi = getWriteApi();

    const point = new Point('oestrus_fusion')
        .tag('farm_id', farmId)
        .tag('mac', data.cow_id || '')
        .tag('gateway', gatewayId)
        .stringField('decision', data.decision || 'NORMAL')
        .stringField('sound_label', data.sound_label || 'normal')
        .floatField('sound_probability', data.sound_probability || 0)
        .stringField('activity_label', data.activity_label || 'unknown')
        .stringField('activity_state', data.activity_state || 'normal_activity')
        .floatField('temperature_c', data.temperature_c || 0)
        .floatField('humidity_percent', data.humidity_percent || 0)
        .timestamp(new Date());

    writeApi.writePoint(point);

    try {
        await writeApi.flush();
    } catch (err) {
        console.error('[InfluxService] ❌ Oestrus fusion write error:', err.message);
    }
}

/**
 * Query activity predictions.
 *
 * @param {string} mac
 * @param {string} range
 * @param {number} limit
 */
async function queryActivityPredictions(mac, range = '-24h', limit = 100) {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "activity_prediction" and r.mac == "${mac}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit})
  `;

    const rows = [];
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                rows.push({
                    time: o._time,
                    predicted_activity: o.predicted_activity,
                    activity_state: o.activity_state,
                    confidence: o.confidence,
                    battery: o.battery,
                });
            },
            error: reject,
            complete: resolve,
        });
    });

    return rows;
}

/**
 * Query sound predictions.
 *
 * @param {string} mac
 * @param {string} range
 * @param {number} limit
 */
async function querySoundPredictions(mac, range = '-24h', limit = 100) {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const query = `
    from(bucket: "${bucket}")
      |> range(start: ${range})
      |> filter(fn: (r) => r._measurement == "sound_prediction" and r.mac == "${mac}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${limit})
  `;

    const rows = [];
    await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                rows.push({
                    time: o._time,
                    oestrus_probability: o.oestrus_probability,
                    label: o.label,
                });
            },
            error: reject,
            complete: resolve,
        });
    });

    return rows;
}

/**
 * Query latest predictions.
 *
 * @param {string} mac
 */
async function queryLatestPredictions(mac) {
    const queryApi = getQueryApi();
    const bucket = config.influx.bucket;

    const activityQuery = `
    from(bucket: "${bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "activity_prediction" and r.mac == "${mac}")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

    const soundQuery = `
    from(bucket: "${bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "sound_prediction" and r.mac == "${mac}")
      |> last()
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  `;

    let activity = null;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(activityQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                activity = {
                    time: o._time,
                    predicted_activity: o.predicted_activity,
                    activity_state: o.activity_state,
                    confidence: o.confidence,
                };
            },
            error: reject,
            complete: resolve,
        });
    });

    let sound = null;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(soundQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                sound = {
                    time: o._time,
                    oestrus_probability: o.oestrus_probability,
                    label: o.label,
                };
            },
            error: reject,
            complete: resolve,
        });
    });

    return { activity, sound };
}

async function writeMethaneSample(farmId, gatewayId, data) {
    const writeApi = getWriteApi();
    const point = new Point('methane_sample')
        .tag('farm_id', farmId)
        .tag('gateway', gatewayId)
        .tag('device', data.device_id || 'unknown')
        .tag('cow_id', data.cow_id || 'unknown')
        .floatField('ch4_cow_ppm', data.ch4_cow_ppm || 0)
        .floatField('ch4_ambient_ppm', data.ch4_ambient_ppm || 0)
        .floatField('delta_ch4_ppm', data.delta_ch4_ppm || 0)
        .floatField('pressure_pa', data.pressure_pa || 0)
        .floatField('airflow_lpm', data.airflow_lpm || 0)
        .floatField('methane_flow_ml_min', data.methane_flow_ml_min || 0)
        .timestamp(new Date(data.timestamp));
    writeApi.writePoint(point);
    try { await writeApi.flush(); } catch (err) { console.error('[Influx] Methane sample write error:', err.message); }
}

module.exports = {
    writeVitalsBatch,
    writeActivityBatch,
    queryMethaneHistory,
    queryLatestVitals,
    writeEnvironmentData,
    queryLatestEnvironment,
    queryEnvironmentHistory,
    writeActivityPrediction,
    writeSoundPrediction,
    writeOestrusFusion,
    queryActivityPredictions,
    querySoundPredictions,
    queryLatestPredictions,
    writeMethaneSample,
};
