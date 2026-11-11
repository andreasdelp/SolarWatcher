using System.Collections.Concurrent;
using System.Text.Json;

namespace SolarWatcher.Eclipses;

/// <summary>Lädt die Finsternisdaten und berechnet Kenngrößen und Totalitätsstreifen.</summary>
public sealed class EclipseService
{
    private const double Deg = Math.PI / 180.0;
    private const double StepHours = 20.0 / 3600.0;   // Abstand der Stützstellen des Pfads
    private const double RangeHours = 3.2;            // Gültigkeitsbereich der Elemente um t0

    private readonly Dictionary<string, EclipseSource> _sources;
    private readonly ConcurrentDictionary<string, EclipsePath> _paths = new();

    public IReadOnlyList<EclipseInfo> Eclipses { get; }

    public EclipseService(IWebHostEnvironment env)
    {
        var file = Path.Combine(env.ContentRootPath, "Data", "eclipses.json");
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var sources = JsonSerializer.Deserialize<List<EclipseSource>>(File.ReadAllText(file), options)
                      ?? throw new InvalidOperationException("Data/eclipses.json ist leer.");
        _sources = sources.ToDictionary(s => s.Id);
        Eclipses = sources.OrderBy(s => s.Date).Select(Describe).ToList();
    }

    public EclipseSource? Find(string id) => _sources.GetValueOrDefault(id);

    public EclipsePath? GetPath(string id) =>
        _sources.TryGetValue(id, out var src) ? _paths.GetOrAdd(id, _ => ComputePath(src)) : null;

    public LocalCircumstances? GetLocal(string id, double latDeg, double lonDeg)
    {
        if (!_sources.TryGetValue(id, out var src)) return null;
        var r = Besselian.LocalTotality(src.Elements, latDeg * Deg, lonDeg * Deg);
        if (r is null) return null;
        var (t2, tm, t3, alt) = r.Value;
        return new LocalCircumstances(
            Besselian.ToUtc(src.Date, src.Elements, t2),
            Besselian.ToUtc(src.Date, src.Elements, tm),
            Besselian.ToUtc(src.Date, src.Elements, t3),
            (t3 - t2) * 3600.0,
            alt);
    }

    private EclipseInfo Describe(EclipseSource src)
    {
        var e = src.Elements;
        double tg = Besselian.GreatestEclipseTime(e);
        var s = Besselian.At(e, tg);
        var center = Besselian.SurfacePoint(e, s, s.X, s.Y);

        GreatestEclipse greatest;
        if (center is { } c)
        {
            var local = Besselian.LocalTotality(e, c.LatRad, c.LonRad);
            var north = Besselian.LimitPoint(e, s, +1).Geo;
            var south = Besselian.LimitPoint(e, s, -1).Geo;
            double? width = north is { } n && south is { } so
                ? Besselian.DistanceKm(n.LatRad, n.LonRad, so.LatRad, so.LonRad)
                : null;
            greatest = new GreatestEclipse(
                Besselian.ToUtc(src.Date, e, tg), c.LatRad / Deg, c.LonRad / Deg,
                local?.AltitudeDeg, width,
                local is { } l ? (l.TEnd - l.TStart) * 3600.0 : null);
        }
        else
        {
            // Nicht-zentrale Finsternis: die Schattenachse verfehlt die Erde.
            greatest = new GreatestEclipse(Besselian.ToUtc(src.Date, e, tg), null, null, null, null, null);
        }

        var path = GetPath(src.Id)!;
        DateTime? start = path.CentralTimesUnixMs.Length > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(path.CentralTimesUnixMs[0]).UtcDateTime : null;
        DateTime? end = path.CentralTimesUnixMs.Length > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(path.CentralTimesUnixMs[^1]).UtcDateTime : null;

        return new EclipseInfo(src.Id, src.Date, src.Type, center is not null, src.Saros, src.SarosMember, src.SarosCount,
            src.Gamma, src.Magnitude, start, end, greatest, e);
    }

    private static EclipsePath ComputePath(EclipseSource src)
    {
        var e = src.Elements;
        var central = new List<double[]>();
        var times = new List<long>();
        var sideA = new List<double[]>();
        var sideB = new List<double[]>();

        int steps = (int)Math.Round(RangeHours / StepHours);
        for (int i = -steps; i <= steps; i++)
        {
            double t = i * StepHours;
            var s = Besselian.At(e, t);

            if (Besselian.SurfacePoint(e, s, s.X, s.Y) is { } c)
            {
                central.Add([c.LatRad / Deg, c.LonRad / Deg]);
                times.Add(new DateTimeOffset(Besselian.ToUtc(src.Date, e, t)).ToUnixTimeMilliseconds());
            }

            var a = Besselian.LimitPoint(e, s, +1);
            var b = Besselian.LimitPoint(e, s, -1);
            if (a.Geo is null && b.Geo is null) continue;

            // Liegt nur eine Grenze auf der Erde, endet der Schatten am Erdrand (Sonne am Horizont).
            var pa = a.Geo ?? Besselian.ClipToLimb(e, s, (b.Xi, b.Eta), (a.Xi, a.Eta));
            var pb = b.Geo ?? Besselian.ClipToLimb(e, s, (a.Xi, a.Eta), (b.Xi, b.Eta));
            sideA.Add([pa.LatRad / Deg, pa.LonRad / Deg]);
            sideB.Add([pb.LatRad / Deg, pb.LonRad / Deg]);
        }

        // Ring: eine Grenzlinie hin, die andere zurück - Längen entlang des Rings stetig fortgesetzt.
        var polygon = new List<double[]>(sideA.Count + sideB.Count + 3);
        polygon.AddRange(sideA);
        polygon.AddRange(Enumerable.Reverse(sideB));
        Unwrap(polygon, null);
        if (polygon.Count > 0)
        {
            // Schwerpunkt in den Bereich ±180° legen, die Zentrallinie daran ausrichten.
            double shift = Math.Round(polygon.Average(p => p[1]) / 360.0) * 360.0;
            foreach (var p in polygon) p[1] -= shift;
            Unwrap(central, sideA[sideA.Count / 2][1]);

            // Schließt sich der Ring erst nach einem vollen Umlauf in der Länge, umschließt der Streifen
            // einen Pol. Dann wird die Fläche über den Pol geschlossen, sonst füllt die Karte die falsche Seite.
            var first = polygon[0];
            var last = polygon[^1];
            double turn = Math.Round((last[1] - first[1]) / 360.0) * 360.0;
            if (turn != 0)
            {
                double pole = polygon.Average(p => p[0]) > 0 ? 90 : -90;
                polygon.Add([first[0], first[1] + turn]);
                polygon.Add([pole, first[1] + turn]);
                polygon.Add([pole, first[1]]);
            }
        }

        return new EclipsePath(src.Id, Round(central), times.ToArray(), Round(polygon));
    }

    /// <summary>Setzt Längen stetig fort (keine Sprünge an ±180°) und richtet die Linienmitte an einer Bezugslänge aus.</summary>
    private static void Unwrap(List<double[]> line, double? referenceLon)
    {
        for (int i = 1; i < line.Count; i++)
        {
            double diff = line[i][1] - line[i - 1][1];
            line[i][1] -= Math.Round(diff / 360.0) * 360.0;
        }
        if (referenceLon is { } r && line.Count > 0)
        {
            double shift = Math.Round((line[line.Count / 2][1] - r) / 360.0) * 360.0;
            foreach (var p in line) p[1] -= shift;
        }
    }

    private static double[][] Round(List<double[]> line) =>
        line.Select(p => new[] { Math.Round(p[0], 4), Math.Round(p[1], 4) }).ToArray();
}
