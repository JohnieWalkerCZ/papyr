using System.Threading.RateLimiting;
using System.Net;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using Papyr.Api.Data;
using Papyr.Api.Security;
using Papyr.Api.Sync;
using Papyr.Api.Storage;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("Papyr") ??
    (builder.Environment.IsDevelopment() ? "Host=localhost;Database=papyr;Username=papyr;Password=papyr" :
        throw new InvalidOperationException("ConnectionStrings:Papyr is required outside Development."));
builder.Services.AddDbContext<PapyrDbContext>(options => options.UseNpgsql(connectionString));
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 5_000_000);
builder.Services.Configure<FormOptions>(options => options.MultipartBodyLengthLimit = 5_000_000);
builder.Services.AddScoped<IPasswordHasher<OwnerRecord>, PasswordHasher<OwnerRecord>>();
builder.Services.AddAuthentication(SessionAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(SessionAuthenticationHandler.SchemeName, _ => { });
builder.Services.AddAuthorization();
builder.Services.AddSignalR();
builder.Services.AddSingleton<SessionConnectionRegistry>();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    foreach (var value in (builder.Configuration["PAPYR_TRUSTED_PROXIES"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    {
        if (!IPAddress.TryParse(value, out var address)) throw new InvalidOperationException($"Invalid trusted proxy IP address: {value}");
        options.KnownProxies.Add(address);
    }
});
builder.Services.AddHostedService<ChangeRetentionService>();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "papyr_antiforgery";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Configuration["PAPYR_COOKIE_SECURE"] == "false"
        ? CookieSecurePolicy.None
        : CookieSecurePolicy.Always;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 8,
            Window = TimeSpan.FromMinutes(5),
            QueueLimit = 0,
            AutoReplenishment = true,
        }));
    options.AddPolicy("bootstrap", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 12, Window = TimeSpan.FromMinutes(5), QueueLimit = 0, AutoReplenishment = true }));
    options.AddPolicy("asset-upload", context => RateLimitPartition.GetConcurrencyLimiter(
        context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "unknown",
        _ => new ConcurrencyLimiterOptions { PermitLimit = 1, QueueLimit = 10, QueueProcessingOrder = QueueProcessingOrder.OldestFirst }));
});

var app = builder.Build();
if (!bool.TryParse(builder.Configuration["PAPYR_MIGRATE_ON_STARTUP"], out var migrateOnStartup) || migrateOnStartup)
{
    try
    {
        await using var scope = app.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<PapyrDbContext>().Database.MigrateAsync();
    }
    catch (Exception error) when (error is not OperationCanceledException)
    {
        var diagnostic = SetupStatusDiagnostics.Describe(error);
        var diagnosticId = Guid.NewGuid().ToString();
        app.Logger.LogError(error, "API startup migrations failed with {DiagnosticCode}; diagnostic id {DiagnosticId}. Only diagnostics are available until restart.", diagnostic.Code, diagnosticId);
        // A failed migration must never enable authentication or application writes.
        app.Run(async context =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (context.Request.Path == "/health/live")
            {
                await context.Response.WriteAsJsonAsync(new { status = "diagnostic" });
                return;
            }
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new { error = new { code = diagnostic.Code, message = diagnostic.Message }, diagnosticId });
        });
        app.Run();
        return;
    }
}

app.Services.GetServices<IHostedService>().OfType<ChangeRetentionService>().Single().StartupCompleted = true;
app.UseForwardedHeaders();
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapGet("/health/live", () => Results.Ok(new { status = "healthy" }));
app.MapGet("/health/ready", async (PapyrDbContext db, CancellationToken cancellationToken) =>
    await db.Database.CanConnectAsync(cancellationToken)
        ? Results.Ok(new { status = "ready" })
        : Results.Problem("Database is unavailable", statusCode: StatusCodes.Status503ServiceUnavailable));
app.MapAuthEndpoints();
app.MapSyncEndpoints();
app.MapHub<ChangeHub>("/hubs/changes").RequireAuthorization();
app.MapAttachmentEndpoints();
app.Run();

public partial class Program { }
