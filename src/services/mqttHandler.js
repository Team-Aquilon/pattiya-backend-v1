const { getMQTTClient } = require('../config/mqtt');
const Gateway = require('../models/Gateway');
const Cow = require('../models/Cow');
const Notification = require('../models/Notification');
const fcmService = require('./fcmService');

let messageHandlerRegistered = false;

function registerMessageHandler(client) {
    if (messageHandlerRegistered) return;
    messageHandlerRegistered = true;

    client.on('message', async (topic, message) => {
        try {
            const payload = JSON.parse(message.toString());
            const topicParts = topic.split('/');
            const farmId = topicParts[1];
            const gatewayId = topicParts[3];

            console.log(`[MQTT Handler] Alert from gateway ${gatewayId}:`, payload.alert_type);

            if (payload.alert_type === 'GEOFENCE_BREACH') {
                await handleGeofenceBreach(farmId, payload);
            }
        } catch (err) {
            console.error('[MQTT Handler] Error processing message:', err.message);
        }
    });
}

function initMQTTHandler() {
    const client = getMQTTClient();
    if (!client) {
        console.warn('[MQTT Handler] No MQTT client available');
        return;
    }

    registerMessageHandler(client);

    client.subscribe('farm/+/gateway/+/alerts', { qos: 1 }, (err) => {
        if (err) {
            console.error('[MQTT Handler] Subscribe error:', err.message);
        } else {
            console.log('[MQTT Handler] Subscribed to farm/+/gateway/+/alerts');
        }
    });
}

async function handleGeofenceBreach(farmId, payload) {
    const { mac_address, trigger_data } = payload;

    const cow = await Cow.findOne({ collar_mac: mac_address?.toUpperCase(), farm_id: farmId });

    if (cow) {
        cow.status = 'THEFT_ALERT';
        if (trigger_data) {
            cow.last_location = { lat: trigger_data.current_lat, lng: trigger_data.current_lng };
        }
        await cow.save();
    }

    await Notification.create({
        farm_id: farmId,
        cow_id: cow ? cow.cow_id : '',
        type: 'GEOFENCE_BREACH',
        title: 'Geofence Breach Alert (MQTT)',
        message: `${cow ? cow.name : mac_address} has left the farm boundary!`,
        severity: 'CRITICAL',
        data: payload,
    });

    await fcmService.sendToFarm(farmId, {
        title: 'Geofence Breach Alert',
        body: `${cow ? cow.name : 'A cow'} has breached the farm boundary!`,
        data: { type: 'GEOFENCE_BREACH', cow_id: cow?.cow_id || '' },
    });
}

function publishCommand(farmId, gatewayId, command) {
    const client = getMQTTClient();
    if (!client || !client.connected) {
        console.warn('[MQTT] Cannot publish - client not connected');
        return;
    }

    const topic = `farm/${farmId}/gateway/${gatewayId}/commands`;
    const payload = JSON.stringify({ ...command, timestamp: new Date().toISOString() });

    client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
            console.error(`[MQTT] Publish error to ${topic}:`, err.message);
        } else {
            console.log(`[MQTT] Published ${command.command} -> ${topic}`);
        }
    });
}

async function publishToAllGateways(farmId, command) {
    const client = getMQTTClient();
    if (!client || !client.connected) {
        console.warn('[MQTT] Cannot publish - client not connected');
        return;
    }

    try {
        const gateways = await Gateway.find({ farm_id: farmId, is_active: true }).select('gateway_id').lean();

        if (gateways.length === 0) {
            console.log(`[MQTT] No active gateways for farm ${farmId}`);
            return;
        }

        for (const gw of gateways) {
            const topic = `farm/${farmId}/gateway/${gw.gateway_id}/commands`;
            const payload = JSON.stringify({ ...command, timestamp: new Date().toISOString() });

            client.publish(topic, payload, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`[MQTT] Publish error to ${topic}:`, err.message);
                }
            });
        }

        console.log(`[MQTT] Broadcast ${command.command} -> ${gateways.length} gateways (farm: ${farmId})`);
    } catch (err) {
        console.error('[MQTT] Broadcast error:', err.message);
    }
}

async function publishAddMAC(farmId, macAddress, cowId) {
    await publishToAllGateways(farmId, {
        command: 'ADD_MAC',
        data: {
            mac_address: macAddress,
            cow_id: cowId,
        },
    });
}

async function publishUpdateGeofence(farmId, geofenceData) {
    await publishToAllGateways(farmId, {
        command: 'UPDATE_GEOFENCE',
        data: geofenceData,
    });
}

async function publishRemoveMAC(farmId, macAddress) {
    await publishToAllGateways(farmId, {
        command: 'REMOVE_MAC',
        data: {
            mac_address: macAddress,
        },
    });
}

module.exports = {
    initMQTTHandler,
    publishCommand,
    publishToAllGateways,
    publishAddMAC,
    publishUpdateGeofence,
    publishRemoveMAC,
};
