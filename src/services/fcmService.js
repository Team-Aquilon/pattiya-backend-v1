const admin = require('firebase-admin');
const config = require('../config');
const User = require('../models/User');

let firebaseInitialized = false;
let missingCredentialsLogged = false;

function hasFirebaseCredentials() {
    return Boolean(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);
}

function initFirebase() {
    if (firebaseInitialized) return true;

    if (admin.apps.length > 0) {
        firebaseInitialized = true;
        return true;
    }

    if (!hasFirebaseCredentials()) {
        if (!missingCredentialsLogged) {
            console.warn('[FCM] Firebase credentials not configured - push notifications disabled');
            missingCredentialsLogged = true;
        }
        return false;
    }

    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: config.firebase.projectId,
                clientEmail: config.firebase.clientEmail,
                privateKey: config.firebase.privateKey,
            }),
        });
        firebaseInitialized = true;
        console.log('[FCM] Firebase Admin SDK initialized');
        return true;
    } catch (err) {
        console.error('[FCM] Firebase init failed:', err.message);
        return false;
    }
}

async function sendToFarm(farmId, { title, body, data = {} }) {
    if (!firebaseInitialized && !initFirebase()) {
        console.log(`[FCM] (skipped) -> ${title}: ${body}`);
        return;
    }

    try {
        const users = await User.find({ farm_id: farmId, is_active: true, 'fcm_tokens.0': { $exists: true } });

        const tokens = [];
        for (const user of users) {
            if (data.type === 'HEAT_DETECTED' && !user.notification_settings.alert_heat) continue;
            if (data.type === 'GEOFENCE_BREACH' && !user.notification_settings.alert_theft) continue;
            if (data.type === 'LOW_BATTERY' && !user.notification_settings.alert_low_battery) continue;

            for (const t of user.fcm_tokens) {
                tokens.push(t.token);
            }
        }

        if (tokens.length === 0) {
            console.log('[FCM] No tokens to send to');
            return;
        }

        const message = {
            notification: { title, body },
            data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
            tokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`[FCM] Sent to ${response.successCount}/${tokens.length} devices`);

        if (response.failureCount > 0) {
            const invalidTokens = [];
            response.responses.forEach((resp, idx) => {
                if (resp.error && (resp.error.code === 'messaging/invalid-registration-token'
                    || resp.error.code === 'messaging/registration-token-not-registered')) {
                    invalidTokens.push(tokens[idx]);
                }
            });

            if (invalidTokens.length > 0) {
                await User.updateMany(
                    { farm_id: farmId },
                    { $pull: { fcm_tokens: { token: { $in: invalidTokens } } } }
                );
                console.log(`[FCM] Cleaned up ${invalidTokens.length} invalid tokens`);
            }
        }
    } catch (err) {
        console.error('[FCM] Push notification error:', err.message);
    }
}

module.exports = { initFirebase, sendToFarm };
