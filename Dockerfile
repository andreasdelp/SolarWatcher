# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/SolarWatcher/SolarWatcher.csproj src/SolarWatcher/
RUN dotnet restore src/SolarWatcher/SolarWatcher.csproj
COPY src/ src/
RUN dotnet publish src/SolarWatcher/SolarWatcher.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

# X-Forwarded-Proto/-For des Reverse-Proxys auswerten
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=true
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "SolarWatcher.dll"]
