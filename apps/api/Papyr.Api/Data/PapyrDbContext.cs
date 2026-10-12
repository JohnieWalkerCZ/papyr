using Microsoft.EntityFrameworkCore;

namespace Papyr.Api.Data;

public sealed class PapyrDbContext(DbContextOptions<PapyrDbContext> options) : DbContext(options)
{
    public DbSet<OwnerRecord> Owners => Set<OwnerRecord>();
    public DbSet<SessionRecord> Sessions => Set<SessionRecord>();
    public DbSet<EntityRecord> Entities => Set<EntityRecord>();
    public DbSet<ReceiptRecord> Receipts => Set<ReceiptRecord>();
    public DbSet<ChangeRecord> Changes => Set<ChangeRecord>();
    public DbSet<BootstrapSnapshotRecord> BootstrapSnapshots => Set<BootstrapSnapshotRecord>();
    public DbSet<BootstrapCursorRecord> BootstrapCursors => Set<BootstrapCursorRecord>();
    public DbSet<AttachmentRecord> Attachments => Set<AttachmentRecord>();
    public DbSet<AttachmentReferenceRecord> AttachmentReferences => Set<AttachmentReferenceRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OwnerRecord>().HasKey(owner => owner.Id);
        modelBuilder.Entity<OwnerRecord>().Property(owner => owner.InstanceKey).HasMaxLength(16);
        modelBuilder.Entity<OwnerRecord>().Property(owner => owner.Username).HasMaxLength(64);
        modelBuilder.Entity<OwnerRecord>().HasIndex(owner => owner.Username).IsUnique();
        modelBuilder.Entity<OwnerRecord>().HasIndex(owner => owner.InstanceKey).IsUnique();
        modelBuilder.Entity<SessionRecord>().HasKey(session => session.TokenHash);
        modelBuilder.Entity<SessionRecord>().Property(session => session.TokenHash).HasMaxLength(64);
        modelBuilder.Entity<SessionRecord>().HasIndex(session => new { session.OwnerId, session.ExpiresAt });
        modelBuilder.Entity<SessionRecord>().HasOne<OwnerRecord>().WithMany().HasForeignKey(session => session.OwnerId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<EntityRecord>().HasKey(entity => entity.Id);
        modelBuilder.Entity<EntityRecord>().Property(entity => entity.Kind).HasMaxLength(16);
        modelBuilder.Entity<EntityRecord>().Property(entity => entity.Title).HasMaxLength(300);
        modelBuilder.Entity<EntityRecord>().Property(entity => entity.NoteType).HasMaxLength(16);
        modelBuilder.Entity<EntityRecord>().Property(entity => entity.Revision).IsConcurrencyToken();
        modelBuilder.Entity<EntityRecord>().HasIndex(entity => new { entity.OwnerId, entity.Kind, entity.ParentId });
        modelBuilder.Entity<EntityRecord>().HasIndex(entity => new { entity.OwnerId, entity.UpdatedAt });
        modelBuilder.Entity<ReceiptRecord>().HasKey(receipt => new { receipt.OwnerId, receipt.OperationId });
        modelBuilder.Entity<ChangeRecord>().HasKey(change => new { change.OwnerId, change.Sequence });
        modelBuilder.Entity<ChangeRecord>().HasIndex(change => new { change.OwnerId, change.EntityId });
        modelBuilder.Entity<BootstrapSnapshotRecord>().HasKey(snapshot => snapshot.Id);
        modelBuilder.Entity<BootstrapSnapshotRecord>().HasIndex(snapshot => new { snapshot.OwnerId, snapshot.ExpiresAt });
        modelBuilder.Entity<BootstrapCursorRecord>().HasKey(cursor => cursor.TokenHash);
        modelBuilder.Entity<BootstrapCursorRecord>().Property(cursor => cursor.TokenHash).HasMaxLength(64);
        modelBuilder.Entity<BootstrapCursorRecord>().HasOne<BootstrapSnapshotRecord>().WithMany().HasForeignKey(cursor => cursor.SnapshotId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<AttachmentRecord>().HasKey(asset => asset.Id);
        modelBuilder.Entity<AttachmentRecord>().Property(asset => asset.Sha256).HasMaxLength(64);
        modelBuilder.Entity<AttachmentRecord>().Property(asset => asset.MimeType).HasMaxLength(100);
        modelBuilder.Entity<AttachmentRecord>().Property(asset => asset.StorageKey).HasMaxLength(100);
        modelBuilder.Entity<AttachmentRecord>().HasOne<OwnerRecord>().WithMany().HasForeignKey(asset => asset.OwnerId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<AttachmentRecord>().HasIndex(asset => new { asset.OwnerId, asset.CreatedAt });
        modelBuilder.Entity<AttachmentReferenceRecord>().HasKey(reference => new { reference.OwnerId, reference.EntityId, reference.AttachmentId });
        modelBuilder.Entity<AttachmentReferenceRecord>().HasOne<EntityRecord>().WithMany().HasForeignKey(reference => reference.EntityId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<AttachmentReferenceRecord>().HasOne<AttachmentRecord>().WithMany().HasForeignKey(reference => reference.AttachmentId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<AttachmentReferenceRecord>().HasIndex(reference => new { reference.OwnerId, reference.AttachmentId });
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            var tableName = entity.ClrType.Name[..^"Record".Length];
            entity.SetTableName(tableName == "Entity" ? "entities" : $"{ToSnakeCase(tableName)}s");
            foreach (var property in entity.GetProperties()) property.SetColumnName(ToSnakeCase(property.Name));
        }
    }

    private static string ToSnakeCase(string name) => string.Concat(name.Select((character, index) =>
        index > 0 && char.IsUpper(character) ? $"_{char.ToLowerInvariant(character)}" : char.ToLowerInvariant(character).ToString()));
}
