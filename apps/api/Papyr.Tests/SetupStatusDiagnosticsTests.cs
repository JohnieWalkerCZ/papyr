using Npgsql;
using Papyr.Api.Security;

namespace Papyr.Tests;

public sealed class SetupStatusDiagnosticsTests
{
    [Theory]
    [InlineData("42P01", "DATABASE_SCHEMA_ERROR")]
    [InlineData("42703", "DATABASE_SCHEMA_ERROR")]
    [InlineData("28P01", "DATABASE_AUTH_FAILED")]
    [InlineData("3D000", "DATABASE_NOT_FOUND")]
    public void Maps_postgres_errors_to_safe_diagnostic_codes(string sqlState, string expectedCode)
    {
        var error = new PostgresException("sensitive database detail", "ERROR", "ERROR", sqlState);

        var result = SetupStatusDiagnostics.Describe(error);

        Assert.Equal(expectedCode, result.Code);
        Assert.DoesNotContain("sensitive database detail", result.Message);
    }

    [Fact]
    public void Hides_unclassified_exception_details()
    {
        var result = SetupStatusDiagnostics.Describe(new InvalidOperationException("sensitive exception detail"));

        Assert.Equal("SETUP_STATUS_FAILED", result.Code);
        Assert.DoesNotContain("sensitive exception detail", result.Message);
    }
}
