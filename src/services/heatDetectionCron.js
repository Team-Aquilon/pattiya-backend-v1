const cron = require('node-cron');
const config = require('../config');
const Cow = require('../models/Cow');
const HealthEvent = require('../models/HealthEvent');
const Notification = require('../models/Notification');
const { getQueryApi } = require('../config/influxdb');
const fcmService = require('./fcmService');

/**
 * Dual-Validation Heat Detection Algorithm
 * 
 * Runs every 30 minutes. For each active cow with a collar:
 * 
 * Condition A: high_motion_events in last 4h > 300% of 7-day baseline average
 * Condition B: mic_mood marked as "VOCALIZING" or "RESTLESS" in last 4h
 * 
 * If BOTH conditions are TRUE → log "HEAT_DETECTED" event + trigger FCM alert
 */

function startHeatDetectionCron() {
    // Run every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
        console.log('[HeatCron] 🔍 Running heat detection analysis...');

        try {
            const cows = await Cow.find({ is_active: true, collar_mac: { $ne: '' }, status: { $ne: 'HEAT_DETECTED' } });

            if (cows.length === 0) {
                console.log('[HeatCron] No eligible cows to analyze');
                return;
            }

            const queryApi = getQueryApi();
            let detectedCount = 0;

            for (const cow of cows) {
                try {
                    const isInHeat = await analyzeHeatForCow(queryApi, cow);
                    if (isInHeat) {
                        detectedCount++;
                        await triggerHeatAlert(cow);
                    }
                } catch (err) {
                    console.warn(`[HeatCron] Error analyzing cow ${cow.cow_id}:`, err.message);
                }
            }

            console.log(`[HeatCron] ✅ Analysis complete. Detected: ${detectedCount}/${cows.length}`);
        } catch (err) {
            console.error('[HeatCron] Fatal error:', err.message);
        }
    });

    console.log('[HeatCron] ✅ Heat detection cron scheduled (every 30 min)');
}

/**
 * Analyze a single cow for heat indicators.
 */
async function analyzeHeatForCow(queryApi, cow) {
    const mac = cow.collar_mac;
    const bucket = config.influx.bucket;

    // ── Condition A: High motion > 300% of 7-day baseline ──

    // 7-day baseline: average daily high_motion_events
    const baselineQuery = `
    from(bucket: "${bucket}")
      |> range(start: -7d)
      |> filter(fn: (r) => r._measurement == "activity" and r.mac == "${mac}" and r._field == "high_motion_events")
      |> mean()
  `;

    let baselineMean = 0;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(baselineQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                baselineMean = o._value || 0;
            },
            error: reject,
            complete: resolve,
        });
    });

    // Last 4h motion
    const recentMotionQuery = `
    from(bucket: "${bucket}")
      |> range(start: -4h)
      |> filter(fn: (r) => r._measurement == "activity" and r.mac == "${mac}" and r._field == "high_motion_events")
      |> mean()
  `;

    let recentMotion = 0;
    await new Promise((resolve, reject) => {
        queryApi.queryRows(recentMotionQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                recentMotion = o._value || 0;
            },
            error: reject,
            complete: resolve,
        });
    });

    const conditionA = baselineMean > 0 && recentMotion > baselineMean * 3;

    // ── Condition B: Vocalization mood check ──

    const moodQuery = `
    from(bucket: "${bucket}")
      |> range(start: -4h)
      |> filter(fn: (r) => r._measurement == "vitals" and r.mac == "${mac}" and r._field == "mic_mood")
      |> last()
  `;

    let lastMood = 'CALM';
    await new Promise((resolve, reject) => {
        queryApi.queryRows(moodQuery, {
            next(row, tableMeta) {
                const o = tableMeta.toObject(row);
                lastMood = o._value || 'CALM';
            },
            error: reject,
            complete: resolve,
        });
    });

    const conditionB = lastMood === 'VOCALIZING' || lastMood === 'RESTLESS';

    return conditionA && conditionB;
}

/**
 * Trigger heat alert: update cow status, log event, send FCM.
 */
async function triggerHeatAlert(cow) {
    // Update cow status
    cow.status = 'HEAT_DETECTED';
    await cow.save();

    // Log as health event for long-term cycle prediction
    await HealthEvent.create({
        farm_id: cow.farm_id,
        cow_id: cow.cow_id,
        event_type: 'HEAT_DETECTED',
        date: new Date(),
        notes: 'Auto-detected by dual-validation algorithm (motion + vocalization)',
        auto_generated: true,
    });

    // Log notification
    const notification = await Notification.create({
        farm_id: cow.farm_id,
        cow_id: cow.cow_id,
        type: 'HEAT_DETECTED',
        title: '🔥 Heat Detected',
        message: `${cow.name} (${cow.cow_id}) is showing signs of estrus. Consider scheduling AI within 12-18 hours.`,
        severity: 'HIGH',
    });

    // Send FCM
    await fcmService.sendToFarm(cow.farm_id, {
        title: '🔥 Heat Detected',
        body: `${cow.name} is showing signs of estrus!`,
        data: { type: 'HEAT_DETECTED', cow_id: cow.cow_id, notification_id: notification._id.toString() },
    });

    console.log(`[HeatCron] 🔥 Heat detected for ${cow.name} (${cow.cow_id})`);
}

module.exports = { startHeatDetectionCron };
