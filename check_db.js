require('dotenv').config();
const mongoose = require('mongoose');
const Cow = require('./src/models/Cow');
const OestrusAlert = require('./src/models/OestrusAlert');
const Notification = require('./src/models/Notification');

async function check() {
    await mongoose.connect('mongodb+srv://admin:admin@pattiya-db-v1.pnoetuz.mongodb.net/?appName=pattiya-db-v1');
    
    console.log('--- Oestrus Alerts ---');
    const alerts = await OestrusAlert.find().sort({createdAt: -1}).limit(5).lean();
    for (const a of alerts) {
        console.log(`CowID: ${a.cow_id}, MAC: ${a.mac_address}, Decision: ${a.decision}`);
    }

    console.log('\n--- Notifications ---');
    const notifs = await Notification.find().sort({createdAt: -1}).limit(5).lean();
    for (const n of notifs) {
        console.log(`CowID: ${n.cow_id}, Type: ${n.type}, Message: ${n.message}`);
    }
    
    process.exit(0);
}

check();
