using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Papyr.Api.Data;

namespace Papyr.Api.Security;

public sealed class AdministratorRecoveryException(string message) : Exception(message);

public static class AdministratorRecovery
{
    public static async Task ApplyAsync(PapyrDbContext db, IPasswordHasher<OwnerRecord> hasher, IConfiguration configuration)
    {
        var username = configuration["PAPYR_ADMIN_USERNAME"];
        var password = configuration["PAPYR_ADMIN_PASSWORD"];
        if (!AuthEndpoints.ValidCredentials(username, password))
            throw new AdministratorRecoveryException("Set PAPYR_ADMIN_USERNAME to a valid username and PAPYR_ADMIN_PASSWORD to a non-empty password before enabling recovery.");

        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(71020261013)");
        var administrator = await db.Owners.SingleOrDefaultAsync(owner => owner.IsAdmin);
        var administratorId = administrator?.Id ?? Guid.Empty;
        var normalizedUsername = username!.Trim().ToLowerInvariant();
        if (await db.Owners.AnyAsync(owner => owner.Username == normalizedUsername && owner.Id != administratorId))
            throw new AdministratorRecoveryException("The recovery username belongs to another account. Choose a different PAPYR_ADMIN_USERNAME.");

        if (administrator is null)
        {
            administrator = new OwnerRecord
            {
                Id = Guid.NewGuid(),
                InstanceKey = Guid.NewGuid().ToString("N")[..16],
                Username = normalizedUsername,
                PasswordHash = string.Empty,
                IsAdmin = true,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Owners.Add(administrator);
        }
        administrator.Username = normalizedUsername;
        administrator.PasswordHash = hasher.HashPassword(administrator, password!);
        await db.Sessions.Where(session => session.OwnerId == administrator.Id).ExecuteDeleteAsync();
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
