# Deploy Papyr

This guide runs Papyr as a private, administrator-provisioned multi-account service with Docker Compose. The supplied Compose file is a local/self-hosted baseline, not a production-hardened public deployment: add a TLS reverse proxy, firewall internal ports, use unique secrets, and validate backups before relying on the instance.

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

4. In the web app, choose **First setup**, enter the configured setup token, a username, and a non-empty password, and confirm the permanent reset. This clears server records and attachment files, plus Papyr's local data in that browser. It creates the first administrator. Passwords have no configured length limit. Save the credentials in your password manager. Remove the setup token from `.env` after setup and restart the API container. Do not share the token or expose the setup screen to untrusted users before setup completes.

5. The administrator creates accounts from the **Server account** panel and shares credentials securely. Sign in to the same account on each device that should sync. Each account has an isolated server and browser library.

Useful operations:

```sh
docker compose -f infra/compose.yaml logs -f web api
docker compose -f infra/compose.yaml down
```

`down` preserves the named volumes. `docker compose down -v` deletes database and attachment volumes and permanently removes server data; do not use it as a routine stop command.

## Deploy with Portainer

Create a Stack from the Git repository and set the Compose path to `infra/compose.yaml`. In Portainer's **Environment variables** section, either add the keys from `.env.example` individually or use **Load variables from .env file** with a private copy whose sample database password has been replaced. Portainer makes these values available for Compose `${VARIABLE}` substitution; the Compose file passes each value to the web, API, or database service as needed. Do not add an `env_file: .env` entry to the stack.

Set `PAPYR_DB_PASSWORD` and `PAPYR_INITIAL_SETUP_TOKEN` to unique strong values before deployment. Set `PAPYR_COOKIE_SECURE=true` when the public site uses HTTPS. `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` is optional and is consumed during the web image build; after changing it, rebuild and redeploy the stack. Keep `PAPYR_MIGRATE_ON_STARTUP=true` for the supplied single-API stack. Keep the stack environment values private and restrict stack access to administrators.

If the API exits during startup and Portainer does not retain its logs, temporarily set the stack variable `PAPYR_API_DIAGNOSTICS=true` and set `PAPYR_API_START_CONDITION=service_started`, then redeploy. The API logs its architecture and .NET runtime details; if startup fails, it keeps the container available for log inspection for one hour. The second setting lets the web container start even while the API is unhealthy, so Compose can finish deploying and Portainer can retain the API container. Read the API container logs in Portainer, then set `PAPYR_API_DIAGNOSTICS=false` and `PAPYR_API_START_CONDITION=service_healthy` and redeploy. The API may show as unhealthy while diagnostic mode is active.

The web app is available on host port `6767` by default (container port `3000`). Set `PAPYR_WEB_PORT=6767` in Portainer if it has a previous value saved. This port listens on all host interfaces. The default Docker subnet is `10.253.0.0/24`. If Portainer already has the old `172.29.0.0/24` values saved, update `PAPYR_NETWORK_SUBNET` to `10.253.0.0/24`, `PAPYR_WEB_IP` to `10.253.0.2`, `PAPYR_API_IP` to `10.253.0.3`, and `PAPYR_DB_IP` to `10.253.0.4` (or remove those overrides to use the Compose defaults). If the new subnet also overlaps on your host, choose a free private `/24` and set all four values consistently.

### Capture startup when Portainer removes failed containers

Settings also reports safe web-to-API transport diagnostics for setup-status without container-log access. `API_CONNECTION_REFUSED` means the target refused the connection (API startup failure or incorrect internal port); `API_DNS_FAILED` means the API hostname could not be resolved; `API_TIMEOUT` means no response within 10 seconds; `API_HTTP_ERROR` means the API was reachable but returned a non-JSON error. Rebuild and redeploy the web image to enable these diagnostics; changing stack environment variables alone does not update application code. Existing API database diagnostic codes continue to pass through.

If Portainer removes containers after a failed stack deployment, capture startup directly on the Docker host over SSH, or reproduce on a separate machine with Docker. From a checkout of the same commit and a private `.env` matching the stack settings, run:

```sh
bash infra/capture-startup.sh /absolute/private/path/papyr-startup.log
```

The script runs Compose in the foreground and captures build output, dependency failures, and streamed service logs before containers can disappear. The log is created with owner-only permissions and existing files are never overwritten. Ctrl+C stops the foreground services without deleting their volumes. On the deployed host, this can rebuild/recreate the stack's services, so use a maintenance window and preserve its existing Compose project name with `COMPOSE_PROJECT_NAME` (shown in the containers' `com.docker.compose.project` label). On another machine, use a fresh project and database; that verifies the image and migrations but cannot reproduce host-specific networking or existing database state. Keep logs private and redact credentials before sharing them.

If the failure happens before any container starts, the saved Compose/build error is the relevant evidence; there are no container logs to retrieve. Docker-host access is required for this capture when Portainer itself does not retain the deployment output.

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

If startup migrations fail, the API keeps listening in diagnostic mode and Settings reports the safe database failure code. All application requests are rejected with `503`; `/health/ready` is also `503`, while `/health/live` reports `status: "diagnostic"`. The supplied TCP healthcheck permits the web service to start and display the cause. Fix the configuration and restart the API to retry migrations. A failure before the application can run, such as an image/runtime failure, still requires startup logs.

## Configuration

The supplied `infra/compose.yaml` reads these values from a local `.env` file in Docker Compose or from Portainer's stack environment variables:

| Variable | Purpose | Guidance |
| --- | --- | --- |
| `PAPYR_DB_PASSWORD` | PostgreSQL password for the `papyr` role | Required for any hosted use; replace the Compose development fallback. |
| `PAPYR_RESET_DB_PASSWORD` | Explicit one-time repair of an existing role password | Defaults to `false`; enable only to set the stored role password to `PAPYR_DB_PASSWORD`, then disable. |
| `PAPYR_ADMIN_USERNAME`, `PAPYR_ADMIN_PASSWORD` | Administrator login credentials for explicit stack recovery | Required while `PAPYR_RESET_DB_PASSWORD=true`; private server values, never included in the web build. |
| `PAPYR_INITIAL_SETUP_TOKEN` | Authorizes first-owner creation | At least 32 characters; remove after setup. |
| `PAPYR_API_DIAGNOSTICS` | Preserve API startup logs after a crash | Set `true` temporarily when diagnosing startup failures; reset to `false` afterward. |
| `PAPYR_API_START_CONDITION` | When the web service starts relative to the API | Defaults to `service_healthy`; set to `service_started` only during API diagnostics, then restore `service_healthy`. |
| `PAPYR_COOKIE_SECURE` | Requires secure session cookies | Set `true` when served over HTTPS. |
| `PAPYR_CHANGE_RETENTION_DAYS` | Change-event retention | Defaults to 90; valid range is 1–3650. |
| `PAPYR_MIGRATE_ON_STARTUP` | Apply EF Core migrations when the API starts | Defaults to `true`; see the multi-replica note above. |
| `PAPYR_MAX_ASSET_STORAGE_BYTES` | Per-owner attachment quota | Defaults to 1 GiB. |
| `PAPYR_WEB_PORT` | Host port published for the web service | Defaults to 6767; keep the service private behind the proxy. |
| `PAPYR_NETWORK_SUBNET`, `PAPYR_WEB_IP`, `PAPYR_API_IP`, `PAPYR_DB_IP` | Private Compose network addressing | Change together only if the default subnet overlaps another Docker network. |
| `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` | Build-time whiteboard license key | Optional; use only with a license valid for this deployment. |

The Next.js API origin is set at image build time through `PAPYR_API_ORIGIN` (the supplied Compose build sets it to `http://api:8080`). For a custom deployment, preserve the internal API origin reachable by the web container. The public browser-facing API path remains same-origin through Next.js rewrites.

Compose passes the API database password separately as `PGPASSWORD`, which Npgsql reads when the connection string omits `Password`. This preserves semicolons and quotes as password characters instead of parsing them as connection-string settings. Keep this environment value private, just like `POSTGRES_PASSWORD`.

Changing `PAPYR_DB_PASSWORD` does **not** change the role password in an already initialized PostgreSQL volume. PostgreSQL can pass the supplied `pg_isready` healthcheck while rejecting the API's password; startup migrations then fail before the API listens. Preserve the existing password, or have the host administrator perform a coordinated database password rotation. Do not delete the database volume to resolve a credential mismatch. An empty setup token only disables first setup; it does not prevent API startup or the setup-status GET.

## Repair an existing database password mismatch in Portainer

### Through stack settings without container access

Recovery now also creates an administrator or replaces the existing administrator's login credentials. Supply `PAPYR_ADMIN_USERNAME` and `PAPYR_ADMIN_PASSWORD` in the private `.env` or Portainer stack environment before enabling the flag. The API applies them after database-password repair and migrations. An existing administrator keeps its ID and all owned data; previous sessions are revoked. A username belonging to another account is rejected. No first-setup data reset runs. Missing/invalid credentials leave the API in diagnostic mode with `ADMIN_RECOVERY_FAILED` (the database password may already have been repaired); correct the values and redeploy. The administrator password is hashed before storage and never returned to the browser or printed in application logs.

```dotenv
PAPYR_RESET_DB_PASSWORD=true
PAPYR_ADMIN_USERNAME=admin
PAPYR_ADMIN_PASSWORD=<your-private-login-password>
```

After recovery, sign in using these administrator credentials, disable the reset flag, and remove `PAPYR_ADMIN_PASSWORD` from the running stack environment if you no longer need it. Keep a private offline copy of the credentials if desired; never commit a populated `.env`.

Update the stack to the current Compose file, keep the intended `PAPYR_DB_PASSWORD`, and explicitly set `PAPYR_RESET_DB_PASSWORD=true`. Redeploy the stack. A one-shot `db-password-reset` service connects through PostgreSQL's shared local Unix socket, uses `psql`'s `\password` command to update only the `papyr` role password, and must complete successfully before the API starts. It has no network access and no mount of the database or attachment files. Password input is not printed and only its encrypted form is sent to PostgreSQL.

After Settings can check setup successfully, remove `PAPYR_RESET_DB_PASSWORD` or set it to `false` and redeploy again. Existing database and attachment volumes remain intact; do not remove or rename the stack or volumes during this repair. The reset is disabled by default and rejects an empty or multiline password. If local socket authentication was hardened, the reset fails without weakening authentication; an administrator must then perform the rotation. The helper uses the same pinned PostgreSQL image already used by the database.

### Through the database console when available

`DATABASE_AUTH_FAILED` means PostgreSQL rejected the API's credentials. If `PAPYR_DB_PASSWORD` was changed after the database volume was initialized, either restore the original stack value or explicitly update the stored database role password to the intended stack value. Redeploying containers alone does not change that stored password.

To update the role without SSH or deleting data, open Portainer's **Containers**, select this stack's **db** container, then open **Console** with `/bin/sh` as the `postgres` operating-system user. With the supplied PostgreSQL image's default local authentication, connect over its local Unix socket:

```sh
psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

At the `papyr=#` prompt, run:

```text
\password papyr
```

Enter the intended `PAPYR_DB_PASSWORD` from the stack settings at both password prompts. Input is hidden; `\password` avoids putting the plaintext password in SQL history or server statement logs. Exit with `\q`, then **restart the api container** to retry startup migrations. Click **Retry setup check** and verify `/health/ready` returns `200`. The role password changes, while notes, tables, attachments, and volumes remain intact. This repair was verified with a disposable PostgreSQL 17.6/API instance, including preservation of an existing database row.

If local authentication has been hardened or the role/database names differ, the instance administrator must perform the password rotation with their existing administrative access. Do not enable network trust authentication or delete the volume. Once recovered, set `PAPYR_API_DIAGNOSTICS=false` and `PAPYR_API_START_CONDITION=service_healthy`; retain `PAPYR_COOKIE_SECURE=false` for the current HTTP instance and enable it when HTTPS is configured.

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
