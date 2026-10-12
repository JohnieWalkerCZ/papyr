using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Papyr.Api.Data;

namespace Papyr.Api.Security;

public sealed class SessionAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PapyrDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "PapyrSession";
    public const string CookieName = "papyr_session";
    public const string SessionHashClaim = "papyr:session_hash";
    public const string SessionExpiresAtClaim = "papyr:session_expires_at";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(CookieName, out var rawToken) || string.IsNullOrWhiteSpace(rawToken))
            return AuthenticateResult.NoResult();

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
        var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(
            item => item.TokenHash == hash && item.ExpiresAt > DateTimeOffset.UtcNow,
            Context.RequestAborted);
        if (session is null) return AuthenticateResult.Fail("Session is invalid or expired.");
        var username = await db.Owners.AsNoTracking()
            .Where(owner => owner.Id == session.OwnerId)
            .Select(owner => owner.Username)
            .SingleOrDefaultAsync(Context.RequestAborted);
        if (username is null) return AuthenticateResult.Fail("Session owner no longer exists.");

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, session.OwnerId.ToString()),
            new Claim(ClaimTypes.Name, username),
            new Claim(SessionHashClaim, session.TokenHash),
            new Claim(SessionExpiresAtClaim, session.ExpiresAt.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture)),
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }
}

public static class SessionTokens
{
    public static string NewToken() => Microsoft.AspNetCore.WebUtilities.WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static bool SecretMatches(string? expected, string? supplied)
    {
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(supplied)) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(supplied));
    }
}
