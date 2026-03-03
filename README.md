# 🐄 Pattiya Smart Cattle Ecosystem — Backend

> **Cloud backend** for the Pattiya IoT platform.  
> Node.js · Express · MongoDB · InfluxDB · MQTT · Firebase Cloud Messaging

This guide is written for the **Mobile App Developer** who needs to get this backend running locally so the mobile app APIs can be tested end-to-end.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [Database Initialization & Seeding](#database-initialization--seeding)
- [Running the Server](#running-the-server)
- [API Testing Notes](#api-testing-notes)
- [Project Structure](#project-structure)
- [Available npm Scripts](#available-npm-scripts)

---

## Prerequisites

Ensure the following software is installed and running on your machine **before** you begin.

| Software | Version | Notes |
|---|---|---|
| **Node.js** | v18+ (LTS recommended) | [Download](https://nodejs.org). Includes `npm`. |
| **MongoDB** | 6.x / 7.x | Run locally (`mongod`) or use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier). The default connection string expects `localhost:27017`. |
| **InfluxDB 2.x** | 2.7+ | [Download](https://portal.influxdata.com/downloads/). After install, run through the initial setup UI at `http://localhost:8086` to create an Org (`pattiya`), Bucket (`sensor_data`), and an **API Token**. Set bucket retention to **90 days**. |
| **MQTT Broker** *(optional)* | Mosquitto 2.x | Only needed if you want to test live telemetry ingestion from a gateway device. Not required for REST API testing. |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/pattiya-backend.git
cd pattiya-backend

# 2. Install dependencies
npm install
```

---

## Environment Setup

The backend reads configuration from a `.env` file in the project root.

### 1. Create your `.env` file

```bash
# Copy the example template
cp .env.example .env        # macOS / Linux
copy .env.example .env       # Windows (cmd)
```

### 2. `.env.example` — Full Template

```env
# ============================================================
# Pattiya Backend - Environment Configuration
# Copy this file to .env and fill in your values
# ============================================================

# --- Server ---
PORT=5000
NODE_ENV=development

# --- MongoDB ---
MONGODB_URI=mongodb://localhost:27017/pattiya

# --- InfluxDB 2.x ---
# Set bucket retention to 90 days (3 months) in the InfluxDB Admin UI
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your_influxdb_token_here
INFLUXDB_ORG=pattiya
INFLUXDB_BUCKET=sensor_data

# --- MQTT Broker ---
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=

# --- JWT ---
JWT_SECRET=change_this_to_a_random_secret
JWT_REFRESH_SECRET=change_this_to_another_random_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# --- Firebase Cloud Messaging ---
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

### 3. Minimum values to change

| Variable | What to do |
|---|---|
| `INFLUXDB_TOKEN` | Paste the API token generated during InfluxDB's initial setup wizard. |
| `JWT_SECRET` | Replace with any random string (e.g. `openssl rand -hex 32`). |
| `JWT_REFRESH_SECRET` | A **different** random string from `JWT_SECRET`. |

> **Tip:** MongoDB URI and InfluxDB defaults work out-of-the-box if both services are running locally with default ports. Firebase and MQTT variables can be left blank for basic REST API testing.

---

## Database Initialization & Seeding

The project ships with a seed script that creates a **Farm**, **Admin user**, **Worker user**, **Gateway**, and **Demo cows** in MongoDB so you can start calling APIs immediately — no manual database setup required.

```bash
npm run seed
```

Or equivalently:

```bash
node scripts/seed.js
```

### What gets created

| Entity | Key Details |
|---|---|
| **Farm** | `RIDIYAGAMA_01` — NLDB Ridiyagama Farm |
| **Admin User** | Username: `manager_kasun` · Password: `admin123` |
| **Worker User** | Username: `worker_nimal` · Password: `worker123` |
| **Gateway** | ID: `GW_001` · Secret: `gw_secret_ridiyagama_001` |
| **Cows (×3)** | Suddi, Kalu, Raththi — with collar MAC addresses |

> The script is **idempotent** — running it multiple times will skip entities that already exist. No data will be duplicated.

---

## Running the Server

### Development mode (auto-restart on file changes)

```bash
npm run dev
```

This uses **nodemon** to watch for file changes and automatically restart the server.

### Production mode

```bash
npm start
```

On a successful boot you will see:

```
═══════════════════════════════════════════
  🐄 Pattiya Smart Cattle Backend
  Environment : development
═══════════════════════════════════════════

[Server] 🚀 Pattiya Backend listening on port 5000
[Server] Health check → http://localhost:5000/api/v1/health
```

---

## API Testing Notes

### Base URL

```
http://localhost:5000/api/v1
```

All REST endpoints are prefixed under `/api/v1`.

### Health Check

```bash
curl http://localhost:5000/api/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "pattiya-backend",
  "timestamp": "2026-03-03T12:00:00.000Z"
}
```

### Login (first test)

Use the seeded Admin credentials to obtain a JWT token:

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "farm_code": "RIDIYAGAMA_01",
    "username": "manager_kasun",
    "password": "admin123"
  }'
```

The response will include an **access token** and a **refresh token**. Include the access token in subsequent requests:

```
Authorization: Bearer <access_token>
```

### Mounted Routes

| Route | Description |
|---|---|
| `POST /api/v1/auth/login` | Login & obtain JWT tokens |
| `POST /api/v1/auth/refresh` | Refresh an expired access token |
| `/api/v1/cows` | Cow management (CRUD, telemetry, health events) |
| `/api/v1/gateway` | Gateway registration & batch telemetry ingestion |
| `/api/v1/user` | User profile management |
| `/api/v1/farm` | Farm settings & geofence configuration |
| `/api/v1/notifications` | Push notification preferences & history |
| `/api/v1/system` | App metadata, version info, dropdown options |

> **Note:** Most routes (except `/auth/login` and `/health`) require a valid `Authorization: Bearer <token>` header and are scoped to the user's farm via multi-tenant middleware.

---

## Project Structure

```
pattiya-backend/
├── scripts/
│   └── seed.js              # DB seed script (Farm + Users + Gateway + Cows)
├── src/
│   ├── app.js               # Express app setup & middleware
│   ├── server.js            # Boot sequence (Mongo → Influx → Firebase → MQTT → Express)
│   ├── config/              # DB connections & environment config
│   ├── controllers/         # Route handlers (business logic)
│   ├── middleware/           # Auth, tenant scoping, validation, file upload
│   ├── models/              # Mongoose schemas (Farm, User, Cow, Gateway, etc.)
│   ├── routes/              # Express route definitions
│   ├── services/            # MQTT handler, FCM, heat-detection cron
│   └── utils/               # Helpers (error classes, response wrappers)
├── tests/                   # Test files
├── .env.example             # Environment variable template
├── package.json
└── README.md                # ← You are here
```

---

## Available npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start in development mode with nodemon (auto-reload) |
| `npm start` | Start in production mode |
| `npm run seed` | Seed the database with demo Farm, Users, Gateway & Cows |
| `npm run lint` | Run ESLint on the `src/` directory |

---

<p align="center">
  <strong>Pattiya Smart Cattle Ecosystem</strong><br/>
  Built with ❤️ for smarter livestock management
</p>