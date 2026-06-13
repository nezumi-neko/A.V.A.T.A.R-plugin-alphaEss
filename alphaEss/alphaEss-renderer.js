// ─────────────────────────────────────────────
// alphaEss-renderer.js v2.0
// ─────────────────────────────────────────────

// ── Thème automatique jour/nuit + bouton manuel ──
let isDark = true;
let manualOverride = false; // true si l'utilisateur a cliqué manuellement

// Calcul lever/coucher soleil pour La Réunion (-21.115°, 55.536°)
// Algorithme simplifié (précision ~5 min, sans lib externe)
function getSunTimes() {
    const LAT  =  -21.115;
    const LNG  =   55.536;
    const now  = new Date();
    const rad  = Math.PI / 180;

    // Jour julien
    const JD = (now.getTime() / 86400000) + 2440587.5;
    const n  = Math.round(JD - 2451545.0 + 0.0008);
    const Jstar = n - LNG / 360;
    const M  = (357.5291 + 0.98560028 * Jstar) % 360;
    const C  = 1.9148 * Math.sin(M * rad) + 0.0200 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const lam = (M + C + 180 + 102.9372) % 360;
    const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    const decl = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad)) / rad;
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(LAT * rad) * Math.sin(decl * rad))
               / (Math.cos(LAT * rad) * Math.cos(decl * rad));

    if (cosW < -1 || cosW > 1) return null; // soleil toujours levé/couché

    const W0 = Math.acos(cosW) / rad;
    const Jrise = Jtransit - W0 / 360;
    const Jset  = Jtransit + W0 / 360;

    // Convertir en heure locale
    const toLocal = jd => new Date((jd - 2440587.5) * 86400000);
    return { rise: toLocal(Jrise), set: toLocal(Jset) };
}

function applyAutoTheme() {
    if (manualOverride) return; // l'utilisateur a choisi manuellement
    const times = getSunTimes();
    const now   = new Date();
    let isDay;
    if (!times) {
        isDay = true; // par défaut jour si calcul impossible
    } else {
        isDay = now >= times.rise && now <= times.set;
    }
    isDark = !isDay;
    document.body.classList.toggle('light', isDay);
    // Icône soleil/lune
    const sunEl = document.getElementById('sun-icon');
    if (sunEl) sunEl.textContent = isDay ? '☀️' : '🌙';
}

// Bouton manuel — override pendant 1h puis reprend l'automatique
document.getElementById('btn-theme').addEventListener('click', () => {
    isDark = !isDark;
    document.body.classList.toggle('light', !isDark);
    manualOverride = true;
    // Reprend le mode auto après 1 heure
    setTimeout(() => {
        manualOverride = false;
        applyAutoTheme();
    }, 3600000);
});

// Applique le thème au démarrage et toutes les minutes
applyAutoTheme();
setInterval(applyAutoTheme, 60000);

// ── Fermeture ──
window.onbeforeunload = (e) => { e.returnValue = false; window.electronAPI.quit(); };
document.getElementById('btn-quit').addEventListener('click', () => window.dispatchEvent(new Event('beforeunload')));

// ── Formatage français ──
// fr()  : supprime les zéros inutiles   ex: 3.00 → "3"   | 2.40 → "2,4"
// fr2() : toujours 2 décimales          ex: 3.00 → "3,00" | 2.40 → "2,40"
function fr(number, decimals = 1) {
    const n = Number(number);
    if (n % 1 === 0) return n.toLocaleString('fr-FR');
    return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
function fr2(number) {
    return Number(number).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ── Graphique multi-courbes (canvas natif) ──
// Courbes : PV (jaune), Maison (bleu), Import EDF (marron), Export réseau (rouge), SOC % (vert axe droit)
// Axe gauche : Watts | Axe droit : SOC batterie % | Affichage 24h glissantes
function drawChart(curve) {
    const canvas = document.getElementById('chart-power');
    const empty  = document.getElementById('chart-empty');
    if (!curve || curve.length === 0) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const sorted = [...curve].sort((a, b) => {
        if (!a.time || !b.time) return 0;
        return new Date(a.time) - new Date(b.time);
    });

    const ctx = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const W = canvas.width, H = canvas.height;
    const pad = { t: 22, r: 32, b: 18, l: 34 };

    // ── Données par série ──
    const pvVals     = sorted.map(p => Math.max(0, p.ppv  || 0));
    const loadVals   = sorted.map(p => Math.max(0, p.load || 0));
    const socVals    = sorted.map(p => (p.soc != null && p.soc > 0) ? p.soc : null);
    const gridVals   = sorted.map(p => p.grid || 0);
    const importVals = gridVals.map(g => Math.max(0,  g));
    const exportVals = gridVals.map(g => Math.max(0, -g));

    const maxW  = Math.max(...pvVals, ...loadVals, ...importVals, ...exportVals, 100);
    const hasSoc = socVals.some(v => v !== null);

    const toX    = i => pad.l + i * (W - pad.l - pad.r) / Math.max(sorted.length - 1, 1);
    const toY    = v => pad.t + (H - pad.t - pad.b) * (1 - v / maxW);
    const toYsoc = v => pad.t + (H - pad.t - pad.b) * (1 - v / 100);

    ctx.clearRect(0, 0, W, H);

    // ── Grille + axes ──
    const gridColor  = isDark ? '#1e2d40' : '#dde6ee';
    const labelColor = isDark ? '#556677' : '#99aabb';
    ctx.font = '8px sans-serif';
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
        ctx.strokeStyle = gridColor; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.fillStyle = labelColor; ctx.textAlign = 'right';
        ctx.fillText(fr(maxW * i / 4, 0), pad.l - 2, y + 3);
        if (hasSoc) {
            ctx.fillStyle = '#27ae60'; ctx.textAlign = 'left';
            ctx.fillText((25 * i) + '%', W - pad.r + 2, y + 3);
        }
    }

    // ── Aire sous courbe ──
    function drawArea(vals, colorAlpha, useSoc = false) {
        ctx.beginPath();
        ctx.moveTo(toX(0), H - pad.b);
        vals.forEach((v, i) => ctx.lineTo(toX(i), useSoc ? toYsoc(v ?? 0) : toY(v)));
        ctx.lineTo(toX(vals.length - 1), H - pad.b);
        ctx.closePath();
        ctx.fillStyle = colorAlpha;
        ctx.fill();
    }

    // ── Ligne pleine (tous les traits en plein, pas de tirets) ──
    function drawLine(vals, color, width = 1.5, useSoc = false) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        let started = false;
        vals.forEach((v, i) => {
            if (v === null) return;
            const y = useSoc ? toYsoc(v) : toY(v);
            if (!started) { ctx.moveTo(toX(i), y); started = true; }
            else ctx.lineTo(toX(i), y);
        });
        ctx.stroke();
    }

    // ── Dessin (aires d'abord, lignes dessus) ──
    drawArea(importVals, 'rgba(139,69,19,0.15)');
    drawArea(exportVals, 'rgba(231,76,60,0.12)');
    drawArea(loadVals,   'rgba(52,152,219,0.15)');
    drawArea(pvVals,     'rgba(245,200,0,0.25)');
    if (hasSoc) drawArea(socVals.map(v => v ?? 0), 'rgba(39,174,96,0.08)', true);

    drawLine(importVals, '#8B4513', 1.2);       // marron — Import EDF
    drawLine(exportVals, '#e74c3c', 1.2);       // rouge  — Export réseau
    drawLine(loadVals,   '#3498db', 1.5);       // bleu   — Maison
    drawLine(pvVals,     '#f5c800', 2);         // jaune  — PV
    if (hasSoc) drawLine(socVals, '#27ae60', 1.5, true); // vert — SOC (axe droit)

    // ── Légende ──
    const legends = [
        { color: '#f5c800', label: 'PV' },
        { color: '#3498db', label: 'Maison' },
        { color: '#8B4513', label: 'Import' },
        { color: '#e74c3c', label: 'Export' },
    ];
    if (hasSoc) legends.push({ color: '#27ae60', label: 'SOC %' });
    ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
    legends.forEach((l, i) => {
        const lx = pad.l + i * ((W - pad.l - pad.r) / legends.length);
        ctx.fillStyle = l.color;
        ctx.fillRect(lx, 4, 6, 5);
        ctx.fillStyle = labelColor;
        ctx.fillText(l.label, lx + 8, 9);
    });

    // ── Axe des heures — 8 repères ──
    ctx.fillStyle = labelColor; ctx.textAlign = 'center';
    const totalPts = sorted.length;
    const labelStep = Math.max(1, Math.floor(totalPts / Math.min(8, totalPts)));
    sorted.forEach((p, i) => {
        if (i % labelStep === 0 && p.time) {
            const t = new Date(p.time);
            const label = `${t.getHours()}h${t.getMinutes() > 0 ? String(t.getMinutes()).padStart(2,'0') : ''}`;
            ctx.fillText(label, toX(i), H - 2);
        }
    });

    // ── Tooltip au clic / touch ───────────────────────────────────────────────
    // Stocke les données pour le handler
    canvas._chartData = { sorted, toX, toY, toYsoc, hasSoc, maxW, pad, W, H, labelColor, gridColor };
}

// ── Handler tooltip (installé une seule fois) ──────────────────────────────
function installChartTooltip() {
    const canvas = document.getElementById('chart-power');
    if (!canvas || canvas._tooltipInstalled) return;
    canvas._tooltipInstalled = true;

    function showTooltip(evt) {
        const d = canvas._chartData;
        if (!d) return;

        const rect  = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        const mx = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left) * scaleX;
        const my = ((evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top)  * scaleY;

        // Trouver l'index le plus proche sur l'axe X
        const { sorted, toX, toY, toYsoc, hasSoc, maxW, pad, W, H, labelColor } = d;
        if (!sorted || sorted.length === 0) return;

        let closest = 0;
        let minDist = Infinity;
        sorted.forEach((p, i) => {
            const dist = Math.abs(toX(i) - mx);
            if (dist < minDist) { minDist = dist; closest = i; }
        });

        const pt  = sorted[closest];
        const ctx = canvas.getContext('2d');

        // Redessiner le graphique
        drawChart(sorted);

        // Ligne verticale
        const cx2 = toX(closest);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cx2, pad.t); ctx.lineTo(cx2, H - pad.b); ctx.stroke();
        ctx.setLineDash([]);

        // Bulle tooltip
        const t = new Date(pt.time);
        const hLabel = `${t.getHours()}h${String(t.getMinutes()).padStart(2,'0')}`;
        const lines = [
            `🕐 ${hLabel}`,
            `☀️ PV : ${Math.round(pt.ppv || 0)} W`,
            `🏠 Maison : ${Math.round(pt.load || 0)} W`,
        ];
        if ((pt.grid || 0) > 0)  lines.push(`📥 Import : ${Math.round(pt.grid)} W`);
        if ((pt.grid || 0) < 0)  lines.push(`📤 Export : ${Math.round(-pt.grid)} W`);
        if (hasSoc && pt.soc > 0) lines.push(`🔋 SOC : ${Math.round(pt.soc)} %`);

        const bw = 110, bh = lines.length * 13 + 8;
        let bx = cx2 + 6;
        let by = Math.max(pad.t, my - bh / 2);
        if (bx + bw > W - pad.r) bx = cx2 - bw - 6;
        if (by + bh > H - pad.b) by = H - pad.b - bh;

        ctx.fillStyle = isDark ? 'rgba(20,35,55,0.95)' : 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fill(); ctx.stroke();

        ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
        const colors = ['#aabbcc','#f5c800','#3498db','#8B4513','#e74c3c','#27ae60'];
        lines.forEach((line, i) => {
            ctx.fillStyle = colors[i] || labelColor;
            ctx.fillText(line, bx + 6, by + 11 + i * 13);
        });
    }

    canvas.addEventListener('mousemove', showTooltip);
    canvas.addEventListener('touchstart', showTooltip, { passive: true });
    canvas.addEventListener('mouseleave', () => {
        const d = canvas._chartData;
        if (d) drawChart(d.sorted);
    });

    // ── Double-clic → fenêtre modale agrandie ──────────────────────────────
    canvas.addEventListener('dblclick', openChartModal);
    // Touch : double-tap détecté manuellement
    let lastTap = 0;
    canvas.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTap < 350) openChartModal();
        lastTap = now;
    });
}

// ── Modale plein écran — fenêtre agrandie de la courbe ────────────────────────
function openChartModal() {
    const d = document.getElementById('chart-power')?._chartData;
    if (!d) return;

    // Éviter les doublons
    if (document.getElementById('chart-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'chart-modal';
    modal.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: ${isDark ? 'rgba(10,18,30,0.97)' : 'rgba(240,244,248,0.97)'};
        display: flex; flex-direction: column;
        align-items: stretch; padding: 12px;
        -webkit-app-region: no-drag;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
    header.innerHTML = `
        <span style="font-size:13px; font-weight:700; color:var(--accent)">📈 Courbe 24h — détail</span>
        <span id="chart-modal-close" style="cursor:pointer; font-size:18px; color:var(--text-dim); padding:4px 8px;">✕</span>
    `;
    modal.appendChild(header);

    // Canvas agrandi
    const bigCanvas = document.createElement('canvas');
    bigCanvas.id = 'chart-modal-canvas';
    bigCanvas.style.cssText = 'flex:1; width:100%; border-radius:8px;';
    modal.appendChild(bigCanvas);

    document.body.appendChild(modal);

    // Dessiner la courbe agrandie
    requestAnimationFrame(() => {
        bigCanvas.width  = bigCanvas.offsetWidth;
        bigCanvas.height = bigCanvas.offsetHeight;

        // Réutiliser drawChart en ciblant temporairement le canvas modal
        const origCanvas = document.getElementById('chart-power');
        const origId = origCanvas.id;
        origCanvas.id = '_chart_hidden';
        bigCanvas.id  = 'chart-power';

        drawChart(d.sorted);

        // Restaurer les IDs
        bigCanvas.id  = 'chart-modal-canvas';
        origCanvas.id = origId;

        // Installer le tooltip sur le canvas modal aussi
        bigCanvas._chartData = bigCanvas._chartData || document.getElementById('chart-power')._chartData;

        // Tooltip sur la modale
        function modalTooltip(evt) {
            const rect  = bigCanvas.getBoundingClientRect();
            const scaleX = bigCanvas.width / rect.width;
            const mx = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left) * scaleX;
            const my = ((evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top) * (bigCanvas.height / rect.height);

            const dd = bigCanvas._chartData;
            if (!dd) return;

            // Recalculer les helpers avec les dimensions du canvas modal
            const W2 = bigCanvas.width, H2 = bigCanvas.height;
            const pad2 = {t:22, r:32, b:18, l:34};
            const toX2 = i => pad2.l + i * (W2-pad2.l-pad2.r) / Math.max(dd.sorted.length-1, 1);
            const toY2 = v => pad2.t + (H2-pad2.t-pad2.b) * (1 - v / dd.maxW);
            const toYsoc2 = v => pad2.t + (H2-pad2.t-pad2.b) * (1 - v / 100);

            let closest=0, minDist=Infinity;
            dd.sorted.forEach((p,i) => {
                const dist = Math.abs(toX2(i) - mx);
                if (dist < minDist) { minDist = dist; closest = i; }
            });

            const pt  = dd.sorted[closest];
            const ctx = bigCanvas.getContext('2d');

            // Redessiner (via swap temporaire)
            origCanvas.id = '_chart_hidden';
            bigCanvas.id  = 'chart-power';
            drawChart(dd.sorted);
            bigCanvas.id  = 'chart-modal-canvas';
            origCanvas.id = origId;

            const cx2 = toX2(closest);
            ctx.strokeStyle='rgba(255,255,255,0.4)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
            ctx.beginPath(); ctx.moveTo(cx2,pad2.t); ctx.lineTo(cx2,H2-pad2.b); ctx.stroke();
            ctx.setLineDash([]);

            const t = new Date(pt.time);
            const hLabel = `${t.getHours()}h${String(t.getMinutes()).padStart(2,'0')}`;
            const lines = [
                {c:'#aabbcc', txt:`🕐 ${hLabel}`},
                {c:'#f5c800', txt:`☀️ PV: ${Math.round(pt.ppv||0)} W`},
                {c:'#3498db', txt:`🏠 Maison: ${Math.round(pt.load||0)} W`},
            ];
            if ((pt.grid||0)>0)  lines.push({c:'#8B4513', txt:`📥 Import: ${Math.round(pt.grid)} W`});
            if ((pt.grid||0)<0)  lines.push({c:'#e74c3c', txt:`📤 Export: ${Math.round(-pt.grid)} W`});
            if (dd.hasSoc && pt.soc>0) lines.push({c:'#27ae60', txt:`🔋 SOC: ${Math.round(pt.soc)} %`});

            const bw=120, bh=lines.length*14+10;
            let bx=cx2+8, by=Math.max(pad2.t, my-bh/2);
            if (bx+bw > W2-pad2.r) bx=cx2-bw-8;
            if (by+bh > H2-pad2.b) by=H2-pad2.b-bh;

            ctx.fillStyle = isDark?'rgba(20,35,55,0.96)':'rgba(255,255,255,0.96)';
            ctx.strokeStyle='rgba(255,255,255,0.2)'; ctx.lineWidth=1;
            ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,5); ctx.fill(); ctx.stroke();
            ctx.font='10px sans-serif'; ctx.textAlign='left';
            lines.forEach((l,i) => { ctx.fillStyle=l.c; ctx.fillText(l.txt, bx+7, by+13+i*14); });
        }

        bigCanvas.addEventListener('mousemove', modalTooltip);
        bigCanvas.addEventListener('touchmove',  modalTooltip, {passive:true});
        bigCanvas.addEventListener('mouseleave', () => {
            origCanvas.id='_chart_hidden'; bigCanvas.id='chart-power';
            drawChart(d.sorted);
            bigCanvas.id='chart-modal-canvas'; origCanvas.id=origId;
        });
    });

    // Fermeture
    const closeModal = () => modal.remove();
    document.getElementById('chart-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('dblclick', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key==='Escape') closeModal(); }, {once:true});
}

// ── Historique 7 jours ──
function drawHistory(history) {
    const container = document.getElementById('history-bars');
    if (!history || history.length === 0) return;
    const maxEpv = Math.max(...history.map(h => h.epv || 0), 1);
    container.innerHTML = '';
    history.forEach(h => {
        const pct = Math.round((h.epv / maxEpv) * 100);
        const date = new Date(h.date);
        const label = date.toLocaleDateString('fr-FR', { weekday: 'short' });
        const wrap = document.createElement('div');
        wrap.className = 'hist-bar-wrap';
        wrap.innerHTML = `
            <div class="hist-val">${fr(h.epv, 1)}</div>
            <div class="hist-bar" style="height:${pct}%"></div>
            <div class="hist-label">${label}</div>`;
        container.appendChild(wrap);
    });
}

// ── Flèches de flux animées (tirets SVG) ──
function setDash(dashId, mode, color) {
    // mode: 'lr' | 'rl' | 'tb' | 'bt' | 'off'
    const el = document.getElementById(dashId);
    if (!el) return;
    el.className.baseVal = 'dash'; // reset
    el.style.stroke = color || '#888';
    if (mode === 'off') {
        el.classList.add('anim-off');
    } else {
        el.classList.add('anim-' + mode);
    }
}

function updateFlux(d) {
    const pv   = d.currentPower || 0;
    const load = d.loadPower    || 0;
    const grid = d.gridPower    || 0;   // + = import, - = export
    const bat  = d.batteryPower || 0;   // + = charge, - = décharge
    const soc  = d.batterySOC   || 0;

    // ── Valeurs affichées ──
    setText('flux-pv',   fr(pv, 0)   + ' W');
    setText('flux-inv',  fr(pv, 0)   + ' W');   // onduleur = sortie PV
    setText('flux-load', fr(load, 0) + ' W');
    setText('flux-bat',  fr(soc, 1)  + ' %');
    setText('flux-grid', (grid > 0 ? '↓ ' : grid < 0 ? '↑ ' : '') + fr(Math.abs(grid), 0) + ' W');

    // Labels sur les liens
    setText('lval-pv',   fr(pv, 0)   + ' W');
    setText('lval-home', fr(load, 0) + ' W');
    setText('lval-grid', fr(Math.abs(grid), 0) + ' W');
    setText('lval-bat',  fr(Math.abs(bat), 0)  + ' W');

    // ── PV → Onduleur (toujours gauche→droite si production) ──
    if (pv > 20) {
        setDash('dash-pv-inv', 'lr', '#f0a500');
    } else {
        setDash('dash-pv-inv', 'off', '#f0a500');
    }

    // ── Onduleur → Maison (gauche→droite si l'onduleur alimente la maison) ──
    if (pv > 20 || bat < -20) {
        setDash('dash-inv-home', 'lr', '#2ecc71');
    } else {
        setDash('dash-inv-home', 'off', '#2ecc71');
    }

    // ── Maison ↔ EDF réseau ──
    if (grid > 50) {
        // Import réseau → maison : droite→gauche
        setDash('dash-home-grid', 'rl', '#e74c3c');
        setText('lval-grid', '↓ ' + fr(grid, 0) + ' W');
    } else if (grid < -50) {
        // Export maison → réseau : gauche→droite
        setDash('dash-home-grid', 'lr', '#2ecc71');
        setText('lval-grid', '↑ ' + fr(Math.abs(grid), 0) + ' W');
    } else {
        setDash('dash-home-grid', 'off', '#3498db');
        setText('lval-grid', '0 W');
    }

    // ── Onduleur ↕ Batterie ──
    // Alpha ESS : pbat > 0 = décharge (batterie → onduleur = ↑ bas vers haut)
    //             pbat < 0 = charge   (onduleur → batterie = ↓ haut vers bas)
    if (bat > 50) {
        setDash('dash-bat', 'bt', '#f39c12');
        setText('lval-bat', '↑ ' + fr(bat, 0) + ' W');
    } else if (bat < -50) {
        setDash('dash-bat', 'tb', '#f39c12');
        setText('lval-bat', '↓ ' + fr(Math.abs(bat), 0) + ' W');
    } else {
        setDash('dash-bat', 'off', '#f39c12');
        setText('lval-bat', '—');
    }

    // Icône soleil/lune gérée par applyAutoTheme()
}

// ── Couleur barre batterie ──
function setBarColor(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    if (pct < 20)      el.style.background = '#e74c3c';
    else if (pct < 50) el.style.background = '#f39c12';
    else               el.style.background = '#2ecc71';
}

// ── Mise à jour complète ──
function updateUI(d) {
    // Flux
    updateFlux(d);

    // Batterie
    const soc = d.batterySOC || 0;
    setText('val-soc', fr(soc, 1) + ' %');
    document.getElementById('bar-soc').style.width = Math.min(100, soc) + '%';
    setBarColor('bar-soc', soc);
    if (d.batteryTemp !== null && d.batteryTemp !== undefined) {
        setText('val-temp', '🌡️ ' + fr(d.batteryTemp, 1) + '°C');
    }

    // Bilan jour
    setText('val-solar',   fr(d.solarToday  || 0, 2));
    setText('val-loadday', fr(d.loadToday   || 0, 2));
    setText('val-import',  fr(d.gridImport  || 0, 2));
    setText('val-export',  fr(d.gridExport  || 0, 2));

    // Taux
    const suff = d.selfSufficiency || 0;
    const cons = d.selfConsumption || 0;
    setText('val-suff', fr(suff, 1) + ' %');
    document.getElementById('bar-suff').style.width = Math.min(100, suff) + '%';
    setText('val-cons', fr(cons, 1) + ' %');
    document.getElementById('bar-cons').style.width = Math.min(100, cons) + '%';

    // Économies + CO2
    setText('val-savings', fr(d.savingsToday  || 0, 2));
    setText('val-co2',     fr2(d.co2Avoided    || 0));
    setText('val-carbon',  fr2(d.carbonAvoided || 0));

    // Pic
    setText('val-peak',        fr(d.peakPower || 0, 0) + ' W');
    setText('val-peak-footer', fr(d.peakPower || 0, 0) + ' W');

    // Heure màj
    if (d.lastUpdate) {
        const t = new Date(d.lastUpdate);
        setText('val-update', t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }

    // Graphique — utilise la courbe temps réel si disponible, sinon powerCurve API
    const curve = (d.realtimeCurve && d.realtimeCurve.length > 2)
        ? d.realtimeCurve
        : d.powerCurve;
    drawChart(curve);

    // Historique
    if (d.history && d.history.length > 0) drawHistory(d.history);
}

// ── Rafraîchissement ──
async function refresh() {
    try {
        const data = await window.electronAPI.getData();
        if (data) updateUI(data);
    } catch(e) { console.error('alphaEss refresh error:', e); }
}

window.electronAPI.onInitAlphaEss(async () => {
    await refresh();
    installChartTooltip();
    setInterval(refresh, 30000);
});
