namespace Papyr.Api.Security;

public sealed class SessionConnectionRegistry
{
    // shortcut: revocation is process-local; use shared connection tracking before running multiple API replicas.
    private readonly object gate = new();
    private readonly Dictionary<string, Dictionary<string, Action>> connections = new(StringComparer.Ordinal);
    private readonly Dictionary<string, DateTimeOffset> revoked = new(StringComparer.Ordinal);

    public bool Register(string sessionHash, string connectionId, DateTimeOffset expiresAt, Action abort)
    {
        lock (gate)
        {
            PurgeExpiredRevocations(DateTimeOffset.UtcNow);
            if (expiresAt <= DateTimeOffset.UtcNow || revoked.ContainsKey(sessionHash)) return false;
            if (!connections.TryGetValue(sessionHash, out var sessionConnections))
                connections[sessionHash] = sessionConnections = new Dictionary<string, Action>(StringComparer.Ordinal);
            sessionConnections[connectionId] = abort;
            return true;
        }
    }

    public void Unregister(string sessionHash, string connectionId)
    {
        lock (gate)
        {
            if (!connections.TryGetValue(sessionHash, out var sessionConnections)) return;
            sessionConnections.Remove(connectionId);
            if (sessionConnections.Count == 0) connections.Remove(sessionHash);
        }
    }

    public void AbortConnection(string sessionHash, string connectionId)
    {
        Action? abort = null;
        lock (gate)
        {
            if (connections.TryGetValue(sessionHash, out var sessionConnections))
                sessionConnections.TryGetValue(connectionId, out abort);
        }
        abort?.Invoke();
    }

    public void Revoke(string sessionHash, DateTimeOffset expiresAt)
    {
        Action[] abort;
        lock (gate)
        {
            PurgeExpiredRevocations(DateTimeOffset.UtcNow);
            if (expiresAt > DateTimeOffset.UtcNow) revoked[sessionHash] = expiresAt;
            abort = connections.Remove(sessionHash, out var sessionConnections) ? sessionConnections.Values.ToArray() : [];
        }
        foreach (var disconnect in abort) disconnect();
    }

    private void PurgeExpiredRevocations(DateTimeOffset now)
    {
        foreach (var sessionHash in revoked.Where(item => item.Value <= now).Select(item => item.Key).ToArray())
            revoked.Remove(sessionHash);
    }
}
