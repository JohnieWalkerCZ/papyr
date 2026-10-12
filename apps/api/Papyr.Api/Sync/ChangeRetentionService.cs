using Microsoft.EntityFrameworkCore;
using Papyr.Api.Data;

namespace Papyr.Api.Sync;

public sealed class ChangeRetentionService(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<ChangeRetentionService> logger) : BackgroundService
{
    private readonly int retentionDays = Math.Clamp(
        int.TryParse(configuration["PAPYR_CHANGE_RETENTION_DAYS"], out var configuredDays) ? configuredDays : 90,
        1,
        3650);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<PapyrDbContext>();
                await PurgeExpiredAsync(db, DateTimeOffset.UtcNow, TimeSpan.FromDays(retentionDays), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception error)
            {
                logger.LogError(error, "Papyr change-log retention sweep failed.");
            }
            try
            {
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    public static async Task PurgeExpiredAsync(PapyrDbContext db, DateTimeOffset now, TimeSpan retention, CancellationToken cancellationToken = default)
    {
        var cutoff = now - retention;
        var owners = await db.Owners.AsNoTracking().Select(owner => owner.Id).ToListAsync(cancellationToken);
        foreach (var ownerId in owners)
        {
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var owner = await db.Owners.AsNoTracking().SingleAsync(item => item.Id == ownerId, cancellationToken);
            var firstRetained = await db.Changes.Where(change => change.OwnerId == ownerId && change.CommittedAt >= cutoff)
                .Select(change => (long?)change.Sequence).MinAsync(cancellationToken);
            var pruneThrough = firstRetained.HasValue ? firstRetained.Value - 1 : owner.LatestSequence;
            if (pruneThrough > owner.MinRetainedSequence)
            {
                await db.Changes.Where(change => change.OwnerId == ownerId && change.Sequence <= pruneThrough)
                    .ExecuteDeleteAsync(cancellationToken);
                await db.Owners.Where(item => item.Id == ownerId)
                    .ExecuteUpdateAsync(update => update.SetProperty(item => item.MinRetainedSequence, pruneThrough), cancellationToken);
            }
            await db.BootstrapSnapshots.Where(snapshot => snapshot.OwnerId == ownerId && snapshot.ExpiresAt <= now)
                .ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
    }
}
