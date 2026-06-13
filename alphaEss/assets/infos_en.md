# Alpha ESS Plugin — A.V.A.T.A.R

![alphaEss](../../core/plugins/alphaEss/assets/images/alphaEss.png =100x*)

Real-time monitoring of your **Alpha ESS** solar and battery installation via the official [open.alphaess.com](https://open.alphaess.com) API.

---

## Features

| Feature | Description |
|---|---|
| ⚡ **Real-time data** | PV production, home consumption, grid exchange, battery power, SOC |
| 📊 **Daily summary** | Energy produced, consumed, imported, exported in kWh |
| 📈 **Multi-curve chart** | PV (yellow), Home (blue), Grid import (brown), Grid export (red), SOC % (green) |
| 💶 **Savings** | Daily savings calculation in € |
| 🌿 **CO₂ avoided** | CO₂ and carbon avoided in kg |
| 📅 **7-day history** | Production bar chart for the last 7 days |
| 🔔 **Voice alerts** | Low battery (≤ 15%), full battery (100%), no production during the day |
| 📱 **Push notifications** | Via ntfy — sent when battery is low or system fault detected |
| 🌐 **Web dashboard** | Interface accessible from any device on the local network |
| 🎛️ **Avatar widget** | Quick access button in the Avatar interface |

---

## Installation

1. Copy the folder to:
   ```
   <AVATAR>/resources/app/core/plugins/alphaEss/
   ```

2. Run `npm install` in the plugin folder

3. Configure `alphaEss.prop` with your API credentials

4. Restart Avatar Server

---

## Getting API credentials

1. Go to [open.alphaess.com](https://open.alphaess.com)
2. Create a developer account
3. Create an application → retrieve `appId` and `appSecret`
4. Enter the inverter serial number (`serialNumber`)

---

## `alphaEss.prop` Configuration

```json
{
    "appId":        "your_app_id",
    "appSecret":    "your_app_secret",
    "serialNumber": "your_serial_number",

    "kwh_price":    0.20,
    "fuel_factor":  0.730,
    "pv_factor":    0.055,
    "webPort":      3847,

    "widget": { "display": true },

    "alerts": {
        "batteryLowThreshold": 15,
        "alertClient":         "Living room"
    }
}
```

| Key | Description |
|---|---|
| `appId` / `appSecret` | open.alphaess.com API credentials |
| `serialNumber` | Your Alpha ESS inverter serial number |
| `kwh_price` | kWh price in € for savings calculation |
| `fuel_factor` | CO₂ emission factor (kg/kWh) for your grid |
| `pv_factor` | PV production emission factor (kg/kWh) |
| `webPort` | Web dashboard port (default: 3847) |
| `batteryLowThreshold` | Battery % threshold for low battery alert |
| `alertClient` | Avatar client that receives voice alerts |

---

## Web dashboard

Accessible from any device on the local network:
```
http://192.168.1.9:3847
```

---

## Production chart

The chart is built **locally** at each cron cycle (every 30s) and saved in `assets/curve.json`. It survives Avatar restarts and resets automatically each day.

| Curve | Color | Description |
|---|---|---|
| ☀️ PV | Yellow | Instant solar production |
| 🏠 Home | Blue | Home consumption |
| 📥 Import | Brown dashed | Import from grid |
| 📤 Export | Red dashed | Export to grid |
| 🔋 SOC | Green (right axis) | Battery charge level in % |

---

## Voice alerts

| Alert | Trigger | Message |
|---|---|---|
| 🔋 Low battery | SOC ≤ 15% | *"Warning! Battery is low: X percent."* |
| 🔋 Full battery | SOC = 100% | *"Warning! Battery is fully charged."* |
| ☀️ No production | < 10W between 7am-7pm | *"Warning! No solar production detected."* |

Alerts start with **"Warning!"** → automatic ntfy push notification if the ntfy plugin is installed.

---

## Voice commands

- *"Sarah, what is the solar production?"*
- *"Sarah, what is the battery level?"*
- *"Sarah, what is the current power?"*
- *"Sarah, how much have we imported from the grid today?"*
- *"Sarah, what is the self-sufficiency rate?"*
- *"Sarah, how much have we saved today?"*
- *"Sarah, how much CO2 have we avoided?"*
- *"Sarah, what was the peak production today?"*
- *"Sarah, give me the full system status."*

---

## Author

Plugin developed for the A.V.A.T.A.R home automation system.
Created by: **Nezumi** — Réunion Island

<br><br>
