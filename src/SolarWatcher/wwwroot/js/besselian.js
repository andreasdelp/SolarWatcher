// Lokale Umstände einer totalen Sonnenfinsternis aus Besselschen Elementen.
// Entspricht Eclipses/Besselian.cs auf dem Server (Verfahren nach Explanatory Supplement / Meeus).

const DEG = Math.PI / 180;
const FLAT = 0.99664719; // 1 - Abplattung der Erde

function stateAt(e, t) {
    return {
        x: e.x[0] + t * (e.x[1] + t * (e.x[2] + t * e.x[3])),
        y: e.y[0] + t * (e.y[1] + t * (e.y[2] + t * e.y[3])),
        dx: e.x[1] + t * (2 * e.x[2] + t * 3 * e.x[3]),
        dy: e.y[1] + t * (2 * e.y[2] + t * 3 * e.y[3]),
        d: (e.d[0] + t * (e.d[1] + t * e.d[2])) * DEG,
        dd: (e.d[1] + 2 * t * e.d[2]) * DEG,
        l2: e.l2[0] + t * (e.l2[1] + t * e.l2[2]),
        // Stundenwinkel der Schattenachse in Greenwich, um ΔT auf Weltzeit korrigiert
        gha: (e.mu[0] + t * e.mu[1] - 0.00417807 * e.deltaT) * DEG,
        dmu: e.mu[1] * DEG,
    };
}

function observe(e, t, site) {
    const s = stateAt(e, t);
    const h = s.gha + site.lon;
    const sinD = Math.sin(s.d), cosD = Math.cos(s.d), sinH = Math.sin(h), cosH = Math.cos(h);
    const xi = site.rhoCos * sinH;
    const eta = site.rhoSin * cosD - site.rhoCos * cosH * sinD;
    const zeta = site.rhoSin * sinD + site.rhoCos * cosH * cosD;
    const u = s.x - xi;
    const v = s.y - eta;
    const a = s.dx - s.dmu * site.rhoCos * cosH;
    const b = s.dy - (s.dmu * xi * sinD - zeta * s.dd);
    return {
        u, v, a, b, zeta,
        n2: a * a + b * b,
        l2: s.l2 - zeta * e.tanF2,
        sinAlt: site.sinLat * sinD + site.cosLat * cosD * cosH,
    };
}

/**
 * Totalität am Ort (Breite/Länge in Grad, Ost positiv).
 * Liefert null außerhalb des Kernschattens, sonst Zeiten als Stunden ab t0 und die Sonnenhöhe in Grad.
 */
export function localTotality(e, latDeg, lonDeg) {
    const lat = latDeg * DEG;
    const u1 = Math.atan(FLAT * Math.tan(lat));
    const site = {
        lon: lonDeg * DEG,
        sinLat: Math.sin(lat),
        cosLat: Math.cos(lat),
        rhoSin: FLAT * Math.sin(u1),
        rhoCos: Math.cos(u1),
    };

    // Zeitpunkt des Maximums
    let t = 0;
    for (let i = 0; i < 30; i++) {
        const o = observe(e, t, site);
        const dt = -(o.u * o.a + o.v * o.b) / o.n2;
        t += dt;
        if (Math.abs(t) > 6) return null;
        if (Math.abs(dt) < 1e-7) break;
    }
    const o = observe(e, t, site);
    const m = Math.hypot(o.u, o.v);
    if (o.l2 >= 0 || m >= -o.l2 || o.zeta <= 0) return null;

    // 2. und 3. Kontakt
    const contact = sign => {
        let tc = t + sign * Math.sqrt(Math.max(0, o.l2 * o.l2 - m * m)) / Math.sqrt(o.n2);
        for (let i = 0; i < 12; i++) {
            const c = observe(e, tc, site);
            const n = Math.sqrt(c.n2);
            const sq = (c.a * c.v - c.u * c.b) / (n * c.l2);
            if (Math.abs(sq) > 1) return null;
            const dt = -(c.u * c.a + c.v * c.b) / c.n2 + sign * Math.abs(c.l2) / n * Math.sqrt(1 - sq * sq);
            tc += dt;
            if (Math.abs(dt) < 1e-8) break;
        }
        return tc;
    };
    const start = contact(-1), end = contact(1);
    if (start === null || end === null) return null;

    return {
        start, max: t, end,
        durationSeconds: (end - start) * 3600,
        sunAltitude: Math.asin(Math.max(-1, Math.min(1, o.sinAlt))) / DEG,
    };
}

/** Wandelt eine Elementzeit (Stunden ab t0, TDT) in ein Date (UTC) um. */
export function toDate(eclipse, t) {
    const [y, mo, d] = eclipse.date.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d) + (eclipse.elements.t0 + t) * 3600000 - eclipse.elements.deltaT * 1000);
}
