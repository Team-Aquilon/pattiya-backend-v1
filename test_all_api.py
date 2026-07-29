"""
Pattiya Backend - Full API Controller Test Suite
Tests all routes and controllers locally at http://localhost:5000/api/v1
"""
import requests
import json
import sys

BASE = "http://localhost:5000/api/v1"
GATEWAY_ID = "GW_001"
HARDWARE_SECRET = "gw_secret_ridiyagama_001"
FARM_ID = "FARM_UUID_12345"
ADMIN_EMAIL = "kasun@ridiyagama.lk"
ADMIN_PASSWORD = "admin123"
TEST_MAC = "A4:CF:12:89:C3:D1"  # Suddi

gateway_token = None
user_token = None
test_cow_id = None

results = []

def log(name, status, detail=""):
    icon = "✅" if status else "❌"
    msg = f"{icon} {name}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append((name, status, detail))

def gateway_login():
    global gateway_token
    r = requests.post(f"{BASE}/gateway/auth/login", json={
        "gateway_id": GATEWAY_ID,
        "hardware_secret": HARDWARE_SECRET
    }, timeout=15)
    ok = r.status_code == 200 and r.json().get("data", {}).get("gateway_access_token")
    gateway_token = r.json().get("data", {}).get("gateway_access_token") if ok else None
    log("Gateway Login", ok, f"Status {r.status_code}")
    return ok

def user_login():
    global user_token
    r = requests.post(f"{BASE}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    }, timeout=15)
    ok = r.status_code == 200
    user_token = r.json().get("data", {}).get("access_token") if ok else None
    log("User Login (App)", ok, f"Status {r.status_code}")
    return ok

def gw_headers():
    return {"Authorization": f"Bearer {gateway_token}"}

def user_headers():
    return {"Authorization": f"Bearer {user_token}"}

def test_health():
    r = requests.get(f"{BASE}/health", timeout=10)
    log("Health Check", r.status_code == 200, f"Status {r.status_code}")

def test_whitelist():
    r = requests.get(f"{BASE}/gateway/whitelist", headers=gw_headers(), timeout=10)
    ok = r.status_code == 200 and "allowed_macs" in r.json().get("data", {})
    log("GET /gateway/whitelist", ok, f"MACs: {r.json().get('data', {}).get('allowed_macs', [])}")

def test_batch_vitals():
    payload = {
        "gateway_id": GATEWAY_ID,
        "batch_timestamp": "2024-01-01T00:00:00Z",
        "records": [{
            "mac_address": TEST_MAC,
            "timestamp": "2024-01-01T00:00:00Z",
            "vitals": {
                "methane_ppm": 200,
                "battery_percentage": 80,
                "temperature": 28.5,
                "humidity": 65
            },
            "gps": {"lat": 6.142, "lng": 80.123}
        }]
    }
    r = requests.post(f"{BASE}/gateway/telemetry/vitals/batch", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/vitals/batch", r.status_code == 200, f"Status {r.status_code}")

def test_batch_activity():
    payload = {
        "gateway_id": GATEWAY_ID,
        "batch_timestamp": "2024-01-01T00:00:00Z",
        "records": [{
            "mac_address": TEST_MAC,
            "timestamp": "2024-01-01T00:00:00Z",
            "step_count": 120,
            "activity_level": "medium"
        }]
    }
    r = requests.post(f"{BASE}/gateway/telemetry/activity/batch", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/activity/batch", r.status_code == 200, f"Status {r.status_code}")

def test_geofence():
    r = requests.get(f"{BASE}/gateway/settings/geofence", headers=gw_headers(), timeout=10)
    ok = r.status_code == 200
    log("GET /gateway/settings/geofence", ok, f"Status {r.status_code}")

def test_activity_prediction():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "timestamp": "2024-01-01T00:00:00Z",
        "predicted_activity": "walking",
        "activity_state": "high_activity",
        "confidence": 0.92,
        "battery": 78,
        "rssi_dbm": -65,
        "snr_db": 12
    }
    r = requests.post(f"{BASE}/gateway/telemetry/activity-prediction", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/activity-prediction", r.status_code == 200, f"Status {r.status_code}")

def test_sound_prediction():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "timestamp": "2024-01-01T00:00:00Z",
        "oestrus_probability": 0.85,
        "label": "oestrus",
        "event_start_ms": 1000
    }
    r = requests.post(f"{BASE}/gateway/telemetry/sound-prediction", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/sound-prediction", r.status_code == 200, f"Status {r.status_code}")

def test_environment():
    payload = {
        "gateway_id": GATEWAY_ID,
        "temperature_c": 30.0,
        "humidity_percent": 70.0,
        "valid": True,
        "uptime_ms": 12345
    }
    r = requests.post(f"{BASE}/gateway/telemetry/environment", json=payload, headers=gw_headers(), timeout=15)
    ok = r.status_code == 200
    log("POST /gateway/telemetry/environment", ok, f"THI={r.json().get('data', {}).get('thi')} Status {r.status_code}")

def test_status_heartbeat():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "lat": 6.142,
        "lon": 80.123,
        "battery": 75,
        "uptime_ms": 99999
    }
    r = requests.post(f"{BASE}/gateway/telemetry/status", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/status", r.status_code == 200, f"Status {r.status_code}")

def test_oestrus_fusion():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "decision": "WATCH",
        "sound_label": "oestrus",
        "sound_probability": 0.7,
        "activity_label": "walking",
        "activity_state": "high_activity",
        "temperature_c": 29.5,
        "humidity_percent": 68.0
    }
    r = requests.post(f"{BASE}/gateway/telemetry/oestrus-fusion", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/oestrus-fusion", r.status_code == 200, f"Decision={payload['decision']} Status {r.status_code}")

def test_methane_sample():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "ppm": 350,
        "timestamp": "2024-01-01T00:00:00Z"
    }
    r = requests.post(f"{BASE}/gateway/telemetry/methane/sample", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/methane/sample", r.status_code == 200, f"Status {r.status_code}")

def test_methane_session():
    payload = {
        "gateway_id": GATEWAY_ID,
        "cow_id": "COW_101",
        "avg_delta_ch4_ppm": 200,
        "session_start_time": "2024-01-01T00:00:00Z",
        "duration_sec": 30
    }
    r = requests.post(f"{BASE}/gateway/telemetry/methane/session", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/telemetry/methane/session", r.status_code == 200, f"Status {r.status_code}")

def test_emergency_alert():
    payload = {
        "gateway_id": GATEWAY_ID,
        "mac_address": TEST_MAC,
        "alert_type": "GEOFENCE_BREACH",
        "timestamp": "2024-01-01T00:00:00Z",
        "trigger_data": {"current_lat": 7.0, "current_lng": 81.0, "distance_from_center_meters": 650}
    }
    r = requests.post(f"{BASE}/gateway/alerts/emergency", json=payload, headers=gw_headers(), timeout=15)
    log("POST /gateway/alerts/emergency", r.status_code == 200, f"Status {r.status_code}")

# ─── Flutter App (User) API Tests ───────────────────────────

def test_dashboard():
    r = requests.get(f"{BASE}/cows/dashboard", headers=user_headers(), timeout=10)
    ok = r.status_code == 200
    log("GET /cows/dashboard", ok, f"Total cows={r.json().get('total_cows')} Status {r.status_code}")

def test_list_cows():
    global test_cow_id
    r = requests.get(f"{BASE}/cows", headers=user_headers(), timeout=10)
    ok = r.status_code == 200
    cows = r.json().get("data", {}).get("cows", [])
    if cows:
        test_cow_id = cows[0].get("cow_id")
    log("GET /cows", ok, f"Count={len(cows)} Status {r.status_code}")

def test_get_single_cow():
    if not test_cow_id:
        log("GET /cows/:cow_id", False, "No cow_id available")
        return
    r = requests.get(f"{BASE}/cows/{test_cow_id}", headers=user_headers(), timeout=10)
    log("GET /cows/:cow_id", r.status_code == 200, f"Cow={r.json().get('name')} Status {r.status_code}")

def test_cow_history():
    if not test_cow_id:
        log("GET /cows/:cow_id/history", False, "No cow_id available")
        return
    r = requests.get(f"{BASE}/cows/{test_cow_id}/history?range=7days", headers=user_headers(), timeout=10)
    log("GET /cows/:cow_id/history", r.status_code == 200, f"Status {r.status_code}")

def test_methane_history():
    if not test_cow_id:
        log("GET /cows/:cow_id/methane/history", False, "No cow_id")
        return
    r = requests.get(f"{BASE}/cows/{test_cow_id}/methane/history?range=24hours", headers=user_headers(), timeout=10)
    log("GET /cows/:cow_id/methane/history", r.status_code == 200, f"Status {r.status_code}")

def test_latest_predictions():
    if not test_cow_id:
        log("GET /cows/:cow_id/predictions/latest", False, "No cow_id")
        return
    r = requests.get(f"{BASE}/cows/{test_cow_id}/predictions/latest", headers=user_headers(), timeout=10)
    log("GET /cows/:cow_id/predictions/latest", r.status_code in [200, 400], f"Status {r.status_code}")

def test_oestrus_alerts():
    if not test_cow_id:
        log("GET /cows/:cow_id/oestrus/alerts", False, "No cow_id")
        return
    r = requests.get(f"{BASE}/cows/{test_cow_id}/oestrus/alerts", headers=user_headers(), timeout=10)
    log("GET /cows/:cow_id/oestrus/alerts", r.status_code == 200, f"Status {r.status_code}")

def test_active_oestrus_alerts():
    r = requests.get(f"{BASE}/cows/oestrus/active", headers=user_headers(), timeout=10)
    log("GET /cows/oestrus/active", r.status_code == 200, f"Status {r.status_code}")

def test_locations():
    r = requests.get(f"{BASE}/cows/locations", headers=user_headers(), timeout=10)
    log("GET /cows/locations", r.status_code == 200, f"Status {r.status_code}")

def test_notifications():
    r = requests.get(f"{BASE}/notifications", headers=user_headers(), timeout=10)
    log("GET /notifications", r.status_code == 200, f"Status {r.status_code}")

def test_system():
    r = requests.get(f"{BASE}/system/version", timeout=10)
    log("GET /system/version", r.status_code in [200, 404], f"Status {r.status_code}")

def test_mock_cows():
    r = requests.get(f"{BASE}/cows/mock-test/list?farm_id={FARM_ID}", timeout=10)
    ok = r.status_code == 200
    cows = r.json().get("data", {}).get("cows", [])
    log("GET /cows/mock-test/list (public)", ok, f"Count={len(cows)} Status {r.status_code}")

# ─── Run All ─────────────────────────────────────────────────

print("=" * 55)
print("  🐄 Pattiya Backend — Full API Test Suite")
print("  Target:", BASE)
print("=" * 55)
print()

print("── GATEWAY ENDPOINTS ──────────────────────────────────")
if not gateway_login():
    print("❌ FATAL: Gateway login failed. Skipping gateway tests.")
else:
    test_whitelist()
    test_batch_vitals()
    test_batch_activity()
    test_geofence()
    test_activity_prediction()
    test_sound_prediction()
    test_environment()
    test_status_heartbeat()
    test_oestrus_fusion()
    test_methane_sample()
    test_methane_session()
    test_emergency_alert()

print()
print("── FLUTTER APP ENDPOINTS ──────────────────────────────")
test_health()
test_mock_cows()
if not user_login():
    print("❌ FATAL: User login failed. Skipping app tests.")
else:
    test_dashboard()
    test_list_cows()
    test_get_single_cow()
    test_cow_history()
    test_methane_history()
    test_latest_predictions()
    test_oestrus_alerts()
    test_active_oestrus_alerts()
    test_locations()
    test_notifications()
    test_system()

print()
print("=" * 55)
passed = sum(1 for _, s, _ in results if s)
failed = sum(1 for _, s, _ in results if not s)
print(f"  Results: {passed} PASSED  |  {failed} FAILED  |  {len(results)} TOTAL")
print("=" * 55)
if failed > 0:
    print("\nFailed tests:")
    for name, status, detail in results:
        if not status:
            print(f"  ❌ {name} — {detail}")
