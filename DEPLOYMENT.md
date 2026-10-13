# Deploy Papyr

This guide runs Papyr as a private, single-owner service with Docker Compose. The supplied Compose file is a local/self-hosted baseline, not a production-hardened public deployment: add a TLS reverse proxy, firewall internal ports, use unique secrets, and validate backups before relying on the instance.

## What runs

- `web`: Next.js app on container port 3000. Its `/api/v1/*` and `/hubs/*` requests are proxied to the API by Next.js.
- `api`: ASP.NET Core on container port 8080, host port 5080 in the supplied Compose file.
- `db`: PostgreSQL 17.6 on the private Compose network, with a persistent named volume.
- `papyr-assets`: persistent named volume for uploaded image attachments.

The database and asset volumes hold server data. Browser IndexedDB holds local copies and pending edits; it is not part of the server backup.

Compose publishes the web port on all host interfaces at `PAPYR_WEB_PORT` (6767 by default) and the API on `127.0.0.1:5080`. Protect port 6767 with a host firewall and preferably put a TLS reverse proxy in front of it before allowing sign-ins. PostgreSQL has no published host port.

## Start a private instance

Requirements: Docker Engine and Docker Compose plugin. From the repository root:

1. Create a private environment file from the harmless template and set unique values:

   ```sh
   install -m 600 .env.example .env
   ```

   Set `PAPYR_DB_PASSWORD` to a strong random password and `PAPYR_INITIAL_SETUP_TOKEN` to a separate random value of at least 32 characters. Keep `.env` private and out of source control. `.env.example` is development-oriented; replace every sample value.

2. Start the services:

   ```sh
   docker compose -f infra/compose.yaml up -d --build
   ```

3. Check API health at `http://localhost:5080/health/live` and `http://localhost:5080/health/ready`, then open `http://localhost:6767`.

4. In the web app, choose **First setup** and enter the configured setup token, a username, and a password (minimum 12 characters). This creates the only owner account. Save the username and password in your password manager. The setup token is only needed for this initial setup; remove it from `.env` after setup and restart the API container. Do not share the token or expose the setup screen to untrusted users before setup completes.

5. Sign in from each device that should sync. Existing local notes are uploaded through the sync flow; check the status and Conflict Center if prompted.

Useful operations:

```sh
docker compose -f infra/compose.yaml logs -f web api
docker compose -f infra/compose.yaml down
```

`down` preserves the named volumes. `docker compose down -v` deletes database and attachment volumes and permanently removes server data; do not use it as a routine stop command.

## Deploy with Portainer

Create a Stack from the Git repository and set the Compose path to `infra/compose.yaml`. In Portainer's **Environment variables** section, either add the keys from `.env.example` individually or use **Load variables from .env file** with a private copy whose sample database password has been replaced. Portainer makes these values available for Compose `${VARIABLE}` substitution; the Compose file passes each value to the web, API, or database service as needed. Do not add an `env_file: .env` entry to the stack.

Set `PAPYR_DB_PASSWORD` and `PAPYR_INITIAL_SETUP_TOKEN` to unique strong values before deployment. Set `PAPYR_COOKIE_SECURE=true` when the public site uses HTTPS. `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` is optional and is consumed during the web image build; after changing it, rebuild and redeploy the stack. Keep `PAPYR_MIGRATE_ON_STARTUP=true` for the supplied single-API stack. Keep the stack environment values private and restrict stack access to administrators.

The web app is available on host port `6767` by default (container port `3000`). Set `PAPYR_WEB_PORT=6767` in Portainer if it has a previous value saved. This port listens on all host interfaces. The default Docker subnet is `10.253.0.0/24`. If Portainer already has the old `172.29.0.0/24` values saved, update `PAPYR_NETWORK_SUBNET` to `10.253.0.0/24`, `PAPYR_WEB_IP` to `10.253.0.2`, `PAPYR_API_IP` to `10.253.0.3`, and `PAPYR_DB_IP` to `10.253.0.4` (or remove those overrides to use the Compose defaults). If the new subnet also overlaps on your host, choose a free private `/24` and set all four values consistently.

## Public HTTPS hosting

Use a reverse proxy or load balancer that terminates TLS and forwards the same public hostname to the `web` service. The web app routes `/api/v1/` and `/hubs/` to the API, so clients should use one origin. Preserve those paths, allow WebSocket upgrades for `/hubs/`, and set request and proxy timeouts high enough for attachment uploads. Enable HTTPS before users sign in.

For a public deployment:

- Set `PAPYR_COOKIE_SECURE=true` in the API environment.
- Configure `PAPYR_TRUSTED_PROXIES` with only the actual immediate proxy addresses. Compose assigns the web container a stable private IP; external proxies must overwrite forwarded headers rather than pass client-supplied values through. If the default Compose subnet overlaps another network, change the subnet and all three service IPs together.
- Set `PAPYR_MAX_ASSET_STORAGE_BYTES` to the desired per-owner attachment quota (default 1 GiB). Keep one API instance unless quota enforcement is coordinated across replicas.
- Publish only the HTTPS proxy to the internet. Restrict host port 6767 to the proxy or trusted networks; keep API port 5080 local and never publish PostgreSQL port 5432.
- Replace the development database password with a unique secret. Use a separate strong one-time setup token, then remove it after owner creation.
- Keep the PostgreSQL and asset volumes on durable storage with restricted host permissions.
- Use a valid `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` only after confirming that the license covers the actual use and host. It is embedded into the browser build; treat it as a public client key, not as a server secret. Without an applicable key, production whiteboards are blocked.
- Build and deploy a pinned, reviewed image. Keep the TLS proxy as the only public service.

The Compose file currently applies EF Core database migrations when the API starts. Run one API replica during upgrades. For multi-replica operation, disable startup migrations and run a controlled migration job before deploying the replicas. Do not set `PAPYR_MIGRATE_ON_STARTUP=false` without providing that migration step.

## Configuration

The supplied `infra/compose.yaml` reads these values from a local `.env` file in Docker Compose or from Portainer's stack environment variables:

| Variable | Purpose | Guidance |
| --- | --- | --- |
| `PAPYR_DB_PASSWORD` | PostgreSQL password for the `papyr` role | Required for any hosted use; replace the Compose development fallback. |
| `PAPYR_INITIAL_SETUP_TOKEN` | Authorizes first-owner creation | At least 32 characters; remove after setup. |
| `PAPYR_COOKIE_SECURE` | Requires secure session cookies | Set `true` when served over HTTPS. |
| `PAPYR_CHANGE_RETENTION_DAYS` | Change-event retention | Defaults to 90; valid range is 1–3650. |
| `PAPYR_MIGRATE_ON_STARTUP` | Apply EF Core migrations when the API starts | Defaults to `true`; see the multi-replica note above. |
| `PAPYR_MAX_ASSET_STORAGE_BYTES` | Per-owner attachment quota | Defaults to 1 GiB. |
| `PAPYR_WEB_PORT` | Host port published for the web service | Defaults to 6767; keep the service private behind the proxy. |
| `PAPYR_NETWORK_SUBNET`, `PAPYR_WEB_IP`, `PAPYR_API_IP`, `PAPYR_DB_IP` | Private Compose network addressing | Change together only if the default subnet overlaps another Docker network. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Build-time whiteboard license key | Optional; use only with a license valid for this deployment. |

The Next.js API origin is set at image build time through `PAPYR_API_ORIGIN` (the supplied Compose build sets it to `http://api:8080`). For a custom deployment, preserve the internal API origin reachable by the web container. The public browser-facing API path remains same-origin through Next.js rewrites.

## Backups and restore

Back up the database and asset volume as a pair. The scripts stop the API during the snapshot so attachments and metadata stay aligned:

```sh
infra/backup.sh /secure/path/papyr-backup
infra/restore.sh /secure/path/papyr-backup
```

Backups include note contents and attachment data. The backup script creates owner-only files and checksums, but does not encrypt them or include `.env`. Encrypt before off-host storage and keep secrets separately. Store backups outside the Papyr volumes.

Restore verifies the listed file hashes and requires typing `RESTORE`; it replaces the configured database and all assets. Run it only against the intended Compose project. Keep a separate current backup before restoring. A database and asset snapshot from different points in time may not match. The scripts do not yet verify a complete clean-host recovery, so rehearse on a disposable instance before production use.

After restoring an older snapshot, leave browser profiles intact. They may contain local edits or pending outbox work newer than the restored server; sign in and review conflicts rather than clearing browser storage.

## Updating and operating

1. Take and protect a paired backup.
2. Review the release and build the images with `docker compose -f infra/compose.yaml build`.
3. Start the updated services with `docker compose -f infra/compose.yaml up -d` and check health endpoints and logs.
4. Smoke-test sign-in, note editing, sync, attachment loading, and an existing client profile before considering the update complete.

Monitor disk space for both volumes. Restrict access to logs and host backups; application logs should not contain note bodies or credentials. Test database and asset restoration regularly. Browser local storage is device-specific and is not backed up by these server scripts.

## Deployment checklist

- [ ] HTTPS works on the public hostname; secure cookies are enabled.
- [ ] Only the reverse proxy is publicly reachable; database and internal service ports are firewalled.
- [ ] Unique database and setup secrets are configured; the setup token is removed after owner creation.
- [ ] Database and asset volumes persist across container replacement.
- [ ] Whiteboard license is valid for the intended use, or whiteboards are left disabled.
- [ ] Backup files are protected and a restore has been rehearsed on a disposable instance.
- [ ] Update and database migration procedures have been exercised.
