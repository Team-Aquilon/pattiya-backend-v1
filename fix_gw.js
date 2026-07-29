require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Gateway = require('./src/models/Gateway');

const MONGODB_URI = process.env.MONGODB_URI;

async function fix() {
    await mongoose.connect(MONGODB_URI);
    const hashedSecret = await bcrypt.hash("gw_secret_ridiyagama_001", 12);
    await Gateway.updateOne({ gateway_id: "GW_001" }, { $set: { hardware_secret: hashedSecret, is_active: true } });
    console.log("Fixed GW_001 secret!");
    process.exit(0);
}
fix();
