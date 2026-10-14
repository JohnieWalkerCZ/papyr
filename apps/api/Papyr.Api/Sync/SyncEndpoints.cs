using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Papyr.Api.Data;
using Papyr.Api.Security;

namespace Papyr.Api.Sync;

public sealed record MutationRequest(List<MutationInput?>? Operations);
public sealed record MutationInput(Guid OperationId, string EntityType, Guid EntityId, string Action, string? BaseRevision, JsonElement Payload);

public static class SyncEndpoints
{
    private const int DefaultPageSize = 200;
    private const int MaxPageSize = 500;
    private const int MaxBatchSize = 100;
    private const int MaxEntityCount = 25_000;
    private const int MaxFolderDepth = 64;
    private const int MaxContentBytes = 4_000_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static void MapSyncEndpoints(this WebApplication app)
    {
        var sync = app.MapGroup("/api/v1").RequireAuthorization();
        sync.MapGet("/bootstrap", BootstrapAsync).RequireRateLimiting("bootstrap");
        sync.MapGet("/changes", ChangesAsync);
        sync.MapGet("/notes/{id:guid}", GetNoteAsync);
        sync.MapGet("/folders/{id:guid}", GetFolderAsync);
        sync.MapPost("/mutations", MutateAsync);
    }

    private static async Task<IResult> BootstrapAsync(
        HttpContext context,
        PapyrDbContext db,
        int? limit,
        string? cursorToken,
        CancellationToken cancellationToken)
    {
        var ownerId = OwnerId(context);
        var pageSize = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        BootstrapSnapshotRecord snapshot;
        var offset = 0;
        var now = DateTimeOffset.UtcNow;
        if (string.IsNullOrWhiteSpace(cursorToken))
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
            await db.BootstrapSnapshots.Where(item => item.ExpiresAt <= now).ExecuteDeleteAsync(cancellationToken);
            var sequence = await db.Owners.Where(item => item.Id == ownerId).Select(item => item.LatestSequence).SingleAsync(cancellationToken);
            var existingSnapshot = await db.BootstrapSnapshots.FirstOrDefaultAsync(item => item.OwnerId == ownerId && item.Sequence == sequence && item.ExpiresAt > now, cancellationToken);
            if (existingSnapshot is null)
            {
                var activeSnapshots = await db.BootstrapSnapshots.CountAsync(item => item.OwnerId == ownerId && item.ExpiresAt > now, cancellationToken);
                if (activeSnapshots >= 5) return Results.Json(Error("BOOTSTRAP_LIMIT", "Too many active bootstrap sessions. Retry after the current sessions expire."), statusCode: StatusCodes.Status429TooManyRequests);
                var entityQuery = db.Entities.AsNoTracking().Where(item => item.OwnerId == ownerId);
                if (await entityQuery.CountAsync(cancellationToken) > MaxEntityCount)
                    return Results.Json(Error("SNAPSHOT_TOO_LARGE", "The library is too large for bootstrap."), statusCode: StatusCodes.Status413PayloadTooLarge);
                var rows = await entityQuery.OrderBy(item => item.Id).ToListAsync(cancellationToken);
                snapshot = new BootstrapSnapshotRecord
                {
                    Id = Guid.NewGuid(),
                    OwnerId = ownerId,
                    Sequence = sequence,
                    EntitiesJson = JsonSerializer.Serialize(rows.Select(ToWire).ToList(), JsonOptions),
                    ExpiresAt = now.AddMinutes(30),
                };
                db.BootstrapSnapshots.Add(snapshot);
                await db.SaveChangesAsync(cancellationToken);
            }
            else snapshot = existingSnapshot;
            await transaction.CommitAsync(cancellationToken);
        }
        else
        {
            var cursor = await db.BootstrapCursors.AsNoTracking().FirstOrDefaultAsync(item =>
                item.TokenHash == SessionTokens.Hash(cursorToken) && item.OwnerId == ownerId, cancellationToken);
            if (cursor is null) return Results.Json(Error("CURSOR_EXPIRED", "Bootstrap cursor has expired."), statusCode: StatusCodes.Status410Gone);
            snapshot = await db.BootstrapSnapshots.AsNoTracking().SingleOrDefaultAsync(item =>
                item.Id == cursor.SnapshotId && item.OwnerId == ownerId && item.ExpiresAt > now, cancellationToken)
                ?? null!;
            if (snapshot is null) return Results.Json(Error("CURSOR_EXPIRED", "Bootstrap cursor has expired."), statusCode: StatusCodes.Status410Gone);
            offset = cursor.Offset;
        }

        var entities = JsonSerializer.Deserialize<List<JsonElement>>(snapshot.EntitiesJson, JsonOptions) ?? [];
        var page = entities.Skip(offset).Take(pageSize).ToArray();
        var nextOffset = offset + page.Length;
        string? nextToken = null;
        if (nextOffset < entities.Count)
        {
            nextToken = SessionTokens.NewToken();
            db.BootstrapCursors.Add(new BootstrapCursorRecord
            {
                TokenHash = SessionTokens.Hash(nextToken),
                OwnerId = ownerId,
                SnapshotId = snapshot.Id,
                Offset = nextOffset,
            });
            await db.SaveChangesAsync(cancellationToken);
        }
        return Results.Ok(new
        {
            folders = page.Where(entity => entity.GetProperty("kind").GetString() == "folder"),
            notes = page.Where(entity => entity.GetProperty("kind").GetString() == "note"),
            nextCursorToken = nextToken,
            cursor = nextToken is null ? Cursor(snapshot.Sequence) : null,
        });
    }

    private static async Task<IResult> ChangesAsync(HttpContext context, PapyrDbContext db, string? cursor, int? limit, CancellationToken cancellationToken)
    {
        var ownerId = OwnerId(context);
        if (!TryParseCursor(cursor, out var sequence)) return Results.BadRequest(Error("INVALID_CURSOR", "Cursor is invalid."));
        var cursorState = await db.Owners.Where(owner => owner.Id == ownerId)
            .Select(owner => new { owner.LatestSequence, owner.MinRetainedSequence }).SingleAsync(cancellationToken);
        if (sequence < cursorState.MinRetainedSequence)
            return Results.Json(Error("CURSOR_EXPIRED", "Change cursor has expired."), statusCode: StatusCodes.Status410Gone);
        if (sequence > cursorState.LatestSequence) return Results.BadRequest(Error("INVALID_CURSOR", "Cursor is ahead of the server."));
        var pageSize = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        var page = await db.Changes.AsNoTracking().Where(change => change.OwnerId == ownerId && change.Sequence > sequence)
            .OrderBy(change => change.Sequence).Take(pageSize).ToListAsync(cancellationToken);
        var next = page.Count == 0 ? sequence : page[^1].Sequence;
        return Results.Ok(new { changes = page.Select(ToWire), nextCursor = Cursor(next), hasMore = next < cursorState.LatestSequence });
    }

    private static async Task<IResult> GetNoteAsync(Guid id, HttpContext context, PapyrDbContext db, CancellationToken cancellationToken)
    {
        var entity = await db.Entities.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == OwnerId(context) && item.Id == id && item.Kind == "note", cancellationToken);
        return entity is null ? Results.NotFound() : Results.Ok(ToWire(entity));
    }

    private static async Task<IResult> GetFolderAsync(Guid id, HttpContext context, PapyrDbContext db, CancellationToken cancellationToken)
    {
        var entity = await db.Entities.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == OwnerId(context) && item.Id == id && item.Kind == "folder", cancellationToken);
        return entity is null ? Results.NotFound() : Results.Ok(ToWire(entity));
    }

    private static async Task<IResult> MutateAsync(MutationRequest? request, HttpContext context, IAntiforgery antiforgery,
        PapyrDbContext db, IHubContext<ChangeHub> hub, ILogger<ChangeHub> logger, CancellationToken cancellationToken)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.BadRequest(Error("CSRF_INVALID", "Request verification failed."));
        if (request?.Operations is null || request.Operations.Count is < 1 or > MaxBatchSize || request.Operations.Any(item => item is null))
            return Results.UnprocessableEntity(Error("INVALID_BATCH", $"Submit between 1 and {MaxBatchSize} valid operations."));
        var ownerId = OwnerId(context);
        var results = new List<object>(request.Operations.Count);
        foreach (var operation in request.Operations)
            results.Add(await ProcessOperation(db, ownerId, operation!, hub, logger, cancellationToken));
        return Results.Ok(new { results });
    }

    private static async Task<object> ProcessOperation(PapyrDbContext db, Guid ownerId, MutationInput operation,
        IHubContext<ChangeHub> hub, ILogger<ChangeHub> logger, CancellationToken cancellationToken)
    {
        if (operation.OperationId == Guid.Empty || operation.EntityId == Guid.Empty)
            return Result(operation, "rejected", null, null, "INVALID_ID", "Operation and entity IDs must be UUIDs.");
        var previous = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.OperationId == operation.OperationId, cancellationToken);
        if (previous is not null) return ReceiptResult(previous, duplicate: true);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            if (operation.EntityType is not ("folder" or "note") || operation.Action is not ("create" or "update" or "move" or "rename" or "delete" or "restore" or "purge"))
                return await SaveFailure(db, transaction, ownerId, operation, "rejected", "INVALID_OPERATION", "Entity type or action is invalid.", null, cancellationToken);
            var current = await db.Entities.SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.Id == operation.EntityId, cancellationToken);
            var foreignCollision = current is null && await db.Entities.AnyAsync(item => item.Id == operation.EntityId, cancellationToken);
            if (foreignCollision) return await SaveFailure(db, transaction, ownerId, operation, "rejected", "ID_IN_USE", "Entity ID is unavailable.", null, cancellationToken);
            if (current is null && operation.Action == "purge")
            {
                if (!long.TryParse(operation.BaseRevision, NumberStyles.None, CultureInfo.InvariantCulture, out _))
                    return await SaveFailure(db, transaction, ownerId, operation, "rejected", "INVALID_BASE_REVISION", "A numeric base revision is required.", null, cancellationToken);
                var noOpReceipt = new ReceiptRecord
                {
                    OwnerId = ownerId,
                    OperationId = operation.OperationId,
                    EntityId = operation.EntityId,
                    Status = "accepted",
                    Revision = 0,
                    CreatedAt = DateTimeOffset.UtcNow,
                };
                db.Receipts.Add(noOpReceipt);
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return ReceiptResult(noOpReceipt, duplicate: false);
            }

            List<EntityRecord>? changedForRestore = null;
            if (operation.Action == "create")
            {
                if (current is not null) return await SaveFailure(db, transaction, ownerId, operation, "conflict", "ENTITY_EXISTS", "Entity already exists.", current, cancellationToken);
                if (operation.BaseRevision is not null) return await SaveFailure(db, transaction, ownerId, operation, "rejected", "INVALID_BASE_REVISION", "Create operations require a null base revision.", null, cancellationToken);
                var created = await CreateEntity(db, ownerId, operation, cancellationToken);
                if (created.Error is not null) return await SaveFailure(db, transaction, ownerId, operation, "rejected", created.Error.Value.Code, created.Error.Value.Message, null, cancellationToken);
                current = created.Entity!;
                db.Entities.Add(current);
            }
            else
            {
                if (current is null || current.Kind != operation.EntityType) return await SaveFailure(db, transaction, ownerId, operation, "rejected", "NOT_FOUND", "Entity was not found.", null, cancellationToken);
                if (!long.TryParse(operation.BaseRevision, NumberStyles.None, CultureInfo.InvariantCulture, out var baseRevision))
                    return await SaveFailure(db, transaction, ownerId, operation, "rejected", "INVALID_BASE_REVISION", "A numeric base revision is required.", current, cancellationToken);
                if (baseRevision != current.Revision) return await SaveFailure(db, transaction, ownerId, operation, "conflict", "REVISION_CONFLICT", "Remote entity changed.", current, cancellationToken);
                var restoreTimestamp = operation.Action == "restore" ? current.DeletedAt : null;
                var validation = await ApplyMutation(db, ownerId, current, operation, cancellationToken);
                if (validation is not null) return await SaveFailure(db, transaction, ownerId, operation, "rejected", validation.Value.Code, validation.Value.Message, current, cancellationToken);
                if (current.Kind == "folder" && operation.Action == "restore" && restoreTimestamp is not null)
                    changedForRestore = await RestoreFolderTree(db, ownerId, current, restoreTimestamp.Value, cancellationToken);
            }

            var changed = current.Kind == "folder" && operation.Action == "delete"
                ? await DeleteFolderTree(db, ownerId, current, cancellationToken)
                : changedForRestore ?? new List<EntityRecord> { current };
            if (current.Kind == "note" && (operation.Action == "create" || operation.Action == "update" && operation.Payload.TryGetProperty("content", out _)))
            {
                var referenceError = await SetAttachmentReferences(db, ownerId, current, cancellationToken);
                if (referenceError is not null)
                    return await SaveFailure(db, transaction, ownerId, operation, "rejected", referenceError.Value.Code, referenceError.Value.Message, current, cancellationToken);
            }
            if (!changed.Contains(current)) changed.Insert(0, current);
            long operationSequence = 0;
            foreach (var entity in changed)
            {
                if (entity.Id == current.Id) entity.Revision = Math.Max(1, entity.Revision + (operation.Action == "create" ? 0 : 1));
                var seq = await AddChange(db, ownerId, operation.OperationId, entity, operation.Action, cancellationToken);
                if (entity.Id == current.Id) operationSequence = seq;
            }
            if (operation.Action == "purge") db.Entities.Remove(current);
            var receipt = new ReceiptRecord
            {
                OwnerId = ownerId,
                OperationId = operation.OperationId,
                EntityId = operation.EntityId,
                Status = "accepted",
                Revision = current.Revision,
                Sequence = operationSequence,
                CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Receipts.Add(receipt);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            try
            {
                await hub.Clients.Group(ChangeHub.OwnerGroup(ownerId)).SendAsync("invalidate", cancellationToken);
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "Could not publish a sync invalidation hint.");
            }
            return ReceiptResult(receipt, duplicate: false);
        }
        catch (DbUpdateConcurrencyException)
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            var remote = await db.Entities.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.Id == operation.EntityId, cancellationToken);
            return await StoreConflict(db, ownerId, operation, remote, cancellationToken);
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            await transaction.RollbackAsync(cancellationToken);
            db.ChangeTracker.Clear();
            var saved = await db.Receipts.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.OperationId == operation.OperationId, cancellationToken);
            if (saved is not null) return ReceiptResult(saved, duplicate: true);
            throw;
        }
    }

    private static async Task<(EntityRecord? Entity, (string Code, string Message)? Error)> CreateEntity(PapyrDbContext db, Guid ownerId, MutationInput operation, CancellationToken cancellationToken)
    {
        if (operation.Payload.ValueKind != JsonValueKind.Object) return (null, ("INVALID_PAYLOAD", "Entity payload must be an object."));
        var payload = operation.Payload;
        var title = String(payload, "title");
        if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 300) return (null, ("INVALID_TITLE", "Title must contain 1–300 characters."));
        var parentKey = operation.EntityType == "folder" ? "parentId" : "folderId";
        if (InvalidGuidField(payload, parentKey)) return (null, ("INVALID_PARENT", "Parent folder ID is invalid."));
        var parentId = GuidValue(payload, parentKey);
        if (parentId is not null)
        {
            var parent = await db.Entities.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.Id == parentId && item.Kind == "folder" && item.DeletedAt == null, cancellationToken);
            if (parent is null) return (null, ("INVALID_PARENT", "Parent folder was not found."));
            if (await ParentDepthExceeds(db, ownerId, parentId.Value, operation.EntityType == "folder" ? 1 : 0, cancellationToken))
                return (null, ("TREE_TOO_DEEP", $"Folder depth cannot exceed {MaxFolderDepth}."));
        }
        var now = DateTimeOffset.UtcNow;
        if (operation.EntityType == "folder") return (new EntityRecord
        {
            Id = operation.EntityId,
            OwnerId = ownerId,
            Kind = "folder",
            ParentId = parentId,
            Title = title.Trim(),
            Revision = 0,
            CreatedAt = now,
            UpdatedAt = now,
        }, null);
        var noteType = String(payload, "type");
        if (noteType is not ("markdown" or "typst" or "whiteboard")) return (null, ("INVALID_NOTE_TYPE", "Note type is invalid."));
        if (!TryInteger(payload, "contentSchemaVersion", out var contentSchemaVersion))
            return (null, ("INVALID_CONTENT_SCHEMA_VERSION", "Content schema version must be a positive integer or null."));
        if (noteType == "whiteboard" && contentSchemaVersion != 1)
            return (null, ("UNSUPPORTED_CONTENT_SCHEMA_VERSION", "Whiteboard content schema version 1 is required."));
        var contentElement = payload.TryGetProperty("content", out var content) ? content : default;
        if (contentElement.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Null) &&
            (noteType == "whiteboard" ? !ValidWhiteboardSnapshot(contentElement) : contentElement.ValueKind != JsonValueKind.String))
            return (null, ("INVALID_CONTENT", "Note content has an invalid format."));
        var source = ContentValue(contentElement, noteType);
        if (Encoding.UTF8.GetByteCount(source ?? "") > MaxContentBytes) return (null, ("CONTENT_TOO_LARGE", "Note content exceeds the configured limit."));
        return (new EntityRecord
        {
            Id = operation.EntityId,
            OwnerId = ownerId,
            Kind = "note",
            ParentId = parentId,
            Title = title.Trim(),
            NoteType = noteType,
            Content = source,
            ContentSchemaVersion = contentSchemaVersion,
            Revision = 0,
            CreatedAt = now,
            UpdatedAt = now,
        }, null);
    }

    private static async Task<(string Code, string Message)?> ApplyMutation(PapyrDbContext db, Guid ownerId, EntityRecord entity, MutationInput operation, CancellationToken cancellationToken)
    {
        var payload = operation.Payload;
        if (payload.ValueKind != JsonValueKind.Object) return ("INVALID_PAYLOAD", "Operation payload must be an object.");
        switch (operation.Action)
        {
            case "update":
                if (payload.ValueKind != JsonValueKind.Object) return ("INVALID_PAYLOAD", "Update payload must be an object.");
                if (payload.TryGetProperty("title", out var titleValue))
                {
                    if (titleValue.ValueKind != JsonValueKind.String) return ("INVALID_TITLE", "Title must be a string containing 1–300 characters.");
                    var title = titleValue.GetString();
                    if (string.IsNullOrWhiteSpace(title) || title.Trim().Length > 300) return ("INVALID_TITLE", "Title must contain 1–300 characters.");
                    entity.Title = title.Trim();
                }
                if (payload.TryGetProperty("content", out var contentValue))
                {
                    if (entity.Kind != "note") return ("INVALID_UPDATE", "Folders do not have note content.");
                    if (entity.NoteType == "whiteboard" ? !ValidWhiteboardSnapshot(contentValue) : contentValue.ValueKind != JsonValueKind.String)
                        return ("INVALID_CONTENT", "Note content has an invalid format.");
                    var content = ContentValue(contentValue, entity.NoteType!);
                    if (Encoding.UTF8.GetByteCount(content ?? "") > MaxContentBytes) return ("CONTENT_TOO_LARGE", "Note content exceeds the configured limit.");
                    entity.Content = content;
                }
                break;
            case "rename":
                var newTitle = String(payload, "title");
                if (string.IsNullOrWhiteSpace(newTitle) || newTitle.Trim().Length > 300) return ("INVALID_TITLE", "Title must contain 1–300 characters.");
                entity.Title = newTitle.Trim();
                break;
            case "move":
                var parentKey = entity.Kind == "folder" ? "parentId" : "folderId";
                if (!payload.TryGetProperty(parentKey, out _) || InvalidGuidField(payload, parentKey)) return ("INVALID_PARENT", "Destination folder ID is invalid.");
                var parentId = GuidValue(payload, parentKey);
                if (parentId is not null)
                {
                    var parent = await db.Entities.AsNoTracking().SingleOrDefaultAsync(item => item.OwnerId == ownerId && item.Id == parentId && item.Kind == "folder" && item.DeletedAt == null, cancellationToken);
                    if (parent is null) return ("INVALID_PARENT", "Destination folder was not found.");
                }
                if (entity.Kind == "folder")
                {
                    var folders = await db.Entities.AsNoTracking().Where(item => item.OwnerId == ownerId && item.Kind == "folder" && item.DeletedAt == null).ToDictionaryAsync(item => item.Id, cancellationToken);
                    var cursor = parentId;
                    var seen = new HashSet<Guid>();
                    var parentDepth = 0;
                    while (cursor is not null)
                    {
                        if (cursor == entity.Id || !seen.Add(cursor.Value)) return ("INVALID_TREE", "A folder cannot be moved into itself or a descendant.");
                        parentDepth++;
                        cursor = folders.TryGetValue(cursor.Value, out var parent) ? parent.ParentId : null;
                    }
                    var subtreeHeight = FolderSubtreeHeight(folders, entity.Id);
                    if (parentDepth + subtreeHeight > MaxFolderDepth) return ("TREE_TOO_DEEP", $"Folder depth cannot exceed {MaxFolderDepth}.");
                }
                else if (parentId is not null && await ParentDepthExceeds(db, ownerId, parentId.Value, 0, cancellationToken)) return ("TREE_TOO_DEEP", $"Folder depth cannot exceed {MaxFolderDepth}.");
                entity.ParentId = parentId;
                break;
            case "delete":
                if (entity.DeletedAt is not null) return ("ALREADY_DELETED", "Entity is already in trash.");
                entity.DeletedAt = DateTimeOffset.UtcNow;
                break;
            case "restore":
                if (entity.DeletedAt is null) return ("NOT_DELETED", "Entity is not in trash.");
                entity.DeletedAt = null;
                if (entity.ParentId is not null && !await db.Entities.AsNoTracking().AnyAsync(item => item.OwnerId == ownerId && item.Id == entity.ParentId && item.Kind == "folder" && item.DeletedAt == null, cancellationToken)) entity.ParentId = null;
                break;
            case "purge":
                if (entity.DeletedAt is null) return ("NOT_DELETED", "Entity must be in trash before permanent deletion.");
                if (entity.Kind == "folder" && await db.Entities.AnyAsync(item => item.OwnerId == ownerId && item.ParentId == entity.Id, cancellationToken))
                    return ("FOLDER_NOT_EMPTY", "Purge child notes and folders before purging this folder.");
                break;
        }
        entity.UpdatedAt = DateTimeOffset.UtcNow;
        return null;
    }

    private static bool ValidWhiteboardSnapshot(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("store", out var store) || store.ValueKind != JsonValueKind.Object ||
            !value.TryGetProperty("schema", out var schema) || schema.ValueKind != JsonValueKind.Object ||
            !schema.TryGetProperty("schemaVersion", out var schemaVersion) || schemaVersion.ValueKind != JsonValueKind.Number || !schemaVersion.TryGetInt32(out var version) ||
            store.EnumerateObject().Count() > 10_000)
            return false;
        JsonElement recordVersions;
        if (version == 1)
        {
            if (!schema.TryGetProperty("storeVersion", out var storeVersion) || storeVersion.ValueKind != JsonValueKind.Number ||
                !schema.TryGetProperty("recordVersions", out recordVersions) || recordVersions.ValueKind != JsonValueKind.Object)
                return false;
        }
        else if (version == 2)
        {
            if (!schema.TryGetProperty("sequences", out recordVersions) || recordVersions.ValueKind != JsonValueKind.Object ||
                !recordVersions.EnumerateObject().All(sequence => sequence.Value.ValueKind == JsonValueKind.Number &&
                    sequence.Value.TryGetInt32(out var sequenceVersion) && sequenceVersion >= 0))
                return false;
        }
        else return false;
        return store.EnumerateObject().All(record => record.Value.ValueKind == JsonValueKind.Object &&
            record.Value.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String && id.GetString() == record.Name &&
            record.Value.TryGetProperty("typeName", out var typeName) && typeName.ValueKind == JsonValueKind.String &&
            recordVersions.TryGetProperty(version == 2 ? $"com.tldraw.{typeName.GetString()}" : typeName.GetString()!, out _));
    }

    private static async Task<List<EntityRecord>> DeleteFolderTree(PapyrDbContext db, Guid ownerId, EntityRecord root, CancellationToken cancellationToken)
    {
        var all = await db.Entities.Where(item => item.OwnerId == ownerId && item.DeletedAt == null).ToListAsync(cancellationToken);
        var ids = new HashSet<Guid> { root.Id };
        for (var changed = true; changed;)
        {
            changed = false;
            foreach (var child in all)
                if (child.ParentId is not null && ids.Contains(child.ParentId.Value) && ids.Add(child.Id)) changed = true;
        }
        var timestamp = root.DeletedAt ?? DateTimeOffset.UtcNow;
        var descendants = all.Where(item => ids.Contains(item.Id) && item.Id != root.Id).ToList();
        foreach (var entity in descendants) { entity.DeletedAt = timestamp; entity.UpdatedAt = timestamp; entity.Revision++; }
        return descendants;
    }

    private static async Task<List<EntityRecord>> RestoreFolderTree(PapyrDbContext db, Guid ownerId, EntityRecord root, DateTimeOffset deletionTimestamp, CancellationToken cancellationToken)
    {
        var all = await db.Entities.Where(item => item.OwnerId == ownerId && item.DeletedAt == deletionTimestamp).ToListAsync(cancellationToken);
        var ids = new HashSet<Guid> { root.Id };
        for (var changed = true; changed;)
        {
            changed = false;
            foreach (var child in all)
                if (child.ParentId is not null && ids.Contains(child.ParentId.Value) && ids.Add(child.Id)) changed = true;
        }
        var descendants = all.Where(item => ids.Contains(item.Id) && item.Id != root.Id).ToList();
        var now = DateTimeOffset.UtcNow;
        foreach (var entity in descendants) { entity.DeletedAt = null; entity.UpdatedAt = now; entity.Revision++; }
        return descendants;
    }

    private static async Task<bool> ParentDepthExceeds(PapyrDbContext db, Guid ownerId, Guid parentId, int addedDepth, CancellationToken cancellationToken)
    {
        var folders = await db.Entities.AsNoTracking().Where(item => item.OwnerId == ownerId && item.Kind == "folder" && item.DeletedAt == null)
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var cursor = parentId;
        var depth = addedDepth;
        var seen = new HashSet<Guid>();
        while (cursor != Guid.Empty)
        {
            if (!seen.Add(cursor) || !folders.TryGetValue(cursor, out var folder)) return true;
            depth++;
            if (depth > MaxFolderDepth) return true;
            cursor = folder.ParentId ?? Guid.Empty;
        }
        return false;
    }

    private static int FolderSubtreeHeight(Dictionary<Guid, EntityRecord> folders, Guid rootId)
    {
        var children = folders.Values.Where(folder => folder.ParentId is not null).GroupBy(folder => folder.ParentId!.Value)
            .ToDictionary(group => group.Key, group => group.Select(folder => folder.Id).ToArray());
        var height = 1;
        var level = new List<Guid> { rootId };
        var seen = new HashSet<Guid> { rootId };
        while (level.Count > 0)
        {
            var next = new List<Guid>();
            foreach (var id in level)
                if (children.TryGetValue(id, out var descendants))
                    foreach (var child in descendants)
                    {
                        if (!seen.Add(child)) return MaxFolderDepth + 1;
                        next.Add(child);
                    }
            if (next.Count == 0) break;
            height++;
            level = next;
        }
        return height;
    }

    private static async Task<long> AddChange(PapyrDbContext db, Guid ownerId, Guid operationId, EntityRecord entity, string action, CancellationToken cancellationToken)
    {
        await db.Owners.Where(owner => owner.Id == ownerId).ExecuteUpdateAsync(update => update.SetProperty(owner => owner.LatestSequence, owner => owner.LatestSequence + 1), cancellationToken);
        var sequence = await db.Owners.Where(owner => owner.Id == ownerId).Select(owner => owner.LatestSequence).SingleAsync(cancellationToken);
        db.Changes.Add(new ChangeRecord
        {
            OwnerId = ownerId,
            Sequence = sequence,
            OperationId = operationId,
            EntityType = entity.Kind,
            EntityId = entity.Id,
            Action = action,
            Revision = entity.Revision,
            EntityJson = JsonSerializer.Serialize(ToWire(entity), JsonOptions),
            CommittedAt = DateTimeOffset.UtcNow,
        });
        return sequence;
    }

    private static async Task<object> SaveFailure(PapyrDbContext db, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        Guid ownerId, MutationInput operation, string status, string code, string message, EntityRecord? current, CancellationToken cancellationToken)
    {
        await transaction.RollbackAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await using var receiptTransaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var receipt = new ReceiptRecord
        {
            OwnerId = ownerId,
            OperationId = operation.OperationId,
            EntityId = operation.EntityId,
            Status = status,
            Revision = current?.Revision,
            ErrorCode = code,
            ErrorMessage = message,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Receipts.Add(receipt);
        await db.SaveChangesAsync(cancellationToken);
        await receiptTransaction.CommitAsync(cancellationToken);
        return ReceiptResult(receipt, duplicate: false);
    }

    private static async Task<(string Code, string Message)?> SetAttachmentReferences(PapyrDbContext db, Guid ownerId, EntityRecord note, CancellationToken cancellationToken)
    {
        var matches = Regex.Matches(note.Content ?? string.Empty, "(?:papyr-asset://|https://papyr\\.invalid/papyr-assets/)([^\\s\\\"'\\)\\]}>;,]+)", RegexOptions.IgnoreCase);
        if (matches.Count > 256) return ("TOO_MANY_ASSETS", "A note may reference at most 256 attachments.");
        var ids = new HashSet<Guid>();
        foreach (Match match in matches)
        {
            if (!Guid.TryParse(match.Groups[1].Value, out var id)) return ("INVALID_ASSET_REFERENCE", "An attachment reference is malformed.");
            ids.Add(id);
        }
        if (ids.Count > 0)
        {
            var found = await db.Attachments.AsNoTracking().Where(asset => asset.OwnerId == ownerId && ids.Contains(asset.Id)).Select(asset => asset.Id).ToListAsync(cancellationToken);
            if (found.Count != ids.Count) return ("ASSET_NOT_FOUND", "Upload referenced attachments before saving the note.");
        }
        await db.AttachmentReferences.Where(reference => reference.OwnerId == ownerId && reference.EntityId == note.Id).ExecuteDeleteAsync(cancellationToken);
        foreach (var id in ids) db.AttachmentReferences.Add(new AttachmentReferenceRecord { OwnerId = ownerId, EntityId = note.Id, AttachmentId = id });
        return null;
    }

    private static async Task<object> StoreConflict(PapyrDbContext db, Guid ownerId, MutationInput operation, EntityRecord? current, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var receipt = new ReceiptRecord
        {
            OwnerId = ownerId,
            OperationId = operation.OperationId,
            EntityId = operation.EntityId,
            Status = "conflict",
            Revision = current?.Revision,
            ErrorCode = "REVISION_CONFLICT",
            ErrorMessage = "Remote entity changed.",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Receipts.Add(receipt);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ReceiptResult(receipt, duplicate: false);
    }

    private static object ReceiptResult(ReceiptRecord receipt, bool duplicate) => new
    {
        operationId = receipt.OperationId,
        status = duplicate && receipt.Status == "accepted" ? "duplicate" : receipt.Status,
        entityId = receipt.EntityId,
        revision = receipt.Revision?.ToString(CultureInfo.InvariantCulture),
        serverCursor = receipt.Sequence is null ? null : Cursor(receipt.Sequence.Value),
        currentRevision = receipt.Status == "conflict" ? receipt.Revision?.ToString(CultureInfo.InvariantCulture) : null,
        error = receipt.ErrorCode is null ? null : new { code = receipt.ErrorCode, message = receipt.ErrorMessage },
    };

    private static object Result(MutationInput operation, string status, long? revision, long? sequence, string? code, string? message) => new
    {
        operationId = operation.OperationId,
        status,
        entityId = operation.EntityId,
        revision = revision?.ToString(CultureInfo.InvariantCulture),
        serverCursor = sequence is null ? null : Cursor(sequence.Value),
        error = code is null ? null : new { code, message },
    };

    private static object ToWire(EntityRecord entity)
    {
        object? content = entity.Content;
        if (entity.NoteType == "whiteboard" && entity.Content is not null)
        {
            using var document = JsonDocument.Parse(entity.Content);
            content = document.RootElement.Clone();
        }
        return new Dictionary<string, object?>
        {
            ["id"] = entity.Id,
            ["kind"] = entity.Kind,
            ["parentId"] = entity.Kind == "folder" ? entity.ParentId : null,
            ["folderId"] = entity.Kind == "note" ? entity.ParentId : null,
            ["title"] = entity.Title,
            ["type"] = entity.NoteType,
            ["content"] = entity.NoteType is null ? null : content,
            ["contentSchemaVersion"] = entity.ContentSchemaVersion,
            ["revision"] = entity.Revision.ToString(CultureInfo.InvariantCulture),
            ["deletedAt"] = entity.DeletedAt,
            ["createdAt"] = entity.CreatedAt,
            ["updatedAt"] = entity.UpdatedAt,
        };
    }

    private static object ToWire(ChangeRecord change) => new
    {
        sequence = change.Sequence.ToString(CultureInfo.InvariantCulture),
        change.OperationId,
        change.EntityType,
        change.EntityId,
        change.Action,
        revision = change.Revision.ToString(CultureInfo.InvariantCulture),
        entity = JsonSerializer.Deserialize<JsonElement>(change.EntityJson),
    };

    private static Guid OwnerId(HttpContext context) => Guid.Parse(context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
    private static string Cursor(long sequence) => $"seq:{sequence.ToString(CultureInfo.InvariantCulture)}";
    private static bool TryParseCursor(string? cursor, out long sequence) => cursor is not null && cursor.StartsWith("seq:", StringComparison.Ordinal) && long.TryParse(cursor.AsSpan(4), NumberStyles.None, CultureInfo.InvariantCulture, out sequence) ? true : SetZero(out sequence);
    private static bool SetZero(out long sequence) { sequence = 0; return false; }
    private static string? String(JsonElement value, string key) => value.TryGetProperty(key, out var result) && result.ValueKind == JsonValueKind.String ? result.GetString() : null;
    private static Guid? GuidValue(JsonElement value, string key) => value.TryGetProperty(key, out var result) && result.ValueKind == JsonValueKind.String && Guid.TryParse(result.GetString(), out var id) ? id : null;
    private static bool TryInteger(JsonElement value, string key, out int? number)
    {
        number = null;
        if (!value.TryGetProperty(key, out var result) || result.ValueKind == JsonValueKind.Null) return true;
        if (result.ValueKind != JsonValueKind.Number || !result.TryGetInt32(out var parsed) || parsed < 1) return false;
        number = parsed;
        return true;
    }
    private static bool InvalidGuidField(JsonElement value, string key) => value.TryGetProperty(key, out var result) && result.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined) && (result.ValueKind != JsonValueKind.String || !Guid.TryParse(result.GetString(), out _));
    private static string? ContentValue(JsonElement content, string? noteType) => content.ValueKind == JsonValueKind.Undefined || content.ValueKind == JsonValueKind.Null ? null : noteType == "whiteboard" ? content.GetRawText() : content.ValueKind == JsonValueKind.String ? content.GetString() : null;
    private static object Error(string code, string message) => new { error = new { code, message } };
}
