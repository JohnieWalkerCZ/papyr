namespace Papyr.Api.Data;

public sealed class OwnerRecord
{
    public Guid Id { get; set; }
    public string InstanceKey { get; set; } = "primary";
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
    public long LatestSequence { get; set; }
    public long MinRetainedSequence { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class SessionRecord
{
    public required string TokenHash { get; set; }
    public Guid OwnerId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class EntityRecord
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public required string Kind { get; set; }
    public Guid? ParentId { get; set; }
    public required string Title { get; set; }
    public string? NoteType { get; set; }
    public string? Content { get; set; }
    public int? ContentSchemaVersion { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed class ReceiptRecord
{
    public Guid OwnerId { get; set; }
    public Guid OperationId { get; set; }
    public Guid EntityId { get; set; }
    public required string Status { get; set; }
    public long? Revision { get; set; }
    public long? Sequence { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ChangeRecord
{
    public Guid OwnerId { get; set; }
    public long Sequence { get; set; }
    public Guid OperationId { get; set; }
    public required string EntityType { get; set; }
    public Guid EntityId { get; set; }
    public required string Action { get; set; }
    public long Revision { get; set; }
    public required string EntityJson { get; set; }
    public DateTimeOffset CommittedAt { get; set; }
}

public sealed class BootstrapSnapshotRecord
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public long Sequence { get; set; }
    public required string EntitiesJson { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
}

public sealed class BootstrapCursorRecord
{
    public required string TokenHash { get; set; }
    public Guid OwnerId { get; set; }
    public Guid SnapshotId { get; set; }
    public int Offset { get; set; }
}

public sealed class AttachmentRecord
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public required string Sha256 { get; set; }
    public required string MimeType { get; set; }
    public long ByteLength { get; set; }
    public required string StorageKey { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletionCandidateAt { get; set; }
}

public sealed class AttachmentReferenceRecord
{
    public Guid OwnerId { get; set; }
    public Guid EntityId { get; set; }
    public Guid AttachmentId { get; set; }
}
