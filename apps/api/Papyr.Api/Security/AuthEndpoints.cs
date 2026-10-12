using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Net;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Papyr.Api.Data;

namespace Papyr.Api.Security;

public sealed record SetupRequest(string Username, string Password);
public sealed record LoginRequest(string Username, string Password);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/api/v1/auth");
        app.MapGet("/api/v1/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
        {
            var tokens = antiforgery.GetAndStoreTokens(context);
            return Results.Ok(new { token = tokens.RequestToken });
        }).AllowAnonymous();

        app.MapPost("/api/v1/setup", SetupAsync).AllowAnonymous().RequireRateLimiting("auth");
        auth.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting("auth");
        auth.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(new { id = user.FindFirstValue(ClaimTypes.NameIdentifier), username = user.Identity?.Name }))
            .RequireAuthorization();
        auth.MapPost("/logout", LogoutAsync).RequireAuthorization();
    }

    private static async Task<IResult> SetupAsync(
        SetupRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        PapyrDbContext db,
        IPasswordHasher<OwnerRecord> hasher,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest(Error("CSRF_INVALID", "Request verification failed."));
        var setupToken = configuration["PAPYR_INITIAL_SETUP_TOKEN"];
        if (setupToken is null || setupToken.Length < 32)
            return Results.Problem("Owner setup is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
        if (!SessionTokens.SecretMatches(setupToken, context.Request.Headers["X-Papyr-Setup-Token"].FirstOrDefault()))
            return Results.Unauthorized();
        if (await db.Owners.AnyAsync(cancellationToken)) return Results.Conflict(Error("SETUP_COMPLETE", "Owner setup has already completed."));
        if (!ValidCredentials(request.Username, request.Password)) return Results.UnprocessableEntity(Error("INVALID_CREDENTIALS", "Use a username of 3–64 characters and a password of at least 12 characters."));

        var owner = new OwnerRecord
        {
            Id = Guid.NewGuid(),
            Username = request.Username.Trim().ToLowerInvariant(),
            PasswordHash = string.Empty,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        owner.PasswordHash = hasher.HashPassword(owner, request.Password);
        db.Owners.Add(owner);
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            loggerFactory.CreateLogger("Papyr.Setup").LogWarning("Concurrent owner setup was rejected.");
            return Results.Conflict(Error("SETUP_COMPLETE", "Owner setup has already completed."));
        }
        await IssueSession(context, db, owner.Id, configuration, cancellationToken);
        return Results.Created("/api/v1/auth/me", new { id = owner.Id, username = owner.Username });
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        IAntiforgery antiforgery,
        PapyrDbContext db,
        IPasswordHasher<OwnerRecord> hasher,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest(Error("CSRF_INVALID", "Request verification failed."));
        if (!ValidCredentials(request.Username, request.Password)) return Results.Unauthorized();
        var username = request.Username.Trim().ToLowerInvariant();
        var owner = await db.Owners.SingleOrDefaultAsync(item => item.Username == username, cancellationToken);
        if (owner is null)
        {
            _ = hasher.HashPassword(new OwnerRecord { Username = "invalid", PasswordHash = string.Empty }, request.Password);
            return Results.Unauthorized();
        }
        if (hasher.VerifyHashedPassword(owner, owner.PasswordHash, request.Password) == PasswordVerificationResult.Failed)
            return Results.Unauthorized();
        await IssueSession(context, db, owner.Id, configuration, cancellationToken);
        return Results.Ok(new { id = owner.Id, username = owner.Username });
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        IAntiforgery antiforgery,
        PapyrDbContext db,
        SessionConnectionRegistry connections,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest(Error("CSRF_INVALID", "Request verification failed."));
        if (context.Request.Cookies.TryGetValue(SessionAuthenticationHandler.CookieName, out var token))
        {
            var hash = SessionTokens.Hash(token);
            await db.Sessions.Where(session => session.TokenHash == hash).ExecuteDeleteAsync(cancellationToken);
            var expiresClaim = context.User.FindFirst(SessionAuthenticationHandler.SessionExpiresAtClaim)?.Value;
            var expiresAt = long.TryParse(expiresClaim, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var expiry)
                ? DateTimeOffset.FromUnixTimeSeconds(expiry)
                : DateTimeOffset.UtcNow;
            connections.Revoke(hash, expiresAt);
        }
        context.Response.Cookies.Delete(SessionAuthenticationHandler.CookieName, CookieOptions(context, configuration));
        return Results.NoContent();
    }

    private static async Task IssueSession(HttpContext context, PapyrDbContext db, Guid ownerId, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var rawToken = SessionTokens.NewToken();
        var expiresAt = DateTimeOffset.UtcNow.AddDays(14);
        db.Sessions.Add(new SessionRecord
        {
            TokenHash = SessionTokens.Hash(rawToken),
            OwnerId = ownerId,
            CreatedAt = DateTimeOffset.UtcNow,
            ExpiresAt = expiresAt,
        });
        await db.SaveChangesAsync(cancellationToken);
        context.Response.Cookies.Append(SessionAuthenticationHandler.CookieName, rawToken, CookieOptions(context, configuration, expiresAt));
    }

    private static CookieOptions CookieOptions(HttpContext context, IConfiguration configuration, DateTimeOffset? expiresAt = null)
    {
        var host = context.Request.Host.Host;
        var loopback = host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
        return new CookieOptions
        {
            HttpOnly = true,
            Secure = bool.TryParse(configuration["PAPYR_COOKIE_SECURE"], out var secure) ? secure : context.Request.IsHttps || !loopback,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            Expires = expiresAt,
        };
    }

    private static bool ValidCredentials(string? username, string? password) =>
        !string.IsNullOrWhiteSpace(username) && username.Trim().Length is >= 3 and <= 64 && username.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-' or '@') && !string.IsNullOrEmpty(password) && password.Length >= 12;

    private static object Error(string code, string message) => new { error = new { code, message } };
}
