namespace SolarWatcher.Eclipses;

/// <summary>
/// Finsternisberechnung aus Besselschen Elementen (Verfahren nach Explanatory Supplement / Meeus).
/// Dieselbe Rechnung für die lokalen Umstände läuft im Browser (wwwroot/js/besselian.js).
/// </summary>
public static class Besselian
{
    private const double Deg = Math.PI / 180.0;
    private const double E2 = 0.00669438;          // Quadrat der Exzentrizität des Erdellipsoids
    private const double Flat = 0.99664719;        // 1 - Abplattung
    private const double EarthRadiusKm = 6371.0088;

    /// <summary>Elemente und ihre stündlichen Änderungen zum Zeitpunkt t (Stunden ab t0).</summary>
    public readonly record struct State(
        double X, double Y, double D, double L1, double L2, double MuDeg,
        double Dx, double Dy, double Dd, double Dmu);

    /// <summary>Lage eines Beobachters relativ zur Schattenachse.</summary>
    public readonly record struct Observer(double U, double V, double A, double B, double L1, double L2, double Zeta)
    {
        public double N2 => A * A + B * B;
    }

    public static State At(BesselianElements e, double t)
    {
        double x = e.X[0] + t * (e.X[1] + t * (e.X[2] + t * e.X[3]));
        double y = e.Y[0] + t * (e.Y[1] + t * (e.Y[2] + t * e.Y[3]));
        double dx = e.X[1] + t * (2 * e.X[2] + t * 3 * e.X[3]);
        double dy = e.Y[1] + t * (2 * e.Y[2] + t * 3 * e.Y[3]);
        double d = (e.D[0] + t * (e.D[1] + t * e.D[2])) * Deg;
        double dd = (e.D[1] + 2 * t * e.D[2]) * Deg;
        double l1 = e.L1[0] + t * (e.L1[1] + t * e.L1[2]);
        double l2 = e.L2[0] + t * (e.L2[1] + t * e.L2[2]);
        double mu = e.Mu[0] + t * e.Mu[1];
        return new State(x, y, d, l1, l2, mu, dx, dy, dd, e.Mu[1] * Deg);
    }

    /// <summary>Stundenwinkel-Nullpunkt: geografische Länge (Ost positiv, rad) = Stundenwinkel - dieser Wert.</summary>
    private static double GreenwichHourAngle(BesselianElements e, in State s) => (s.MuDeg - 0.00417807 * e.DeltaT) * Deg;

    public static Observer Observe(BesselianElements e, in State s, double latRad, double lonRad)
    {
        double u1 = Math.Atan(Flat * Math.Tan(latRad));
        double rhoSin = Flat * Math.Sin(u1);
        double rhoCos = Math.Cos(u1);
        double h = GreenwichHourAngle(e, s) + lonRad;
        double sinD = Math.Sin(s.D), cosD = Math.Cos(s.D), sinH = Math.Sin(h), cosH = Math.Cos(h);

        double xi = rhoCos * sinH;
        double eta = rhoSin * cosD - rhoCos * cosH * sinD;
        double zeta = rhoSin * sinD + rhoCos * cosH * cosD;
        double dXi = s.Dmu * rhoCos * cosH;
        double dEta = s.Dmu * xi * sinD - zeta * s.Dd;

        return new Observer(
            s.X - xi, s.Y - eta,
            s.Dx - dXi, s.Dy - dEta,
            s.L1 - zeta * e.TanF1, s.L2 - zeta * e.TanF2,
            zeta);
    }

    /// <summary>
    /// Ort auf dem Erdellipsoid, dessen Projektion in die Fundamentalebene (xi, eta) ist
    /// (der Sonne zugewandte Seite). Null, wenn der Punkt außerhalb der Erdscheibe liegt.
    /// </summary>
    public static (double LatRad, double LonRad)? SurfacePoint(BesselianElements e, in State s, double xi, double eta)
    {
        double sinD = Math.Sin(s.D), cosD = Math.Cos(s.D);
        double rho1 = Math.Sqrt(1 - E2 * cosD * cosD);
        double sinD1 = sinD / rho1;
        double cosD1 = Math.Sqrt(1 - E2) * cosD / rho1;
        double eta1 = eta / rho1;
        double z2 = 1 - xi * xi - eta1 * eta1;
        if (z2 < 0) return null;
        double zeta1 = Math.Sqrt(z2);

        double sinPhi1 = eta1 * cosD1 + zeta1 * sinD1;
        double theta = Math.Atan2(xi, -eta1 * sinD1 + zeta1 * cosD1);
        double phi1 = Math.Asin(Math.Clamp(sinPhi1, -1, 1));
        double lat = Math.Atan(Math.Tan(phi1) / Math.Sqrt(1 - E2));
        double lon = NormalizeRad(theta - GreenwichHourAngle(e, s));
        return (lat, lon);
    }

    /// <summary>Zeitpunkt (t ab t0), zu dem die Schattenachse dem Erdmittelpunkt am nächsten kommt.</summary>
    public static double GreatestEclipseTime(BesselianElements e)
    {
        double t = 0;
        for (int i = 0; i < 20; i++)
        {
            var s = At(e, t);
            double dt = -(s.X * s.Dx + s.Y * s.Dy) / (s.Dx * s.Dx + s.Dy * s.Dy);
            t += dt;
            if (Math.Abs(dt) < 1e-9) break;
        }
        return t;
    }

    /// <summary>Lokale Umstände der Totalität; null, wenn der Ort nicht im Kernschatten liegt oder die Sonne unter dem Horizont steht.</summary>
    public static (double TStart, double TMax, double TEnd, double AltitudeDeg)? LocalTotality(BesselianElements e, double latRad, double lonRad)
    {
        double t = 0;
        Observer o = default;
        for (int i = 0; i < 30; i++)
        {
            o = Observe(e, At(e, t), latRad, lonRad);
            double dt = -(o.U * o.A + o.V * o.B) / o.N2;
            t += dt;
            if (Math.Abs(t) > 6) return null;
            if (Math.Abs(dt) < 1e-7) break;
        }
        o = Observe(e, At(e, t), latRad, lonRad);
        double m = Math.Sqrt(o.U * o.U + o.V * o.V);
        if (o.L2 >= 0 || m >= -o.L2 || o.Zeta <= 0) return null;

        double? Contact(int sign)
        {
            double tc = t;
            // Startwert aus der linearen Näherung um das Maximum
            double n = Math.Sqrt(o.N2);
            tc += sign * Math.Sqrt(Math.Max(0, o.L2 * o.L2 - m * m)) / n;
            for (int i = 0; i < 12; i++)
            {
                var c = Observe(e, At(e, tc), latRad, lonRad);
                double nc = Math.Sqrt(c.N2);
                double sq = (c.A * c.V - c.U * c.B) / (nc * c.L2);
                if (Math.Abs(sq) > 1) return null;
                double dt = -(c.U * c.A + c.V * c.B) / c.N2 + sign * Math.Abs(c.L2) / nc * Math.Sqrt(1 - sq * sq);
                tc += dt;
                if (Math.Abs(dt) < 1e-8) break;
            }
            return tc;
        }

        var t2 = Contact(-1);
        var t3 = Contact(+1);
        if (t2 is null || t3 is null) return null;
        return (t2.Value, t, t3.Value, Math.Asin(Math.Clamp(SunAltitudeSin(e, At(e, t), latRad, lonRad), -1, 1)) / Deg);
    }

    private static double SunAltitudeSin(BesselianElements e, in State s, double latRad, double lonRad)
    {
        double h = GreenwichHourAngle(e, s) + lonRad;
        return Math.Sin(latRad) * Math.Sin(s.D) + Math.Cos(latRad) * Math.Cos(s.D) * Math.Cos(h);
    }

    /// <summary>
    /// Punkt der Kernschattengrenze (nördliche bzw. südliche Grenzlinie) zum Zeitpunkt t:
    /// der Ort, an dem genau jetzt das Finsternismaximum eintritt und die Totalitätsdauer null ist.
    /// </summary>
    /// <returns>Position in der Fundamentalebene und - falls auf der Erde - die geografische Position.</returns>
    public static (double Xi, double Eta, (double LatRad, double LonRad)? Geo) LimitPoint(BesselianElements e, in State s, int side)
    {
        double a = s.Dx, b = s.Dy, l = s.L2;
        double xi = s.X, eta = s.Y;
        (double, double)? geo = null;
        for (int i = 0; i < 25; i++)
        {
            double n = Math.Sqrt(a * a + b * b);
            double nxi = s.X + side * Math.Abs(l) * b / n;
            double neta = s.Y - side * Math.Abs(l) * a / n;
            double change = Math.Abs(nxi - xi) + Math.Abs(neta - eta);
            xi = nxi;
            eta = neta;
            geo = SurfacePoint(e, s, xi, eta);
            if (geo is null || change < 1e-10) break;
            var o = Observe(e, s, geo.Value.Item1, geo.Value.Item2);
            a = o.A;
            b = o.B;
            l = o.L2;
        }
        return (xi, eta, geo);
    }

    /// <summary>Schnittpunkt der Strecke (innen → außen) mit dem Rand der Erdscheibe, als Ort auf der Erde (Sonne am Horizont).</summary>
    public static (double LatRad, double LonRad) ClipToLimb(BesselianElements e, in State s, (double Xi, double Eta) inside, (double Xi, double Eta) outside)
    {
        double lo = 0, hi = 1;
        var best = SurfacePoint(e, s, inside.Xi, inside.Eta)!.Value;
        for (int i = 0; i < 40; i++)
        {
            double mid = (lo + hi) / 2;
            var p = SurfacePoint(e, s, inside.Xi + (outside.Xi - inside.Xi) * mid, inside.Eta + (outside.Eta - inside.Eta) * mid);
            if (p is null) hi = mid;
            else { lo = mid; best = p.Value; }
        }
        return best;
    }

    public static DateTime ToUtc(DateOnly date, BesselianElements e, double t) =>
        date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddSeconds((e.T0 + t) * 3600.0 - e.DeltaT);

    public static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        double dLat = lat2 - lat1, dLon = lon2 - lon1;
        double h = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(lat1) * Math.Cos(lat2) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * EarthRadiusKm * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    public static double NormalizeRad(double a)
    {
        a %= 2 * Math.PI;
        if (a > Math.PI) a -= 2 * Math.PI;
        if (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }
}
