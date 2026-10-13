using Npgsql;

namespace Papyr.Api.Security;

public sealed record SetupStatusDiagnostic(string Code, string Message);

public static class SetupStatusDiagnostics
{
    public static SetupStatusDiagnostic Describe(Exception error)
    {
        if (Find<AdministratorRecoveryException>(error) is { } recovery)
            return new("ADMIN_RECOVERY_FAILED", recovery.Message);
        var postgres = Find<PostgresException>(error);
        return postgres?.SqlState switch
        {
            "42P01" or "42703" => new("DATABASE_SCHEMA_ERROR", "Papyr's database schema is incomplete. Check that API migrations completed."),
            "28P01" => new("DATABASE_AUTH_FAILED", "PostgreSQL rejected the API credentials. Check that the API and database use the same password."),
            "3D000" => new("DATABASE_NOT_FOUND", "The Papyr database was not found. Check the database name in the API connection settings."),
            _ when Find<NpgsqlException>(error) is not null => new("DATABASE_UNAVAILABLE", "The API could not connect to PostgreSQL. Check that the database container is healthy and reachable."),
            _ => new("SETUP_STATUS_FAILED", "The API could not check setup status. Check the API container and database configuration."),
        };
    }

    private static TException? Find<TException>(Exception error) where TException : Exception
    {
        for (Exception? current = error; current is not null; current = current.InnerException)
            if (current is TException match) return match;
        return null;
    }
}
