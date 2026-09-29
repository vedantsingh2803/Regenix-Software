import http.server
import socketserver
import json
import sqlite3
import time
import math
import random
import os
import sys
import threading
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timedelta
import uuid

PORT = int(os.environ.get("PORT", 8000))
DB_FILE = os.path.join(os.path.dirname(__file__), "regenix.db")
WEB_DIR = os.path.dirname(__file__)

class MicrogridState:
    def __init__(self):
        self.lock = threading.Lock()
        self.solar_voltage = 18.4
        self.solar_current = 6.95
        self.solar_power = 128
        
        self.wind_voltage = 12.7
        self.wind_current = 5.83
        self.wind_power = 74
        
        self.battery_soc = 72.0
        self.battery_voltage = 12.4
        self.battery_current = -3.2
        self.battery_temp = 28.5
        self.battery_status = "DISCHARGING"
        
        self.grid_voltage = 230.0
        self.grid_power = 0
        self.grid_status = "STANDBY"
        
        # Load relays
        self.loads = {
            "critical": {"power": 72, "enabled": True, "name": "Critical Loads"},
            "important": {"power": 48, "enabled": True, "name": "Important Loads"},
            "noncritical": {"power": 26, "enabled": True, "name": "Non-Critical Loads"},
            "ev": {"power": 0, "enabled": False, "name": "EV Charger"}
        }
        
        self.ev_mode = "eco" # "eco", "fast", "off"
        self.ev_power_kw = 3.2
        
        self.frequency = 50.02
        self.efficiency = 91.0
        
        # Historical buffer for live charts (last 20 points)
        self.history_gen = [82, 91, 104, 119, 128, 142, 154, 167, 182, 195, 202]
        self.history_soc = [61, 64, 66, 69, 73, 75, 74, 72, 71, 72]
        
        self.carbon_co2_kg = 128.6
        self.today_wh = 202

        self.active_fault = None # e.g. "OVERLOAD"

        self.latest_optimization = None
        
state = MicrogridState()

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telemetry_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            solar_power REAL,
            wind_power REAL,
            battery_soc REAL,
            total_consumption REAL,
            efficiency REAL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            level TEXT,
            title TEXT,
            message TEXT,
            acknowledged INTEGER DEFAULT 0
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS anomalies (
            id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            asset TEXT,
            severity TEXT,
            observed_value REAL,
            expected_value REAL,
            deviation_pct REAL,
            possible_causes TEXT,
            recommended_action TEXT,
            status TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS simulations (
            id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            config TEXT,
            results TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Seed initial alerts if empty
    cursor.execute("SELECT COUNT(*) FROM alerts")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("good", "System Normal", "All monitored energy sources are operating within expected limits.", 0))
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("info", "Battery Support Ready", "Battery reserve is available for renewable fluctuations.", 0))
        cursor.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                       ("good", "BMS Protection Active", "Voltage and current protection are enabled.", 0))

    conn.commit()
    conn.close()

def get_weather_for_time(dt):
    # Deterministic simulation based on hour and day of year
    hour = dt.hour + dt.minute / 60.0
    day_of_year = dt.timetuple().tm_yday

    # Base temp varies by season and time of day
    seasonal_temp_offset = math.sin((day_of_year - 80) / 365.0 * 2 * math.pi) * 10
    daily_temp_var = math.sin((hour - 8) / 24.0 * 2 * math.pi) * 8
    base_temp = 15 + seasonal_temp_offset + daily_temp_var

    # Cloud cover varies pseudo-randomly but smoothly based on day/hour
    cloud_cover = (math.sin(day_of_year * 0.1 + hour * 0.5) * 50 + 50)
    cloud_cover = max(0, min(100, cloud_cover))

    # Solar irradiance
    if 6 < hour < 18:
        solar_irradiance = math.sin((hour - 6) / 12.0 * math.pi) * 1000
        solar_irradiance *= (1 - (cloud_cover / 200.0)) # clouds reduce solar
    else:
        solar_irradiance = 0

    # Wind speed
    wind_speed = 3 + math.sin(hour * 1.5 + day_of_year) * 2 + math.sin(hour * 0.3) * 1
    wind_speed = max(0, wind_speed)

    # Weather condition
    if cloud_cover < 20:
        condition = "Clear"
    elif cloud_cover < 60:
        condition = "Partly Cloudy"
    elif cloud_cover < 85:
        condition = "Cloudy"
    else:
        condition = "Overcast"
        if wind_speed > 6:
            condition = "Storm"
        elif seasonal_temp_offset < 0 and wind_speed > 4:
            condition = "Rain"

    return {
        "timestamp": dt.isoformat(),
        "temperature": round(base_temp, 1),
        "humidity": round(40 + cloud_cover * 0.4 + math.sin(hour)*10, 1),
        "cloud_cover": round(cloud_cover, 1),
        "solar_irradiance": round(max(0, solar_irradiance), 1),
        "wind_speed": round(wind_speed, 1),
        "wind_direction": int((day_of_year * 24 + hour) * 10 % 360),
        "pressure": round(1013 + math.sin(day_of_year) * 10, 1),
        "uv_index": round(solar_irradiance / 100, 1),
        "visibility": round(10 - (cloud_cover/20.0), 1),
        "weather_condition": condition
    }

def detect_anomalies(current_state_snapshot, weather, dt):
    anomalies = []
    
    # 1. Solar anomaly check
    expected_solar = weather["solar_irradiance"] * 0.15 # rough efficiency
    if weather["solar_irradiance"] > 100 and current_state_snapshot["solar_power"] < expected_solar * 0.5:
        anomalies.append({
            "id": str(uuid.uuid4()),
            "timestamp": dt.isoformat(),
            "asset": "Solar",
            "severity": "warning",
            "observed_value": current_state_snapshot["solar_power"],
            "expected_value": expected_solar,
            "deviation_pct": round((expected_solar - current_state_snapshot["solar_power"]) / max(1, expected_solar) * 100, 1),
            "possible_causes": ["Panel shading", "Dust accumulation", "Inverter issue"],
            "recommended_action": "Inspect solar panels for debris or shading",
            "status": "active"
        })
        
    # 2. Wind anomaly check
    expected_wind = (weather["wind_speed"] ** 3) * 0.5
    if weather["wind_speed"] > 4 and current_state_snapshot["wind_power"] < expected_wind * 0.4:
         anomalies.append({
            "id": str(uuid.uuid4()),
            "timestamp": dt.isoformat(),
            "asset": "Wind",
            "severity": "warning",
            "observed_value": current_state_snapshot["wind_power"],
            "expected_value": expected_wind,
            "deviation_pct": round((expected_wind - current_state_snapshot["wind_power"]) / max(1, expected_wind) * 100, 1),
            "possible_causes": ["Turbine obstruction", "Mechanical wear"],
            "recommended_action": "Check wind turbine rotation",
            "status": "active"
        })

    # Save to DB
    if anomalies:
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            for a in anomalies:
                c.execute('''INSERT INTO anomalies 
                             (id, timestamp, asset, severity, observed_value, expected_value, deviation_pct, possible_causes, recommended_action, status)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                          (a["id"], a["timestamp"], a["asset"], a["severity"], a["observed_value"], a["expected_value"], 
                           a["deviation_pct"], json.dumps(a["possible_causes"]), a["recommended_action"], a["status"]))
            conn.commit()
            conn.close()
        except Exception as e:
            print("Anomaly saving error", e)

def get_active_anomalies():
    try:
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT id, timestamp, asset, severity, observed_value, expected_value, deviation_pct, possible_causes, recommended_action, status FROM anomalies WHERE status='active' ORDER BY timestamp DESC")
        rows = c.fetchall()
        conn.close()
        return [{
            "id": r[0], "timestamp": r[1], "asset": r[2], "severity": r[3], 
            "observed_value": r[4], "expected_value": r[5], "deviation_pct": r[6],
            "possible_causes": json.loads(r[7]), "recommended_action": r[8], "status": r[9]
        } for r in rows]
    except:
        return []

def generate_recommendations(current_state_snapshot, weather):
    recs = []
    
    # Check battery
    if current_state_snapshot["battery_soc"] < 30 and weather["solar_irradiance"] < 100:
        recs.append({
            "id": str(uuid.uuid4()),
            "priority": "high",
            "title": "Low Battery Reserve",
            "description": "Battery SOC is low and renewable generation is currently weak.",
            "reason": "Prevents grid reliance during peak rate hours.",
            "expected_impact": "Saves $2.40/day",
            "confidence_pct": 92,
            "category": "battery"
        })
        
    # Check EV charging
    if current_state_snapshot["loads"]["ev"]["enabled"] and current_state_snapshot["ev_mode"] == "fast" and current_state_snapshot["battery_soc"] < 50:
         recs.append({
            "id": str(uuid.uuid4()),
            "priority": "medium",
            "title": "Switch EV to Eco Mode",
            "description": "EV is fast charging while battery is below 50%.",
            "reason": "Maximize renewable utilization for EV charging.",
            "expected_impact": "Improves renewable utilization by 15%",
            "confidence_pct": 88,
            "category": "load_scheduling"
        })

    if weather["wind_speed"] > 6 and current_state_snapshot["battery_soc"] > 80:
        recs.append({
            "id": str(uuid.uuid4()),
            "priority": "low",
            "title": "High Wind Generation",
            "description": "Wind generation is high and battery is mostly full. Consider enabling deferred loads.",
            "reason": "Avoid renewable curtailment.",
            "expected_impact": "Increases renewable efficiency by 10%",
            "confidence_pct": 95,
            "category": "source_selection"
        })

    # Default if empty
    if not recs:
        recs.append({
            "id": str(uuid.uuid4()),
            "priority": "low",
            "title": "System Optimized",
            "description": "Current system parameters are optimal for current weather and load.",
            "reason": "Balanced supply and demand.",
            "expected_impact": "Maintains stability",
            "confidence_pct": 99,
            "category": "cost"
        })
        
    return recs[:5]

def telemetry_loop():
    """Background physics loop simulating live solar/wind/battery microgrid telemetry."""
    step = 0
    while True:
        time.sleep(2)
        step += 1
        
        now = datetime.now()
        weather = get_weather_for_time(now)
        
        with state.lock:
            # Solar fluctuates with daylight sine curve and weather
            solar_irradiance_factor = weather["solar_irradiance"] / 1000.0
            solar_base = 250 * solar_irradiance_factor
            solar_var = math.sin(time.time() / 6.5) * 18
            state.solar_power = max(0, int(solar_base + (solar_var if solar_base > 0 else 0)))
            state.solar_voltage = round(18.0 + (state.solar_power / max(1, 250)) * 0.8, 1) if state.solar_power > 0 else 0.0
            state.solar_current = round(state.solar_power / max(1, state.solar_voltage), 2)
            
            # Wind fluctuates with wind speed and turbulence
            wind_speed_factor = (weather["wind_speed"] / 10.0) ** 3
            wind_base = 300 * min(1.0, wind_speed_factor)
            wind_var = math.sin(time.time() / 4.1) * 16
            state.wind_power = max(0, int(wind_base + (wind_var if wind_base > 0 else 0)))
            state.wind_voltage = round(12.2 + (state.wind_power / 300.0) * 0.7, 1) if state.wind_power > 0 else 0.0
            state.wind_current = round(state.wind_power / max(1, state.wind_voltage), 2)
            
            # Total generation
            gen = state.solar_power + state.wind_power
            
            # Calculate load power based on active relays
            load_sum = 0
            if state.loads["critical"]["enabled"]: load_sum += state.loads["critical"]["power"]
            if state.loads["important"]["enabled"]: load_sum += state.loads["important"]["power"]
            if state.loads["noncritical"]["enabled"]: load_sum += state.loads["noncritical"]["power"]
            
            # EV charger load calculation
            if state.loads["ev"]["enabled"]:
                if state.ev_mode == "fast":
                    state.loads["ev"]["power"] = 3200
                elif state.ev_mode == "eco":
                    # Eco mode uses excess renewable generation
                    excess = max(0, gen - (load_sum - state.loads["ev"]["power"]))
                    state.loads["ev"]["power"] = min(3200, max(500, excess))
                else:
                    state.loads["ev"]["power"] = 0
            else:
                state.loads["ev"]["power"] = 0

            load_sum += state.loads["ev"]["power"]
            
            # Simulated fault injection
            if state.active_fault == "OVERLOAD":
                load_sum += 1500

            # Net power diff
            net = gen - load_sum
            
            # Battery SoC dynamics
            if net < 0:
                # Discharging
                drain_rate = abs(net) / 3600.0 * 0.05
                state.battery_soc = max(15.0, round(state.battery_soc - drain_rate, 2))
                state.battery_current = round(-abs(net) / max(1, state.battery_voltage), 2)
                state.battery_status = "DISCHARGING"
            else:
                # Charging
                charge_rate = net / 3600.0 * 0.04
                state.battery_soc = min(100.0, round(state.battery_soc + charge_rate, 2))
                state.battery_current = round(net / max(1, state.battery_voltage), 2)
                state.battery_status = "CHARGING" if net > 5 else "STANDBY"
            
            # Grid backup logic if SoC low or heavy overload
            if state.battery_soc < 20 or state.active_fault == "OVERLOAD":
                state.grid_power = max(0, load_sum - gen)
                state.grid_status = "ACTIVE"
            else:
                state.grid_power = 0
                state.grid_status = "STANDBY"

            # Efficiency calculation
            eff_base = 92.0 - (state.loads["ev"]["power"] / 3200.0) * 3.0
            state.efficiency = round(max(82.0, min(97.0, eff_base + math.sin(step / 10.0))), 1)
            
            # Update history rolling buffers
            if step % 3 == 0:
                state.history_gen.append(gen)
                if len(state.history_gen) > 20: state.history_gen.pop(0)
                
                state.history_soc.append(int(state.battery_soc))
                if len(state.history_soc) > 20: state.history_soc.pop(0)

                # Periodically log to SQLite DB
                try:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute("INSERT INTO telemetry_logs (solar_power, wind_power, battery_soc, total_consumption, efficiency) VALUES (?, ?, ?, ?, ?)",
                              (state.solar_power, state.wind_power, state.battery_soc, load_sum, state.efficiency))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass

        # Periodically run anomaly detection
        if step % 30 == 0:
            with state.lock:
                current_state = {
                    "solar_power": state.solar_power,
                    "wind_power": state.wind_power,
                    "battery_soc": state.battery_soc,
                    "loads": state.loads,
                    "ev_mode": state.ev_mode
                }
            detect_anomalies(current_state, weather, now)


class RegenixRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def _set_json_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_json_headers(200)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/telemetry/live":
            self._set_json_headers(200)
            now = datetime.now()
            weather = get_weather_for_time(now)
            active_anomalies_count = len(get_active_anomalies())
            
            with state.lock:
                gen = state.solar_power + state.wind_power
                cons = sum(l["power"] for l in state.loads.values() if l["enabled"])
                solar_pct = round(state.solar_power / max(1, gen) * 100) if gen > 0 else 0
                wind_pct = round(state.wind_power / max(1, gen) * 100) if gen > 0 else 0
                batt_pct = max(0, 100 - solar_pct - wind_pct)

                recs = generate_recommendations({
                    "battery_soc": state.battery_soc,
                    "loads": state.loads,
                    "ev_mode": state.ev_mode
                }, weather)

                data = {
                    "solar": {"voltage": state.solar_voltage, "current": state.solar_current, "power": state.solar_power},
                    "wind": {"voltage": state.wind_voltage, "current": state.wind_current, "power": state.wind_power},
                    "battery": {
                        "soc": state.battery_soc,
                        "voltage": state.battery_voltage,
                        "current": state.battery_current,
                        "status": state.battery_status,
                        "temp": state.battery_temp
                    },
                    "grid": {"voltage": state.grid_voltage, "power": state.grid_power, "status": state.grid_status},
                    "loads": state.loads,
                    "ev": {"mode": state.ev_mode, "power_kw": state.ev_power_kw, "active": state.loads["ev"]["enabled"]},
                    "totals": {
                        "generation": gen,
                        "consumption": cons,
                        "efficiency": state.efficiency,
                        "frequency": state.frequency,
                        "solar_pct": solar_pct,
                        "wind_pct": wind_pct,
                        "battery_pct": batt_pct
                    },
                    "carbon": {
                        "today_wh": gen,
                        "co2_saved_kg": round(128.6 + (gen / 1000.0) * 0.85, 1),
                        "trees_equivalent": int(9 + (gen / 500.0)),
                        "km_avoided": int(542 + (gen / 10.0))
                    },
                    "ai": {
                        "score": 94 if state.battery_soc >= 40 else 78,
                        "forecast_1h": cons + 12,
                        "recommendation": recs[0]["title"] if recs else "Use Solar + Wind",
                        "battery_reserve_ok": state.battery_soc >= 20
                    },
                    "active_fault": state.active_fault,
                    "weather": weather,
                    "active_anomaly_count": active_anomalies_count,
                    "active_recommendation_count": len(recs),
                    "optimization_status": state.latest_optimization["status"] if state.latest_optimization else "idle"
                }
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        elif path == "/api/telemetry/history":
            self._set_json_headers(200)
            with state.lock:
                data = {
                    "generation": list(state.history_gen),
                    "battery_soc": list(state.history_soc)
                }
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        elif path == "/api/alerts":
            self._set_json_headers(200)
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT id, timestamp, level, title, message, acknowledged FROM alerts ORDER BY id DESC LIMIT 15")
                rows = c.fetchall()
                conn.close()
                alerts = [{
                    "id": r[0], "time": r[1], "level": r[2], "title": r[3], "message": r[4], "acknowledged": bool(r[5])
                } for r in rows]
            except Exception as e:
                alerts = []
            self.wfile.write(json.dumps({"alerts": alerts}).encode("utf-8"))
            return

        elif path == "/api/ai/forecast":
            self._set_json_headers(200)
            with state.lock:
                cons = sum(l["power"] for l in state.loads.values() if l["enabled"])
                forecast = [int(cons * (1 + math.sin(i / 2.0) * 0.15)) for i in range(6)]
                res = {
                    "next_1h": forecast[0],
                    "forecast_bars": forecast,
                    "score": 94 if state.battery_soc > 40 else 76,
                    "recommendation": "Use Solar + Wind priority routing.",
                    "renewable_contrib_pct": min(100, int((state.solar_power + state.wind_power) / max(1, cons) * 100)) if cons > 0 else 100
                }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/api/weather/current":
            self._set_json_headers(200)
            now = datetime.now()
            weather = get_weather_for_time(now)
            self.wfile.write(json.dumps(weather).encode("utf-8"))
            return

        elif path == "/api/weather/forecast":
            self._set_json_headers(200)
            now = datetime.now()
            forecasts = []
            for i in range(24):
                ft = now + timedelta(hours=i)
                forecasts.append(get_weather_for_time(ft))
            self.wfile.write(json.dumps({"forecast": forecasts}).encode("utf-8"))
            return

        elif path.startswith("/api/forecast/"):
            self._set_json_headers(200)
            now = datetime.now()
            
            solar_forecast = []
            wind_forecast = []
            load_forecast = []
            
            for i in range(24):
                ft = now + timedelta(hours=i)
                fw = get_weather_for_time(ft)
                
                # Solar model
                s_val = (fw["solar_irradiance"] / 1000.0) * 250
                s_err = s_val * 0.1
                solar_forecast.append({
                    "timestamp": ft.isoformat(),
                    "value": round(s_val, 1),
                    "lower_bound": round(max(0, s_val - s_err), 1),
                    "upper_bound": round(s_val + s_err, 1)
                })
                
                # Wind model
                w_val = ((fw["wind_speed"] / 10.0) ** 3) * 300
                w_val = min(300, w_val)
                w_err = w_val * 0.15
                wind_forecast.append({
                    "timestamp": ft.isoformat(),
                    "value": round(w_val, 1),
                    "lower_bound": round(max(0, w_val - w_err), 1),
                    "upper_bound": round(w_val + w_err, 1)
                })
                
                # Load model
                hour = ft.hour
                l_val = 150 + math.sin((hour - 8)/24.0 * 2*math.pi) * 50 + (100 if 18 <= hour <= 21 else 0)
                l_err = l_val * 0.05
                load_forecast.append({
                    "timestamp": ft.isoformat(),
                    "value": round(l_val, 1),
                    "lower_bound": round(max(0, l_val - l_err), 1),
                    "upper_bound": round(l_val + l_err, 1)
                })

            metrics = {"MAE": 4.2, "RMSE": 5.8, "MAPE": 8.4}
            
            if path == "/api/forecast/solar":
                self.wfile.write(json.dumps({"forecast": solar_forecast, "metrics": metrics}).encode("utf-8"))
            elif path == "/api/forecast/wind":
                self.wfile.write(json.dumps({"forecast": wind_forecast, "metrics": metrics}).encode("utf-8"))
            elif path == "/api/forecast/load":
                self.wfile.write(json.dumps({"forecast": load_forecast, "metrics": metrics}).encode("utf-8"))
            elif path == "/api/forecast/combined":
                self.wfile.write(json.dumps({
                    "solar": solar_forecast,
                    "wind": wind_forecast,
                    "load": load_forecast,
                    "metrics": metrics
                }).encode("utf-8"))
            return

        elif path == "/api/anomalies":
            self._set_json_headers(200)
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("SELECT id, timestamp, asset, severity, observed_value, expected_value, deviation_pct, possible_causes, recommended_action, status FROM anomalies ORDER BY timestamp DESC LIMIT 50")
                rows = c.fetchall()
                conn.close()
                anomalies = [{
                    "id": r[0], "timestamp": r[1], "asset": r[2], "severity": r[3], 
                    "observed_value": r[4], "expected_value": r[5], "deviation_pct": r[6],
                    "possible_causes": json.loads(r[7]), "recommended_action": r[8], "status": r[9]
                } for r in rows]
            except:
                anomalies = []
            self.wfile.write(json.dumps({"anomalies": anomalies}).encode("utf-8"))
            return

        elif path == "/api/anomalies/active":
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"anomalies": get_active_anomalies()}).encode("utf-8"))
            return

        elif path == "/api/optimization/latest":
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"optimization": state.latest_optimization}).encode("utf-8"))
            return

        elif path.startswith("/api/simulation/"):
            parts = path.split("/")
            if len(parts) == 4 and parts[3] != "run" and parts[3] != "compare":
                sim_id = parts[3]
                self._set_json_headers(200)
                try:
                    conn = sqlite3.connect(DB_FILE)
                    c = conn.cursor()
                    c.execute("SELECT config, results FROM simulations WHERE id = ?", (sim_id,))
                    row = c.fetchone()
                    conn.close()
                    if row:
                        self.wfile.write(json.dumps({
                            "id": sim_id,
                            "config": json.loads(row[0]),
                            "results": json.loads(row[1])
                        }).encode("utf-8"))
                    else:
                        self.wfile.write(json.dumps({"error": "not found"}).encode("utf-8"))
                except:
                    self.wfile.write(json.dumps({"error": "db error"}).encode("utf-8"))
                return

        elif path == "/api/recommendations":
            self._set_json_headers(200)
            now = datetime.now()
            weather = get_weather_for_time(now)
            with state.lock:
                current_state = {
                    "battery_soc": state.battery_soc,
                    "loads": state.loads,
                    "ev_mode": state.ev_mode
                }
            recs = generate_recommendations(current_state, weather)
            self.wfile.write(json.dumps({"recommendations": recs}).encode("utf-8"))
            return

        elif path == "/api/analytics/summary":
            self._set_json_headers(200)
            res = {
                "daily": {
                    "energy_generated_kwh": 12.4,
                    "energy_consumed_kwh": 10.2,
                    "renewable_pct": 85.5,
                    "peak_load_kw": 3.4,
                    "grid_dependency_pct": 14.5,
                    "cost_saved": 4.50,
                    "co2_saved_kg": 8.2,
                    "battery_cycles": 1.2,
                    "system_efficiency": 92.1
                },
                "weekly": {
                    "energy_generated_kwh": 82.4,
                    "energy_consumed_kwh": 76.2,
                    "renewable_pct": 82.1,
                    "peak_load_kw": 4.1,
                    "grid_dependency_pct": 17.9,
                    "cost_saved": 28.50,
                    "co2_saved_kg": 54.2,
                    "battery_cycles": 8.4,
                    "system_efficiency": 91.5
                },
                "monthly": {
                    "energy_generated_kwh": 345.2,
                    "energy_consumed_kwh": 312.8,
                    "renewable_pct": 79.4,
                    "peak_load_kw": 4.5,
                    "grid_dependency_pct": 20.6,
                    "cost_saved": 115.20,
                    "co2_saved_kg": 228.4,
                    "battery_cycles": 34.2,
                    "system_efficiency": 90.8,
                    "battery_health_pct": 98.2
                }
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        # Serve static files as default behavior
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b'{}'
        try:
            req_data = json.loads(body.decode('utf-8'))
        except Exception:
            req_data = {}

        if path == "/api/loads/toggle":
            load_id = req_data.get("load_id")
            enabled = req_data.get("enabled")
            if load_id in state.loads:
                with state.lock:
                    if enabled is not None:
                        state.loads[load_id]["enabled"] = bool(enabled)
                    else:
                        state.loads[load_id]["enabled"] = not state.loads[load_id]["enabled"]
            
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "loads": state.loads}).encode("utf-8"))
            return

        elif path == "/api/ev/control":
            mode = req_data.get("mode")
            power_kw = req_data.get("power_kw")
            with state.lock:
                if mode in ["eco", "fast", "off"]:
                    state.ev_mode = mode
                    state.loads["ev"]["enabled"] = (mode != "off")
                if power_kw is not None:
                    state.ev_power_kw = float(power_kw)

            self._set_json_headers(200)
            self.wfile.write(json.dumps({
                "success": True,
                "ev_mode": state.ev_mode,
                "ev_power_kw": state.ev_power_kw,
                "ev_enabled": state.loads["ev"]["enabled"]
            }).encode("utf-8"))
            return

        elif path == "/api/alerts/acknowledge":
            alert_id = req_data.get("id")
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                if alert_id:
                    c.execute("UPDATE alerts SET acknowledged = 1 WHERE id = ?", (alert_id,))
                else:
                    c.execute("UPDATE alerts SET acknowledged = 1")
                conn.commit()
                conn.close()
            except Exception:
                pass

            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True}).encode("utf-8"))
            return

        elif path == "/api/alerts/trigger":
            fault_type = req_data.get("type", "OVERLOAD")
            with state.lock:
                state.active_fault = fault_type
            
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("INSERT INTO alerts (level, title, message, acknowledged) VALUES (?, ?, ?, ?)",
                          ("critical", "CRITICAL OVERLOAD TRIP", "System load exceeded 1.5 kW safety limit! Dynamic load shedding triggered.", 0))
                conn.commit()
                conn.close()
            except Exception:
                pass

            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "fault": fault_type}).encode("utf-8"))
            return

        elif path == "/api/reports/export":
            with state.lock:
                report_data = {
                    "system": "REGENIX Smart Hybrid Microgrid",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "today_generation_wh": state.solar_power + state.wind_power,
                    "today_consumption_wh": sum(l["power"] for l in state.loads.values() if l["enabled"]),
                    "system_efficiency": f"{state.efficiency}%",
                    "battery_soc": f"{state.battery_soc}%",
                    "co2_saved_kg": round(128.6 + (state.solar_power / 100.0), 1),
                    "status": "ALL SYSTEMS NORMAL"
                }
            self._set_json_headers(200)
            self.wfile.write(json.dumps({"success": True, "report": report_data}).encode("utf-8"))
            return

        elif path == "/api/optimization/run":
            self._set_json_headers(200)
            now = datetime.now()
            weather = get_weather_for_time(now)
            
            # Simple optimization logic mock
            with state.lock:
                soc = state.battery_soc
                gen = state.solar_power + state.wind_power
                cons = sum(l["power"] for l in state.loads.values() if l["enabled"])
                
            rec_source = "Solar+Wind" if gen > cons else "Battery"
            batt_action = "Charge" if gen > cons else "Discharge"
            
            opt = {
                "timestamp": now.isoformat(),
                "status": "completed",
                "recommended_source": rec_source,
                "battery_action": batt_action,
                "load_schedule": {
                    "critical": "always_on",
                    "essential": "always_on",
                    "flexible": "deferred" if batt_action == "Discharge" and soc < 50 else "on"
                },
                "expected_cost": 2.50,
                "cost_savings_vs_baseline": 1.25,
                "renewable_utilization_pct": 98.5,
                "grid_dependency_pct": 1.5,
                "explanation": f"Optimal source is {rec_source}. Battery should {batt_action} based on current SOC of {soc}%.",
                "confidence": 95
            }
            
            with state.lock:
                state.latest_optimization = opt
                
            self.wfile.write(json.dumps(opt).encode("utf-8"))
            return

        elif path == "/api/simulation/run":
            self._set_json_headers(200)
            sim_id = str(uuid.uuid4())
            
            sc = req_data.get("solar_change_pct", 0)
            wc = req_data.get("wind_change_pct", 0)
            lc = req_data.get("load_change_pct", 0)
            init_soc = req_data.get("battery_soc", 50)
            grid_avail = req_data.get("grid_available", True)
            grid_price_mult = req_data.get("grid_price_multiplier", 1.0)
            
            results = []
            soc = init_soc
            total_cost = 0
            unserved_load = 0
            grid_import_total = 0
            renewable_total = 0
            load_total = 0
            batt_cycles = 0
            
            now = datetime.now()
            
            for i in range(24):
                ft = now + timedelta(hours=i)
                fw = get_weather_for_time(ft)
                
                # Apply changes
                s_val = ((fw["solar_irradiance"] / 1000.0) * 250) * (1 + sc/100.0)
                w_val = min(300, (((fw["wind_speed"] / 10.0) ** 3) * 300)) * (1 + wc/100.0)
                
                hour = ft.hour
                l_val = (150 + math.sin((hour - 8)/24.0 * 2*math.pi) * 50 + (100 if 18 <= hour <= 21 else 0)) * (1 + lc/100.0)
                
                ren = s_val + w_val
                net = ren - l_val
                
                grid_import = 0
                grid_export = 0
                batt_charge = 0
                batt_discharge = 0
                unserved = 0
                
                # Simple battery dynamics
                if net > 0: # excess
                    charge_amount = min(net, (100 - soc) * 10) # rough capacity
                    soc += charge_amount / 10.0
                    batt_charge = charge_amount
                    grid_export = net - charge_amount if grid_avail else 0
                else: # deficit
                    deficit = abs(net)
                    discharge_amount = min(deficit, soc * 10)
                    soc -= discharge_amount / 10.0
                    batt_discharge = discharge_amount
                    batt_cycles += discharge_amount / 1000.0
                    
                    rem_deficit = deficit - discharge_amount
                    if grid_avail:
                        grid_import = rem_deficit
                        total_cost += grid_import * 0.15 * grid_price_mult
                    else:
                        unserved = rem_deficit
                        
                renewable_total += ren
                load_total += l_val
                grid_import_total += grid_import
                unserved_load += unserved
                
                results.append({
                    "hour": i,
                    "timestamp": ft.isoformat(),
                    "solar": round(s_val, 1),
                    "wind": round(w_val, 1),
                    "load": round(l_val, 1),
                    "soc": round(soc, 1),
                    "grid_import": round(grid_import, 1),
                    "unserved": round(unserved, 1)
                })
                
            summary = {
                "total_cost": round(total_cost, 2),
                "renewable_utilization": round(min(100, (renewable_total / max(1, load_total)) * 100), 1),
                "grid_dependency": round((grid_import_total / max(1, load_total)) * 100, 1),
                "unserved_load": round(unserved_load, 1),
                "battery_cycles": round(batt_cycles, 2),
                "co2_avoided": round(renewable_total * 0.85, 1)
            }
            
            res_obj = {
                "id": sim_id,
                "hourly": results,
                "summary": summary
            }
            
            try:
                conn = sqlite3.connect(DB_FILE)
                c = conn.cursor()
                c.execute("INSERT INTO simulations (id, config, results) VALUES (?, ?, ?)",
                          (sim_id, json.dumps(req_data), json.dumps(res_obj)))
                conn.commit()
                conn.close()
            except Exception as e:
                print("Sim db error", e)

            self.wfile.write(json.dumps(res_obj).encode("utf-8"))
            return

        elif path == "/api/simulation/compare":
            self._set_json_headers(200)
            # In a real app this would run both and compare, here we return a stub
            self.wfile.write(json.dumps({"success": True, "message": "Compare simulated."}).encode("utf-8"))
            return

        self._set_json_headers(404)
        self.wfile.write(json.dumps({"error": "Endpoint not found"}).encode("utf-8"))

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True

def run():
    init_db()
    t = threading.Thread(target=telemetry_loop, daemon=True)
    t.start()
    
    server = ThreadedHTTPServer(("0.0.0.0", PORT), RegenixRequestHandler)
    print(f"[REGENIX] Smart Hybrid Energy Server running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down REGENIX server.")
        server.shutdown()

if __name__ == "__main__":
    run()
