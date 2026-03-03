const asyncHandler = require('../middleware/asyncHandler');

// ─── 10. System Metadata (Dropdown Lists) ──────────────────

exports.getMetadata = asyncHandler(async (_req, res) => {
    res.json({
        cow_breeds: ['Jersey', 'Friesian', 'Sahiwal', 'Australian Milking Zebu'],
        health_event_types: ['VACCINATION', 'TREATMENT', 'ARTIFICIAL_INSEMINATION', 'BIRTH'],
        withdrawal_reasons: ['SOLD', 'DIED', 'COLLAR_BROKEN', 'MISTAKE'],
    });
});

// ─── 5.5 App Version Check ─────────────────────────────────

exports.getVersion = asyncHandler(async (_req, res) => {
    const pkg = require('../../package.json');
    res.json({
        status: 'success',
        data: {
            api_version: 'v1.0',
            backend_version: pkg.version,
            min_app_version: '1.0.0',
            latest_app_version: '1.0.0',
        },
    });
});

module.exports = exports;
