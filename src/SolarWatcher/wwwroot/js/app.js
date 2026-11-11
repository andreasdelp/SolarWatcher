import { localTotality, toDate } from './besselian.js';

/* global L */

const LOCALE = 'de-DE';
const dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateShort = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const timeUtc = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const num = (v, digits = 1) => v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const detailsEl = document.getElementById('details');
const listEl = document.getElementById('list');

// ---------------------------------------------------------------- Karte

const map = L.map('map', { worldCopyJump: true, minZoom: 2, zoomSnap: 0.5 }).setView([48, 10], 4);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
}).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

const pathLayer = L.layerGroup().addTo(map);
const tooltip = L.tooltip({ className: 'totality-tip', direction: 'right', offset: [14, 0], opacity: 1 });

let eclipses = [];
let current = null;

// ---------------------------------------------------------------- Formatierung

function formatDuration(seconds) {
    const s = Math.round(seconds);
    return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

function formatCoord(lat, lon) {
    return `${num(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${num(Math.abs(lon), 2)}° ${lon >= 0 ? 'O' : 'W'}`;
}

function eclipseDate(e) {
    const [y, m, d] = e.date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function countdown(e) {
    const days = Math.round((eclipseDate(e) - Date.now()) / 86400000);
    if (days < 0) return 'bereits vorbei';
    if (days === 0) return 'heute';
    if (days < 365) return `in ${days} Tagen`;
    return `in ${num(days / 365.25, 1)} Jahren`;
}

// ---------------------------------------------------------------- Infofenster

function renderDetails(e) {
    const g = e.greatest;
    const rows = [];
    const row = (label, value) => rows.push(`<dt>${label}</dt><dd>${value}</dd>`);

    row('Typ', e.central ? 'Total' : 'Total (nicht zentral)');
    if (g.timeUtc) row('Größte Finsternis', `${timeUtc.format(new Date(g.timeUtc))} UTC`);
    if (g.lat != null) row('Ort der größten Finsternis', formatCoord(g.lat, g.lon));
    if (g.durationSeconds != null) row('Längste Totalität', formatDuration(g.durationSeconds));
    if (g.pathWidthKm != null) row('Breite des Streifens', `ca. ${Math.round(g.pathWidthKm)} km`);
    if (g.sunAltitude != null) row('Sonnenhöhe dort', `${num(g.sunAltitude)}°`);
    if (e.totalityStartUtc) {
        row('Kernschatten auf der Erde', `${timeUtc.format(new Date(e.totalityStartUtc)).slice(0, 5)} – ${timeUtc.format(new Date(e.totalityEndUtc)).slice(0, 5)} UTC`);
    }
    row('Größe (Magnitude)', num(e.magnitude, 4));
    row('Gamma', num(e.gamma, 4));
    row('Saros-Zyklus', `${e.saros} (Nr. ${e.sarosMember} von ${e.sarosCount})`);
    row('ΔT', `${num(e.elements.deltaT)} s`);

    detailsEl.innerHTML = `
        <h2>Ausgewählte Finsternis</h2>
        <div class="date">${dateLong.format(eclipseDate(e))}</div>
        <div class="sub">Totale Sonnenfinsternis · ${countdown(e)}</div>
        <dl>${rows.join('')}</dl>
        <p class="hint">Maus über den Totalitätsstreifen bewegen (oder antippen): Beginn und Dauer der Totalität in Ortszeit sowie die Sonnenhöhe.</p>`;
}

function renderList() {
    const today = Date.now() - 86400000;
    listEl.innerHTML = '';
    for (const e of eclipses) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.id = e.id;
        if (eclipseDate(e) < today) btn.classList.add('past');
        const dur = e.greatest.durationSeconds != null ? formatDuration(e.greatest.durationSeconds) : 'nicht zentral';
        btn.innerHTML = `<span>${dateShort.format(eclipseDate(e))}</span><span class="dur">${dur}</span>`;
        btn.addEventListener('click', () => select(e.id));
        li.append(btn);
        listEl.append(li);
    }
}

// ---------------------------------------------------------------- Auswahl und Pfad

async function select(id, { fit = true } = {}) {
    const e = eclipses.find(x => x.id === id);
    if (!e) return;
    current = e;
    hideTooltip();
    renderDetails(e);
    for (const btn of listEl.querySelectorAll('button')) {
        const active = btn.dataset.id === id;
        btn.setAttribute('aria-current', active ? 'true' : 'false');
        if (active) btn.scrollIntoView({ block: 'nearest' });
    }
    history.replaceState(null, '', `#${id}`);

    const res = await fetch(`api/eclipses/${id}/path`);
    if (!res.ok || current !== e) return;
    const path = await res.json();

    pathLayer.clearLayers();
    // Der Streifen wird auch in den Nachbarkopien der Weltkarte gezeichnet.
    for (const shift of [-360, 0, 360]) {
        const move = pts => pts.map(([lat, lon]) => [lat, lon + shift]);
        L.polygon(move(path.polygon), {
            color: '#1b2140', weight: 1, opacity: 0.7,
            fillColor: '#10142b', fillOpacity: 0.45, interactive: false,
        }).addTo(pathLayer);
        if (path.central.length > 1) {
            L.polyline(move(path.central), { color: '#e5484d', weight: 2, interactive: false }).addTo(pathLayer);
        }
        if (e.greatest.lat != null) {
            // Länge an die stetig fortgesetzte Zentrallinie anpassen
            const ref = path.central[Math.floor(path.central.length / 2)][1];
            const lon = e.greatest.lon + Math.round((ref - e.greatest.lon) / 360) * 360 + shift;
            L.circleMarker([e.greatest.lat, lon], {
                radius: 6, color: '#1a1405', weight: 1.5, fillColor: '#f6c453', fillOpacity: 1, interactive: false,
            }).addTo(pathLayer);
        }
    }

    if (fit && path.polygon.length) {
        const lats = path.polygon.map(p => Math.max(-80, Math.min(80, p[0])));
        const lons = path.polygon.map(p => p[1]);
        map.fitBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { padding: [30, 30], maxZoom: 6, animate: false });
    }
}

// ---------------------------------------------------------------- Zeitzonen (Ortszeit am Mauszeiger)

const zoneCache = new Map();   // Rasterzelle -> IANA-Zeitzone | Promise
const formatCache = new Map(); // IANA-Zeitzone -> Intl.DateTimeFormat

function zoneAt(lat, lon) {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    if (!zoneCache.has(key)) {
        const promise = fetch(`api/timezone?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`)
            .then(r => (r.ok ? r.json() : null))
            .then(j => {
                const zone = j?.timeZone ?? 'UTC';
                zoneCache.set(key, zone);
                return zone;
            })
            .catch(() => { zoneCache.delete(key); return null; });
        zoneCache.set(key, promise);
    }
    return zoneCache.get(key);
}

function localFormat(zone) {
    if (!formatCache.has(zone)) {
        let fmt;
        try {
            fmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', timeZone: zone });
        } catch {
            fmt = null; // Zeitzone dem Browser unbekannt
        }
        formatCache.set(zone, fmt);
    }
    return formatCache.get(zone);
}

// ---------------------------------------------------------------- Tooltip

let hover = null; // { lat, lon, latlng }
let frame = 0;

function hideTooltip() {
    hover = null;
    if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
}

function updateTooltip() {
    frame = 0;
    if (!hover || !current) return;
    const { lat, lon, latlng } = hover;
    const local = localTotality(current.elements, lat, lon);
    if (!local) {
        if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
        return;
    }

    const zone = zoneAt(lat, lon);
    if (zone instanceof Promise) zone.then(() => { if (hover && hover.latlng === latlng) updateTooltip(); });
    const fmt = typeof zone === 'string' ? localFormat(zone) : null;
    const time = t => (fmt ? fmt.format(toDate(current, t)) : `${timeUtc.format(toDate(current, t))} UTC`);
    const zoneLabel = typeof zone === 'string' ? (fmt ? `Ortszeit · ${zone.replace(/_/g, ' ')}` : 'Weltzeit') : 'Ortszeit wird ermittelt …';

    tooltip.setLatLng(latlng).setContent(`
        <div class="tip-title">Totalität</div>
        <table>
            <tr><th>Beginn</th><td>${time(local.start)}</td></tr>
            <tr><th>Ende</th><td>${time(local.end)}</td></tr>
            <tr><th>Dauer</th><td>${formatDuration(local.durationSeconds)}</td></tr>
            <tr><th>Sonnenhöhe</th><td>${num(local.sunAltitude)}°</td></tr>
        </table>
        <div class="tip-zone">${zoneLabel}</div>`);
    if (!map.hasLayer(tooltip)) tooltip.addTo(map);
}

function onPointer(ev) {
    const lat = ev.latlng.lat;
    if (Math.abs(lat) > 90) return hideTooltip();
    hover = { lat, lon: ((ev.latlng.lng + 540) % 360 + 360) % 360 - 180, latlng: ev.latlng };
    if (!frame) frame = requestAnimationFrame(updateTooltip);
}

map.on('mousemove', onPointer);
map.on('click', onPointer);
map.on('mouseout', hideTooltip);

// ---------------------------------------------------------------- Start

async function init() {
    try {
        const res = await fetch('api/eclipses');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        eclipses = await res.json();
    } catch (err) {
        detailsEl.innerHTML = `<p class="muted">Die Finsternisdaten konnten nicht geladen werden (${err.message}).</p>`;
        return;
    }
    renderList();

    const wanted = location.hash.slice(1);
    const today = Date.now() - 86400000;
    const first = eclipses.find(e => e.id === wanted) ?? eclipses.find(e => eclipseDate(e) >= today) ?? eclipses[0];
    if (first) await select(first.id);

    // Direktlinks wie .../#2027-08-02
    window.addEventListener('hashchange', () => {
        const id = location.hash.slice(1);
        if (id && id !== current?.id) select(id);
    });
}

init();
