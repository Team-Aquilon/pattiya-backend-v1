const mqtt = require('mqtt');
const config = require('./index');

let mqttClient = null;

/**
 * Connect to the MQTT broker and return the client instance.
 * The client automatically handles reconnection.
 */
function connectMQTT() {
    const options = {
        clientId: `pattiya-backend-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,          // Retry every 5 s
        connectTimeout: 10000,          // 10 s timeout
    };

    // Only add credentials if provided
    if (config.mqtt.username) {
        options.username = config.mqtt.username;
        options.password = config.mqtt.password;
    }

    mqttClient = mqtt.connect(config.mqtt.brokerUrl, options);

    mqttClient.on('connect', () => {
        console.log('[MQTT] ✅ Connected to broker →', config.mqtt.brokerUrl);
    });

    mqttClient.on('reconnect', () => {
        console.log('[MQTT] 🔄 Reconnecting to broker...');
    });

    mqttClient.on('error', (err) => {
        console.error('[MQTT] ❌ Error:', err.message);
    });

    mqttClient.on('offline', () => {
        console.warn('[MQTT] ⚠️  Client went offline');
    });

    return mqttClient;
}

/**
 * Get the active MQTT client (must call connectMQTT first).
 */
function getMQTTClient() {
    return mqttClient;
}

module.exports = { connectMQTT, getMQTTClient };
