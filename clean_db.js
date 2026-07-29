const mongoose = require('mongoose');
const Cow = require('./src/models/Cow');
const OestrusAlert = require('./src/models/OestrusAlert');
const Notification = require('./src/models/Notification');
const HealthEvent = require('./src/models/HealthEvent');

async function run() {
    await mongoose.connect('mongodb+srv://admin:admin@pattiya-db-v1.pnoetuz.mongodb.net/?appName=pattiya-db-v1');
    
    // Delete any OestrusAlert with a cow_id that contains a dash (i.e. timestamp) or is empty
    const del1 = await OestrusAlert.deleteMany({ cow_id: { $regex: '-' } });
    const del2 = await OestrusAlert.deleteMany({ cow_id: '' });
    console.log('Deleted OestrusAlerts:', del1.deletedCount + del2.deletedCount);
    
    // Delete notifications with empty cow_id or SYSTEM type
    const del3 = await Notification.deleteMany({ cow_id: { $in: ['', null] } });
    const del4 = await Notification.deleteMany({ type: 'SYSTEM' });
    console.log('Deleted Notifications:', del3.deletedCount + del4.deletedCount);

    process.exit(0);
}
run();
