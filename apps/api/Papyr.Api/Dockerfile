FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY apps/api/Papyr.Api/Papyr.Api.csproj apps/api/Papyr.Api/
RUN dotnet restore apps/api/Papyr.Api/Papyr.Api.csproj
COPY apps/api/Papyr.Api apps/api/Papyr.Api
RUN dotnet publish apps/api/Papyr.Api/Papyr.Api.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Papyr.Api.dll"]
