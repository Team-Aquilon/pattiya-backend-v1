const mqtt = require('mqtt');
const config = require('./index');

let mqttClient = null;

function connectMQTT() {
    if (!config.mqtt.enabled) return null;
    if (mqttClient) return mqttClient;

    const options = {
        clientId: `pattiya-backend-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
    };

    if (config.mqtt.username) {
        options.username = config.mqtt.username;
        options.password = config.mqtt.password;
    }

    mqttClient = mqtt.connect(config.mqtt.brokerUrl, options);

    mqttClient.on('connect', () => {
        console.log('[MQTT] Connected to broker ->', config.mqtt.brokerUrl);
    });

    mqttClient.on('reconnect', () => {
        console.log('[MQTT] Reconnecting to broker...');
    });

    mqttClient.on('error', (err) => {
        console.error('[MQTT] Error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.warn('[MQTT] Client went offline');
    });

    mqttClient.on('close', () => {
        console.warn('[MQTT] Connection closed');
    });

    return mqttClient;
}

function getMQTTClient() {
    return mqttClient;
}

module.exports = { connectMQTT, getMQTTClient };
