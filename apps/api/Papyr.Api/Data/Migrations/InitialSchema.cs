using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Papyr.Api.Data.Migrations;

[DbContext(typeof(PapyrDbContext))]
[Migration("202610110001_InitialSchema")]
public sealed class InitialSchema : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable("owners", table => new
        {
            id = table.Column<Guid>(type: "uuid", nullable: false),
            instance_key = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
            username = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
            password_hash = table.Column<string>(type: "text", nullable: false),
            latest_sequence = table.Column<long>(type: "bigint", nullable: false),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table => table.PrimaryKey("pk_owners", x => x.id));

        migrationBuilder.CreateTable("entities", table => new
        {
            id = table.Column<Guid>(type: "uuid", nullable: false),
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
            parent_id = table.Column<Guid>(type: "uuid", nullable: true),
            title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
            note_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
            content = table.Column<string>(type: "text", nullable: true),
            content_schema_version = table.Column<int>(type: "integer", nullable: true),
            revision = table.Column<long>(type: "bigint", nullable: false),
            deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table => table.PrimaryKey("pk_entities", x => x.id));

        migrationBuilder.CreateTable("sessions", table => new
        {
            token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
            expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("pk_sessions", x => x.token_hash);
            table.ForeignKey("fk_sessions_owners_owner_id", x => x.owner_id, "owners", "id", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateTable("receipts", table => new
        {
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            operation_id = table.Column<Guid>(type: "uuid", nullable: false),
            entity_id = table.Column<Guid>(type: "uuid", nullable: false),
            status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
            revision = table.Column<long>(type: "bigint", nullable: true),
            sequence = table.Column<long>(type: "bigint", nullable: true),
            error_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
            error_message = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
            created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table => table.PrimaryKey("pk_receipts", x => new { x.owner_id, x.operation_id }));

        migrationBuilder.CreateTable("changes", table => new
        {
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            sequence = table.Column<long>(type: "bigint", nullable: false),
            operation_id = table.Column<Guid>(type: "uuid", nullable: false),
            entity_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
            entity_id = table.Column<Guid>(type: "uuid", nullable: false),
            action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
            revision = table.Column<long>(type: "bigint", nullable: false),
            entity_json = table.Column<string>(type: "text", nullable: false),
            committed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table => table.PrimaryKey("pk_changes", x => new { x.owner_id, x.sequence }));

        migrationBuilder.CreateTable("bootstrap_snapshots", table => new
        {
            id = table.Column<Guid>(type: "uuid", nullable: false),
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            sequence = table.Column<long>(type: "bigint", nullable: false),
            entities_json = table.Column<string>(type: "text", nullable: false),
            expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
        }, constraints: table => table.PrimaryKey("pk_bootstrap_snapshots", x => x.id));

        migrationBuilder.CreateTable("bootstrap_cursors", table => new
        {
            token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
            owner_id = table.Column<Guid>(type: "uuid", nullable: false),
            snapshot_id = table.Column<Guid>(type: "uuid", nullable: false),
            offset = table.Column<int>(type: "integer", nullable: false),
        }, constraints: table =>
        {
            table.PrimaryKey("pk_bootstrap_cursors", x => x.token_hash);
            table.ForeignKey("fk_bootstrap_cursors_bootstrap_snapshots_snapshot_id", x => x.snapshot_id, "bootstrap_snapshots", "id", onDelete: ReferentialAction.Cascade);
        });

        migrationBuilder.CreateIndex("ix_owners_username", "owners", "username", unique: true);
        migrationBuilder.CreateIndex("ix_owners_instance_key", "owners", "instance_key", unique: true);
        migrationBuilder.CreateIndex("ix_entities_owner_id_kind_parent_id", "entities", new[] { "owner_id", "kind", "parent_id" });
        migrationBuilder.CreateIndex("ix_entities_owner_id_updated_at", "entities", new[] { "owner_id", "updated_at" });
        migrationBuilder.CreateIndex("ix_sessions_owner_id_expires_at", "sessions", new[] { "owner_id", "expires_at" });
        migrationBuilder.CreateIndex("ix_changes_owner_id_entity_id", "changes", new[] { "owner_id", "entity_id" });
        migrationBuilder.CreateIndex("ix_bootstrap_snapshots_owner_id_expires_at", "bootstrap_snapshots", new[] { "owner_id", "expires_at" });
        migrationBuilder.CreateIndex("ix_bootstrap_cursors_snapshot_id", "bootstrap_cursors", "snapshot_id");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("changes");
        migrationBuilder.DropTable("bootstrap_cursors");
        migrationBuilder.DropTable("bootstrap_snapshots");
        migrationBuilder.DropTable("receipts");
        migrationBuilder.DropTable("entities");
        migrationBuilder.DropTable("sessions");
        migrationBuilder.DropTable("owners");
    }
}
