/**
 * ═══════════════════════════════════════════════════════════
 *  Pattiya Backend — Database Seed Script
 *  
 *  Creates the initial Farm + Admin User + Demo Gateway
 *  so you can immediately test /auth/login
 *
 *  Usage:  node scripts/seed.js
 * ═══════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ─── Config ──────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pattiya';

const SEED_DATA = {
    farm: {
        farm_id: 'FARM_UUID_12345',
        farm_code: 'RIDIYAGAMA_01',
        farm_name: 'NLDB Ridiyagama Farm',
        logo_url: '',
        theme_color: '#4CAF50',
        geofence: {
            center_lat: 6.142023,
            center_lng: 80.123045,
            radius_meters: 500,
            is_active: true,
        },
    },
    admin: {
        username: 'manager_kasun',
        email: 'kasun@ridiyagama.lk',
        password: 'admin123',       // Will be hashed by pre-save hook
        name: 'Kasun Perera',
        phone: '+94771234567',
        role: 'admin',
    },
    worker: {
        username: 'worker_nimal',
        email: 'nimal@ridiyagama.lk',
        password: 'worker123',
        name: 'Nimal Silva',
        phone: '+94779876543',
        role: 'user',
    },
    gateway: {
        gateway_id: 'GW_001',
        hardware_secret: 'gw_secret_ridiyagama_001',  // Will be hashed
        name: 'Main Barn Gateway',
    },
    cows: [
        { name: 'Suddi', collar_mac: 'A4:CF:12:89:C3:D1', breed: 'Jersey', age_months: 36 },
        { name: 'Kalu', collar_mac: 'B2:DA:45:12:E4:C9', breed: 'Friesian', age_months: 48 },
        { name: 'Raththi', collar_mac: 'C1:E4:77:89:D2:A1', breed: 'Sahiwal', age_months: 24 },
    ],
};

// ─── Models (inline to avoid path issues) ────────────────

// We require models directly
const Farm = require('../src/models/Farm');
const User = require('../src/models/User');
const Gateway = require('../src/models/Gateway');
const Cow = require('../src/models/Cow');

// ─── Seed Logic ──────────────────────────────────────────

async function seed() {
    console.log('═══════════════════════════════════════════');
    console.log('  🌱 Pattiya Database Seeder');
    console.log(`  MongoDB: ${MONGODB_URI}`);
    console.log('═══════════════════════════════════════════\n');

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const farmId = SEED_DATA.farm.farm_id;

    // ── 1. Create Farm ──────────────────────────────────

    const existingFarm = await Farm.findOne({ farm_id: farmId });
    if (existingFarm) {
        console.log(`⚠️  Farm "${SEED_DATA.farm.farm_name}" already exists — skipping`);
    } else {
        await Farm.create(SEED_DATA.farm);
        console.log(`✅ Farm created: ${SEED_DATA.farm.farm_name} (code: ${SEED_DATA.farm.farm_code})`);
    }

    // ── 2. Create Admin User ────────────────────────────

    const existingAdmin = await User.findOne({ farm_id: farmId, username: SEED_DATA.admin.username });
    if (existingAdmin) {
        console.log(`⚠️  Admin user "${SEED_DATA.admin.username}" already exists — skipping`);
    } else {
        await User.create({ ...SEED_DATA.admin, farm_id: farmId });
        console.log(`✅ Admin user created: ${SEED_DATA.admin.username} / ${SEED_DATA.admin.password}`);
    }

    // ── 3. Create Worker User ───────────────────────────

    const existingWorker = await User.findOne({ farm_id: farmId, username: SEED_DATA.worker.username });
    if (existingWorker) {
        console.log(`⚠️  Worker user "${SEED_DATA.worker.username}" already exists — skipping`);
    } else {
        await User.create({ ...SEED_DATA.worker, farm_id: farmId });
        console.log(`✅ Worker user created: ${SEED_DATA.worker.username} / ${SEED_DATA.worker.password}`);
    }

    // ── 4. Create Gateway ───────────────────────────────

    const existingGw = await Gateway.findOne({ gateway_id: SEED_DATA.gateway.gateway_id });
    if (existingGw) {
        console.log(`⚠️  Gateway "${SEED_DATA.gateway.gateway_id}" already exists — skipping`);
    } else {
        const hashedSecret = await bcrypt.hash(SEED_DATA.gateway.hardware_secret, 12);
        await Gateway.create({
            farm_id: farmId,
            gateway_id: SEED_DATA.gateway.gateway_id,
            hardware_secret: hashedSecret,
            name: SEED_DATA.gateway.name,
        });
        console.log(`✅ Gateway created: ${SEED_DATA.gateway.gateway_id} (secret: ${SEED_DATA.gateway.hardware_secret})`);
    }

    // ── 5. Create Demo Cows ─────────────────────────────

    for (const cowData of SEED_DATA.cows) {
        const existingCow = await Cow.findOne({ collar_mac: cowData.collar_mac, farm_id: farmId });
        if (existingCow) {
            console.log(`⚠️  Cow "${cowData.name}" already exists — skipping`);
        } else {
            const cowId = `COW_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
            const dob = new Date(Date.now() - cowData.age_months * 30 * 24 * 60 * 60 * 1000);
            await Cow.create({
                farm_id: farmId,
                cow_id: cowId,
                name: cowData.name,
                collar_mac: cowData.collar_mac,
                breed: cowData.breed,
                dob,
            });
            console.log(`✅ Cow created: ${cowData.name} (MAC: ${cowData.collar_mac})`);
            // Small delay so cow_id timestamps differ
            await new Promise(r => setTimeout(r, 50));
        }
    }

    // ── Done ────────────────────────────────────────────

    console.log('\n═══════════════════════════════════════════');
    console.log('  🎉 Seeding Complete!');
    console.log('');
    console.log('  Test credentials:');
    console.log('  ─────────────────────────────────────');
    console.log(`  Farm Code:   ${SEED_DATA.farm.farm_code}`);
    console.log(`  Farm ID:     ${farmId}`);
    console.log(`  Admin Login: ${SEED_DATA.admin.username} / ${SEED_DATA.admin.password}`);
    console.log(`  Worker Login: ${SEED_DATA.worker.username} / ${SEED_DATA.worker.password}`);
    console.log(`  Gateway:     ${SEED_DATA.gateway.gateway_id} / ${SEED_DATA.gateway.hardware_secret}`);
    console.log('═══════════════════════════════════════════\n');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
    process.exit(0);
}

seed().catch((err) => {
    console.error('\n❌ Seeding failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
