using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Papyr.Api.Data.Migrations;

[DbContext(typeof(PapyrDbContext))]
[Migration("202610110003_ChangeRetention")]
public sealed class ChangeRetention : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.AddColumn<long>(
        name: "min_retained_sequence",
        table: "owners",
        type: "bigint",
        nullable: false,
        defaultValue: 0L);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropColumn(
        name: "min_retained_sequence",
        table: "owners");
}
