# Papyr

Papyr is a self-hosted notes app that keeps a working copy in your browser. Write offline, then sync to your private Papyr server and use the same account on another device.

Papyr is in active development. Markdown editing, local-first storage, account setup, and server sync are available. Typst and whiteboard editing are present, but remain proof-of-concept features; whiteboards require a suitable tldraw license for production use. See [current limitations](#current-limitations) before relying on the app for important work.

## Use a Papyr instance

Open the web address provided by the person hosting your Papyr server. The library works without signing in and saves notes in that browser profile. To sync notes or use the same library on another device, sign in with the account for that instance. There is no public account registration.

### First use

1. Ask the instance administrator whether this is a new instance and, if so, obtain its one-time setup token.
2. In the **Server account** panel, choose **First setup**, enter a username, a password of at least 12 characters, and the setup token. This creates the instance's single owner account; setup can only succeed once.
3. On other devices, sign in with that username and password. Each browser keeps its own local copy and synchronizes with the server after sign-in.

If no server is configured or reachable, continue using Papyr locally. Those notes stay in that browser's storage and will not appear on other devices until the browser signs in and syncs with the intended server.

### Create and organize notes

- Use **New** to create a Markdown note, Typst document, or whiteboard. Use the folder controls to create nested folders.
- Rename, move, or delete items from their action menu. Deleted items go to Trash, where they can be restored. Folder deletion also affects its descendants.
- Search locally by note title or text. The library's sort and display preferences are saved on the device.
- Markdown notes are edited as source and can be exported as `.md`. Markdown tables and some nested block syntax are not currently supported in preview.
- Typst notes compile in the browser and can export source and PDF. The bundled runtime works offline after its assets have been cached; arbitrary external Typst packages are unavailable.
- Whiteboards can be edited with pointer, touch, or pen and exported as an editable snapshot, PNG, or SVG where supported.

### Offline work, sync, and conflicts

Papyr saves edits to the browser before reporting them as saved locally. Sync runs in the background when signed in; the status area distinguishes local saves, pending sync, syncing, offline, and errors. **Sync now** requests an immediate attempt. Previously loaded local notes remain usable offline.

If the same note changes independently on two devices, Papyr pauses that note and opens the Conflict Center. Review the versions and choose whether to keep the server version, save the local version as a separate note, or explicitly overwrite the server version. Do not clear browser storage while it has unsynced edits.

## Run Papyr locally

For a quick local instance, install Docker with Compose, then run:

```sh
docker compose -f infra/compose.yaml up --build
```

Open [http://localhost:3000](http://localhost:3000). The API health endpoints are [live](http://localhost:5080/health/live) and [ready](http://localhost:5080/health/ready). Compose binds both services to loopback; use a TLS reverse proxy for remote access.

For web hot reload while API and PostgreSQL run in Docker, install Node.js 24.18.0, pnpm 11.12.0, and the .NET 10 SDK, then run:

```sh
pnpm install --frozen-lockfile
./infra/dev.sh
```

The development script generates a one-time owner setup token if needed, saves it in the local `.env`, and prints it in the terminal. Keep it private. Press Ctrl+C to stop the web server; stop the containers with `docker compose -f infra/compose.yaml down`.

For self-hosted deployment, HTTPS, storage, and backup instructions, see [DEPLOYMENT.md](DEPLOYMENT.md). The app's sync contract and current implementation detail are in [API.md](API.md) and [SYNC.md](SYNC.md).

## Current limitations

- This is an in-progress MVP; do not treat it as a sole archival copy. Keep independent backups of important work.
- The product is designed for one owner per instance. There is no public registration, sharing, or real-time collaborative editing.
- Typst has no arbitrary package fetching. Markdown preview does not support every Markdown construct.
- Whiteboards are a proof of concept and production is blocked unless an applicable tldraw license key is supplied at build time.
- Attachment orphan cleanup and a clean-host backup/restore rehearsal are still outstanding.
- Browser storage can be cleared by the user, browser settings, or device failure. Sync important notes to a server and back up the server.
