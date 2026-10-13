using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Papyr.Api.Data;
using Papyr.Api.Security;

namespace Papyr.Tests;

public sealed class AdministratorRecoveryTests
{
    [Fact]
    public async Task Recovery_creates_or_updates_admin_preserves_data_revokes_sessions_and_refuses_account_collision()
    {
        var configured = Environment.GetEnvironmentVariable("PAPYR_TEST_CONNECTION") ?? throw new InvalidOperationException("Set PAPYR_TEST_CONNECTION.");
        var databaseName = $"papyr_recovery_{Guid.NewGuid():N}";
        await using var connection = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(configured) { Database = "postgres" }.ConnectionString);
        await connection.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE {databaseName}", connection)) await create.ExecuteNonQueryAsync();
        var database = new NpgsqlConnectionStringBuilder(configured) { Database = databaseName }.ConnectionString;
        try
        {
            Guid administratorId;
            var noteId = Guid.NewGuid();
            var oldToken = SessionTokens.NewToken();
            using (var initial = Factory(database, "FirstAdmin", "old-admin-password"))
            {
                using var client = initial.CreateClient();
                Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/auth/setup-status")).StatusCode);
                await using var scope = initial.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PapyrDbContext>();
                var administrator = await db.Owners.SingleAsync();
                Assert.True(administrator.IsAdmin);
                Assert.Equal("firstadmin", administrator.Username);
                administratorId = administrator.Id;
                db.Entities.Add(new EntityRecord { Id = noteId, OwnerId = administratorId, Kind = "note", Title = "Preserved", NoteType = "markdown", Content = "Keep this source", Revision = 1, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow });
                db.Sessions.Add(new SessionRecord { TokenHash = SessionTokens.Hash(oldToken), OwnerId = administratorId, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(1) });
                db.Owners.Add(new OwnerRecord { Id = Guid.NewGuid(), InstanceKey = "other", Username = "other-user", PasswordHash = "preserve-other-hash", CreatedAt = DateTimeOffset.UtcNow });
                await db.SaveChangesAsync();
            }
            using (var recovery = Factory(database, "RecoveredAdmin", "new-admin-password"))
            {
                using var client = recovery.CreateClient();
                using var oldSession = new HttpRequestMessage(HttpMethod.Get, "/api/v1/auth/me");
                oldSession.Headers.Add("Cookie", $"{SessionAuthenticationHandler.CookieName}={oldToken}");
                Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(oldSession)).StatusCode);
                using var csrf = JsonDocument.Parse(await client.GetStringAsync("/api/v1/auth/csrf"));
                client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf.RootElement.GetProperty("token").GetString());
                Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "firstadmin", password = "old-admin-password" })).StatusCode);
                Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "recoveredadmin", password = "new-admin-password" })).StatusCode);
                await using var scope = recovery.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PapyrDbContext>();
                var administrator = await db.Owners.SingleAsync(owner => owner.IsAdmin);
                Assert.Equal(administratorId, administrator.Id);
                Assert.Equal("Keep this source", (await db.Entities.SingleAsync(entity => entity.Id == noteId)).Content);
                Assert.False(await db.Sessions.AnyAsync(session => session.TokenHash == SessionTokens.Hash(oldToken)));
                Assert.Equal(PasswordVerificationResult.Success, scope.ServiceProvider.GetRequiredService<IPasswordHasher<OwnerRecord>>().VerifyHashedPassword(administrator, administrator.PasswordHash, "new-admin-password"));
            }
            foreach (var username in new[] { "other-user", "" })
            {
                using var invalid = Factory(database, username, "never-applied-password");
                using var client = invalid.CreateClient();
                using var response = await client.GetAsync("/api/v1/auth/setup-status");
                Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
                Assert.Contains("ADMIN_RECOVERY_FAILED", await response.Content.ReadAsStringAsync());
                await using var scope = invalid.Services.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PapyrDbContext>();
                Assert.Equal("recoveredadmin", (await db.Owners.SingleAsync(owner => owner.IsAdmin)).Username);
                Assert.Equal("preserve-other-hash", (await db.Owners.SingleAsync(owner => owner.Username == "other-user")).PasswordHash);
                Assert.True(await db.Entities.AnyAsync(entity => entity.Id == noteId));
            }
            using var disabled = Factory(database, "ignored-user", "ignored-password", reset: false);
            using var disabledClient = disabled.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await disabledClient.GetAsync("/api/v1/auth/setup-status")).StatusCode);
            await using var disabledScope = disabled.Services.CreateAsyncScope();
            Assert.Equal("recoveredadmin", (await disabledScope.ServiceProvider.GetRequiredService<PapyrDbContext>().Owners.SingleAsync(owner => owner.IsAdmin)).Username);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE {databaseName} WITH (FORCE)", connection);
            await drop.ExecuteNonQueryAsync();
        }
    }

    private static WebApplicationFactory<Program> Factory(string database, string username, string password, bool reset = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:Papyr", database);
            builder.UseSetting("PAPYR_RESET_DB_PASSWORD", reset ? "true" : "false");
            builder.UseSetting("PAPYR_ADMIN_USERNAME", username);
            builder.UseSetting("PAPYR_ADMIN_PASSWORD", password);
            builder.UseSetting("PAPYR_COOKIE_SECURE", "false");
        });
}
