# 🐄 Pattiya Smart Cattle Ecosystem — Backend Architecture & Database Design

> **Version:** 1.0 · **Stack:** Node.js / Express / MongoDB / InfluxDB / MQTT / FCM
> **Authors:** Pattiya Engineering Team

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure (MVC)](#2-project-structure-mvc)
3. [Boot Sequence & Lifecycle](#3-boot-sequence--lifecycle)
4. [Database Design — Polyglot Persistence](#4-database-design--polyglot-persistence)
5. [MongoDB Schema Design](#5-mongodb-schema-design)
6. [InfluxDB Time-Series Design](#6-influxdb-time-series-design)
7. [Authentication Architecture](#7-authentication-architecture)
8. [Telemetry Ingestion Pipeline](#8-telemetry-ingestion-pipeline)
9. [MQTT Real-Time Layer](#9-mqtt-real-time-layer)
10. [Background Jobs & Alerting](#10-background-jobs--alerting)
11. [API Route Architecture](#11-api-route-architecture)
12. [Deployment Architecture](#12-deployment-architecture)

---

## 1. System Overview

Pattiya is a **Multi-Tenant SaaS IoT platform** for dairy farmers. It monitors cattle health via smart collars that communicate with ESP32 LoRa gateways, which relay data to a cloud backend.

### High-Level Architecture

```mermaid
graph TB
    subgraph "Edge Layer"
        COLLAR["🐄 Smart Collar<br/>(LoRa + Sensors)"]
        ESP["🔌 ESP32 Gateway<br/>(LoRa ↔ WiFi Bridge)"]
    end

    subgraph "Cloud Backend"
        EXPRESS["⚡ Express.js API Server<br/>Port 5000"]
        MONGO[("🍃 MongoDB Atlas<br/>Structured Data")]
        INFLUX[("📊 InfluxDB Cloud<br/>Time-Series Data")]
        MQTT_BROKER["📡 MQTT Broker<br/>(HiveMQ Cloud)"]
        FCM["🔔 Firebase FCM<br/>(Push Notifications)"]
        CRON["⏰ Cron Jobs<br/>(Heat Detection)"]
    end

    subgraph "Client Layer"
        APP["📱 Flutter Mobile App"]
    end

    COLLAR -- "LoRa 433MHz" --> ESP
    ESP -- "REST API (HTTPS)<br/>Batch Telemetry" --> EXPRESS
    ESP <-- "MQTT (TLS 8883)<br/>Commands & Alerts" --> MQTT_BROKER
    EXPRESS <-- "MQTT Pub/Sub" --> MQTT_BROKER
    EXPRESS --> MONGO
    EXPRESS --> INFLUX
    EXPRESS --> FCM
    CRON --> MONGO
    CRON --> INFLUX
    CRON --> FCM
    APP -- "REST API (HTTPS)<br/>JWT Auth" --> EXPRESS
    FCM -- "Push Notifications" --> APP
```

### Design Rationale

| Decision | Reasoning |
|---|---|
| **Node.js + Express** | Non-blocking I/O handles high-frequency IoT telemetry efficiently. JSON-native aligns with MQTT/REST payloads. |
| **Polyglot Persistence** | MongoDB for structured data (users, cows, farms), InfluxDB for high-frequency sensor data. Each database excels at its workload. |
| **MQTT** | Sub-second latency for geofence breach alerts and real-time edge commands. HTTP batching alone introduces a 20-minute delay. |
| **Multi-Tenant via `farm_id`** | Every model includes a `farm_id` field. Simpler than database-per-tenant, with good isolation via compound indexes. |
| **JWT Dual-Track Auth** | Mobile app users get short-lived access + refresh tokens. ESP32 gateways get 24-hour tokens with hardware secret verification. |

---

## 2. Project Structure (MVC)

```
pattiya-backend/
├── src/
│   ├── config/              # Database & service connections
│   │   ├── index.js         # Central config loader (dotenv → frozen object)
│   │   ├── mongodb.js       # Mongoose connection + reconnect logic
│   │   ├── influxdb.js      # InfluxDB 2.x client (write/query APIs)
│   │   └── mqtt.js          # MQTT client with auto-reconnect
│   │
│   ├── middleware/           # Request pipeline interceptors
│   │   ├── auth.js           # JWT auth for mobile app users + role check
│   │   ├── gatewayAuth.js    # JWT auth for ESP32 gateways (dual header)
│   │   ├── asyncHandler.js   # Wraps async controllers for error propagation
│   │   └── validate.js       # Joi schema validation factory
│   │
│   ├── models/               # Mongoose schemas (8 models)
│   │   ├── Farm.js           # Farm profiles + geofence settings
│   │   ├── User.js           # Users with bcrypt + FCM tokens
│   │   ├── Cow.js            # Cow profiles + collar pairing
│   │   ├── Gateway.js        # ESP32 base stations
│   │   ├── HealthEvent.js    # Vet records + auto-generated events
│   │   ├── MilkRecord.js     # Daily milk production
│   │   ├── Notification.js   # Push alert history
│   │   └── RefreshToken.js   # JWT refresh tokens with TTL
│   │
│   ├── controllers/          # Request handlers (business logic)
│   │   ├── authController.js
│   │   ├── cowController.js
│   │   ├── gatewayController.js
│   │   ├── farmController.js
│   │   ├── userController.js
│   │   ├── notificationController.js
│   │   └── systemController.js
│   │
│   ├── routes/               # Express route definitions
│   │   ├── auth.js           # /api/v1/auth/*
│   │   ├── cows.js           # /api/v1/cows/*
│   │   ├── gateway.js        # /api/v1/gateway/*
│   │   ├── farm.js           # /api/v1/farm/*
│   │   ├── user.js           # /api/v1/user/*
│   │   ├── notifications.js  # /api/v1/notifications/*
│   │   └── system.js         # /api/v1/system/*
│   │
│   ├── services/             # Shared business logic & background jobs
│   │   ├── influxService.js  # InfluxDB write/query abstraction
│   │   ├── fcmService.js     # Firebase push notification sender
│   │   ├── mqttHandler.js    # MQTT subscribe/publish (PART C)
│   │   └── heatDetectionCron.js  # 30-min estrus detection job
│   │
│   ├── utils/
│   │   ├── AppError.js       # Custom operational error class
│   │   └── thi.js            # THI (Temperature-Humidity Index) calculator
│   │
│   ├── app.js                # Express app setup + middleware stack
│   └── server.js             # Entry point + graceful shutdown
│
├── scripts/
│   └── seed.js               # Database seeder (Farm, Users, Gateway, Cows)
├── uploads/                  # Cow image uploads (multer)
├── .env                      # Environment variables
└── package.json
```

### Why MVC?

The Model-View-Controller pattern separates concerns:

- **Models** define data shape and validation (Mongoose schemas with pre-save hooks)
- **Controllers** handle HTTP request/response logic
- **Services** encapsulate reusable business logic (InfluxDB writes, FCM sending, MQTT publishing)
- **Routes** define URL mappings and middleware chains

This makes it easy for the mobile app developer to understand which endpoint does what, and for the IoT developer to work on gateway-specific code independently.

---

## 3. Boot Sequence & Lifecycle

```mermaid
sequenceDiagram
    participant S as server.js
    participant DB as MongoDB
    participant IX as InfluxDB
    participant MQ as MQTT Broker
    participant EX as Express App
    participant CR as Cron Scheduler

    S->>DB: mongoose.connect()
    DB-->>S: ✅ Connected

    S->>IX: pingInfluxDB()
    IX-->>S: ✅ Reachable (Flux query)

    S->>MQ: mqtt.connect()
    MQ-->>S: ✅ Connected

    S->>MQ: initMQTTHandler()
    Note over S,MQ: Subscribe to farm/+/gateway/+/alerts

    S->>CR: startHeatDetectionCron()
    Note over CR: Runs every 30 minutes

    S->>EX: app.listen(PORT)
    EX-->>S: 🚀 Listening on port 5000

    Note over S: Graceful Shutdown Handler
    S->>EX: server.close()
    S->>DB: mongoose.disconnect()
    S->>MQ: client.end()
```

### Graceful Shutdown

The server intercepts `SIGTERM` and `SIGINT` signals to:
1. Stop accepting new HTTP connections
2. Close MongoDB connection pool
3. Disconnect MQTT client cleanly
4. Exit process with code 0

This prevents data corruption during deployments and container restarts.

---

## 4. Database Design — Polyglot Persistence

### Why Two Databases?

```mermaid
graph LR
    subgraph "MongoDB (Document Store)"
        direction TB
        M1["Users & Auth"]
        M2["Farm Profiles"]
        M3["Cow Profiles"]
        M4["Health Events"]
        M5["Notifications"]
        M6["Milk Records"]
    end

    subgraph "InfluxDB (Time-Series)"
        direction TB
        I1["Vitals Telemetry<br/>(methane, temp, humidity)"]
        I2["Activity Telemetry<br/>(steps, motion, resting)"]
        I3["Environment Data<br/>(DHT22 ambient climate)"]
    end

    style M1 fill:#4DB33D,color:#fff
    style M2 fill:#4DB33D,color:#fff
    style M3 fill:#4DB33D,color:#fff
    style M4 fill:#4DB33D,color:#fff
    style M5 fill:#4DB33D,color:#fff
    style M6 fill:#4DB33D,color:#fff
    style I1 fill:#22ADF6,color:#fff
    style I2 fill:#22ADF6,color:#fff
    style I3 fill:#22ADF6,color:#fff
```

| Criteria | MongoDB | InfluxDB |
|---|---|---|
| **Data Type** | Structured entities with relationships | High-frequency time-stamped measurements |
| **Write Pattern** | Low frequency (user actions, events) | High frequency (every 20-30 min per cow, batched) |
| **Read Pattern** | Random access by ID, complex queries | Range scans by time window, aggregation |
| **Retention** | Permanent (or soft-delete) | 90-day auto-purge (raw data) |
| **Indexing** | Compound B-tree indexes on `farm_id` + entity ID | Tag-based indexing on `farm_id`, `mac`, `gateway` |

### Data Flow Decision Tree

```mermaid
flowchart TD
    A["Incoming Data"] --> B{Is it a time-stamped<br/>sensor reading?}
    B -- Yes --> C["Write to InfluxDB<br/>(fast path)"]
    B -- No --> D{Is it a user action<br/>or entity change?}
    D -- Yes --> E["Write to MongoDB"]
    D -- No --> F{Is it a notification<br/>or alert?}
    F -- Yes --> G["MongoDB + FCM Push"]
    C --> H{Does it exceed<br/>a threshold?}
    H -- "Methane > 600 PPM" --> G
    H -- "THI > 72" --> G
    H -- No --> I["Done"]
```

---

## 5. MongoDB Schema Design

### Entity Relationship Diagram

```mermaid
erDiagram
    FARM ||--o{ USER : "has"
    FARM ||--o{ COW : "owns"
    FARM ||--o{ GATEWAY : "deploys"
    FARM ||--o{ NOTIFICATION : "receives"
    COW ||--o{ HEALTH_EVENT : "has"
    COW ||--o{ MILK_RECORD : "produces"
    USER ||--o{ REFRESH_TOKEN : "holds"

    FARM {
        string farm_id PK
        string farm_code UK
        string farm_name
        string logo_url
        string theme_color
        object geofence
        boolean is_active
    }

    USER {
        ObjectId _id PK
        string farm_id FK
        string username
        string email
        string password
        string name
        string phone
        string role
        array fcm_tokens
        object notification_settings
        date deletion_scheduled_at
        boolean is_active
    }

    COW {
        ObjectId _id PK
        string farm_id FK
        string cow_id UK
        string name
        string collar_mac
        string breed
        date dob
        number weight_kg
        string status
        string image_url
        object last_location
        number battery_percentage
        string battery_status
        boolean is_active
    }

    GATEWAY {
        ObjectId _id PK
        string farm_id FK
        string gateway_id UK
        string hardware_secret
        string name
        date last_seen
        boolean is_active
    }

    HEALTH_EVENT {
        ObjectId _id PK
        string farm_id FK
        string cow_id FK
        string event_type
        date date
        string notes
        number cost
        boolean auto_generated
    }

    MILK_RECORD {
        ObjectId _id PK
        string farm_id FK
        string cow_id FK
        date date
        string session
        number liters
    }

    NOTIFICATION {
        ObjectId _id PK
        string farm_id FK
        string cow_id
        string type
        string title
        string message
        string severity
        object data
        boolean is_read
    }

    REFRESH_TOKEN {
        ObjectId _id PK
        string token UK
        ObjectId user_id FK
        string farm_id FK
        date expires_at
        boolean is_revoked
    }
```

### Model Details

---

#### 5.1 Farm Model

**Purpose:** Represents a dairy farm (tenant). All other entities belong to a farm.

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required, Unique, Indexed | Application-level identifier (e.g. `FARM_UUID_12345`) |
| `farm_code` | String | Required, Unique, Uppercase | Human-readable code for tenant resolution (e.g. `RIDIYAGAMA_01`) |
| `farm_name` | String | Required | Display name |
| `logo_url` | String | Default: `''` | Farm branding for mobile app |
| `theme_color` | String | Default: `'#4CAF50'` | App theme color per tenant |
| `geofence.center_lat` | Number | Default: `0` | Geofence center latitude |
| `geofence.center_lng` | Number | Default: `0` | Geofence center longitude |
| `geofence.radius_meters` | Number | Default: `500` | Virtual boundary radius |
| `geofence.is_active` | Boolean | Default: `false` | Toggle geofence monitoring |
| `is_active` | Boolean | Default: `true` | Soft delete flag |

**Design Reasoning:** The geofence is embedded (not a separate collection) because there's exactly one geofence per farm — embedding avoids a join and keeps the data co-located.

---

#### 5.2 User Model

**Purpose:** Farm workers and managers. Scoped to a specific farm.

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required, Indexed | Tenant isolation |
| `username` | String | Required, Lowercase | Login identifier |
| `email` | String | Required, Lowercase | Password recovery |
| `password` | String | Required, Min 6 | Bcrypt-hashed (12 rounds) |
| `name` | String | Required | Display name |
| `phone` | String | Default: `''` | Contact number |
| `role` | String | Enum: `admin`, `user` | Authorization level |
| `fcm_tokens` | Array | `[{token, device_os, created_at}]` | Push notification targets |
| `notification_settings` | Object | `{alert_heat, alert_theft, alert_low_battery}` | Per-user alert preferences |
| `reset_code` | String | Optional | 6-digit password reset code |
| `reset_code_expires` | Date | Optional | Reset code TTL (15 min) |
| `deletion_scheduled_at` | Date | Optional | 30-day grace period for account deletion |
| `is_active` | Boolean | Default: `true` | Soft delete |

**Indexes:**
- Compound unique: `{ farm_id: 1, username: 1 }` — username unique per farm
- Compound unique: `{ farm_id: 1, email: 1 }` — email unique per farm

**Security Features:**
- `pre('save')` hook auto-hashes passwords with bcrypt (12 salt rounds)
- `comparePassword()` instance method for login verification
- `toJSON()` method strips `password`, `reset_code` from API responses

**Design Reasoning:** FCM tokens are embedded as an array because a user may have multiple devices (phone + tablet). Notification settings are embedded because they're always read with the user profile.

---

#### 5.3 Cow Model

**Purpose:** Individual cow profiles with real-time collar status.

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required, Indexed | Tenant isolation |
| `cow_id` | String | Required, Unique | App-level identifier (e.g. `COW_M1A2B3`) |
| `name` | String | Required, Trim | Cow name |
| `image_url` | String | Default: `''` | Uploaded cow photo |
| `breed` | String | Default: `''` | Breed (Jersey, Friesian, etc.) |
| `dob` | Date | Optional | Date of birth |
| `weight_kg` | Number | Default: `0` | Current weight in kg |
| `collar_mac` | String | Default: `''`, Uppercase, Trim | Paired BLE MAC address |
| `status` | String | Enum, Default: `HEALTHY` | Current health/alert status |
| `battery_percentage` | Number | Default: `100` | Collar battery level |
| `battery_status` | String | Enum, Default: `NORMAL` | Derived battery state |
| `last_location.lat` | Number | Default: `0` | Latest GPS latitude |
| `last_location.lng` | Number | Default: `0` | Latest GPS longitude |
| `last_update` | Date | Default: `Date.now` | Last telemetry timestamp |
| `radius_meters` | Number | Default: `1000` | Per-cow geofence override |
| `is_active` | Boolean | Default: `true` | False = unpaired/sold |
| `unpair_reason` | String | Enum, Default: `''` | Reason for deactivation |
| `unpair_notes` | String | Default: `''` | Additional notes |
| `unpaired_at` | Date | Optional | Deactivation timestamp |

**Status Enum:** `HEALTHY`, `HEAT_DETECTED`, `SICK`, `THEFT_ALERT`, `LOW_BATTERY`, `OFFLINE`

**Unpair Reason Enum:** `SOLD`, `DIED`, `COLLAR_BROKEN`, `MISTAKE`, `''`

**Battery Status Enum:** `NORMAL`, `LOW`, `CRITICAL`

**Indexes:**
- `{ farm_id: 1, status: 1 }` — dashboard filtering by status
- `{ farm_id: 1, collar_mac: 1 }` — telemetry MAC lookups
- `{ farm_id: 1, is_active: 1 }` — active cow queries

**Design Reasoning:** `last_location`, `battery_percentage`, and `status` are denormalized here (even though they come from telemetry) so the mobile app dashboard can query a single collection for the cow list without joining InfluxDB. These fields are updated asynchronously in the "slow path" of telemetry ingestion. The `radius_meters` field allows per-cow geofence overrides — useful when a cow is in a different paddock.

---

#### 5.4 Gateway Model

**Purpose:** ESP32 LoRa base stations that relay collar data.

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required, Indexed | Tenant isolation |
| `gateway_id` | String | Required, Unique | Device identifier (e.g. `GW_001`) |
| `hardware_secret` | String | Required | Bcrypt-hashed secret for authentication |
| `name` | String | Default: `''` | Human label |
| `last_seen` | Date | Optional | Last heartbeat timestamp |
| `is_active` | Boolean | Default: `true` | Deployment status |

**Security:** The `hardware_secret` is stored hashed (bcrypt). During gateway login, the plain-text secret from the ESP32 is compared using `bcrypt.compare()` — the raw secret is never stored.

---

#### 5.5 HealthEvent Model

**Purpose:** Digital vet card — both manual entries and auto-generated alerts.

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required | Tenant isolation |
| `cow_id` | String | Required | Target cow |
| `event_type` | String | Enum | `VACCINATION`, `TREATMENT`, `ARTIFICIAL_INSEMINATION`, `BIRTH` |
| `date` | Date | Required | Event date |
| `notes` | String | Default: `''` | Details or auto-generated alert text |
| `cost` | Number | Default: `0` | Veterinary cost |
| `auto_generated` | Boolean | Default: `false` | True for system-created events (heat, methane) |

**Indexes:** `{ farm_id: 1, cow_id: 1, date: -1 }` — efficient time-ordered lookups per cow

---

#### 5.6 MilkRecord Model

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required | Tenant isolation |
| `cow_id` | String | Required | Producing cow |
| `date` | Date | Required | Production date |
| `session` | String | Enum: `MORNING`, `EVENING` | Milking session |
| `liters` | Number | Required | Volume produced |

**Unique Index:** `{ farm_id: 1, cow_id: 1, date: 1, session: 1 }` — prevents duplicate entries for the same cow/date/session.

---

#### 5.7 Notification Model

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `farm_id` | String | Required, Indexed | Tenant isolation |
| `cow_id` | String | Default: `''` | Related cow (empty for farm-level alerts) |
| `type` | String | Enum | `HEAT_DETECTED`, `GEOFENCE_BREACH`, `SYSTEM`, etc. |
| `title` | String | Required | Short display title |
| `message` | String | Required | Full alert message |
| `severity` | String | Enum: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | Priority level |
| `data` | Mixed | Optional | Structured payload (methane PPM, THI, etc.) |
| `is_read` | Boolean | Default: `false` | Read status in app |

---

#### 5.8 RefreshToken Model

| Field | Type | Constraints | Purpose |
|---|---|---|---|
| `token` | String | Required, Unique | Opaque hex string (80 chars) |
| `user_id` | ObjectId | Required, Indexed | Owner reference |
| `farm_id` | String | Required | Tenant context |
| `expires_at` | Date | Required, **TTL Index** | Auto-deleted by MongoDB after expiry |
| `is_revoked` | Boolean | Default: `false` | Explicit revocation flag |

**Design Reasoning:** The TTL index on `expires_at` means MongoDB automatically garbage-collects expired tokens — no cron job needed. The `is_revoked` flag handles explicit logout.

---

## 6. InfluxDB Time-Series Design

### Measurements

```mermaid
graph TD
    subgraph "InfluxDB Bucket: sensor_data"
        subgraph "Measurement: vitals"
            V_TAGS["Tags: farm_id, mac, gateway"]
            V_FIELDS["Fields: temperature, humidity,<br/>methane_ppm, mic_mood,<br/>battery_percentage"]
        end

        subgraph "Measurement: activity"
            A_TAGS["Tags: farm_id, mac, gateway"]
            A_FIELDS["Fields: step_count,<br/>high_motion_events,<br/>resting_time_mins"]
        end

        subgraph "Measurement: environment"
            E_TAGS["Tags: farm_id, gateway"]
            E_FIELDS["Fields: ambient_temperature,<br/>ambient_humidity, thi"]
        end
    end
```

### Schema Detail

#### `vitals` (Per-cow sensor data, every 20 min)

| Component | Name | Type | Example |
|---|---|---|---|
| **Tag** | `farm_id` | String | `FARM_UUID_12345` |
| **Tag** | `mac` | String | `A4:CF:12:89:C3:D1` |
| **Tag** | `gateway` | String | `GW_001` |
| **Field** | `temperature` | Float | `38.5` (body temp °C) |
| **Field** | `humidity` | Float | `78.0` (collar sensor %) |
| **Field** | `methane_ppm` | Float | `450.2` |
| **Field** | `mic_mood` | String | `CALM`, `VOCALIZING` |
| **Field** | `battery_percentage` | Integer | `85` |

#### `activity` (Per-cow motion data, every 30 min)

| Component | Name | Type | Example |
|---|---|---|---|
| **Tag** | `farm_id` | String | `FARM_UUID_12345` |
| **Tag** | `mac` | String | `A4:CF:12:89:C3:D1` |
| **Tag** | `gateway` | String | `GW_001` |
| **Field** | `step_count` | Integer | `450` |
| **Field** | `high_motion_events` | Integer | `12` |
| **Field** | `resting_time_mins` | Integer | `10` |

#### `environment` (Farm-level ambient climate, per batch)

| Component | Name | Type | Example |
|---|---|---|---|
| **Tag** | `farm_id` | String | `FARM_UUID_12345` |
| **Tag** | `gateway` | String | `GW_001` |
| **Field** | `ambient_temperature` | Float | `32.5` (DHT22 °C) |
| **Field** | `ambient_humidity` | Float | `78.0` (DHT22 %) |
| **Field** | `thi` | Float | `81.3` (calculated THI) |

### Why Tags vs Fields?

- **Tags** are indexed — used in `WHERE` and `GROUP BY` clauses. We tag by `farm_id` and `mac` because every query filters by these.
- **Fields** are the actual measured values — not indexed, but stored efficiently for range scans.
- `mic_mood` is stored as a field (not tag) despite being a string because it has high cardinality patterns that would bloat the tag index.

### Retention Policy

Raw data is auto-purged after **90 days** (configurable via the InfluxDB bucket settings). For long-term analysis, significant events (heat detection, methane alerts) are also logged in MongoDB's `HealthEvent` collection permanently.

---

## 7. Authentication Architecture

### Dual-Track JWT System

```mermaid
flowchart TD
    subgraph "Mobile App Auth (Short-lived)"
        A1["POST /auth/login"] --> A2["Verify farm_id + username + password"]
        A2 --> A3["Generate access_token (15 min)<br/>+ refresh_token (7 days)"]
        A3 --> A4["Store refresh_token in MongoDB"]
        A4 --> A5["Return both tokens"]

        A6["POST /auth/refresh"] --> A7["Validate refresh_token"]
        A7 --> A8["Rotate: revoke old, issue new pair"]
    end

    subgraph "Gateway Auth (Long-lived)"
        B1["POST /gateway/auth/login"] --> B2["Verify gateway_id + hardware_secret<br/>(bcrypt compare)"]
        B2 --> B3["Generate gateway_access_token (24h)"]
        B3 --> B4["Return token + farm_id"]
    end
```

### Token Payload Structures

**Mobile App Token (`type: 'user'`):**
```json
{
  "userId": "ObjectId",
  "farmId": "FARM_UUID_12345",
  "role": "admin",
  "type": "user",
  "iat": 1719907200,
  "exp": 1719908100
}
```

**Gateway Token (`type: 'gateway'`):**
```json
{
  "gatewayId": "GW_001",
  "farmId": "FARM_UUID_12345",
  "type": "gateway",
  "iat": 1719907200,
  "exp": 1719993600
}
```

### Header Support

The `gatewayAuth` middleware accepts tokens from two headers (for ESP32 compatibility):
1. `Authorization: Bearer <token>` — standard
2. `x-gateway-token: <token>` — ESP32 convenience header

### Refresh Token Rotation

```mermaid
sequenceDiagram
    participant App as Mobile App
    participant API as Backend
    participant DB as MongoDB

    App->>API: POST /auth/refresh {refresh_token}
    API->>DB: Find token (not revoked, not expired)
    DB-->>API: Token document

    API->>DB: Set old token is_revoked = true
    API->>DB: Create new RefreshToken document
    API-->>App: {new access_token, new refresh_token}

    Note over DB: TTL index auto-deletes<br/>expired tokens
```

This rotation strategy means each refresh token is **single-use** — if an attacker steals a refresh token and it's already been rotated, the theft is detected and the session is invalidated.

---

## 8. Telemetry Ingestion Pipeline

### The Fast Path / Slow Path Architecture

This is the most critical design decision in the system. When the ESP32 gateway sends a batch of sensor data for 100 cows, the backend must respond quickly (the ESP32 has limited timeout tolerance) while also performing expensive operations (MongoDB updates, threshold evaluation, FCM notifications).

```mermaid
flowchart TD
    GW["ESP32 Gateway<br/>POST /telemetry/vitals/batch"] --> PARSE["Parse JSON body<br/>(up to 100 cow records)"]

    PARSE --> FAST["⚡ FAST PATH<br/>InfluxDB Batch Write"]
    FAST --> RESP["✅ 200 OK Response<br/>(returned to gateway)"]

    RESP --> SLOW["🐢 SLOW PATH (setImmediate)<br/>Runs AFTER response is sent"]

    SLOW --> S1["Update cow status in MongoDB<br/>(battery, GPS, last_update)"]
    SLOW --> S2["Evaluate methane thresholds"]
    SLOW --> S3["Extract DHT22 environment data"]

    S2 --> S2A{"> 600 PPM?"}
    S2A -- Yes --> ALERT1["Mark cow SICK<br/>+ Log HealthEvent<br/>+ FCM Push"]
    S2A -- No --> DONE1["Skip"]

    S3 --> S3A["Calculate THI"]
    S3A --> S3B{"> 72 THI?"}
    S3B -- Yes --> ALERT2["Log FARM_HEAT_STRESS_WARNING<br/>+ FCM Push"]
    S3B -- No --> DONE2["Skip"]

    style FAST fill:#2196F3,color:#fff
    style RESP fill:#4CAF50,color:#fff
    style SLOW fill:#FF9800,color:#fff
    style ALERT1 fill:#F44336,color:#fff
    style ALERT2 fill:#F44336,color:#fff
```

### Why This Design?

| Concern | Solution |
|---|---|
| **ESP32 timeout** | Respond in <500ms after InfluxDB flush |
| **Data durability** | InfluxDB batch write is atomic and fast |
| **MongoDB updates** | Run asynchronously via `setImmediate()` — doesn't block response |
| **Alert latency** | Alerts fire within seconds (not 20 min) because they run in the background immediately |
| **Error isolation** | If MongoDB is slow, the gateway still gets a 200 OK. Background errors are logged but don't affect telemetry ingestion. |

### THI Calculation (Temperature-Humidity Index)

```
THI = (1.8 × T + 32) − [(0.55 − 0.0055 × RH) × (1.8 × T − 26)]
```

| THI Range | Classification | Alert? |
|---|---|---|
| ≤ 68 | Normal | No |
| 68–72 | Mild | No |
| 72–78 | Moderate | ✅ Yes |
| 78–82 | Severe | ✅ Yes |
| > 82 | Danger | ✅ Yes (Critical) |

---

## 9. MQTT Real-Time Layer

### Topic Architecture

```mermaid
flowchart LR
    subgraph "Cloud → Edge (Commands)"
        direction TB
        T1["farm/{farm_id}/gateway/{gateway_id}/commands"]
        CMD_A["ADD_MAC<br/>New collar registered"]
        CMD_B["UPDATE_GEOFENCE<br/>Boundary changed"]
        CMD_C["REMOVE_MAC<br/>Collar unpaired"]
        T1 --- CMD_A
        T1 --- CMD_B
        T1 --- CMD_C
    end

    subgraph "Edge → Cloud (Alerts)"
        direction TB
        T2["farm/{farm_id}/gateway/{gateway_id}/alerts"]
        ALT_A["GEOFENCE_BREACH<br/>Cow outside boundary"]
        T2 --- ALT_A
    end
```

### Event Triggers

| MQTT Command | Triggered By | Action on ESP32 |
|---|---|---|
| `ADD_MAC` | Farmer registers new cow in app | Add MAC to EEPROM whitelist |
| `UPDATE_GEOFENCE` | Farmer changes boundary in app | Update Haversine formula variables |
| `REMOVE_MAC` | Farmer unpairs collar in app | Remove MAC from whitelist, stop processing LoRa packets |

### Publishing Strategy

When publishing commands, the backend queries MongoDB for **all active gateways** belonging to the farm and publishes to each gateway's specific topic individually:

```javascript
// Queries: Gateway.find({ farm_id, is_active: true })
// Publishes to: farm/{farm_id}/gateway/GW_001/commands
//               farm/{farm_id}/gateway/GW_002/commands
//               ... (one message per gateway)
```

This ensures messages reach only the correct gateways and avoids a broadcast topic that could leak data across farms.

---

## 10. Background Jobs & Alerting

### Heat Detection Cron (Every 30 Minutes)

```mermaid
flowchart TD
    CRON["⏰ node-cron: '*/30 * * * *'"] --> QUERY["Query InfluxDB:<br/>activity data for all active cows<br/>(last 2 hours)"]

    QUERY --> EVAL["For each cow, evaluate<br/>dual-validation algorithm"]

    EVAL --> CHECK1{"Motion score > threshold?<br/>(high_motion_events ≥ 8<br/>AND step_count ≥ 300)"}

    CHECK1 -- Yes --> CHECK2{"Vocalization confirmed?<br/>(mic_mood == 'VOCALIZING')"}
    CHECK1 -- No --> SKIP["Skip — normal activity"]

    CHECK2 -- Yes --> DETECT["🔴 HEAT DETECTED"]
    CHECK2 -- No --> SUSPECT["🟡 SUSPECTED<br/>(motion only, no vocalization)"]

    DETECT --> UPDATE["Set cow.status = 'HEAT_DETECTED'"]
    UPDATE --> LOG["Create HealthEvent<br/>(auto_generated: true)"]
    LOG --> NOTIFY["Create Notification<br/>+ FCM Push to farmer"]
```

### Dual-Validation Algorithm

The heat detection system requires **two independent signals** to confirm estrus, reducing false positives:

1. **Motion Analysis** (MPU6050 accelerometer): Elevated step count + high motion events indicate restlessness
2. **Vocalization Analysis** (MEMS microphone): The `mic_mood: 'VOCALIZING'` classification from the collar's edge ML model confirms behavioral change

This approach has significantly higher accuracy than single-signal detection systems used in traditional collar products.

### Alert Pipeline

```mermaid
flowchart LR
    TRIGGER["Alert Condition Met"] --> MONGO["Log to MongoDB<br/>(Notification + HealthEvent)"]
    MONGO --> FCM_CHECK["Check user<br/>notification_settings"]
    FCM_CHECK --> FCM_SEND["Send FCM Push<br/>to eligible users"]
    FCM_SEND --> CLEAN["Clean invalid<br/>FCM tokens"]
```

The FCM service respects per-user notification preferences:
- If `alert_heat: false`, heat alerts are suppressed for that user
- If `alert_theft: false`, geofence breach alerts are suppressed
- Invalid/expired FCM tokens are automatically cleaned from the user document

---

## 11. API Route Architecture

### Complete Endpoint Map

```mermaid
graph TD
    subgraph "Public (No Auth)"
        P1["GET /auth/resolve-tenant"]
        P2["POST /auth/login"]
        P3["POST /auth/refresh"]
        P4["POST /auth/forgot-password"]
        P5["POST /auth/reset-password"]
        P6["POST /gateway/auth/login"]
        P7["GET /system/metadata"]
        P8["GET /system/version"]
        P9["GET /health"]
    end

    subgraph "Mobile App (JWT User Auth)"
        M1["GET /cows/dashboard"]
        M2["GET /cows"]
        M3["GET /cows/:id"]
        M4["GET /cows/:id/history"]
        M5["POST /cows/register"]
        M6["POST /cows/:id/image"]
        M7["PUT /cows/:id"]
        M8["POST /cows/:id/unpair"]
        M9["GET /cows/locations"]
        M10["GET /cows/:id/methane/history"]
        M11["POST /cows/:id/events"]
        M12["GET /cows/:id/events"]
        M13["POST /cows/:id/milk"]
        M14["GET /cows/:id/milk/stats"]
        M15["PUT /farm/settings/geofence"]
        M16["GET /farm/environment/current"]
        M17["GET /farm/environment/history"]
        M18["POST /notifications/device"]
        M19["GET /notifications"]
        M20["PUT /notifications/settings"]
        M21["GET /user/profile"]
        M22["PUT /user/profile"]
        M23["DELETE /user/account"]
        M24["POST /auth/logout"]
    end

    subgraph "Gateway (JWT Gateway Auth)"
        G1["GET /gateway/whitelist"]
        G2["POST /gateway/telemetry/vitals/batch"]
        G3["POST /gateway/telemetry/activity/batch"]
        G4["GET /gateway/settings/geofence"]
        G5["POST /gateway/alerts/emergency"]
    end
```

### Middleware Chain

```mermaid
flowchart LR
    REQ["Incoming Request"] --> HELMET["helmet()<br/>Security headers"]
    HELMET --> CORS["cors()<br/>Cross-origin"]
    CORS --> COMPRESS["compression()<br/>Gzip"]
    COMPRESS --> MORGAN["morgan('dev')<br/>Logging"]
    MORGAN --> JSON["express.json()<br/>Body parser"]
    JSON --> ROUTER["Route Matching"]
    ROUTER --> AUTH{"Auth Required?"}
    AUTH -- "Mobile" --> JWT["auth middleware<br/>Verify user JWT"]
    AUTH -- "Gateway" --> GW_AUTH["gatewayAuth<br/>Verify gateway JWT"]
    AUTH -- "Public" --> CTRL["Controller"]
    JWT --> CTRL
    GW_AUTH --> CTRL
    CTRL --> RES["Response"]
    CTRL -- "Error" --> ERR["Global Error Handler"]
```

---

## 12. Deployment Architecture

### Cloud Deployment Topology

```mermaid
graph TB
    subgraph "DNS / CDN"
        DNS["api.pattiya.lk"]
    end

    subgraph "Compute"
        RENDER["Render / Railway<br/>Node.js Web Service"]
    end

    subgraph "Managed Databases"
        ATLAS["MongoDB Atlas<br/>M0 Free Tier<br/>ap-south-1"]
        INFLUX_CLOUD["InfluxDB Cloud<br/>Free Tier<br/>us-east-1"]
    end

    subgraph "Managed Services"
        HIVEMQ["HiveMQ Cloud<br/>MQTT Broker<br/>eu-central-1"]
        FIREBASE["Firebase<br/>Cloud Messaging"]
    end

    DNS --> RENDER
    RENDER --> ATLAS
    RENDER --> INFLUX_CLOUD
    RENDER <--> HIVEMQ
    RENDER --> FIREBASE

    style RENDER fill:#6C63FF,color:#fff
    style ATLAS fill:#4DB33D,color:#fff
    style INFLUX_CLOUD fill:#22ADF6,color:#fff
    style HIVEMQ fill:#FF9800,color:#fff
    style FIREBASE fill:#FFA000,color:#fff
```

### Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `PORT` | Server listen port | `5000` |
| `NODE_ENV` | Runtime mode | `development` / `production` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://...` |
| `INFLUXDB_URL` | InfluxDB endpoint | `https://...cloud2.influxdata.com` |
| `INFLUXDB_TOKEN` | InfluxDB auth token | `xR4kl8m...` |
| `INFLUXDB_ORG` | InfluxDB organization | `pattiya.ai` |
| `INFLUXDB_BUCKET` | InfluxDB bucket name | `sensor_data` |
| `MQTT_BROKER_URL` | MQTT broker endpoint | `mqtts://...hivemq.cloud:8883` |
| `MQTT_USERNAME` | MQTT credentials | `admin` |
| `MQTT_PASSWORD` | MQTT credentials | `***` |
| `JWT_SECRET` | Access token signing key | Random 64-char string |
| `JWT_REFRESH_SECRET` | Refresh token signing key | Random 64-char string |
| `JWT_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `FIREBASE_PROJECT_ID` | FCM project | `pattiya-cattle` |
| `FIREBASE_CLIENT_EMAIL` | FCM service account | `firebase-adminsdk-...` |
| `FIREBASE_PRIVATE_KEY` | FCM private key (PEM) | `-----BEGIN PRIVATE KEY-----\n...` |

---

> **Document Version:** 1.0 · **Last Updated:** July 2026
