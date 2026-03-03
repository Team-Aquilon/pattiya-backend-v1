const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const Cow = require('../models/Cow');
const HealthEvent = require('../models/HealthEvent');
const MilkRecord = require('../models/MilkRecord');
const Farm = require('../models/Farm');
const { getQueryApi } = require('../config/influxdb');
const influxService = require('../services/influxService');
const { publishAddMAC, publishRemoveMAC } = require('../services/mqttHandler');
const config = require('../config');
const asyncHandler = require('../middleware/asyncHandler');

// ─── Status priority for sorting ───────────────────────────

const STATUS_PRIORITY = {
    HEAT_DETECTED: 1,
    SICK: 1,
    THEFT_ALERT: 1,
    LOW_BATTERY: 2,
    OFFLINE: 2,
    HEALTHY: 3,
};

function cowSortComparator(a, b) {
    return (STATUS_PRIORITY[a.status] || 3) - (STATUS_PRIORITY[b.status] || 3);
}

// ─── 2.1 Dashboard Summary ────────────────────────────────

exports.dashboard = asyncHandler(async (req, res) => {
    const farmId = req.farmId;
    const cows = await Cow.find({ farm_id: farmId, is_active: true })
        .select('cow_id name status last_update battery_percentage')
        .lean();

    cows.sort(cowSortComparator);

    const alertStatuses = ['HEAT_DETECTED', 'SICK', 'THEFT_ALERT'];
    const alertsCount = cows.filter((c) => alertStatuses.includes(c.status)).length;

    // Friendly last_update
    const now = Date.now();
    const formatted = cows.map((c) => {
        const diffMs = now - new Date(c.last_update).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        let last_update;
        if (diffMins < 1) last_update = 'Just now';
        else if (diffMins < 60) last_update = `${diffMins} mins ago`;
        else if (diffMins < 1440) last_update = `${Math.floor(diffMins / 60)} hours ago`;
        else last_update = `${Math.floor(diffMins / 1440)} days ago`;

        return {
            id: c.cow_id,
            name: c.name,
            status: c.status,
            last_update,
            battery_percentage: c.battery_percentage,
        };
    });

    res.json({
        total_cows: cows.length,
        alerts_count: alertsCount,
        cows: formatted,
    });
});

// ─── 2.2 Cow Inventory (Paginated) ────────────────────────

exports.listCows = asyncHandler(async (req, res) => {
    const farmId = req.farmId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const search = req.query.search || '';

    const filter = { farm_id: farmId, is_active: true };
    if (search) {
        filter.name = { $regex: search, $options: 'i' };
    }

    const total = await Cow.countDocuments(filter);
    const cows = await Cow.find(filter)
        .select('cow_id name status last_update battery_percentage breed collar_mac')
        .lean();

    cows.sort(cowSortComparator);

    const paginated = cows.slice((page - 1) * limit, page * limit);

    res.json({
        status: 'success',
        data: {
            cows: paginated,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        },
    });
});

// ─── 2.3 Single Cow Detail ────────────────────────────────

exports.getCow = asyncHandler(async (req, res) => {
    const cow = await Cow.findOne({
        cow_id: req.params.cow_id,
        farm_id: req.farmId,
    }).lean();

    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    res.json({
        id: cow.cow_id,
        name: cow.name,
        image_url: cow.image_url,
        breed: cow.breed,
        dob: cow.dob,
        weight_kg: cow.weight_kg,
        status: cow.status,
        collar_mac: cow.collar_mac,
        battery_percentage: cow.battery_percentage,
        battery_status: cow.battery_status,
    });
});

// ─── 2.4 Cow History (Charts) ─────────────────────────────

exports.getCowHistory = asyncHandler(async (req, res) => {
    const { cow_id } = req.params;
    const range = req.query.range || '7days';

    // Find the cow to get MAC address
    const cow = await Cow.findOne({ cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    const rangeMap = { '24hours': '-24h', '7days': '-7d', '30days': '-30d' };
    const fluxRange = rangeMap[range] || '-7d';

    let methane_graph = [];
    let activity_graph = [];

    try {
        const queryApi = getQueryApi();

        // Methane query
        const methaneQuery = `
      from(bucket: "${config.influx.bucket}")
        |> range(start: ${fluxRange})
        |> filter(fn: (r) => r._measurement == "vitals" and r.mac == "${cow.collar_mac}" and r._field == "methane_ppm")
        |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
    `;

        const methaneRows = [];
        await new Promise((resolve, reject) => {
            queryApi.queryRows(methaneQuery, {
                next(row, tableMeta) {
                    const o = tableMeta.toObject(row);
                    methaneRows.push({ time: o._time, value: Math.round(o._value * 100) / 100 });
                },
                error: reject,
                complete: resolve,
            });
        });
        methane_graph = methaneRows;

        // Activity query
        const activityQuery = `
      from(bucket: "${config.influx.bucket}")
        |> range(start: ${fluxRange})
        |> filter(fn: (r) => r._measurement == "activity" and r.mac == "${cow.collar_mac}" and r._field == "step_count")
        |> aggregateWindow(every: 1h, fn: sum, createEmpty: false)
    `;

        const activityRows = [];
        await new Promise((resolve, reject) => {
            queryApi.queryRows(activityQuery, {
                next(row, tableMeta) {
                    const o = tableMeta.toObject(row);
                    activityRows.push({ time: o._time, value: o._value });
                },
                error: reject,
                complete: resolve,
            });
        });
        activity_graph = activityRows;
    } catch (err) {
        console.warn('[CowHistory] InfluxDB query failed:', err.message);
    }

    res.json({
        status: 'success',
        data: { methane_graph, activity_graph },
    });
});

// ─── 2.5 Register New Collar ──────────────────────────────

exports.registerCow = asyncHandler(async (req, res) => {
    const { cow_name, collar_mac_address, breed, age_months } = req.body;

    if (!cow_name || !collar_mac_address) {
        return res.status(400).json({ status: 'error', message: 'cow_name and collar_mac_address are required' });
    }

    // Check if MAC is already in use
    const existing = await Cow.findOne({ collar_mac: collar_mac_address.toUpperCase(), is_active: true });
    if (existing) {
        return res.status(409).json({ status: 'error', message: 'This collar MAC is already registered' });
    }

    const cowId = `COW_${Date.now().toString(36).toUpperCase()}`;
    const dob = age_months ? new Date(Date.now() - age_months * 30 * 24 * 60 * 60 * 1000) : undefined;

    const cow = await Cow.create({
        farm_id: req.farmId,
        cow_id: cowId,
        name: cow_name,
        collar_mac: collar_mac_address.toUpperCase(),
        breed: breed || '',
        dob,
    });

    // MQTT Event A: Sync new collar MAC to all gateways (PART C §12.1)
    publishAddMAC(req.farmId, cow.collar_mac, cow.cow_id).catch((err) =>
        console.error('[Cow] MQTT ADD_MAC publish error:', err.message)
    );

    res.status(201).json({
        status: 'success',
        data: { cow_id: cow.cow_id, name: cow.name, collar_mac: cow.collar_mac },
    });
});

// ─── 2.6 Upload Cow Image ─────────────────────────────────

exports.uploadImage = asyncHandler(async (req, res) => {
    const cow = await Cow.findOne({ cow_id: req.params.cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'Image file is required' });
    }

    // Build URL path (static file serving)
    const imageUrl = `/uploads/cows/${req.file.filename}`;
    cow.image_url = imageUrl;
    await cow.save();

    res.json({ status: 'success', data: { image_url: imageUrl } });
});

// ─── 4.1 Get Cow Locations ────────────────────────────────

exports.getLocations = asyncHandler(async (req, res) => {
    const farm = await Farm.findOne({ farm_id: req.farmId });
    const cows = await Cow.find({ farm_id: req.farmId, is_active: true })
        .select('cow_id last_location status battery_percentage radius_meters')
        .lean();

    res.json({
        farm_center: farm ? { lat: farm.geofence.center_lat, lng: farm.geofence.center_lng } : { lat: 0, lng: 0 },
        geofence_radius: farm ? farm.geofence.radius_meters : 500,
        cows: cows.map((c) => ({
            id: c.cow_id,
            radius_meters: c.radius_meters,
            lat: c.last_location?.lat || 0,
            lng: c.last_location?.lng || 0,
            status: c.status === 'THEFT_ALERT' ? 'THEFT_ALERT' : 'NORMAL',
            battery_percentage: c.battery_percentage,
        })),
    });
});

// ─── 5.1 Edit Cow Details ─────────────────────────────────

exports.updateCow = asyncHandler(async (req, res) => {
    const allowed = ['name', 'breed', 'weight_kg', 'dob'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const cow = await Cow.findOneAndUpdate(
        { cow_id: req.params.cow_id, farm_id: req.farmId },
        updates,
        { new: true, runValidators: true }
    );

    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    res.json({ status: 'success', data: cow });
});

// ─── 5.2 Unpair Collar ────────────────────────────────────

exports.unpairCow = asyncHandler(async (req, res) => {
    const { reason, notes } = req.body;

    const cow = await Cow.findOne({ cow_id: req.params.cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    // Save MAC before clearing it — needed for MQTT REMOVE_MAC
    const oldMac = cow.collar_mac;

    cow.is_active = false;
    cow.unpair_reason = reason || '';
    cow.unpair_notes = notes || '';
    cow.unpaired_at = new Date();
    cow.collar_mac = '';
    await cow.save();

    // MQTT Event C: Notify gateways to remove MAC from whitelist (PART C §12.1)
    if (oldMac) {
        publishRemoveMAC(req.farmId, oldMac).catch((err) =>
            console.error('[Cow] MQTT REMOVE_MAC publish error:', err.message)
        );
    }

    res.json({ status: 'success', message: 'Collar unpaired successfully' });
});

// ─── 7.1 Add Health Event ──────────────────────────────────

exports.addHealthEvent = asyncHandler(async (req, res) => {
    const cow = await Cow.findOne({ cow_id: req.params.cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    const { event_type, date, notes, cost } = req.body;
    if (!event_type || !date) {
        return res.status(400).json({ status: 'error', message: 'event_type and date are required' });
    }

    const event = await HealthEvent.create({
        farm_id: req.farmId,
        cow_id: cow.cow_id,
        event_type,
        date: new Date(date),
        notes: notes || '',
        cost: cost || 0,
    });

    res.status(201).json({ status: 'success', data: event });
});

// ─── 7.2 Get Event History ─────────────────────────────────

exports.getHealthEvents = asyncHandler(async (req, res) => {
    const events = await HealthEvent.find({
        cow_id: req.params.cow_id,
        farm_id: req.farmId,
    }).sort({ date: -1 });

    res.json({ status: 'success', data: events });
});

// ─── 8.1 Add Milk Record ──────────────────────────────────

exports.addMilkRecord = asyncHandler(async (req, res) => {
    const cow = await Cow.findOne({ cow_id: req.params.cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    const { date, session, liters } = req.body;
    if (!date || !session || liters === undefined) {
        return res.status(400).json({ status: 'error', message: 'date, session, and liters are required' });
    }

    const record = await MilkRecord.create({
        farm_id: req.farmId,
        cow_id: cow.cow_id,
        date: new Date(date),
        session,
        liters,
    });

    res.status(201).json({ status: 'success', data: record });
});

// ─── 8.2 Milk Stats ───────────────────────────────────────

exports.getMilkStats = asyncHandler(async (req, res) => {
    const { cow_id } = req.params;

    // Last 30 days of records
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const records = await MilkRecord.find({
        cow_id,
        farm_id: req.farmId,
        date: { $gte: thirtyDaysAgo },
    }).sort({ date: -1 });

    const totalLiters = records.reduce((sum, r) => sum + r.liters, 0);
    const avgPerDay = records.length > 0 ? totalLiters / 30 : 0;

    // Today's records
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRecords = records.filter((r) => new Date(r.date) >= today);
    const todayTotal = todayRecords.reduce((sum, r) => sum + r.liters, 0);

    res.json({
        status: 'success',
        data: {
            total_30d_liters: Math.round(totalLiters * 100) / 100,
            avg_per_day: Math.round(avgPerDay * 100) / 100,
            today_liters: todayTotal,
            records_count: records.length,
            recent_records: records.slice(0, 10),
        },
    });
});

// ─── NEW: Methane History (Line Chart) ─────────────────────
//
// GET /cows/:cow_id/methane/history?range=24hours
//
// Returns aggregated methane PPM data points suitable for
// rendering a line chart on the mobile app. The aggregation
// window is auto-computed based on the requested range:
//   24 hours → 15 min windows  (up to 96 data points)
//   7 days   → 1 hour windows  (up to 168 data points)
//   30 days  → 6 hour windows  (up to 120 data points)

exports.getMethaneHistory = asyncHandler(async (req, res) => {
    const { cow_id } = req.params;
    const range = req.query.range || '24hours';

    const cow = await Cow.findOne({ cow_id, farm_id: req.farmId });
    if (!cow) {
        return res.status(404).json({ status: 'error', message: 'Cow not found' });
    }

    if (!cow.collar_mac) {
        return res.status(400).json({ status: 'error', message: 'No collar paired — no sensor data available' });
    }

    // Map range to Flux range string and aggregation window
    const rangeConfig = {
        '24hours': { fluxRange: '-24h', window: '15m' },
        '7days': { fluxRange: '-7d', window: '1h' },
        '30days': { fluxRange: '-30d', window: '6h' },
    };

    const cfg = rangeConfig[range] || rangeConfig['24hours'];

    let data_points = [];
    try {
        data_points = await influxService.queryMethaneHistory(
            cow.collar_mac,
            cfg.fluxRange,
            cfg.window
        );
    } catch (err) {
        console.warn('[MethaneHistory] InfluxDB query failed:', err.message);
    }

    // Compute summary stats for the chart header
    const values = data_points.map((p) => p.value);
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const min = values.length > 0 ? Math.min(...values) : 0;

    res.json({
        status: 'success',
        data: {
            cow_id: cow.cow_id,
            cow_name: cow.name,
            collar_mac: cow.collar_mac,
            range,
            aggregation_window: cfg.window,
            summary: {
                avg_ppm: Math.round(avg * 100) / 100,
                max_ppm: Math.round(max * 100) / 100,
                min_ppm: Math.round(min * 100) / 100,
                data_points_count: data_points.length,
                danger_threshold: 600,
            },
            methane_graph: data_points,
        },
    });
});
