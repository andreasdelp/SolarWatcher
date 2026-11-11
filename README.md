# SolarWatcher

Interaktive Karte der totalen Sonnenfinsternisse von 2026 bis 2100 (ASP.NET Core, .NET 10).

- Karte mit OpenStreetMap-Kacheln im deutschen Kartenstil (Leaflet), Totalitätsstreifen mit Zentrallinie
- Infofenster mit Auswahlzeile (vor/zurück) und den Kenndaten der gewählten Finsternis
- Tooltip im Streifen (Maus): Beginn und Ende der Totalität in Ortszeit, Dauer, Sonnenhöhe
- Klick oder Tippen setzt eine verschiebbare Markierung; die Ortsdetails stehen dann im Infofenster

## Starten

Lokal (Entwicklung):

```bash
dotnet run --project src/SolarWatcher
```

Docker:

```bash
docker compose up -d --build
```

Die Anwendung lauscht im Container auf Port 8080 (`/healthz` für Health-Checks).

## Betrieb hinter einem Reverse-Proxy im Unterverzeichnis

Das Frontend verwendet ausschließlich relative URLs. Es gibt zwei Varianten:

**A – der Proxy schneidet das Präfix ab** (keine Konfiguration der Anwendung nötig), nginx:

```nginx
location = /solarwatcher { return 301 /solarwatcher/; }
location /solarwatcher/ {
    proxy_pass http://127.0.0.1:8080/;      # abschließender Schrägstrich: Präfix wird entfernt
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**B – der Proxy reicht den Pfad unverändert durch**: Umgebungsvariable `PathBase=/solarwatcher` setzen
(in `docker-compose.yml` vorbereitet), nginx:

```nginx
location /solarwatcher {
    proxy_pass http://127.0.0.1:8080;       # ohne Schrägstrich: Pfad bleibt erhalten
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/SolarWatcher/Eclipses/` | Berechnung aus Besselschen Elementen: Zentrallinie, Grenzlinien, Kenndaten |
| `src/SolarWatcher/Data/eclipses.json` | Besselsche Elemente der 53 totalen Finsternisse 2026–2100 |
| `src/SolarWatcher/wwwroot/` | Frontend (Leaflet liegt lokal unter `lib/leaflet`) |
| `tools/FetchElements.cs` | Lädt die Elemente neu von der NASA: `dotnet run tools/FetchElements.cs` |

API: `api/eclipses`, `api/eclipses/{id}/path`, `api/eclipses/{id}/local?lat=&lon=`, `api/timezone?lat=&lon=`.

## Daten und Genauigkeit

- Besselsche Elemente: Fred Espenak, NASA/GSFC (eclipse.gsfc.nasa.gov). Die daraus berechneten Werte
  stimmen mit den NASA-Angaben überein (z. B. 12.08.2026: größte Finsternis 17:45:53,8 UT, 2 min 18,2 s).
- Zeiten künftiger Finsternisse hängen von der Prognose für ΔT ab; für späte Jahre sind Abweichungen
  im Sekundenbereich möglich. Mondrandprofil und Geländehöhe sind nicht berücksichtigt.
- Hybride (ringförmig-totale) Finsternisse sind nicht enthalten.
- Die Mercator-Karte endet bei ±85° Breite; Streifen in Polnähe werden dort abgeschnitten.
- Zeitzonen: Paket GeoTimeZone (Grenzen aus OpenStreetMap), Sommerzeitregeln nach heutigem Stand des Browsers.
- Kacheln kommen direkt von tile.openstreetmap.de (FOSSGIS); bei hoher Last bitte deren Nutzungsrichtlinie beachten.
