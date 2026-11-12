import { localTotality, toDate } from './besselian.js';

/* global L */

const LOCALE = 'de-DE';
const dateLong = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateShort = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const timeUtc = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const num = (v, digits = 1) => v.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const detailsEl = document.getElementById('details');
const placeEl = document.getElementById('place');
const selectEl = document.getElementById('select');
const prevEl = document.getElementById('prev');
const nextEl = document.getElementById('next');

// ---------------------------------------------------------------- Karte

// Die OSM-Kacheln sind fertige Bilder, ihre Schriftgröße lässt sich nicht einstellen. Auf Touch-Geräten
// wird deshalb das ganze Kartenbild vergrößert dargestellt (größere Kacheln bei passend skaliertem
// Koordinatensystem) - Beschriftungen werden entsprechend größer, das Bild etwas weicher.
const touchDevice = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
const TILE_SIZE = touchDevice ? 352 : 256;
const crs = L.extend({}, L.CRS.EPSG3857, {
    scale: zoom => TILE_SIZE * Math.pow(2, zoom),
    zoom: scale => Math.log(scale / TILE_SIZE) / Math.LN2,
});

const map = L.map('map', { crs, worldCopyJump: true, minZoom: touchDevice ? 1 : 2, zoomSnap: 0.5 }).setView([48, 10], 4);

// Deutscher OpenStreetMap-Kartenstil: gleiche Daten, Orte weltweit deutsch bzw. lateinisch beschriftet.
L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    tileSize: TILE_SIZE,
    maxZoom: 19,
    maxNativeZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
}).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

const pathLayer = L.layerGroup().addTo(map);
const tooltip = L.tooltip({ className: 'totality-tip', direction: 'right', offset: [14, 0], opacity: 1 });

let eclipses = [];
let current = null;
let pin = null; // markierter Ort: { lat, lon, marker }

// ---------------------------------------------------------------- Formatierung

function formatDuration(seconds) {
    const s = Math.round(seconds);
    return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

function formatCoord(lat, lon) {
    return `${num(Math.abs(lat), 3)}° ${lat >= 0 ? 'N' : 'S'}, ${num(Math.abs(lon), 3)}° ${lon >= 0 ? 'O' : 'W'}`;
}

const wrapLon = lon => ((lon + 540) % 360 + 360) % 360 - 180;

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

// ---------------------------------------------------------------- Zeitzonen (Ortszeit)

const zoneCache = new Map();   // Rasterzelle -> IANA-Zeitzone | Promise
const formatCache = new Map(); // IANA-Zeitzone -> { time, date } | null

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
            fmt = {
                time: new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short', timeZone: zone }),
                date: new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: zone }),
            };
        } catch {
            fmt = null; // Zeitzone dem Browser unbekannt
        }
        formatCache.set(zone, fmt);
    }
    return formatCache.get(zone);
}

/** Liefert Formatierer für die Ortszeit; solange die Zeitzone noch geladen wird, Weltzeit. */
function clockAt(lat, lon, onReady) {
    const zone = zoneAt(lat, lon);
    if (zone instanceof Promise) zone.then(onReady);
    const fmt = typeof zone === 'string' ? localFormat(zone) : null;
    return {
        time: t => (fmt ? fmt.time.format(toDate(current, t)) : `${timeUtc.format(toDate(current, t))} UTC`),
        date: t => (fmt ? fmt.date.format(toDate(current, t)) : dateShort.format(toDate(current, t))),
        label: typeof zone === 'string' ? (fmt ? zone.replace(/_/g, ' ') : 'Weltzeit') : 'wird ermittelt …',
    };
}

// ---------------------------------------------------------------- Infofenster: Finsternis

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
        <dl>${rows.join('')}</dl>`;
}

// ---------------------------------------------------------------- Infofenster: markierter Ort

function renderPlace() {
    if (!current) return;
    if (!pin) {
        placeEl.innerHTML = `
            <h2>Ort</h2>
            <p class="muted">Auf die Karte klicken oder tippen, um einen Ort zu markieren – hier erscheinen dann
            Beginn, Dauer und Sonnenhöhe der Totalität. Die Markierung lässt sich verschieben.</p>`;
        return;
    }

    const { lat, lon } = pin;
    const local = localTotality(current.elements, lat, lon);
    const mine = pin;
    const clock = clockAt(lat, lon, () => { if (pin === mine) renderPlace(); });
    const rows = [];
    const row = (label, value, cls = '') => rows.push(`<dt>${label}</dt><dd class="${cls}">${value}</dd>`);

    if (local) {
        row('Dauer der Totalität', formatDuration(local.durationSeconds), 'big');
        row('Datum', clock.date(local.max));
        row('Beginn', clock.time(local.start));
        row('Mitte', clock.time(local.max));
        row('Ende', clock.time(local.end));
        row('Sonnenhöhe', `${num(local.sunAltitude)}°`);
        row('Zeitzone', clock.label);
    }
    row('Koordinaten', formatCoord(lat, lon));

    placeEl.innerHTML = `
        <h2>Markierter Ort</h2>
        <div class="title">${local ? 'Im Totalitätsstreifen' : 'Außerhalb des Totalitätsstreifens'}</div>
        <div class="sub ${local ? '' : 'outside'}">${local
            ? `Totale Finsternis am ${dateShort.format(eclipseDate(current))}`
            : `Am ${dateShort.format(eclipseDate(current))} ist hier keine totale Finsternis zu sehen.`}</div>
        <dl>${rows.join('')}</dl>
        <button type="button" id="unpin">Markierung entfernen</button>`;
    document.getElementById('unpin').addEventListener('click', clearPin);
}

function setPin(latlng) {
    if (Math.abs(latlng.lat) > 90) return;
    if (!pin) {
        const marker = L.marker(latlng, { draggable: true, autoPan: true, title: 'Markierter Ort' }).addTo(map);
        marker.on('drag', () => movePin(marker.getLatLng()));
        pin = { marker };
    } else {
        pin.marker.setLatLng(latlng);
    }
    movePin(latlng);
}

function movePin(latlng) {
    pin = { marker: pin.marker, lat: latlng.lat, lon: wrapLon(latlng.lng) };
    renderPlace();
}

function clearPin() {
    if (pin) map.removeLayer(pin.marker);
    pin = null;
    renderPlace();
}

// ---------------------------------------------------------------- Auswahl und Pfad

function renderPicker() {
    selectEl.innerHTML = '';
    for (const e of eclipses) {
        const dur = e.greatest.durationSeconds != null ? formatDuration(e.greatest.durationSeconds) : 'nicht zentral';
        selectEl.add(new Option(`${dateShort.format(eclipseDate(e))} · ${dur}`, e.id));
    }
    selectEl.addEventListener('change', () => select(selectEl.value));
    prevEl.addEventListener('click', () => step(-1));
    nextEl.addEventListener('click', () => step(1));
}

function step(delta) {
    const target = eclipses[eclipses.indexOf(current) + delta];
    if (target) select(target.id);
}

async function select(id, { fit = true } = {}) {
    const e = eclipses.find(x => x.id === id);
    if (!e) return;
    current = e;
    hideTooltip();
    renderDetails(e);
    renderPlace();
    const index = eclipses.indexOf(e);
    selectEl.value = id;
    prevEl.disabled = index === 0;
    nextEl.disabled = index === eclipses.length - 1;
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

// ---------------------------------------------------------------- Tooltip (Maus)

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

    const clock = clockAt(lat, lon, () => { if (hover && hover.latlng === latlng) updateTooltip(); });
    tooltip.setLatLng(latlng).setContent(`
        <div class="tip-title">Totalität</div>
        <table>
            <tr><th>Beginn</th><td>${clock.time(local.start)}</td></tr>
            <tr><th>Ende</th><td>${clock.time(local.end)}</td></tr>
            <tr><th>Dauer</th><td>${formatDuration(local.durationSeconds)}</td></tr>
            <tr><th>Sonnenhöhe</th><td>${num(local.sunAltitude)}°</td></tr>
        </table>
        <div class="tip-zone">Ortszeit · ${clock.label}</div>`);
    if (!map.hasLayer(tooltip)) tooltip.addTo(map);
}

map.on('mousemove', ev => {
    // Auf Touch-Geräten lösen Tipper synthetische Mausereignisse aus - dort zählt nur die Markierung.
    if (ev.originalEvent?.sourceCapabilities?.firesTouchEvents) return;
    if (Math.abs(ev.latlng.lat) > 90) return hideTooltip();
    hover = { lat: ev.latlng.lat, lon: wrapLon(ev.latlng.lng), latlng: ev.latlng };
    if (!frame) frame = requestAnimationFrame(updateTooltip);
});
map.on('mouseout', hideTooltip);
map.on('click', ev => setPin(ev.latlng));

// ---------------------------------------------------------------- Eigener Standort

// Der Standort bleibt im Browser; er wird nicht an den Server übertragen.
const locateLayer = L.layerGroup().addTo(map);
let myPosition = null;   // L.LatLng
let watchId = null;
let highAccuracy = true;
let centerOnFix = false;
let locateButton = null;

function setLocateState(state, title) {
    locateButton.dataset.state = state;
    locateButton.title = title;
    locateButton.setAttribute('aria-label', title);
}

function onPosition(pos) {
    myPosition = L.latLng(pos.coords.latitude, pos.coords.longitude);
    locateLayer.clearLayers();
    L.circle(myPosition, {
        radius: pos.coords.accuracy, color: '#2a7fff', weight: 1, fillColor: '#2a7fff', fillOpacity: 0.12, interactive: false,
    }).addTo(locateLayer);
    L.circleMarker(myPosition, {
        radius: 7, color: '#fff', weight: 2.5, fillColor: '#2a7fff', fillOpacity: 1, interactive: false,
    }).addTo(locateLayer);
    setLocateState('active', 'Zum eigenen Standort springen');
    if (centerOnFix) {
        centerOnFix = false;
        map.setView(myPosition, Math.max(map.getZoom(), 6), { animate: false });
    }
}

function onPositionError(err) {
    if (myPosition) return; // letzte bekannte Position weiter anzeigen
    navigator.geolocation.clearWatch(watchId);
    watchId = null;

    // Manche Browser (u. a. Firefox für Android) liefern mit "hoher Genauigkeit" nur per GPS und laufen
    // in Gebäuden in eine Zeitüberschreitung - dann genügt die gröbere Netzwerk-Ortung.
    if (err.code !== err.PERMISSION_DENIED && highAccuracy) {
        highAccuracy = false;
        startWatching();
        return;
    }

    const wanted = centerOnFix; // nur melden, wenn der Benutzer selbst danach gefragt hat
    centerOnFix = false;
    const message = !window.isSecureContext
        ? 'Den Standort geben Browser nur über eine HTTPS-Verbindung heraus.'
        : err.code === err.PERMISSION_DENIED
            ? 'Standort nicht freigegeben. Bitte den Standortzugriff für diese Seite (und in Android für den Browser) erlauben.'
            : 'Standort konnte nicht ermittelt werden. Ist die Ortung des Geräts eingeschaltet?';
    setLocateState('error', message);
    if (wanted) showNotice(message);
}

function startWatching() {
    if (watchId !== null || !navigator.geolocation) return;
    setLocateState('busy', 'Standort wird ermittelt …');
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
        enableHighAccuracy: highAccuracy, maximumAge: 30000, timeout: highAccuracy ? 12000 : 30000,
    });
}

/** Kurze Meldung über der Karte - Tooltips der Schaltflächen sind auf Touch-Geräten nicht sichtbar. */
function showNotice(text) {
    let el = document.getElementById('notice');
    if (!el) {
        el = document.createElement('div');
        el.id = 'notice';
        el.setAttribute('role', 'status');
        map.getContainer().append(el);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => { el.hidden = true; }, 8000);
}

if (navigator.geolocation) {
    const LocateControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-control');
            locateButton = L.DomUtil.create('a', '', bar);
            locateButton.href = '#';
            locateButton.role = 'button';
            locateButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle class="dot" cx="12" cy="12" r="2.6"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            setLocateState('idle', 'Eigenen Standort anzeigen');
            L.DomEvent.disableClickPropagation(bar);
            L.DomEvent.on(locateButton, 'click', ev => {
                L.DomEvent.preventDefault(ev);
                if (myPosition) {
                    map.setView(myPosition, Math.max(map.getZoom(), 6), { animate: false });
                } else {
                    centerOnFix = true;
                    if (watchId === null) highAccuracy = true; // neuer Versuch nach einem Fehler
                    startWatching();
                }
            });
            return bar;
        },
    });
    map.addControl(new LocateControl());

    // Ist der Standort bereits freigegeben, wird er ohne Nachfrage angezeigt (ohne die Karte zu verschieben).
    navigator.permissions?.query({ name: 'geolocation' })
        .then(status => { if (status.state === 'granted') startWatching(); })
        .catch(() => { });
}

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
    renderPicker();

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
