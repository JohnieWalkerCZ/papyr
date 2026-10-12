using System.Security.Cryptography;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Papyr.Api.Data;

namespace Papyr.Api.Storage;

public static class AttachmentEndpoints
{
    private const long MaxBytes = 4_000_000;
    private const long DefaultOwnerQuotaBytes = 1_073_741_824;
    private static readonly Dictionary<string, byte[]> Signatures = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
        ["image/jpeg"] = [0xFF, 0xD8, 0xFF],
        ["image/gif"] = [0x47, 0x49, 0x46, 0x38],
        ["image/webp"] = [0x52, 0x49, 0x46, 0x46],
    };

    public static void MapAttachmentEndpoints(this WebApplication app)
    {
        var assets = app.MapGroup("/api/v1/assets").RequireAuthorization();
        assets.MapPost("", UploadAsync).RequireRateLimiting("asset-upload");
        assets.MapGet("/{id:guid}", DownloadAsync);
    }

    private static async Task<IResult> UploadAsync(HttpContext context, IAntiforgery antiforgery, PapyrDbContext db, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!await antiforgery.IsRequestValidAsync(context)) return Results.Json(new { error = new { code = "CSRF_INVALID", message = "Request verification failed." } }, statusCode: 400);
        if (!Guid.TryParse(context.Request.Headers["X-Asset-Id"].FirstOrDefault(), out var assetId) || assetId == Guid.Empty)
            return Results.BadRequest(Error("INVALID_ASSET_ID", "A stable asset UUID is required."));
        if (!context.Request.HasFormContentType) return Results.BadRequest(Error("INVALID_UPLOAD", "Use multipart/form-data with one file field named file."));

        var form = await context.Request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
        if (form.Files.Count != 1) return Results.UnprocessableEntity(Error("INVALID_UPLOAD", "Upload exactly one image in the file field."));
        if (file is null || file.Length is <= 0 or > MaxBytes) return Results.StatusCode(file?.Length > MaxBytes ? 413 : 422);
        var mimeType = file.ContentType.Split(';', 2)[0].Trim();
        if (!Signatures.TryGetValue(mimeType, out var signature)) return Results.UnprocessableEntity(Error("UNSUPPORTED_MEDIA_TYPE", "Only PNG, JPEG, GIF, and WebP images are supported."));

        var ownerId = Guid.Parse(context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        var root = Path.GetFullPath(configuration["PAPYR_ASSET_STORAGE_PATH"] ?? Path.Combine(AppContext.BaseDirectory, "assets"));
        var ownerDirectory = Path.Combine(root, ownerId.ToString("N"));
        Directory.CreateDirectory(ownerDirectory);
        var storageKey = $"{ownerId:N}/{assetId:N}.blob";
        var finalPath = Path.Combine(ownerDirectory, $"{assetId:N}.blob");
        var temporaryPath = Path.Combine(ownerDirectory, $".{Guid.NewGuid():N}.upload");
        string? computedHash = null;
        try
        {
            await using (var destination = new FileStream(temporaryPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
                await file.CopyToAsync(destination, cancellationToken);
            var (sha256, validSignature) = await HashAndCheckAsync(temporaryPath, signature, cancellationToken);
            computedHash = sha256;
            if (!validSignature) return Results.UnprocessableEntity(Error("INVALID_IMAGE", "File content does not match its declared image type."));
            var claimedHash = context.Request.Headers["X-Content-SHA256"].FirstOrDefault();
            if (string.IsNullOrWhiteSpace(claimedHash)) return Results.BadRequest(Error("HASH_REQUIRED", "Provide the client SHA-256 hash."));
            byte[] claimedBytes;
            try { claimedBytes = Convert.FromHexString(claimedHash); }
            catch (FormatException) { return Results.UnprocessableEntity(Error("HASH_MISMATCH", "Uploaded content does not match its declared SHA-256 hash.")); }
            if (claimedBytes.Length != 32 || !CryptographicOperations.FixedTimeEquals(claimedBytes, Convert.FromHexString(sha256)))
                return Results.UnprocessableEntity(Error("HASH_MISMATCH", "Uploaded content does not match its declared SHA-256 hash."));

            var existing = await db.Attachments.AsNoTracking().SingleOrDefaultAsync(item => item.Id == assetId, cancellationToken);
            if (existing is not null)
            {
                if (existing.OwnerId != ownerId || existing.Sha256 != sha256 || existing.MimeType != mimeType || existing.ByteLength != file.Length)
                    return Results.Conflict(Error("ASSET_ID_CONFLICT", "This asset ID already refers to different content."));
                return Results.Ok(new { id = assetId, sha256, mimeType, byteLength = file.Length, status = "duplicate" });
            }

            var ownerQuota = long.TryParse(configuration["PAPYR_MAX_ASSET_STORAGE_BYTES"], out var configuredQuota) && configuredQuota > 0
                ? configuredQuota
                : DefaultOwnerQuotaBytes;
            var usedBytes = await db.Attachments.Where(item => item.OwnerId == ownerId).SumAsync(item => (long?)item.ByteLength, cancellationToken) ?? 0;
            if (file.Length > ownerQuota - usedBytes)
                return Results.Json(Error("STORAGE_QUOTA_EXCEEDED", "This account has reached its attachment storage limit."), statusCode: StatusCodes.Status413PayloadTooLarge);

            if (File.Exists(finalPath))
            {
                await using var orphan = File.OpenRead(finalPath);
                var orphanHash = Convert.ToHexString(await SHA256.HashDataAsync(orphan, cancellationToken)).ToLowerInvariant();
                if (orphanHash != sha256) return Results.Conflict(Error("ASSET_ID_CONFLICT", "This asset ID already refers to different content."));
            }
            else File.Move(temporaryPath, finalPath);

            db.Attachments.Add(new AttachmentRecord
            {
                Id = assetId,
                OwnerId = ownerId,
                Sha256 = sha256,
                MimeType = mimeType,
                ByteLength = file.Length,
                StorageKey = storageKey,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(cancellationToken);
            return Results.Created($"/api/v1/assets/{assetId}", new { id = assetId, sha256, mimeType, byteLength = file.Length, status = "stored" });
        }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            var raced = await db.Attachments.AsNoTracking().SingleOrDefaultAsync(item => item.Id == assetId && item.OwnerId == ownerId, cancellationToken);
            return raced is not null && raced.Sha256 == computedHash
                ? Results.Ok(new { id = assetId, sha256 = raced.Sha256, mimeType = raced.MimeType, byteLength = raced.ByteLength, status = "duplicate" })
                : Results.Conflict(Error("ASSET_ID_CONFLICT", "This asset ID already refers to different content."));
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    private static async Task<IResult> DownloadAsync(Guid id, HttpContext context, PapyrDbContext db, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var ownerId = Guid.Parse(context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);
        var asset = await db.Attachments.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id && item.OwnerId == ownerId, cancellationToken);
        if (asset is null) return Results.NotFound();
        var path = Path.Combine(Path.GetFullPath(configuration["PAPYR_ASSET_STORAGE_PATH"] ?? Path.Combine(AppContext.BaseDirectory, "assets")), ownerId.ToString("N"), $"{id:N}.blob");
        if (!File.Exists(path)) return Results.Problem("Attachment data is unavailable.", statusCode: StatusCodes.Status503ServiceUnavailable);
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        context.Response.Headers["X-Content-SHA256"] = asset.Sha256;
        return Results.File(File.OpenRead(path), asset.MimeType, enableRangeProcessing: false);
    }

    private static async Task<(string Hash, bool SignatureMatches)> HashAndCheckAsync(string path, byte[] signature, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var header = new byte[Math.Max(12, signature.Length)];
        var read = await stream.ReadAsync(header.AsMemory(), cancellationToken);
        var matches = read >= signature.Length && header.AsSpan(0, signature.Length).SequenceEqual(signature);
        if (matches && signature.Length == 4 && signature.AsSpan().SequenceEqual(Signatures["image/webp"]))
            matches = read >= 12 && header.AsSpan(8, 4).SequenceEqual("WEBP"u8);
        stream.Position = 0;
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
        return (hash, matches);
    }

    private static object Error(string code, string message) => new { error = new { code, message } };
}
