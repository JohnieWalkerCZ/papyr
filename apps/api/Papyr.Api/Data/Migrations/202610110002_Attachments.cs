using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Papyr.Api.Data.Migrations;

[DbContext(typeof(PapyrDbContext))]
[Migration("202610110002_Attachments")]
public sealed class Attachments : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "attachments",
            columns: table => new
            {
                id = table.Column<Guid>(type: "uuid", nullable: false),
                owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                mime_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                byte_length = table.Column<long>(type: "bigint", nullable: false),
                storage_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                deletion_candidate_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_attachments", x => x.id);
                table.ForeignKey("fk_attachments_owners_owner_id", x => x.owner_id, "owners", "id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "attachment_references",
            columns: table => new
            {
                owner_id = table.Column<Guid>(type: "uuid", nullable: false),
                entity_id = table.Column<Guid>(type: "uuid", nullable: false),
                attachment_id = table.Column<Guid>(type: "uuid", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("pk_attachment_references", x => new { x.owner_id, x.entity_id, x.attachment_id });
                table.ForeignKey("fk_attachment_references_entities_entity_id", x => x.entity_id, "entities", "id", onDelete: ReferentialAction.Cascade);
                table.ForeignKey("fk_attachment_references_attachments_attachment_id", x => x.attachment_id, "attachments", "id", onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex("ix_attachments_owner_id_created_at", "attachments", new[] { "owner_id", "created_at" });
        migrationBuilder.CreateIndex("ix_attachment_references_entity_id", "attachment_references", "entity_id");
        migrationBuilder.CreateIndex("ix_attachment_references_attachment_id", "attachment_references", "attachment_id");
        migrationBuilder.CreateIndex("ix_attachment_references_owner_id_attachment_id", "attachment_references", new[] { "owner_id", "attachment_id" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "attachment_references");
        migrationBuilder.DropTable(name: "attachments");
    }
}
