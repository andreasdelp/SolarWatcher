using System.IO.Compression;
using GeoTimeZone;
using Microsoft.AspNetCore.ResponseCompression;
using SolarWatcher.Eclipses;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<EclipseService>();
builder.Services.AddResponseCompression(o => o.EnableForHttps = true);
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

var app = builder.Build();

// Betrieb hinter einem Reverse-Proxy in einem Unterverzeichnis (z. B. https://example.org/solarwatcher/):
// Reicht der Proxy den Pfad unverändert durch, wird das Präfix über "PathBase" (Umgebungsvariable PathBase)
// bekannt gemacht. Schneidet der Proxy das Präfix ab, ist nichts zu konfigurieren - das Frontend
// verwendet ausschließlich relative URLs.
var pathBase = app.Configuration["PathBase"]?.Trim('/');
if (!string.IsNullOrEmpty(pathBase))
{
    app.UsePathBase("/" + pathBase);
    app.Use(async (ctx, next) =>
    {
        // ".../solarwatcher" -> ".../solarwatcher/", damit relative URLs stimmen
        if (ctx.Request.PathBase.HasValue && !ctx.Request.Path.HasValue)
        {
            ctx.Response.Redirect(ctx.Request.PathBase + "/" + ctx.Request.QueryString);
            return;
        }
        await next();
    });
}

// Routing ausdrücklich erst nach UsePathBase, damit die API-Routen ohne Präfix zugeordnet werden.
app.UseRouting();
app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Browser sollen Skripte und Styles vor der Verwendung prüfen (ETag), sonst läuft nach einem
    // Update noch längere Zeit die alte Version aus dem Cache.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

var api = app.MapGroup("/api");

api.MapGet("/eclipses", (EclipseService svc) => svc.Eclipses);

api.MapGet("/eclipses/{id}/path", (string id, EclipseService svc) =>
    svc.GetPath(id) is { } path ? Results.Ok(path) : Results.NotFound());

api.MapGet("/eclipses/{id}/local", (string id, double lat, double lon, EclipseService svc) =>
{
    if (svc.Find(id) is null) return Results.NotFound();
    if (!ValidPosition(lat, lon)) return Results.BadRequest();
    return Results.Ok(new { total = svc.GetLocal(id, lat, lon) });
});

// IANA-Zeitzone eines Orts, damit der Browser die Ortszeit anzeigen kann.
api.MapGet("/timezone", (double lat, double lon) =>
    ValidPosition(lat, lon)
        ? Results.Ok(new { timeZone = TimeZoneLookup.GetTimeZone(lat, lon).Result })
        : Results.BadRequest());

app.MapGet("/healthz", () => Results.Text("ok"));

app.Run();

static bool ValidPosition(double lat, double lon) =>
    double.IsFinite(lat) && double.IsFinite(lon) && Math.Abs(lat) <= 90 && Math.Abs(lon) <= 180;
