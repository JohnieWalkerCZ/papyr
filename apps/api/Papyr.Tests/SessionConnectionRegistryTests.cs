using Papyr.Api.Security;

namespace Papyr.Tests;

public sealed class SessionConnectionRegistryTests
{
    [Fact]
    public void Revoking_a_session_aborts_all_connections_and_rejects_late_registration()
    {
        var registry = new SessionConnectionRegistry();
        var expiry = DateTimeOffset.UtcNow.AddMinutes(1);
        var aborted = 0;

        Assert.True(registry.Register("session", "one", expiry, () => aborted++));
        Assert.True(registry.Register("session", "two", expiry, () => aborted++));
        registry.Revoke("session", expiry);

        Assert.Equal(2, aborted);
        Assert.False(registry.Register("session", "late", expiry, () => aborted++));
        Assert.Equal(2, aborted);
    }

    [Fact]
    public void Expired_sessions_cannot_register_a_connection()
    {
        var registry = new SessionConnectionRegistry();

        Assert.False(registry.Register("expired", "connection", DateTimeOffset.UtcNow.AddSeconds(-1), () => { }));
    }
}
