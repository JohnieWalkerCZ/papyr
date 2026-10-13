using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Papyr.Api.Security;

namespace Papyr.Tests;

public sealed class AuthEndpointsTests
{
    [Fact]
    public async Task Bootstrap_login_and_revocable_csrf_protected_session_work_against_postgres()
    {
        var configuredConnection = Environment.GetEnvironmentVariable("PAPYR_TEST_CONNECTION")
            ?? throw new InvalidOperationException("Set PAPYR_TEST_CONNECTION to a PostgreSQL connection string for integration tests.");
        var admin = new NpgsqlConnectionStringBuilder(configuredConnection) { Database = "postgres" };
        var databaseName = $"papyr_test_{Guid.NewGuid():N}";
        var storagePath = Path.Combine(Path.GetTempPath(), $"papyr-test-assets-{Guid.NewGuid():N}");
        await using (var connection = new NpgsqlConnection(admin.ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE {databaseName}", connection);
            await command.ExecuteNonQueryAsync();
        }

        try
        {
            var testConnection = new NpgsqlConnectionStringBuilder(configuredConnection) { Database = databaseName };
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseSetting("ConnectionStrings:Papyr", testConnection.ConnectionString);
                builder.UseSetting("PAPYR_INITIAL_SETUP_TOKEN", "integration-test-bootstrap-secret-at-least-32-chars");
                builder.UseSetting("PAPYR_COOKIE_SECURE", "false");
                builder.UseSetting("PAPYR_ASSET_STORAGE_PATH", storagePath);
                builder.UseSetting("PAPYR_MAX_ASSET_STORAGE_BYTES", "100");
                builder.UseSetting("PAPYR_TRUSTED_PROXIES", "127.0.0.1,::1");
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

            await using (var schemaConnection = new NpgsqlConnection(testConnection.ConnectionString))
            {
                await schemaConnection.OpenAsync();
                await using var renameOwners = new NpgsqlCommand("ALTER TABLE owners RENAME TO owners_unavailable", schemaConnection);
                await renameOwners.ExecuteNonQueryAsync();
            }
            try
            {
                using var setupStatus = await client.GetAsync("/api/v1/auth/setup-status");
                Assert.Equal(HttpStatusCode.ServiceUnavailable, setupStatus.StatusCode);
                var setupError = await setupStatus.Content.ReadFromJsonAsync<SetupStatusErrorResponse>();
                Assert.Equal("DATABASE_SCHEMA_ERROR", setupError?.Error?.Code);
                Assert.False(string.IsNullOrWhiteSpace(setupError?.DiagnosticId));
            }
            finally
            {
                await using var schemaConnection = new NpgsqlConnection(testConnection.ConnectionString);
                await schemaConnection.OpenAsync();
                await using var restoreOwners = new NpgsqlCommand("ALTER TABLE owners_unavailable RENAME TO owners", schemaConnection);
                await restoreOwners.ExecuteNonQueryAsync();
            }

            Directory.CreateDirectory(Path.Combine(storagePath, "stale-owner"));
            await File.WriteAllTextAsync(Path.Combine(storagePath, "stale-owner", "old.blob"), "old data");
            await using (var seedScope = factory.Services.CreateAsyncScope())
            {
                var db = seedScope.ServiceProvider.GetRequiredService<Papyr.Api.Data.PapyrDbContext>();
                db.Entities.Add(new Papyr.Api.Data.EntityRecord
                {
                    Id = Guid.NewGuid(), OwnerId = Guid.NewGuid(), Kind = "note", Title = "Stale", Revision = 1,
                    CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
                });
                await db.SaveChangesAsync();
            }

            var csrf = await GetCsrf(client);
            using var unconfirmedSetup = await Post(client, "/api/v1/setup", new { username = "owner", password = "correct horse battery staple", confirmReset = false }, csrf,
                ("X-Papyr-Setup-Token", "integration-test-bootstrap-secret-at-least-32-chars"));
            Assert.Equal(HttpStatusCode.BadRequest, unconfirmedSetup.StatusCode);
            await using (var preservedScope = factory.Services.CreateAsyncScope())
            {
                var db = preservedScope.ServiceProvider.GetRequiredService<Papyr.Api.Data.PapyrDbContext>();
                Assert.Equal(1, await db.Entities.CountAsync());
            }
            using var setup = await Post(client, "/api/v1/setup", new { username = "owner", password = "correct horse battery staple", confirmReset = true }, csrf,
                ("X-Papyr-Setup-Token", "integration-test-bootstrap-secret-at-least-32-chars"));
            Assert.Equal(HttpStatusCode.Created, setup.StatusCode);
            Assert.False(Directory.Exists(Path.Combine(storagePath, "stale-owner")));
            var identity = await setup.Content.ReadFromJsonAsync<IdentityResponse>();
            Assert.NotNull(identity?.Id);
            csrf = await GetCsrf(client);

            var image = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/X2sAAAAASUVORK5CYII=");
            var assetId = Guid.NewGuid();
            var imageHash = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
            using var uploadedAsset = await PostAsset(client, assetId, image, imageHash, csrf);
            Assert.Equal(HttpStatusCode.Created, uploadedAsset.StatusCode);
            using var overQuotaAsset = await PostAsset(client, Guid.NewGuid(), image, imageHash, csrf);
            Assert.Equal(HttpStatusCode.RequestEntityTooLarge, overQuotaAsset.StatusCode);
            using var badHashAsset = await PostAsset(client, Guid.NewGuid(), image, new string('0', 64), csrf);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, badHashAsset.StatusCode);
            var invalidImage = new byte[] { 1, 2, 3, 4 };
            using var invalidImageUpload = await PostAsset(client, Guid.NewGuid(), invalidImage, Convert.ToHexString(SHA256.HashData(invalidImage)).ToLowerInvariant(), csrf);
            Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidImageUpload.StatusCode);
            using var uploadedDuplicate = await PostAsset(client, assetId, image, imageHash, csrf);
            Assert.Equal(HttpStatusCode.OK, uploadedDuplicate.StatusCode);
            Assert.Contains("duplicate", await uploadedDuplicate.Content.ReadAsStringAsync());
            using var downloadedAsset = await client.GetAsync($"/api/v1/assets/{assetId}");
            Assert.Equal(image, await downloadedAsset.Content.ReadAsByteArrayAsync());
            Assert.Equal("nosniff", downloadedAsset.Headers.GetValues("X-Content-Type-Options").Single());

            using var me = await client.GetAsync("/api/v1/auth/me");
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            Assert.Equal("owner", (await me.Content.ReadFromJsonAsync<IdentityResponse>())?.Username);

            using var missingCsrf = await client.PostAsJsonAsync("/api/v1/auth/logout", new { });
            Assert.Equal(HttpStatusCode.BadRequest, missingCsrf.StatusCode);

            string sessionHash;
            await using (var sessionConnection = new NpgsqlConnection(testConnection.ConnectionString))
            {
                await sessionConnection.OpenAsync();
                await using var sessionQuery = new NpgsqlCommand("SELECT token_hash FROM sessions WHERE owner_id = @owner", sessionConnection);
                sessionQuery.Parameters.AddWithValue("owner", identity!.Id!.Value);
                sessionHash = (string)(await sessionQuery.ExecuteScalarAsync())!;
            }
            var activeConnectionAborted = false;
            var connections = factory.Services.GetRequiredService<SessionConnectionRegistry>();
            Assert.True(connections.Register(sessionHash, "logout-test", DateTimeOffset.UtcNow.AddDays(1), () => activeConnectionAborted = true));

            using var logout = await Post(client, "/api/v1/auth/logout", new { }, csrf);
            Assert.True(logout.StatusCode == HttpStatusCode.NoContent, await logout.Content.ReadAsStringAsync());
            Assert.True(activeConnectionAborted);
            using var afterLogout = await client.GetAsync("/api/v1/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);

            csrf = await GetCsrf(client);
            using var login = await Post(client, "/api/v1/auth/login", new { username = "OWNER", password = "correct horse battery staple" }, csrf);
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            csrf = await GetCsrf(client);

            var folderId = Guid.NewGuid();
            var folderCreate = new
            {
                operationId = Guid.NewGuid(),
                entityType = "folder",
                entityId = folderId,
                action = "create",
                baseRevision = (string?)null,
                payload = new { id = folderId, kind = "folder", parentId = (Guid?)null, title = "School" },
            };
            using var folderResult = await Post(client, "/api/v1/mutations", new { operations = new[] { folderCreate } }, csrf);
            folderResult.EnsureSuccessStatusCode();
            Assert.Equal("accepted", FirstMutationStatus(await folderResult.Content.ReadAsStringAsync()));

            var noteId = Guid.NewGuid();
            var createNote = new
            {
                operationId = Guid.NewGuid(),
                entityType = "note",
                entityId = noteId,
                action = "create",
                baseRevision = (string?)null,
                payload = new { id = noteId, kind = "note", folderId, title = "Sequences", type = "markdown", contentSchemaVersion = (int?)null, content = $"# Sequences\n![pixel](papyr-asset://{assetId})\nhttps://papyr.invalid/papyr-assets/{assetId}" },
            };
            using var createdNote = await Post(client, "/api/v1/mutations", new { operations = new[] { createNote } }, csrf);
            createdNote.EnsureSuccessStatusCode();
            Assert.Equal("accepted", FirstMutationStatus(await createdNote.Content.ReadAsStringAsync()));

            var invalidTitleOperation = new { operationId = Guid.NewGuid(), entityType = "note", entityId = noteId, action = "update", baseRevision = "1", payload = new { title = 123 } };
            using var invalidTitleResult = await Post(client, "/api/v1/mutations", new { operations = new[] { invalidTitleOperation } }, csrf);
            Assert.Equal("rejected", FirstMutationStatus(await invalidTitleResult.Content.ReadAsStringAsync()));

            var whiteboardId = Guid.NewGuid();
            var invalidWhiteboardCreate = new
            {
                operationId = Guid.NewGuid(),
                entityType = "note",
                entityId = whiteboardId,
                action = "create",
                baseRevision = (string?)null,
                payload = new { id = whiteboardId, kind = "note", folderId = (Guid?)null, title = "Broken canvas", type = "whiteboard", contentSchemaVersion = 1, content = new { malformed = true } },
            };
            using var invalidWhiteboardResult = await Post(client, "/api/v1/mutations", new { operations = new[] { invalidWhiteboardCreate } }, csrf);
            Assert.Equal("rejected", FirstMutationStatus(await invalidWhiteboardResult.Content.ReadAsStringAsync()));
            using var replay = await Post(client, "/api/v1/mutations", new { operations = new[] { createNote } }, csrf);
            Assert.Equal("duplicate", FirstMutationStatus(await replay.Content.ReadAsStringAsync()));

            var rejectedUpdate = new
            {
                operationId = Guid.NewGuid(),
                entityType = "note",
                entityId = noteId,
                action = "update",
                baseRevision = "1",
                payload = new { content = "# Rejected\npapyr-asset://" + Guid.NewGuid() },
            };
            using var missingAssetReference = await Post(client, "/api/v1/mutations", new
            {
                operations = new[] { rejectedUpdate },
            }, csrf);
            Assert.Equal("rejected", FirstMutationStatus(await missingAssetReference.Content.ReadAsStringAsync()));
            using var rejectedReplay = await Post(client, "/api/v1/mutations", new { operations = new[] { rejectedUpdate } }, csrf);
            Assert.Equal("rejected", FirstMutationStatus(await rejectedReplay.Content.ReadAsStringAsync()));
            using var noteAfterRejectedUpdate = await client.GetAsync($"/api/v1/notes/{noteId}");
            Assert.Contains($"papyr-asset://{assetId}", (await noteAfterRejectedUpdate.Content.ReadAsStringAsync()));

            using var secondDevice = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            var secondCsrf = await GetCsrf(secondDevice);
            using var secondLogin = await Post(secondDevice, "/api/v1/auth/login", new { username = "owner", password = "correct horse battery staple" }, secondCsrf);
            Assert.Equal(HttpStatusCode.OK, secondLogin.StatusCode);
            secondCsrf = await GetCsrf(secondDevice);
            using var authenticatedHubNegotiation = await secondDevice.PostAsync("/hubs/changes/negotiate?negotiateVersion=1", null);
            Assert.Equal(HttpStatusCode.OK, authenticatedHubNegotiation.StatusCode);
            using var anonymousClient = factory.CreateClient();
            using var anonymousHubNegotiation = await anonymousClient.PostAsync("/hubs/changes/negotiate?negotiateVersion=1", null);
            Assert.Equal(HttpStatusCode.Unauthorized, anonymousHubNegotiation.StatusCode);

            using var update = await Post(client, "/api/v1/mutations", new
            {
                operations = new[] { new { operationId = Guid.NewGuid(), entityType = "note", entityId = noteId, action = "update", baseRevision = "1", payload = new { content = "# Latest" } } },
            }, csrf);
            update.EnsureSuccessStatusCode();
            Assert.Equal("accepted", FirstMutationStatus(await update.Content.ReadAsStringAsync()));

            using var conflict = await Post(secondDevice, "/api/v1/mutations", new
            {
                operations = new[] { new { operationId = Guid.NewGuid(), entityType = "note", entityId = noteId, action = "update", baseRevision = "1", payload = new { content = "# Stale" } } },
            }, secondCsrf);
            conflict.EnsureSuccessStatusCode();
            Assert.Equal("conflict", FirstMutationStatus(await conflict.Content.ReadAsStringAsync()));
            using var latest = await client.GetAsync($"/api/v1/notes/{noteId}");
            Assert.Equal("# Latest", (await latest.Content.ReadFromJsonAsync<NoteResponse>())?.Content?.GetString());

            using var firstPage = await client.GetAsync("/api/v1/bootstrap?limit=1");
            firstPage.EnsureSuccessStatusCode();
            using var firstSnapshot = JsonDocument.Parse(await firstPage.Content.ReadAsStringAsync());
            var continuation = firstSnapshot.RootElement.GetProperty("nextCursorToken").GetString();
            Assert.False(string.IsNullOrWhiteSpace(continuation));
            using var secondPage = await client.GetAsync($"/api/v1/bootstrap?limit=1&cursorToken={Uri.EscapeDataString(continuation!)}");
            secondPage.EnsureSuccessStatusCode();
            using var secondSnapshot = JsonDocument.Parse(await secondPage.Content.ReadAsStringAsync());
            Assert.Equal("seq:3", secondSnapshot.RootElement.GetProperty("cursor").GetString());

            await using (var expireConnection = new NpgsqlConnection(testConnection.ConnectionString))
            {
                await expireConnection.OpenAsync();
                await using var expireSnapshot = new NpgsqlCommand(
                    "UPDATE bootstrap_snapshots SET expires_at = now() - interval '1 minute' WHERE id = (SELECT snapshot_id FROM bootstrap_cursors WHERE token_hash = @token)",
                    expireConnection);
                expireSnapshot.Parameters.AddWithValue("token", SessionTokens.Hash(continuation!));
                Assert.Equal(1, await expireSnapshot.ExecuteNonQueryAsync());
            }
            using var expiredBootstrap = await client.GetAsync($"/api/v1/bootstrap?cursorToken={Uri.EscapeDataString(continuation!)}");
            Assert.Equal(HttpStatusCode.Gone, expiredBootstrap.StatusCode);

            for (var attempt = 0; attempt < 9; attempt++)
            {
                using var bootstrap = await client.GetAsync("/api/v1/bootstrap");
                Assert.True(bootstrap.IsSuccessStatusCode, await bootstrap.Content.ReadAsStringAsync());
            }
            using var limitedBootstrap = await client.GetAsync("/api/v1/bootstrap");
            Assert.Equal(HttpStatusCode.TooManyRequests, limitedBootstrap.StatusCode);
            Assert.Contains("CURSOR_EXPIRED", await expiredBootstrap.Content.ReadAsStringAsync());
            await using (var snapshotConnection = new NpgsqlConnection(testConnection.ConnectionString))
            {
                await snapshotConnection.OpenAsync();
                await using var snapshotCount = new NpgsqlCommand("SELECT count(*) FROM bootstrap_snapshots", snapshotConnection);
                Assert.Equal(1L, (long)(await snapshotCount.ExecuteScalarAsync())!);
            }

            using var changesPage = await client.GetAsync("/api/v1/changes?cursor=seq%3A0&limit=2");
            changesPage.EnsureSuccessStatusCode();
            using var changes = JsonDocument.Parse(await changesPage.Content.ReadAsStringAsync());
            Assert.Equal(2, changes.RootElement.GetProperty("changes").GetArrayLength());
            Assert.True(changes.RootElement.GetProperty("hasMore").GetBoolean());

            await using (var ageConnection = new NpgsqlConnection(testConnection.ConnectionString))
            {
                await ageConnection.OpenAsync();
                await using var ageChanges = new NpgsqlCommand(
                    "UPDATE changes SET committed_at = now() - interval '91 days' WHERE owner_id = @owner AND sequence < 3",
                    ageConnection);
                ageChanges.Parameters.AddWithValue("owner", identity!.Id!.Value);
                Assert.Equal(2, await ageChanges.ExecuteNonQueryAsync());
            }
            await using (var scope = factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Papyr.Api.Data.PapyrDbContext>();
                await Papyr.Api.Sync.ChangeRetentionService.PurgeExpiredAsync(db, DateTimeOffset.UtcNow, TimeSpan.FromDays(90));
            }
            using var expiredChanges = await client.GetAsync("/api/v1/changes?cursor=seq%3A0");
            Assert.Equal(HttpStatusCode.Gone, expiredChanges.StatusCode);
            Assert.Contains("CURSOR_EXPIRED", await expiredChanges.Content.ReadAsStringAsync());
            using var retainedChanges = await client.GetAsync("/api/v1/changes?cursor=seq%3A2");
            retainedChanges.EnsureSuccessStatusCode();
            using var retained = JsonDocument.Parse(await retainedChanges.Content.ReadAsStringAsync());
            Assert.Single(retained.RootElement.GetProperty("changes").EnumerateArray());

            using var createdAccount = await Post(client, "/api/v1/auth/accounts", new { username = "second-user", password = "another password" }, csrf);
            Assert.Equal(HttpStatusCode.Created, createdAccount.StatusCode);
            using var secondClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            var accountCsrf = await GetCsrf(secondClient);
            using var accountLogin = await Post(secondClient, "/api/v1/auth/login", new { username = "second-user", password = "another password" }, accountCsrf);
            Assert.Equal(HttpStatusCode.OK, accountLogin.StatusCode);
            accountCsrf = await GetCsrf(secondClient);
            using var forbiddenAccount = await Post(secondClient, "/api/v1/auth/accounts", new { username = "third-user", password = "another password" }, accountCsrf);
            Assert.Equal(HttpStatusCode.Forbidden, forbiddenAccount.StatusCode);
            using var secondBootstrap = await secondClient.GetAsync("/api/v1/bootstrap");
            secondBootstrap.EnsureSuccessStatusCode();
            using var secondLibrary = JsonDocument.Parse(await secondBootstrap.Content.ReadAsStringAsync());
            Assert.Empty(secondLibrary.RootElement.GetProperty("folders").EnumerateArray());
            Assert.Empty(secondLibrary.RootElement.GetProperty("notes").EnumerateArray());

            using var duplicateSetup = await Post(client, "/api/v1/setup", new { username = "another", password = "correct horse battery staple", confirmReset = true }, csrf,
                ("X-Papyr-Setup-Token", "integration-test-bootstrap-secret-at-least-32-chars"));
            Assert.Equal(HttpStatusCode.Conflict, duplicateSetup.StatusCode);
        }
        finally
        {
            await using var connection = new NpgsqlConnection(admin.ConnectionString);
            await connection.OpenAsync();
            await using var terminate = new NpgsqlCommand("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @name", connection);
            terminate.Parameters.AddWithValue("name", databaseName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {databaseName}", connection);
            await drop.ExecuteNonQueryAsync();
            if (Directory.Exists(storagePath)) Directory.Delete(storagePath, recursive: true);
        }
    }

    private static async Task<string> GetCsrf(HttpClient client)
    {
        using var response = await client.GetAsync("/api/v1/auth/csrf");
        response.EnsureSuccessStatusCode();
        var value = await response.Content.ReadFromJsonAsync<CsrfResponse>();
        return Assert.IsType<string>(value?.Token);
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object body, string csrf, params (string Name, string Value)[] headers)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-CSRF-TOKEN", csrf);
        foreach (var (name, value) in headers) request.Headers.Add(name, value);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> PostAsset(HttpClient client, Guid assetId, byte[] bytes, string hash, string csrf)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/assets") { Content = new MultipartFormDataContent() };
        request.Headers.Add("X-CSRF-TOKEN", csrf);
        request.Headers.Add("X-Asset-Id", assetId.ToString());
        request.Headers.Add("X-Content-SHA256", hash);
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/png");
        ((MultipartFormDataContent)request.Content).Add(file, "file", "pixel.png");
        return await client.SendAsync(request);
    }

    private sealed record CsrfResponse(string? Token);
    private sealed record SetupStatusErrorResponse(SetupStatusError? Error, string? DiagnosticId);
    private sealed record SetupStatusError(string? Code, string? Message);
    private sealed record IdentityResponse(Guid? Id, string? Username, bool IsAdmin);
    private sealed record NoteResponse(JsonElement? Content);

    private static string FirstMutationStatus(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.GetProperty("results")[0].GetProperty("status").GetString()!;
    }
}
