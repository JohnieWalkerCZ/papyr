using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Papyr.Api.Data.Migrations;

[DbContext(typeof(PapyrDbContext))]
[Migration("202610130001_MultipleAccounts")]
public sealed class MultipleAccounts : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(name: "is_admin", table: "owners", type: "boolean", nullable: false, defaultValue: true);
        migrationBuilder.CreateIndex(name: "ix_owners_is_admin", table: "owners", column: "is_admin", unique: true, filter: "is_admin = TRUE");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "ix_owners_is_admin", table: "owners");
        migrationBuilder.DropColumn(name: "is_admin", table: "owners");
    }
}
