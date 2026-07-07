import { getTableName } from "drizzle-orm";

import { getClient } from "@/db";
import { schema } from "@/db/schema";
import { requireTutor } from "@/lib/authz";

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function GET() {
  await requireTutor();
  const client = getClient();
  const tables: Record<string, unknown[]> = {};

  for (const [key, table] of Object.entries(schema).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const tableName = getTableName(table);
    const result = await client.execute(`select * from ${quoteIdentifier(tableName)}`);
    tables[key] = result.rows.map((row) => ({ ...row }));
  }

  const exportedAt = new Date().toISOString();

  return new Response(JSON.stringify({ exportedAt, tables }, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="tutorloft-backup-${exportedAt.slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
