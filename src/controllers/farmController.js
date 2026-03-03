const Farm = require('../models/Farm');
const Gateway = require('../models/Gateway');
const { publishUpdateGeofence } = require('../services/mqttHandler');
const influxService = require('../services/influxService');
const { calculateTHI, classifyTHI } = require('../utils/thi');
const asyncHandler = require('../middleware/asyncHandler');

// ─── 4.2 Update Geofence Settings ─────────────────────────

exports.updateGeofence = asyncHandler(async (req, res) => {
    const { center_lat, center_lng, radius_meters, is_active } = req.body;

    const farm = await Farm.findOne({ farm_id: req.farmId });
    if (!farm) {
        return res.status(404).json({ status: 'error', message: 'Farm not found' });
    }

    if (center_lat !== undefined) farm.geofence.center_lat = center_lat;
    if (center_lng !== undefined) farm.geofence.center_lng = center_lng;
    if (radius_meters !== undefined) farm.geofence.radius_meters = radius_meters;
    if (is_active !== undefined) farm.geofence.is_active = is_active;
    await farm.save();

    // MQTT Event B: Sync geofence update to all gateways (PART C §12.1)
    publishUpdateGeofence(req.farmId, {
        center_lat: farm.geofence.center_lat,
        center_lng: farm.geofence.center_lng,
        radius_meters: farm.geofence.radius_meters,
        is_active: farm.geofence.is_active,
    }).catch((err) => console.error('[Farm] MQTT geofence sync error:', err.message));

    res.json({ status: 'success', message: 'Geofence updated successfully.' });
});

// ─── Farm Environment Dashboard (Current) ─────────────────
//
// GET /farm/environment/current
//
// Returns the latest ambient temperature, humidity, and THI
// from the DHT22 sensor on the Base Station, for the mobile
// app dashboard display.

exports.getEnvironment = asyncHandler(async (req, res) => {
    const farmId = req.farmId;

    let environment = null;
    try {
        environment = await influxService.queryLatestEnvironment(farmId);
    } catch (err) {
        console.warn('[Farm] InfluxDB environment query failed:', err.message);
    }

    if (!environment) {
        return res.json({
            status: 'success',
            data: {
                available: false,
                message: 'No environment data available yet. Waiting for gateway telemetry.',
            },
        });
    }

    const temp = Math.round((environment.ambient_temperature || 0) * 10) / 10;
    const hum = Math.round((environment.ambient_humidity || 0) * 10) / 10;
    const thi = environment.thi
        ? Math.round(environment.thi * 10) / 10
        : calculateTHI(temp, hum);
    const thiClass = classifyTHI(thi);

    res.json({
        status: 'success',
        data: {
            available: true,
            ambient_temperature: temp,
            ambient_humidity: hum,
            thi,
            thi_classification: {
                level: thiClass.level,
                description: thiClass.description,
                alert: thiClass.alert,
            },
            last_updated: environment._time || null,
        },
    });
});

// ─── Farm Environment History (Charts) ────────────────────
//
// GET /farm/environment/history?range=24hours

exports.getEnvironmentHistory = asyncHandler(async (req, res) => {
    const farmId = req.farmId;
    const range = req.query.range || '24hours';

    const rangeConfig = {
        '24hours': { fluxRange: '-24h', window: '30m' },
        '7days': { fluxRange: '-7d', window: '3h' },
        '30days': { fluxRange: '-30d', window: '12h' },
    };

    const cfg = rangeConfig[range] || rangeConfig['24hours'];

    let data_points = [];
    try {
        data_points = await influxService.queryEnvironmentHistory(farmId, cfg.fluxRange, cfg.window);
    } catch (err) {
        console.warn('[Farm] InfluxDB environment history query failed:', err.message);
    }

    res.json({
        status: 'success',
        data: {
            range,
            aggregation_window: cfg.window,
            data_points_count: data_points.length,
            thi_alert_threshold: 72,
            history: data_points,
        },
    });
});

module.exports = exports;
