using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Papyr.Api.Security;

namespace Papyr.Api.Sync;

[Authorize]
public sealed class ChangeHub(SessionConnectionRegistry connections) : Hub
{
    public override async Task OnConnectedAsync()
    {
        var ownerId = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        var sessionHash = Context.User?.FindFirstValue(SessionAuthenticationHandler.SessionHashClaim);
        var expiresClaim = Context.User?.FindFirstValue(SessionAuthenticationHandler.SessionExpiresAtClaim);
        if (!Guid.TryParse(ownerId, out var parsedOwnerId) || string.IsNullOrEmpty(sessionHash) ||
            !long.TryParse(expiresClaim, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var expiry))
        {
            Context.Abort();
            return;
        }
        var expiresAt = DateTimeOffset.FromUnixTimeSeconds(expiry);
        var connectionId = Context.ConnectionId;
        var disconnected = Context.ConnectionAborted;
        if (!connections.Register(sessionHash, connectionId, expiresAt, Context.Abort))
        {
            Context.Abort();
            return;
        }
        await Groups.AddToGroupAsync(connectionId, OwnerGroup(parsedOwnerId), disconnected);
        _ = AbortAtExpiryAsync(sessionHash, connectionId, expiresAt, disconnected);
        await base.OnConnectedAsync();
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        var sessionHash = Context.User?.FindFirstValue(SessionAuthenticationHandler.SessionHashClaim);
        if (!string.IsNullOrEmpty(sessionHash)) connections.Unregister(sessionHash, Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }

    private async Task AbortAtExpiryAsync(string sessionHash, string connectionId, DateTimeOffset expiresAt, CancellationToken disconnected)
    {
        try
        {
            var delay = expiresAt - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero) await Task.Delay(delay, disconnected);
            if (!disconnected.IsCancellationRequested) connections.AbortConnection(sessionHash, connectionId);
        }
        catch (OperationCanceledException) when (disconnected.IsCancellationRequested) { }
    }

    public static string OwnerGroup(Guid ownerId) => $"owner:{ownerId:N}";
}
