const mongoose = require('mongoose');

const methaneSessionSchema = new mongoose.Schema({
    farm_id: {
        type: String,
        required: true,
        index: true
    },
    device_id: String,
    cow_id: String,
    rfid_tag: String,
    session_start_time: Date,
    session_duration_seconds: Number,
    valid_sample_count: Number,
    invalid_sample_count: Number,
    avg_delta_ch4_ppm: Number,
    avg_airflow_lpm: Number,
    avg_methane_flow_ml_min: Number,
    status: String
}, {
    timestamps: true
});

methaneSessionSchema.index({ farm_id: 1, cow_id: 1, createdAt: -1 });

module.exports = mongoose.model('MethaneSession', methaneSessionSchema);
