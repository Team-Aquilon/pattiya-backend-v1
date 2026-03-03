/**
 * Temperature-Humidity Index (THI) Calculator
 *
 * Standard dairy cattle heat stress formula:
 *   THI = (1.8 × T + 32) − [(0.55 − 0.0055 × RH) × (1.8 × T − 26)]
 *
 * Where:
 *   T  = ambient temperature in °C
 *   RH = relative humidity in %
 *
 * THI thresholds for dairy cattle:
 *   ≤ 68   → Normal (no stress)
 *   68–72  → Mild stress
 *   72–78  → Moderate stress  ← alert threshold
 *   78–82  → Severe stress
 *   > 82   → Danger / emergency
 */

const THI_THRESHOLDS = Object.freeze({
    NORMAL: 68,
    MILD: 72,
    MODERATE: 78,
    SEVERE: 82,
});

/**
 * Calculate THI from temperature (°C) and relative humidity (%).
 * @param {number} tempC   - Ambient temperature in Celsius
 * @param {number} rhPct   - Relative humidity as a percentage (0–100)
 * @returns {number}       - THI value rounded to 1 decimal
 */
function calculateTHI(tempC, rhPct) {
    const thi = (1.8 * tempC + 32) - ((0.55 - 0.0055 * rhPct) * (1.8 * tempC - 26));
    return Math.round(thi * 10) / 10;
}

/**
 * Classify a THI value into a stress level.
 * @param {number} thi
 * @returns {{ level: string, description: string, alert: boolean }}
 */
function classifyTHI(thi) {
    if (thi <= THI_THRESHOLDS.NORMAL) {
        return { level: 'NORMAL', description: 'No heat stress', alert: false };
    }
    if (thi <= THI_THRESHOLDS.MILD) {
        return { level: 'MILD', description: 'Mild discomfort — monitor closely', alert: false };
    }
    if (thi <= THI_THRESHOLDS.MODERATE) {
        return { level: 'MODERATE', description: 'Heat stress — activate cooling systems', alert: true };
    }
    if (thi <= THI_THRESHOLDS.SEVERE) {
        return { level: 'SEVERE', description: 'Severe heat stress — immediate action needed', alert: true };
    }
    return { level: 'DANGER', description: 'Emergency heat stress — risk of mortality', alert: true };
}

module.exports = { calculateTHI, classifyTHI, THI_THRESHOLDS };
