const dotenv = require('dotenv');
const path = require('path');

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value, defaultValue = []) {
  if (!value) return defaultValue;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInteger(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const port = parseInteger(process.env.PORT, 5000);

const config = Object.freeze({
  server: {
    port,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}`,
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  },

  cors: {
    origins: parseList(process.env.CORS_ORIGINS, ['*']),
  },

  mongo: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/pattiya',
  },

  influx: {
    url: process.env.INFLUXDB_URL || 'http://localhost:8086',
    token: process.env.INFLUXDB_TOKEN || '',
    org: process.env.INFLUXDB_ORG || 'pattiya',
    bucket: process.env.INFLUXDB_BUCKET || 'sensor_data',
    required: parseBoolean(process.env.INFLUXDB_REQUIRED, false),
  },

  mqtt: {
    enabled: parseBoolean(process.env.MQTT_ENABLED, true),
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || '',
    password: process.env.MQTT_PASSWORD || '',
  },

  heatCron: {
    enabled: parseBoolean(process.env.HEAT_CRON_ENABLED, true),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'pattiya',
  },
});

module.exports = config;
