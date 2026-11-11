#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true

// Lädt die Besselschen Elemente aller totalen Sonnenfinsternisse ab 2026 von der
// NASA-Eclipse-Website (Fred Espenak, GSFC) und schreibt sie nach
// src/SolarWatcher/Data/eclipses.json.
//
// Aufruf (im Repository-Wurzelverzeichnis):   dotnet run tools/FetchElements.cs

using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

const int FirstYear = 2026;
const string CatalogUrl = "https://eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html";
const string ElementsUrl = "https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm{4}/SE{0}{1}{2}{3}beselm.html";
var inv = CultureInfo.InvariantCulture;
string[] months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
http.DefaultRequestHeaders.UserAgent.ParseAdd("SolarWatcher-FetchElements/1.0");

string Text(string html) => WebUtility.HtmlDecode(Regex.Replace(html, "<[^>]*>", ""));
double D(string s) => double.Parse(s, inv);

var catalog = Text(await http.GetStringAsync(CatalogUrl));
// 09511  2001 Jun 21  12:04:46     64     18  127   T   -p  -0.5701  1.0495 ...
var lineRx = new Regex(@"^\s*\d{4,5}\s+(\d{4})\s+(\w{3})\s+(\d{2})\s+[\d:]+\s+-?\d+\s+-?\d+\s+\d+\s+(\S+)\s", RegexOptions.Multiline);
var result = new List<object>();

foreach (Match m in lineRx.Matches(catalog))
{
    int year = int.Parse(m.Groups[1].Value);
    string mon = m.Groups[2].Value, day = m.Groups[3].Value, type = m.Groups[4].Value;
    if (year < FirstYear || !type.StartsWith('T')) continue;

    var url = string.Format(ElementsUrl, year, mon, day, "T", year <= 2050 ? 2001 : 2051);
    Console.Write($"{year} {mon} {day} ({type}) ... ");
    var page = Text(await http.GetStringAsync(url));

    var head = Regex.Match(page, @"Polynomial Besselian Elements for:\s+(\d{4}) (\w{3}) (\d{2})\s+(\d{2}):(\d{2}):([\d.]+)\s+TDT");
    if (!head.Success) throw new Exception("Kopfzeile der Elemente nicht gefunden: " + url);
    double t0 = D(head.Groups[4].Value) + D(head.Groups[5].Value) / 60 + D(head.Groups[6].Value) / 3600;
    var t0Date = new DateOnly(int.Parse(head.Groups[1].Value), Array.IndexOf(months, head.Groups[2].Value) + 1, int.Parse(head.Groups[3].Value));

    double[][] rows = new double[4][];
    for (int n = 0; n < 4; n++)
    {
        var row = Regex.Match(page, $@"^\s+{n}((?:\s+-?\d+\.\d+)+)\s*$", RegexOptions.Multiline);
        if (!row.Success) throw new Exception($"Zeile {n} der Elemente nicht gefunden: {url}");
        rows[n] = row.Groups[1].Value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(D).ToArray();
    }
    if (rows[0].Length != 6 || rows[1].Length != 6 || rows[2].Length != 5 || rows[3].Length != 2)
        throw new Exception("Unerwartetes Format der Elemente: " + url);

    var tan = Regex.Match(page, @"Tan\s+\S1\s*=\s*([\d.]+)\s+Tan\s+\S2\s*=\s*([\d.]+)");
    var gamma = Regex.Match(page, @"Gamma\s*=\s*(-?[\d.]+)");
    var mag = Regex.Match(page, @"Eclipse Magnitude\s*=\s*([\d.]+)");
    var dT = Regex.Match(page, @"ΔT\s*=\s*(-?[\d.]+)\s*s");
    var saros = Regex.Match(page, @"Saros Series\s*=\s*(\d+)\s*\(\s*(\d+)/\s*(\d+)\)");
    if (!tan.Success || !gamma.Success || !mag.Success || !dT.Success || !saros.Success)
        throw new Exception("Kopfdaten nicht gefunden: " + url);

    // Angaben zum Zeitpunkt der größten Finsternis (fehlen bei nicht-zentralen Finsternissen teilweise)
    var ge = Regex.Match(page, @"Greatest Eclipse:\s+Time\s*=\s*(\d{2}):(\d{2}):([\d.]+)\s*UT\s+Lat\s*=\s*(\d+)°([\d.]+)'([NS])\s+Long\s*=\s*(\d+)°([\d.]+)'([EW])");
    var alt = Regex.Match(page, @"Sun Altitude\s*=\s*([\d.]+)°");
    var width = Regex.Match(page, @"Path Width\s*=\s*([\d.]+)\s*km");
    var dur = Regex.Match(page, @"Central Duration\s*=\s*(\d+)m([\d.]+)s");

    double? Deg(Match g, int i) => g.Success
        ? (D(g.Groups[i].Value) + D(g.Groups[i + 1].Value) / 60) * (g.Groups[i + 2].Value is "S" or "W" ? -1 : 1)
        : null;

    result.Add(new
    {
        id = $"{t0Date:yyyy-MM-dd}",
        date = $"{t0Date:yyyy-MM-dd}",
        type,
        saros = int.Parse(saros.Groups[1].Value),
        sarosMember = int.Parse(saros.Groups[2].Value),
        sarosCount = int.Parse(saros.Groups[3].Value),
        gamma = D(gamma.Groups[1].Value),
        magnitude = D(mag.Groups[1].Value),
        greatest = new
        {
            timeUt = ge.Success ? $"{ge.Groups[1].Value}:{ge.Groups[2].Value}:{ge.Groups[3].Value}" : null,
            lat = Deg(ge, 4),
            lon = Deg(ge, 7),
            sunAltitude = alt.Success ? D(alt.Groups[1].Value) : (double?)null,
            pathWidthKm = width.Success ? D(width.Groups[1].Value) : (double?)null,
            durationSeconds = dur.Success ? D(dur.Groups[1].Value) * 60 + D(dur.Groups[2].Value) : (double?)null,
        },
        elements = new
        {
            t0,
            deltaT = D(dT.Groups[1].Value),
            x = new[] { rows[0][0], rows[1][0], rows[2][0], rows[3][0] },
            y = new[] { rows[0][1], rows[1][1], rows[2][1], rows[3][1] },
            d = new[] { rows[0][2], rows[1][2], rows[2][2] },
            l1 = new[] { rows[0][3], rows[1][3], rows[2][3] },
            l2 = new[] { rows[0][4], rows[1][4], rows[2][4] },
            mu = new[] { rows[0][5], rows[1][5] },
            tanF1 = D(tan.Groups[1].Value),
            tanF2 = D(tan.Groups[2].Value),
        },
    });
    Console.WriteLine("ok");
    await Task.Delay(300); // den NASA-Server nicht bedrängen
}

var outPath = Path.Combine("src", "SolarWatcher", "Data", "eclipses.json");
await File.WriteAllTextAsync(outPath, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"{result.Count} Finsternisse nach {outPath} geschrieben.");
