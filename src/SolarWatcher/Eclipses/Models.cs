namespace SolarWatcher.Eclipses;

/// <summary>Polynomiale Besselsche Elemente (NASA/Espenak). Zeitargument t in Stunden ab t0 (TDT).</summary>
public sealed record BesselianElements(
    double T0,
    double DeltaT,
    double[] X,
    double[] Y,
    double[] D,
    double[] L1,
    double[] L2,
    double[] Mu,
    double TanF1,
    double TanF2);

/// <summary>Angaben zum Zeitpunkt der größten Finsternis.</summary>
public sealed record GreatestEclipse(
    DateTime? TimeUtc,
    double? Lat,
    double? Lon,
    double? SunAltitude,
    double? PathWidthKm,
    double? DurationSeconds);

/// <summary>Referenzwerte der NASA aus der Quelldatei (nur bis 2048 vorhanden).</summary>
public sealed record NasaGreatest(
    string? TimeUt,
    double? Lat,
    double? Lon,
    double? SunAltitude,
    double? PathWidthKm,
    double? DurationSeconds);

/// <summary>Eintrag der Quelldatei Data/eclipses.json.</summary>
public sealed record EclipseSource(
    string Id,
    DateOnly Date,
    string Type,
    int Saros,
    int SarosMember,
    int SarosCount,
    double Gamma,
    double Magnitude,
    NasaGreatest? Greatest,
    BesselianElements Elements);

/// <summary>Finsternis, wie sie die API ausliefert.</summary>
public sealed record EclipseInfo(
    string Id,
    DateOnly Date,
    string Type,
    bool Central,
    int Saros,
    int SarosMember,
    int SarosCount,
    double Gamma,
    double Magnitude,
    DateTime? TotalityStartUtc,
    DateTime? TotalityEndUtc,
    GreatestEclipse Greatest,
    BesselianElements Elements);

/// <summary>Geometrie des Totalitätsstreifens. Punkte als [Breite, Länge]; Längen sind stetig fortgesetzt (können ±180° überschreiten).</summary>
public sealed record EclipsePath(
    string Id,
    double[][] Central,
    long[] CentralTimesUnixMs,
    double[][] Polygon);

/// <summary>Lokale Umstände der Totalität an einem Ort.</summary>
public sealed record LocalCircumstances(
    DateTime StartUtc,
    DateTime MaxUtc,
    DateTime EndUtc,
    double DurationSeconds,
    double SunAltitude);
