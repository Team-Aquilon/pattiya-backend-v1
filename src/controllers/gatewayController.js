const jwt = require('jsonwebtoken');
const config = require('../config');
const Gateway = require('../models/Gateway');
const Cow = require('../models/Cow');
const Farm = require('../models/Farm');
const Notification = require('../models/Notification');
const HealthEvent = require('../models/HealthEvent');
const OestrusAlert = require('../models/OestrusAlert');
const MethaneSession = require('../models/MethaneSession');
const influxService = require('../services/influxService');
const fcmService = require('../services/fcmService');
const { emitFarmUpdate } = require('../services/socketService');
const { calculateTHI, classifyTHI } = require('../utils/thi');
const asyncHandler = require('../middleware/asyncHandler');

// ????????? Thresholds ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const METHANE_DANGER_THRESHOLD = 600;
const THI_ALERT_THRESHOLD = 72;

// ????????? 1.1 Gateway Boot Login ?????????????????????????????????????????????????????????????????????????????????????????????

exports.gatewayLogin = asyncHandler(async (req, res) => {
    const { gateway_id, hardware_secret } = req.body;

    if (!gateway_id || !hardware_secret) {
        return res.status(400).json({ status: 'error', message: 'gateway_id and hardware_secret are required' });
    }

    const gateway = await Gateway.findOne({ gateway_id, is_active: true });
    if (!gateway) {
        return res.status(401).json({ status: 'error', message: 'Gateway not found' });
    }

    const isMatch = await gateway.compareSecret(hardware_secret);
    if (!isMatch) {
        return res.status(401).json({ status: 'error', message: 'Invalid hardware secret' });
    }

    gateway.last_seen = new Date();
    await gateway.save();

    const gateway_access_token = jwt.sign(
        { gatewayId: gateway.gateway_id, farmId: gateway.farm_id, type: 'gateway' },
        config.jwt.secret,
        { expiresIn: '24h' }
    );

    res.json({
        status: 'success',
        data: {
            gateway_access_token,
            expires_in: 86400,
            farm_id: gateway.farm_id,
        },
    });
});

// ????????? 2.1 Sync Allowed MAC Addresses ??????????????????????????????????????????????????????????????????

exports.getWhitelist = asyncHandler(async (req, res) => {
    const cows = await Cow.find({ farm_id: req.farmId, is_active: true, collar_mac: { $ne: '' } })
        .select('collar_mac')
        .lean();

    res.json({
        status: 'success',
        data: {
            allowed_macs: cows.map((c) => c.collar_mac),
        },
    });
});

// ????????? 2.2 Batch Vitals Telemetry ??????????????????????????????????????????????????????????????????????????????
//
//  Architecture: Fast Path vs Slow Path
//  ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????
//  FAST PATH (non-blocking): InfluxDB batch write via influxService
//  SLOW PATH (async background): MongoDB cow updates + methane alerts
//
//  The HTTP response is sent as soon as InfluxDB write is flushed.
//  MongoDB operations run in parallel without delaying the gateway.

exports.batchVitals = asyncHandler(async (req, res) => {
    const { gateway_id, batch_timestamp, records } = req.body;

    if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ status: 'error', message: 'records array is required' });
    }

    const farmId = req.farmId;

    // ?????? FAST PATH: InfluxDB write (time-series) ??????????????????????????????
    await influxService.writeVitalsBatch(farmId, gateway_id, records);

    // ?????? Respond immediately to the gateway ?????????????????????????????????????????????
    res.json({ status: 'success', message: 'Batch processed successfully' });

    // ?????? SLOW PATH: MongoDB updates + health checks (background) ??????
    //    These run AFTER the response is sent. Not awaited.
    setImmediate(async () => {
        try {
            await processVitalsBackground(farmId, gateway_id, records);
        } catch (err) {
            console.error('[Gateway] Background vitals processing error:', err.message);
        }
    });
});

/**
 * Background processing for each cow in the vitals batch:
 *  1. Update live state in MongoDB (battery, location, last_update)
 *  2. Evaluate methane threshold ??? alert if > 600 PPM
 *  3. Extract DHT22 environment data ??? InfluxDB + THI alert if > 72
 */
async function processVitalsBackground(farmId, gatewayId, records) {
    const methaneAlerts = []; // Collect cows exceeding threshold

    for (const record of records) {
        const { mac_address, timestamp, vitals, gps } = record;

        // ?????? 1. Update cow's live state in MongoDB ????????????????????????
        const updateData = { last_update: new Date(timestamp) };

        if (vitals) {
            updateData.battery_percentage = vitals.battery_percentage;

            if (vitals.battery_percentage <= 10) {
                updateData.battery_status = 'CRITICAL';
                updateData.status = 'LOW_BATTERY';
            } else if (vitals.battery_percentage <= 25) {
                updateData.battery_status = 'LOW';
            } else {
                updateData.battery_status = 'NORMAL';
            }
        }

        if (gps && gps.lat && gps.lng) {
            updateData.last_location = { lat: gps.lat, lng: gps.lng };
        }

        const cow = await Cow.findOneAndUpdate(
            { collar_mac: mac_address.toUpperCase(), farm_id: farmId },
            { $set: updateData },
            { new: true }
        );

        // ?????? 2. Methane threshold check ?????????????????????????????????????????????????????????
        if (vitals && vitals.methane_ppm > METHANE_DANGER_THRESHOLD && cow) {
            methaneAlerts.push({
                cow,
                methane_ppm: vitals.methane_ppm,
                timestamp,
            });
        }
    }

    // ?????? 3. Fire methane alerts (batched for efficiency) ??????
    for (const alert of methaneAlerts) {
        await handleHighMethaneAlert(farmId, alert.cow, alert.methane_ppm, alert.timestamp);
    }

    // ?????? 4. Environment data (DHT22 on the Base Station) ??????????????????
    //    The gateway sends ambient_temperature and ambient_humidity
    //    at the batch level (same for all records in the batch).
    //    We extract from the first record that has vitals.
    const firstRecord = records.find((r) => r.vitals);
    if (firstRecord && firstRecord.vitals) {
        const { temperature, humidity } = firstRecord.vitals;
        if (temperature != null && humidity != null) {
            const thi = calculateTHI(temperature, humidity);
            const thiClass = classifyTHI(thi);
            const batchTimestamp = firstRecord.timestamp || new Date().toISOString();

            // Write environment point to InfluxDB
            await influxService.writeEnvironmentData(
                farmId, gatewayId, temperature, humidity, thi, batchTimestamp
            );
            emitFarmUpdate(farmId, {
                action: 'updated',
                source: 'gateway_vitals',
                entity: 'environment',
                gateway_id: gatewayId,
            });

            console.log(`[Gateway] ???????  Farm ${farmId}: Temp=${temperature}??C, RH=${humidity}%, THI=${thi} (${thiClass.level})`);

            // Alert if THI exceeds threshold
            if (thi > THI_ALERT_THRESHOLD && thiClass.alert) {
                await handleHeatStressAlert(farmId, temperature, humidity, thi, thiClass);
            }
        }
    }
}

/**
 * Handle a single HIGH_METHANE_WARNING:
 *  - Log HealthEvent in MongoDB for historical tracking
 *  - Log Notification for the app's notification feed
 *  - Fire FCM push to the farmer
 */
async function handleHighMethaneAlert(farmId, cow, methanePpm, timestamp) {
    console.log(`[Gateway] ??????  HIGH METHANE: ${cow.name} (${cow.cow_id}) ??? ${methanePpm} PPM`);

    // Mark cow as SICK if not already in a higher-priority state
    if (cow.status === 'HEALTHY' || cow.status === 'OFFLINE') {
        cow.status = 'SICK';
        await cow.save();
    }

    // Log health event (long-term historical tracking)
    await HealthEvent.create({
        farm_id: farmId,
        cow_id: cow.cow_id,
        event_type: 'TREATMENT', // Closest standard type; notes clarify it's methane
        date: new Date(timestamp),
        notes: `HIGH_METHANE_WARNING: ${methanePpm} PPM detected. Possible digestive bloat. Threshold: ${METHANE_DANGER_THRESHOLD} PPM.`,
        auto_generated: true,
    });

    // Log notification (app feed)
    const notification = await Notification.create({
        farm_id: farmId,
        cow_id: cow.cow_id,
        type: 'SYSTEM',
        title: '?????? High Methane Warning',
        message: `${cow.name} (${cow.cow_id}) is emitting ${methanePpm} PPM methane ??? possible digestive bloat! Check immediately.`,
        severity: 'HIGH',
        data: { methane_ppm: methanePpm, threshold: METHANE_DANGER_THRESHOLD },
    });

    // FCM push notification
    await fcmService.sendToFarm(farmId, {
        title: `?????? High Methane: ${cow.name}`,
        body: `${methanePpm} PPM detected ??? possible digestive bloat!`,
        data: {
            type: 'HIGH_METHANE_WARNING',
            cow_id: cow.cow_id,
            methane_ppm: String(methanePpm),
            notification_id: notification._id.toString(),
        },
    });
}

/**
 * Handle FARM_HEAT_STRESS_WARNING:
 *  - Log Notification with THI details
 *  - Fire FCM push advising the farmer to activate cooling
 */
async function handleHeatStressAlert(farmId, temperature, humidity, thi, thiClass) {
    console.log(`[Gateway] ???? HEAT STRESS: Farm ${farmId} ??? THI=${thi} (${thiClass.level})`);

    // Log notification (farm-level, no specific cow)
    const notification = await Notification.create({
        farm_id: farmId,
        cow_id: '',
        type: 'SYSTEM',
        title: `???? Heat Stress Warning: ${thiClass.level}`,
        message: `THI=${thi} (${temperature}??C / ${humidity}% RH). ${thiClass.description}. Activate fans and sprinklers immediately!`,
        severity: thiClass.level === 'DANGER' ? 'CRITICAL' : 'HIGH',
        data: {
            alert_type: 'FARM_HEAT_STRESS_WARNING',
            thi,
            ambient_temperature: temperature,
            ambient_humidity: humidity,
            stress_level: thiClass.level,
        },
    });

    // FCM push notification
    await fcmService.sendToFarm(farmId, {
        title: `???? Heat Stress: THI ${thi}`,
        body: `${thiClass.description} (${temperature}??C / ${humidity}% RH). Turn on cooling systems!`,
        data: {
            type: 'FARM_HEAT_STRESS_WARNING',
            thi: String(thi),
            stress_level: thiClass.level,
            notification_id: notification._id.toString(),
        },
    });
}

// ????????? 2.3 Batch Activity Telemetry ???????????????????????????????????????????????????????????????????????????

exports.batchActivity = asyncHandler(async (req, res) => {
    const { gateway_id, batch_timestamp, records } = req.body;

    if (!records || !Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ status: 'error', message: 'records array is required' });
    }

    // Fast path: InfluxDB write
    await influxService.writeActivityBatch(req.farmId, gateway_id, records, batch_timestamp);

    res.json({ status: 'success', message: 'Activity batch processed' });
});

// ????????? 2.4 Fetch Geofence Boundaries ?????????????????????????????????????????????????????????????????????

exports.getGeofence = asyncHandler(async (req, res) => {
    const farm = await Farm.findOne({ farm_id: req.farmId });
    if (!farm) {
        return res.status(404).json({ status: 'error', message: 'Farm not found' });
    }

    res.json({
        status: 'success',
        data: {
            center_lat: farm.geofence.center_lat,
            center_lng: farm.geofence.center_lng,
            radius_meters: farm.geofence.radius_meters,
        },
    });
});

// ????????? 11.5 Emergency Edge Alert ????????????????????????????????????????????????????????????????????????????????????

exports.emergencyAlert = asyncHandler(async (req, res) => {
    const { gateway_id, mac_address, alert_type, timestamp, trigger_data } = req.body;
    const farmId = req.farmId;

    const cow = await Cow.findOne({ collar_mac: mac_address?.toUpperCase(), farm_id: farmId });

    if (cow) {
        cow.status = 'THEFT_ALERT';
        if (trigger_data) {
            cow.last_location = {
                lat: trigger_data.current_lat,
                lng: trigger_data.current_lng,
            };
        }
        await cow.save();
    }

    const notification = await Notification.create({
        farm_id: farmId,
        cow_id: cow ? cow.cow_id : '',
        type: 'GEOFENCE_BREACH',
        title: '???? Geofence Breach Alert',
        message: `${cow ? cow.name : mac_address} has left the farm boundary! Distance: ${trigger_data?.distance_from_center_meters || 'unknown'}m`,
        severity: 'CRITICAL',
        data: { alert_type, trigger_data, gateway_id },
    });

    await fcmService.sendToFarm(farmId, {
        title: '???? Geofence Breach Alert',
        body: `${cow ? cow.name : 'A cow'} has breached the farm boundary!`,
        data: { type: 'GEOFENCE_BREACH', cow_id: cow?.cow_id || '', notification_id: notification._id.toString() },
    });

    res.json({ status: 'alert_received', action_taken: 'FCM_Push_Notification_Triggered' });
});

// ????????? 11.6 Multimodal AI Telemetry Endpoints ??????????????????????????????????????????

exports.activityPrediction = asyncHandler(async (req, res) => {
    const { gateway_id, cow_id, mac_address, timestamp, features, predicted_activity, activity_state, confidence, battery, rssi_dbm, snr_db } = req.body;
    
    await influxService.writeActivityPrediction(req.farmId, gateway_id, req.body);
    
    if (mac_address) {
        const cow = await Cow.findOne({ collar_mac: mac_address.toUpperCase(), farm_id: req.farmId });
        if (cow) {
            cow.last_update = new Date(timestamp || Date.now());
            if (battery !== undefined) {
                cow.battery_percentage = battery;
                if (battery <= 10) {
                    cow.battery_status = 'CRITICAL';
                } else if (battery <= 25) {
                    cow.battery_status = 'LOW';
                } else {
                    cow.battery_status = 'NORMAL';
                }
            }
            await cow.save();
        }
    }
    
    res.json({ status: 'success', message: 'Activity prediction stored' });
});

exports.soundPrediction = asyncHandler(async (req, res) => {
    const { gateway_id, mac_address, timestamp, event_start_ms, oestrus_probability, label, rssi_dbm, snr_db } = req.body;
    
    await influxService.writeSoundPrediction(req.farmId, gateway_id, req.body);
    
    res.json({ status: 'success', message: 'Sound prediction stored' });
});

exports.environmentReading = asyncHandler(async (req, res) => {
    const { gateway_id, timestamp, uptime_ms, temperature_c, humidity_percent, valid } = req.body;
    
    let thi = null;
    if (valid) {
        thi = calculateTHI(temperature_c, humidity_percent);
        await influxService.writeEnvironmentData(req.farmId, gateway_id, temperature_c, humidity_percent, thi, timestamp || new Date().toISOString());
        emitFarmUpdate(req.farmId, {
            action: 'updated',
            source: 'environment_reading',
            entity: 'environment',
            gateway_id,
        });
        
        if (thi > THI_ALERT_THRESHOLD) {
            const thiClass = classifyTHI(thi);
            if (thiClass && thiClass.alert) {
                await handleHeatStressAlert(req.farmId, temperature_c, humidity_percent, thi, thiClass);
            }
        }
    }
    
    res.json({ status: 'success', message: 'Environment data stored', data: { thi } });
});

exports.statusHeartbeat = asyncHandler(async (req, res) => {
    const { gateway_id, cow_id, mac_address, lat, lon, uptime_ms, battery, gps_age_ms, rssi_dbm, snr_db } = req.body;
    
    if (mac_address) {
        const cow = await Cow.findOne({ collar_mac: mac_address.toUpperCase(), farm_id: req.farmId });
        if (cow) {
            if (lat !== undefined && lon !== undefined) {
                cow.last_location = { lat, lng: lon };
            }
            if (battery !== undefined) {
                cow.battery_percentage = battery;
                if (battery <= 10) {
                    cow.battery_status = 'CRITICAL';
                    cow.status = 'LOW_BATTERY';
                } else if (battery <= 25) {
                    cow.battery_status = 'LOW';
                } else {
                    cow.battery_status = 'NORMAL';
                }
            }
            cow.last_update = new Date();
            await cow.save();
        }
    }
    
    res.json({ status: 'success', message: 'Status updated' });
});

exports.oestrusFusion = asyncHandler(async (req, res) => {
    const { gateway_id, cow_id, mac_address, decision, sound_label, sound_probability, activity_label, activity_state, temperature_c, humidity_percent, rssi_dbm, snr_db } = req.body;
    
    await influxService.writeOestrusFusion(req.farmId, gateway_id, req.body);
    
    await OestrusAlert.create({
        farm_id: req.farmId,
        cow_id,
        mac_address,
        decision,
        sound_label,
        sound_probability,
        activity_label,
        activity_state,
        temperature_c,
        humidity_percent,
        timestamp: new Date()
    });
    
    if (decision === 'LIKELY_OESTRUS') {
        const cow = await Cow.findOne({ collar_mac: mac_address?.toUpperCase(), farm_id: req.farmId });
        if (cow) {
            cow.status = 'HEAT_DETECTED';
            await cow.save();
            
            await HealthEvent.create({
                farm_id: req.farmId,
                cow_id: cow.cow_id,
                event_type: 'HEAT_DETECTED',
                date: new Date(),
                notes: `Fusion Details: Sound=${sound_label} (${sound_probability}), Activity=${activity_label}, Temp=${temperature_c}, Hum=${humidity_percent}`,
                auto_generated: true
            });
            
            const notification = await Notification.create({
                farm_id: req.farmId,
                cow_id: cow.cow_id,
                type: 'HEAT_DETECTED',
                title: 'Heat Detected',
                message: `${cow.name || cow.cow_id} is likely in oestrus.`,
                severity: 'CRITICAL',
                data: { decision, sound_label, activity_label }
            });
            
            await fcmService.sendToFarm(req.farmId, {
                title: '???? Heat Detected',
                body: `${cow.name || cow.cow_id} is likely in oestrus based on multimodal fusion.`,
                data: {
                    type: 'HEAT_DETECTED',
                    cow_id: cow.cow_id,
                    notification_id: notification._id.toString()
                }
            });
        }
    } else if (decision === 'WATCH') {
        const cow = await Cow.findOne({ collar_mac: mac_address?.toUpperCase(), farm_id: req.farmId });
        await Notification.create({
            farm_id: req.farmId,
            cow_id: cow ? cow.cow_id : cow_id,
            type: 'HEAT_DETECTED',
            title: '???? Oestrus Watch',
            message: `${cow ? cow.name : cow_id} is showing some signs of oestrus. Keep watching.`,
            severity: 'MEDIUM',
            data: { decision }
        });
    }
    
    res.json({ status: 'success', message: 'Fusion decision processed', data: { decision, alert_triggered: decision !== 'NORMAL' } });
});

exports.methaneSample = asyncHandler(async (req, res) => {
    const { gateway_id } = req.body;
    await influxService.writeMethaneSample(req.farmId, gateway_id, req.body);
    emitFarmUpdate(req.farmId, {
        action: 'updated',
        source: 'methane_sample',
        entity: 'methane',
        gateway_id,
    });
    res.json({ status: 'success', message: 'Methane sample stored' });
});

exports.methaneSession = asyncHandler(async (req, res) => {
    const { gateway_id, cow_id, rfid_tag, avg_delta_ch4_ppm, session_start_time } = req.body;
    
    await MethaneSession.create({
        farm_id: req.farmId,
        ...req.body
    });
    emitFarmUpdate(req.farmId, {
        action: 'updated',
        source: 'methane_session',
        entity: 'methane',
        gateway_id,
        cow_id,
    });

    if (avg_delta_ch4_ppm > 600) {
        let cow = null;
        if (cow_id) cow = await Cow.findOne({ cow_id, farm_id: req.farmId });
        if (!cow && rfid_tag) cow = await Cow.findOne({ rfid_tag, farm_id: req.farmId });
        
        if (cow) {
            await handleHighMethaneAlert(req.farmId, cow, avg_delta_ch4_ppm, session_start_time || new Date());
        }
    }

    res.json({ status: 'success', message: 'Methane session stored' });
});
