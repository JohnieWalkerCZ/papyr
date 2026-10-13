using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Papyr.Tests;

public sealed class StartupDiagnosticsTests
{
    [Fact]
    public async Task Failed_startup_migrations_keep_diagnostics_available_and_block_application_requests()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:Papyr", "Host=127.0.0.1;Port=1;Database=papyr;Username=papyr;Password=private-test-password;Timeout=1");
            builder.UseSetting("PAPYR_MIGRATE_ON_STARTUP", "true");
        });
        using var client = factory.CreateClient();
        using var live = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        foreach (var path in new[] { "/health/ready", "/api/v1/auth/setup-status", "/api/v1/auth/me" })
        {
            using var response = await client.GetAsync(path);
            await AssertDiagnostic(response);
        }
        using var mutation = await client.PostAsJsonAsync("/api/v1/mutations", new { operations = Array.Empty<object>() });
        await AssertDiagnostic(mutation);
    }

    private static async Task AssertDiagnostic(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("DATABASE_UNAVAILABLE", body);
        Assert.Contains("diagnosticId", body);
        Assert.DoesNotContain("private-test-password", body);
    }
}
