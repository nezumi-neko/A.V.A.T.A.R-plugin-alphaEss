/**
 * Plugin Alpha ESS pour A.V.A.T.A.R — v2.0
 * Monitoring solaire complet : production, batterie, réseau, alertes, économies, CO₂
 */

import * as path from 'node:path';
import fs from 'fs-extra';
import * as url from 'url';
import * as crypto from 'node:crypto';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

import * as widgetLib from '../../../widgetLibrairy.js';
const Widget = await widgetLib.init();

import { startWebServer, stopWebServer } from './alphaEss-web.js';

let Locale;
let periphInfo = [];
let currentwidgetState;
let AlphaWindow;

const widgetFolder    = path.resolve(__dirname, 'assets/widget');
const widgetImgFolder = path.resolve(__dirname, 'assets/images/widget');
const styleFile       = path.resolve(__dirname, 'assets/style.json');
const historyFile     = path.resolve(__dirname, 'assets/history.json');
const peakFile        = path.resolve(__dirname, 'assets/peak.json');
const curveFile       = path.resolve(__dirname, 'assets/curve.json'); // courbe temps réel persistante

// ─── Formatage français ───
const fr = (number, decimals = 1) => {
    const n = Number(number);
    if (n % 1 === 0) return n.toLocaleString('fr-FR');
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

// Helper : parle ET affiche dans la console
const say = (msg, client) => {
    info(`alphaEss [${client}]: ${msg}`);
    Avatar.speak(msg, client);
};

// ─── Cache principal ───
let cachedData = {
    lastUpdate:      null,
    // Temps réel
    currentPower:    null,   // W   — production PV
    batterySOC:      null,   // %   — charge batterie
    batteryTemp:     null,   // °C  — température batterie
    gridPower:       null,   // W   — réseau
    loadPower:       null,   // W   — conso maison
    batteryPower:    null,   // W   — flux batterie
    evPower:         null,   // W   — recharge VE
    // Journalier
    solarToday:      null,   // kWh
    loadToday:       null,   // kWh
    gridImport:      null,   // kWh
    gridExport:      null,   // kWh
    selfSufficiency: null,   // %
    selfConsumption: null,   // %
    // Calculés
    savingsToday:    null,   // €
    co2Avoided:      null,   // kg CO₂ évité
    carbonAvoided:   null,   // kg Carbone évité (CO2 × 0.2727)
    peakPower:       null,   // W   — pic de production du jour
    peakDay:         null,   // date string — pour reset quotidien
    // Courbe horaire — API (ppv uniquement)
    powerCurve:      [],     // [{time, ppv}]
    powerCurveUpdated: 0,   // timestamp dernière MAJ courbe
    // Courbe 24h glissantes — construite localement à chaque cron
    realtimeCurve:   [],    // [{time, ppv, load, grid, pbat, soc}] — 24h max
    // Historique 7 jours
    history:         [],
};

// ─── État des alertes (évite répétition) ───
let alertState = {
    batteryLow:    false,
    batteryFull:   false,
    exporting:     false,
    noProd:        false,
};

// ─────────────────────────────────────────────
// Initialisation
// ─────────────────────────────────────────────
export async function init() {
    if (!await Avatar.lang.addPluginPak("alphaEss")) {
        return error('alphaEss: unable to load language pak files');
    }
    Locale = await Avatar.lang.getPak("alphaEss", Config.language);
    if (!Locale) return error(`alphaEss: Unable to find the '${Config.language}' language pak.`);

    // Crée le dossier assets si besoin
    fs.ensureDirSync(path.resolve(__dirname, 'assets'));

    // Charge le pic journalier sauvegardé (résistant au redémarrage)
    if (fs.existsSync(peakFile)) {
        const saved = fs.readJsonSync(peakFile, { throws: false });
        const today = new Date().toDateString();
        if (saved?.day === today && saved?.peak > 0) {
            cachedData.peakPower = saved.peak;
            cachedData.peakDay   = saved.day;
            // info(`alphaEss: Pic journalier restauré — ${saved.peak}W`);
        }
    }

    // Charge la courbe temps réel sauvegardée (résistante au redémarrage)
    if (fs.existsSync(curveFile)) {
        try {
            const saved    = fs.readJsonSync(curveFile, { throws: false });
            const now24hAgo = Date.now() - 24 * 3600 * 1000;
            if (Array.isArray(saved?.points) && saved.points.length > 0) {
                // Ne garder que les points des 24 dernières heures
                cachedData.realtimeCurve = saved.points.filter(
                    p => new Date(p.time).getTime() >= now24hAgo
                );
                // info(`alphaEss: Courbe restaurée — ${cachedData.realtimeCurve.length} points (24h glissantes)`);
            }
        } catch (e) {
            warn('alphaEss: Impossible de lire la courbe sauvegardée — ' + e.message);
        }
    }

    await refreshData();

    // Démarre le serveur web
    const port = Config.modules.alphaEss.webPort ?? 3847;
    startWebServer(port, () => cachedData);

    periphInfo.push({
        Buttons: [{
            name: "Alpha ESS", value_type: "button",
            usage_name: "Button", periph_id: "alphaEss_001",
            notes: "Tableau de bord Alpha ESS"
        }]
    });
}

// ─────────────────────────────────────────────
// Cron — rafraîchissement toutes les 30s
// ─────────────────────────────────────────────
export async function cron() {
    await refreshData();
    checkAlerts();
    if (AlphaWindow) AlphaWindow.webContents.send('onInit-alphaEss');
}

// ─────────────────────────────────────────────
// Alertes vocales automatiques
// ─────────────────────────────────────────────
function checkAlerts() {
    const cfg      = Config.modules.alphaEss;
    const client   = cfg.alertClient || Config.default.client;
    const soc      = cachedData.batterySOC;
    const grid     = cachedData.gridPower;
    const power    = cachedData.currentPower;
    const hour     = new Date().getHours();
    const isDaytime = hour >= 7 && hour <= 19;

    // ── Batterie faible ───────────────────────────────────────────────────────
    // Seuil configurable (défaut 15%)
    const lowThreshold = cfg.alerts?.batteryLowThreshold ?? 15;
    if (soc !== null && soc <= lowThreshold && !alertState.batteryLow) {
        alertState.batteryLow = true;
        say(`Attention ! La batterie est faible : ${fr(soc, 0)} pourcent.`, client);
    } else if (soc !== null && soc >= lowThreshold + 5) {
        alertState.batteryLow = false;
    }

    // ── Batterie pleine à 100% ────────────────────────────────────────────────
    if (soc !== null && soc >= 100 && !alertState.batteryFull) {
        alertState.batteryFull = true;
        say('Attention ! La batterie est chargée à cent pourcent.', client);
    } else if (soc !== null && soc < 95) {
        alertState.batteryFull = false;
    }

    // ── Export réseau — pas d'alerte (export = bonne nouvelle !) ─────────────
    if (grid !== null && grid > -50) {
        alertState.exporting = false;
    }

    // ── Production nulle en journée (possible panne) ──────────────────────────
    if (isDaytime && power !== null && power < 10 && !alertState.noProd) {
        alertState.noProd = true;
        say('Attention ! Aucune production solaire détectée. Vérifiez l installation.', client);
    } else if (power !== null && power > 50) {
        alertState.noProd = false;
    }
}

// ─────────────────────────────────────────────
// Widget A.V.A.T.A.R
// ─────────────────────────────────────────────
export async function onClose(widgets) {
    stopWebServer();
    if (Config.modules.alphaEss.widget.display === true) {
        await Widget.initVar(widgetFolder, widgetImgFolder, null, Config.modules.alphaEss);
        if (widgets) await Widget.saveWidgets(widgets);
    }
    if (AlphaWindow) {
        const pos = AlphaWindow.getPosition();
        fs.writeJsonSync(styleFile, { x: pos[0], y: pos[1], start: true });
    } else {
        let prop = fs.existsSync(styleFile) ? (fs.readJsonSync(styleFile, { throws: false }) || {}) : {};
        prop.start = false;
        fs.writeJsonSync(styleFile, prop);
    }
}

export async function getWidgetsOnLoad() {
    if (Config.modules.alphaEss.widget.display === true) {
        await Widget.initVar(widgetFolder, widgetImgFolder, null, Config.modules.alphaEss);
        let widgets = await Widget.getWidgets();
        return { plugin: "alphaEss", widgets, Config: Config.modules.alphaEss };
    }
}

export async function readyToShow() {
    if (fs.existsSync(styleFile)) {
        let prop = fs.readJsonSync(styleFile, { throws: false });
        currentwidgetState = prop?.start || false;
        if (currentwidgetState) openAlphaWindow();
    } else {
        currentwidgetState = false;
    }
    Avatar.Interface.refreshWidgetInfo({ plugin: 'alphaEss', id: "alphaEss_001" });
}

export async function getNewButtonState(arg) {
    return currentwidgetState === true ? 'On' : 'Off';
}

export async function getPeriphInfo() { return periphInfo; }

export async function widgetAction(even) {
    currentwidgetState = even.value.action === 'On';
    if (!AlphaWindow && even.value.action === 'On') return openAlphaWindow();
    if (AlphaWindow  && even.value.action === 'Off') AlphaWindow.destroy();
}

// ─────────────────────────────────────────────
// Fenêtre dashboard
// ─────────────────────────────────────────────
const openAlphaWindow = async () => {
    if (AlphaWindow) return AlphaWindow.show();

    let style = {
        parent: Avatar.Interface.mainWindow(),
        frame: false, movable: true, resizable: false,
        minimizable: false, alwaysOnTop: false, show: false,
        width: 350, height: 850, opacity: 1,
        icon: path.resolve(__dirname, 'assets', 'images', 'alphaEss.png'),
        webPreferences: { preload: path.resolve(__dirname, 'alphaEss-preload.js') },
        title: "Alpha ESS Dashboard"
    };

    if (fs.existsSync(styleFile)) {
        let prop = fs.readJsonSync(styleFile, { throws: false });
        if (prop) { style.x = prop.x; style.y = prop.y; }
    }

    AlphaWindow = await Avatar.Interface.BrowserWindow(style, path.resolve(__dirname, 'alphaEss.html'), false);

    AlphaWindow.once('ready-to-show', () => {
        AlphaWindow.show();
        AlphaWindow.webContents.send('onInit-alphaEss');
        if (Config.modules.alphaEss?.devTools === true) {
            AlphaWindow.webContents.openDevTools({ mode: 'detach' });
        }
    });

    Avatar.Interface.ipcMain().handle('alphaEss-getData', async () => cachedData);
    Avatar.Interface.ipcMain().handle('alphaEss-getConfig', async () => Config.modules.alphaEss);

    Avatar.Interface.ipcMain().on('alphaEss-quit', () => {
        AlphaWindow.destroy();
        Avatar.Interface.refreshWidgetInfo({ plugin: 'alphaEss', id: "alphaEss_001" });
    });

    AlphaWindow.on('closed', () => {
        currentwidgetState = false;
        Avatar.Interface.ipcMain().removeHandler('alphaEss-getData');
        Avatar.Interface.ipcMain().removeHandler('alphaEss-getConfig');
        Avatar.Interface.ipcMain().removeAllListeners('alphaEss-quit');
        AlphaWindow = null;
    });
};

// ─────────────────────────────────────────────
// Commandes vocales
// ─────────────────────────────────────────────
export async function action(data, callback) {
    try {
        Locale = await Avatar.lang.getPak("alphaEss", data.language);
        if (!Locale) throw new Error(`alphaEss: Unable to find the '${data.language}' language pak.`);

        const tblActions = {
            solarProduction:  () => speakSolarProduction(data.client),
            batteryLevel:     () => speakBatteryLevel(data.client),
            currentPower:     () => speakCurrentPower(data.client),
            gridExchange:     () => speakGridExchange(data.client),
            homeConsumption:  () => speakHomeConsumption(data.client),
            dailyConsumption: () => speakDailyConsumption(data.client),
            gridImportExport: () => speakGridImportExport(data.client),
            selfSufficiency:  () => speakSelfSufficiency(data.client),
            selfConsumption:  () => speakSelfConsumption(data.client),
            savings:          () => speakSavings(data.client),
            co2:              () => speakCo2(data.client),
            peakPower:        () => speakPeakPower(data.client),
            fullStatus:       () => speakFullStatus(data.client),
        };

        info("alphaEss:", data.action.command, L.get("plugin.from"), data.client);

        if (!cachedData.lastUpdate || (Date.now() - cachedData.lastUpdate) > 120000) {
            await refreshData();
        }

        tblActions[data.action.command]?.();
    } catch (err) {
        if (data.client) Avatar.Speech.end(data.client);
        if (err.message) error(err.message);
    }
    callback();
}

// ─────────────────────────────────────────────
// Réponses vocales
// ─────────────────────────────────────────────
const noData = (client) => say(Locale.get("message.noData"), client);

const speakSolarProduction  = (c) => cachedData.solarToday === null   ? noData(c) : say(Locale.get(["message.solarProduction",  fr(cachedData.solarToday, 2)]), c);
const speakBatteryLevel     = (c) => cachedData.batterySOC === null   ? noData(c) : say(Locale.get(["message.batteryLevel",     fr(cachedData.batterySOC, 1)]), c);
const speakCurrentPower     = (c) => cachedData.currentPower === null ? noData(c) : say(Locale.get(["message.currentPower",     fr(cachedData.currentPower, 0), fr(cachedData.currentPower / 1000, 2)]), c);
const speakHomeConsumption  = (c) => cachedData.loadPower === null    ? noData(c) : say(Locale.get(["message.homeConsumption",  fr(cachedData.loadPower, 0)]), c);
const speakDailyConsumption = (c) => cachedData.loadToday === null    ? noData(c) : say(Locale.get(["message.dailyConsumption", fr(cachedData.loadToday, 2)]), c);
const speakSelfSufficiency  = (c) => cachedData.selfSufficiency===null? noData(c) : say(Locale.get(["message.selfSufficiency",  fr(cachedData.selfSufficiency, 1)]), c);
const speakSelfConsumption  = (c) => cachedData.selfConsumption===null? noData(c) : say(Locale.get(["message.selfConsumption",  fr(cachedData.selfConsumption, 1)]), c);
const speakPeakPower        = (c) => cachedData.peakPower === null    ? noData(c) : say(Locale.get(["message.peakPower",        fr(cachedData.peakPower, 0)]), c);

const speakGridExchange = (c) => {
    if (cachedData.gridPower === null) return noData(c);
    const key = cachedData.gridPower >= 0 ? "message.gridImporting" : "message.gridExporting";
    say(Locale.get([key, fr(Math.abs(cachedData.gridPower), 0)]), c);
};

const speakGridImportExport = (c) => {
    if (cachedData.gridImport === null) return noData(c);
    say(Locale.get(["message.gridImportExport", fr(cachedData.gridImport, 2), fr(cachedData.gridExport, 2)]), c);
};

const speakSavings = (c) => {
    if (cachedData.savingsToday === null) return noData(c);
    say(Locale.get(["message.savings", fr(cachedData.savingsToday, 2)]), c);
};

const speakCo2 = (c) => {
    if (cachedData.co2Avoided === null) return noData(c);
    say(Locale.get(["message.co2", fr(cachedData.co2Avoided, 2)]), c);
};

const speakFullStatus = (c) => {
    if (cachedData.solarToday === null) return noData(c);
    say(Locale.get([
        "message.fullStatus",
        fr(cachedData.currentPower    || 0, 0),
        fr(cachedData.batterySOC      || 0, 1),
        fr(cachedData.solarToday      || 0, 2),
        fr(cachedData.selfSufficiency || 0, 1),
        fr(cachedData.selfConsumption || 0, 1),
        fr(cachedData.loadToday       || 0, 2),
        fr(cachedData.savingsToday    || 0, 2),
        fr(cachedData.co2Avoided      || 0, 2),
    ]), c);
};

// ─────────────────────────────────────────────
// API Alpha ESS
// ─────────────────────────────────────────────
function buildAuthHeaders() {
    const appId     = Config.modules.alphaEss.appId;
    const appSecret = Config.modules.alphaEss.appSecret;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sign      = crypto.createHash('sha512').update(appId + appSecret + timestamp).digest('hex');
    return { 'Content-Type': 'application/json', appId, timeStamp: timestamp, sign };
}

async function apiCall(endpoint, params = {}) {
    const query   = new URLSearchParams(params).toString();
    const fullUrl = `https://openapi.alphaess.com/api${endpoint}${query ? '?' + query : ''}`;
    const response = await fetch(fullUrl, { method: 'GET', headers: buildAuthHeaders() });
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    const json = await response.json();
    if (json.code !== 200) throw new Error(`API code ${json.code}: ${json.msg}`);
    return json.data;
}

async function refreshData() {
    try {
        const sn    = Config.modules.alphaEss.serialNumber;
        const today = new Date().toISOString().split('T')[0];
        const cfg   = Config.modules.alphaEss;
        const kwh_price  = cfg.kwh_price  ?? 0.25;   // € / kWh
        // Réunion : mix électrique dominé par le fioul (centrale EDF SEI)
        // Facteur CO₂ réseau Réunion : ~730 g/kWh (centrale fuel) → 0.730 kg/kWh
        // Source : OER (Observatoire Énergie Réunion) + EDF facteur fuel
        // Photovoltaïque cycle de vie : ~55 g/kWh — on soustrait car le PV émet aussi un peu
        // CO₂ réellement évité = (fuel_factor - pv_factor) × production
        const fuel_factor = cfg.fuel_factor ?? 0.730;  // kg CO₂/kWh central fuel Réunion
        const pv_factor   = cfg.pv_factor   ?? 0.055;  // kg CO₂/kWh PV cycle de vie
        const co2_factor  = fuel_factor - pv_factor;   // = 0.675 kg CO₂ net évité par kWh
        const carbon_ratio = 12 / 44;                  // = 0.2727 — ratio molaire C/CO₂

        // 1. Puissance instantanée
        const powerData = await apiCall('/getLastPowerData', { sysSn: sn });
        if (powerData) {
            cachedData.currentPower = powerData.ppv   ?? 0;
            cachedData.batterySOC   = powerData.soc   ?? 0;
            cachedData.batteryTemp  = powerData.batTemp ?? null;
            cachedData.gridPower    = powerData.pgrid ?? 0;
            cachedData.loadPower    = powerData.pload ?? 0;
            cachedData.batteryPower = powerData.pbat  ?? 0;
            cachedData.evPower      = powerData.pev   ?? 0;

            // Pic journalier — remise à zéro à chaque nouveau jour
            const todayStr = new Date().toDateString();
            if (cachedData.peakDay !== todayStr) {
                cachedData.peakDay   = todayStr;
                cachedData.peakPower = 0;
            }
            if (cachedData.currentPower > cachedData.peakPower) {
                cachedData.peakPower = cachedData.currentPower;
                // Sauvegarde sur disque — résistant au redémarrage
                fs.writeJsonSync(peakFile, { day: todayStr, peak: cachedData.peakPower });
            }

            // ── Courbe 24h glissantes ────────────────────────────────────────────
            // On stocke un point à chaque cron et on purge les points > 24h
            const nowISO   = new Date().toISOString();
            const now24hAgo = Date.now() - 24 * 3600 * 1000;
            const lastPt   = cachedData.realtimeCurve[cachedData.realtimeCurve.length - 1];
            const lastMin  = lastPt ? lastPt.time.substring(0, 16) : '';

            if (nowISO.substring(0, 16) !== lastMin) {
                // Ajouter le nouveau point
                cachedData.realtimeCurve.push({
                    time: nowISO,
                    ppv:  cachedData.currentPower || 0,
                    load: cachedData.loadPower    || 0,
                    grid: cachedData.gridPower    || 0,
                    pbat: cachedData.batteryPower || 0,
                    soc:  cachedData.batterySOC   || 0,
                });

                // Purger les points de plus de 24h (fenêtre glissante)
                cachedData.realtimeCurve = cachedData.realtimeCurve.filter(
                    p => new Date(p.time).getTime() >= now24hAgo
                );

                // Sauvegarder sur disque (résistant au redémarrage)
                try {
                    fs.writeJsonSync(curveFile, {
                        saved:  nowISO,
                        points: cachedData.realtimeCurve
                    });
                } catch (e) {
                    warn('alphaEss: Impossible de sauvegarder la courbe — ' + e.message);
                }
            }
        }

        // 2. Énergie du jour
        const energyData = await apiCall('/getOneDateEnergyBySn', { sysSn: sn, queryDate: today });
        if (energyData) {
            cachedData.solarToday = energyData.epv     ?? 0;
            cachedData.gridImport = energyData.eInput  ?? 0;
            cachedData.gridExport = energyData.eOutput ?? 0;
            const eCharge    = energyData.eCharge    ?? 0;
            const eDischarge = energyData.eDischarge ?? 0;

            // Consommation totale maison
            cachedData.loadToday = Math.max(0,
                cachedData.solarToday + cachedData.gridImport - cachedData.gridExport + eDischarge - eCharge
            );

            // Énergie solaire utilisée localement :
            // = production directement consommée (sans export)
            //   + décharge batterie (énergie solaire stockée puis réutilisée)
            // On plafonne à la conso totale pour éviter > 100%
            const solarDirect   = Math.max(0, cachedData.solarToday - cachedData.gridExport - eCharge);
            const solarFromBat  = eDischarge;  // la décharge vient du solaire stocké
            const solarUsed     = Math.min(cachedData.loadToday, solarDirect + solarFromBat);

            cachedData.selfSufficiency = cachedData.loadToday > 0
                ? Math.min(100, (solarUsed / cachedData.loadToday) * 100) : 0;
            cachedData.selfConsumption = cachedData.solarToday > 0
                ? Math.min(100, (solarUsed / cachedData.solarToday) * 100) : 0;

            // Économies = énergie solaire utilisée × prix kWh
            cachedData.savingsToday = solarUsed * kwh_price;
            // CO₂ évité = énergie solaire utilisée × facteur net (fuel - pv)
            cachedData.co2Avoided     = solarUsed * co2_factor;
            // Carbone évité = CO₂ évité × ratio molaire C/CO₂ (12/44 = 0.2727)
            cachedData.carbonAvoided  = cachedData.co2Avoided * carbon_ratio;
        }

        // 3. Courbe — rafraîchie toutes les 5 minutes
        const lastCurveTs = cachedData.powerCurveUpdated || 0;
        if (Date.now() - lastCurveTs > 5 * 60 * 1000) {
            try {
                const curveData = await apiCall('/getOneDayPowerBySn', { sysSn: sn, queryDate: today });
                if (curveData && Array.isArray(curveData) && curveData.length > 0) {
                    cachedData.powerCurve = curveData.map(p => ({
                        time: p.uploadTime ?? p.time ?? p.statDate,
                        ppv:  p.ppv   ?? p.pvPower ?? 0,
                        load: p.pload ?? p.loadPower ?? 0,
                        grid: p.pgrid ?? p.gridPower ?? 0,
                    }));
                    cachedData.powerCurveUpdated = Date.now();
                }
            } catch(e) {
                error('alphaEss: Erreur courbe —', e.message);
            }
        }

        // 4. Historique 7 jours — jours passés en cache, aujourd'hui toujours mis à jour
        await refreshHistory(sn, today);

        cachedData.lastUpdate = Date.now();

        // Log toutes les 5 minutes seulement
        const now = new Date();
        if (now.getSeconds() < 31 && now.getMinutes() % 5 === 0) {
            // info(`alphaEss: PV:${cachedData.currentPower}W | Bat:${cachedData.batterySOC}% | Prod:${cachedData.solarToday}kWh | Éco:${cachedData.savingsToday?.toFixed(2)}€ | CO₂:${cachedData.co2Avoided?.toFixed(2)}kg`);
        }

    } catch (err) {
        error('alphaEss: Erreur API —', err.message);
    }
}

async function refreshHistory(sn, today) {
    try {
        let history = fs.existsSync(historyFile)
            ? (fs.readJsonSync(historyFile, { throws: false }) || [])
            : [];

        // 7 jours passés + aujourd'hui
        const days = [];
        for (let i = 6; i >= 1; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d.toISOString().split('T')[0]);
        }
        days.push(today); // aujourd'hui toujours en dernier

        const newHistory = [];
        for (const day of days) {
            // Jours passés : utiliser le cache si dispo
            // Aujourd'hui : toujours rafraîchir depuis l'API
            const cached = history.find(h => h.date === day);
            if (cached && day !== today) {
                newHistory.push(cached);
                continue;
            }
            try {
                const data = await apiCall('/getOneDateEnergyBySn', { sysSn: sn, queryDate: day });
                if (data) {
                    newHistory.push({
                        date:    day,
                        epv:     data.epv     ?? 0,
                        eInput:  data.eInput  ?? 0,
                        eOutput: data.eOutput ?? 0
                    });
                }
            } catch(e) {
                // Si l'API échoue pour un jour passé, on garde le cache
                if (cached) newHistory.push(cached);
            }
        }

        newHistory.sort((a, b) => a.date.localeCompare(b.date));
        fs.writeJsonSync(historyFile, newHistory);
        cachedData.history = newHistory;
    } catch(e) {
        error('alphaEss: Erreur historique —', e.message);
    }
}
