# 🐄 Pattiya — AI Predictions & Oestrus Alerts API Documentation

> **For:** Flutter App Developer · **Version:** 2.0 · **Base URL:** `https://api.yourserver.com/api/v1`
> **Auth:** All endpoints require `Authorization: Bearer <access_token>` (obtained from `POST /auth/login`)

---

## Table of Contents

1. [New Endpoints Summary](#1-new-endpoints-summary)
2. [AI Predictions — Per Cow](#2-ai-predictions--per-cow)
3. [Oestrus Fusion Alerts](#3-oestrus-fusion-alerts)
4. [New Notification Types (Oestrus & Methane)](#4-new-notification-types-oestrus--methane)
5. [Gateway Telemetry Endpoints (Internal)](#5-gateway-telemetry-endpoints-internal)
6. [Data Flow Diagram](#6-data-flow-diagram)

---

## 1. New Endpoints Summary

### Mobile App Endpoints (For Flutter)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/cows/oestrus/active` | All cows with active oestrus alerts (last 24h) |
| `GET` | `/cows/:cow_id/predictions/latest` | Latest AI predictions for a cow |
| `GET` | `/cows/:cow_id/predictions/history` | Prediction history for charts |
| `GET` | `/cows/:cow_id/oestrus/alerts` | Oestrus fusion alert history |

### Gateway Telemetry Endpoints (From Raspberry Pi — Internal)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/gateway/telemetry/activity-prediction` | Activity ML prediction from Pi |
| `POST` | `/gateway/telemetry/sound-prediction` | Sound oestrus prediction from ESP32 |
| `POST` | `/gateway/telemetry/environment` | DHT22 environment reading |
| `POST` | `/gateway/telemetry/status` | GPS/battery heartbeat |
| `POST` | `/gateway/telemetry/oestrus-fusion` | Fusion decision (sound + activity) |
| `POST` | `/gateway/telemetry/methane/sample` | Individual methane sample from Tower |
| `POST` | `/gateway/telemetry/methane/session` | Complete 10-minute methane session summary |

---

## 2. AI Predictions — Per Cow

### 2.1 Get Latest Predictions

Returns the most recent activity and sound AI model predictions for a specific cow.

**Endpoint:** `GET /cows/:cow_id/predictions/latest`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "cow_id": "COW_1719907200_123456",
    "cow_name": "Suddi",
    "activity": {
      "time": "2026-07-18T12:00:00.000Z",
      "predicted_activity": "walking",
      "activity_state": "normal_activity",
      "confidence": 0.92
    },
    "sound": {
      "time": "2026-07-18T12:05:00.000Z",
      "oestrus_probability": 0.15,
      "label": "normal"
    }
  }
}
```

**Field Descriptions:**

| Field | Description |
|-------|-------------|
| `predicted_activity` | ML model output: `walking`, `standing`, `lying`, `eating`, `trotting`, `rising`, `mounting`, `active` |
| `activity_state` | Simplified: `high_activity` (trotting/rising/mounting/active) or `normal_activity` |
| `confidence` | Model confidence (0.0 – 1.0) |
| `oestrus_probability` | Sound model's oestrus probability (0.0 – 1.0) |
| `label` | Sound classification: `normal`, `watch`, `likely_oestrus` |

**Response (404):** If cow not found
```json
{ "status": "error", "message": "Cow not found" }
```

---

### 2.2 Get Prediction History (For Charts)

Returns time-series prediction data for charts and graphs.

**Endpoint:** `GET /cows/:cow_id/predictions/history`

**Query Parameters:**

| Param | Type | Default | Options |
|-------|------|---------|---------|
| `range` | string | `24h` | `1h`, `6h`, `12h`, `24h`, `3d`, `7d`, `30d` |

**Example:** `GET /cows/COW_105/predictions/history?range=24h`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "activity_predictions": [
      {
        "time": "2026-07-18T10:00:00.000Z",
        "predicted_activity": "standing",
        "activity_state": "normal_activity",
        "confidence": 0.88
      },
      {
        "time": "2026-07-18T10:30:00.000Z",
        "predicted_activity": "trotting",
        "activity_state": "high_activity",
        "confidence": 0.95
      }
    ],
    "sound_predictions": [
      {
        "time": "2026-07-18T10:00:00.000Z",
        "oestrus_probability": 0.12,
        "label": "normal"
      },
      {
        "time": "2026-07-18T10:30:00.000Z",
        "oestrus_probability": 0.78,
        "label": "likely_oestrus"
      }
    ]
  }
}
```

---

## 3. Oestrus Fusion Alerts

### 3.1 Get Active Oestrus Alerts (Dashboard)

Returns all cows that currently have an active `LIKELY_OESTRUS` or `WATCH` alert from the last 24 hours. **Use this for the dashboard oestrus card.**

**Endpoint:** `GET /cows/oestrus/active`

> [!IMPORTANT]
> This endpoint uses `/cows/oestrus/active` (no `:cow_id`). It returns alerts across ALL cows in the farm.

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "active_alerts": [
      {
        "cow_id": "COW_1719907200_123456",
        "cow_name": "Suddi",
        "decision": "LIKELY_OESTRUS",
        "sound_label": "likely_oestrus",
        "sound_probability": 0.85,
        "activity_label": "mounting",
        "activity_state": "high_activity",
        "temperature_c": 28.5,
        "humidity_percent": 72.0,
        "created_at": "2026-07-18T12:15:00.000Z"
      },
      {
        "cow_id": "COW_1719907200_789012",
        "cow_name": "Kalu",
        "decision": "WATCH",
        "sound_label": "watch",
        "sound_probability": 0.45,
        "activity_label": "walking",
        "activity_state": "normal_activity",
        "temperature_c": 28.5,
        "humidity_percent": 72.0,
        "created_at": "2026-07-18T11:45:00.000Z"
      }
    ]
  }
}
```

**Decision Values:**

| Decision | Meaning | UI Suggestion |
|----------|---------|---------------|
| `LIKELY_OESTRUS` | Both sound AND activity models confirm oestrus | 🔴 Red badge, critical alert |
| `WATCH` | One signal detected — needs monitoring | 🟡 Yellow badge, warning |
| `NORMAL` | No oestrus signals | Not shown in active alerts |

---

### 3.2 Get Oestrus Alert History (Per Cow)

Returns the full fusion alert history for a specific cow, with pagination.

**Endpoint:** `GET /cows/:cow_id/oestrus/alerts`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page |

**Example:** `GET /cows/COW_105/oestrus/alerts?page=1&limit=10`

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "alerts": [
      {
        "_id": "669abc123def456789012345",
        "farm_id": "FARM_UUID_12345",
        "cow_id": "COW_1719907200_123456",
        "gateway_id": "GW_001",
        "decision": "LIKELY_OESTRUS",
        "sound_label": "likely_oestrus",
        "sound_probability": 0.85,
        "activity_label": "mounting",
        "activity_state": "high_activity",
        "temperature_c": 28.5,
        "humidity_percent": 72.0,
        "rssi_dbm": -65,
        "snr_db": 8.5,
        "createdAt": "2026-07-18T12:15:00.000Z",
        "updatedAt": "2026-07-18T12:15:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "pages": 1
    }
  }
}
```

---

## 4. New Notification Types (Oestrus & Methane)

When the backend detects oestrus or high methane, these FCM push notifications are sent automatically:

### LIKELY_OESTRUS → Push Notification
```json
{
  "title": "🔥 Oestrus Detected: Suddi",
  "body": "Suddi is showing strong oestrus signs (sound + activity confirmed). Schedule AI within 12-18 hours!",
  "data": {
    "type": "HEAT_DETECTED",
    "cow_id": "COW_105",
    "notification_id": "669abc123..."
  }
}
```

### WATCH → Push Notification  
```json
{
  "title": "👀 Oestrus Watch: Kalu",
  "body": "Kalu shows partial oestrus signals. Monitor closely.",
  "data": {
    "type": "HEAT_DETECTED",
    "cow_id": "COW_106",
    "notification_id": "669abc456..."
  }
}
```

### Cow Status Changes

| Decision | Cow Status Updated To | Description |
|----------|----------------------|-------------|
| `LIKELY_OESTRUS` | `HEAT_DETECTED` | Cow's status field changes |
| `WATCH` | *(unchanged)* | Just a notification, no status change |
| `NORMAL` | *(unchanged)* | No notification sent |

### HIGH_METHANE_WARNING → Push Notification
Sent if a cow's 10-minute methane session averages over **600 PPM**.
```json
{
  "title": "⚠️ High Methane Alert: Suddi",
  "body": "Suddi is exhibiting abnormally high methane levels (avg 645 PPM). Check for dietary or digestive issues.",
  "data": {
    "type": "HIGH_METHANE",
    "cow_id": "COW_105",
    "severity": "HIGH",
    "notification_id": "669abc789..."
  }
}
```

---

## 5. Gateway Telemetry Endpoints (Internal)

> [!NOTE]
> These are **NOT used by the Flutter app**. They are called by the Raspberry Pi gateway. Documented here for reference.

### 5.1 Activity Prediction

**Endpoint:** `POST /gateway/telemetry/activity-prediction`
**Auth:** `x-gateway-token` or `Authorization: Bearer <gateway_token>`

```json
{
  "gateway_id": "GW_001",
  "cow_id": "COW_105",
  "mac_address": "A4:CF:12:89:C3:D1",
  "timestamp": "2026-07-18T12:00:00Z",
  "features": {
    "mean_acc": 1.23, "std_acc": 0.45, "min_acc": 0.1, "max_acc": 3.4,
    "energy_acc": 15.6, "mean_gyro": 0.8, "std_gyro": 0.3, "min_gyro": 0.01,
    "max_gyro": 2.1, "energy_gyro": 8.9
  },
  "predicted_activity": "walking",
  "activity_state": "normal_activity",
  "confidence": 0.92,
  "battery": 85.0,
  "rssi_dbm": -65,
  "snr_db": 8.5
}
```

### 5.2 Sound Prediction

**Endpoint:** `POST /gateway/telemetry/sound-prediction`

```json
{
  "gateway_id": "GW_001",
  "mac_address": "A4:CF:12:89:C3:D1",
  "timestamp": "2026-07-18T12:05:00Z",
  "event_start_ms": 123456789,
  "oestrus_probability": 0.78,
  "label": "likely_oestrus",
  "rssi_dbm": -65,
  "snr_db": 8.5
}
```

### 5.3 Environment Reading

**Endpoint:** `POST /gateway/telemetry/environment`

```json
{
  "gateway_id": "GW_001",
  "timestamp": "2026-07-18T12:00:00Z",
  "uptime_ms": 3600000,
  "temperature_c": 32.5,
  "humidity_percent": 78.0,
  "valid": true
}
```

### 5.4 Status Heartbeat

**Endpoint:** `POST /gateway/telemetry/status`

```json
{
  "gateway_id": "GW_001",
  "cow_id": "COW_105",
  "mac_address": "A4:CF:12:89:C3:D1",
  "lat": 6.142023,
  "lon": 80.123045,
  "uptime_ms": 3600000,
  "battery": 85.0,
  "gps_age_ms": 500,
  "rssi_dbm": -65,
  "snr_db": 8.5
}
```

### 5.5 Oestrus Fusion

**Endpoint:** `POST /gateway/telemetry/oestrus-fusion`

```json
{
  "gateway_id": "GW_001",
  "cow_id": "COW_105",
  "mac_address": "A4:CF:12:89:C3:D1",
  "decision": "LIKELY_OESTRUS",
  "sound_label": "likely_oestrus",
  "sound_probability": 0.85,
  "activity_label": "mounting",
  "activity_state": "high_activity",
  "temperature_c": 28.5,
  "humidity_percent": 72.0,
  "rssi_dbm": -65,
  "snr_db": 8.5
}
```

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE LAYER (Farm)                             │
│                                                                 │
│  ┌──────────────┐    LoRa 433MHz    ┌──────────────────────┐   │
│  │ 🐄 ESP32-S3  │ ──────────────▶ │  🔌 Raspberry Pi     │   │
│  │  Smart Collar │   ACT, PRED,    │  Base Station         │   │
│  │              │   ENV, status    │                        │   │
│  │ Sound Model  │                  │  Activity Model (ML)  │   │
│  │ (on-device)  │                  │  Fusion Algorithm      │   │
│  └──────────────┘                  │                        │   │
│                                    │  cloud_uploader.py     │   │
│  ┌──────────────┐   WebSocket       │  ├─ JWT Auth           │   │
│  │ 🏗️ ESP32-S3  │ ──────────────▶ │  ├─ WebSocket Server   │   │
│  │ Methane Tower│   JSON payload   │  ├─ Queue + Retry      │   │
│  └──────────────┘                  │  └─ Background Thread  │   │
│                                    └────────┬───────────────┘   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │ HTTPS POST
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUD BACKEND                                │
│                                                                 │
│  POST /gateway/telemetry/activity-prediction ──▶ InfluxDB      │
│  POST /gateway/telemetry/sound-prediction ────▶ InfluxDB       │
│  POST /gateway/telemetry/environment ─────────▶ InfluxDB + THI │
│  POST /gateway/telemetry/status ──────────────▶ MongoDB (cow)  │
│  POST /gateway/telemetry/oestrus-fusion ──────▶ MongoDB + FCM  │
│  POST /gateway/telemetry/methane/session ─────▶ MongoDB + FCM  │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ 🍃 MongoDB     │  │ 📊 InfluxDB    │  │ 🔔 Firebase FCM │  │
│  │ MethaneSession │  │ methane_sample │  │ Push to farmer  │  │
│  │ OestrusAlert   │  │ activity_pred  │  │ when OESTRUS or │  │
│  │ HealthEvent    │  │ sound_pred     │  │ HIGH METHANE    │  │
│  │ Cow (status)   │  │ oestrus_fusion │  │ detected        │  │
│  └────────────────┘  └────────────────┘  └─────────────────┘  │
│                                                                 │
│                     ▼ Flutter App APIs ▼                        │
│                                                                 │
│  GET /cows/oestrus/active ─────────▶ Dashboard active alerts   │
│  GET /cows/:id/predictions/latest ─▶ Latest AI predictions     │
│  GET /cows/:id/predictions/history ▶ Chart data                │
│  GET /cows/:id/oestrus/alerts ─────▶ Alert history             │
└─────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                                     ┌──────────────┐
                                     │ 📱 Flutter   │
                                     │  Mobile App   │
                                     └──────────────┘
```

---

> **Document Version:** 2.0 · **Last Updated:** July 2026
