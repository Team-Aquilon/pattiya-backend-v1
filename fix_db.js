require('dotenv').config();
const mongoose = require('mongoose');
const Cow = require('./src/models/Cow');

async function fixCow() {
    console.log('Connecting to DB...');
    await mongoose.connect('mongodb+srv://admin:admin@pattiya-db-v1.pnoetuz.mongodb.net/?appName=pattiya-db-v1');
    
    console.log('Updating COW_MS59R9BF...');
    const result = await Cow.updateOne(
        { cow_id: 'COW_MS59R9BF' },
        { $set: { collar_mac: '1C:DB:D4:45:73:04', is_active: true } }
    );
    console.log('Update result:', result);
    
    process.exit(0);
}

fixCow();
