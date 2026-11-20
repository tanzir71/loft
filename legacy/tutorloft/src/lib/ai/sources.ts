import { desc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { materials, promptHistory, schema } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type AiSourceKind = "material" | "paste" | "url" | "youtube";

export type AiSource = {
  content: string;
  kind: AiSourceKind;
  label: string;
  materialId?: string;
  url?: string;
};

type CollectAiSourcesInput = {
  fetchFn?: FetchFn;
  materialIds?: string[];
  pastedText?: string;
  urls?: string[];
  youtubeTranscript?: string;
  youtubeUrl?: string;
};

type SavePromptHistoryInput = {
  feature: string;
  input: unknown;
  makeId?: () => string;
  now?: () => number;
};

const sourceInputSchema = z.object({
  materialIds: z.array(z.string().trim().min(1)).optional(),
  pastedText: z.string().optional(),
  urls: z.array(z.string().trim().url()).optional(),
  youtubeTranscript: z.string().optional(),
  youtubeUrl: z.string().trim().url().optional(),
});

const promptHistorySchema = z.object({
  feature: z.string().trim().min(1),
  input: z.unknown(),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

export function htmlToText(html: string) {
  return normalizeWhitespace(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

async function fetchUrlSource(fetchFn: FetchFn, url: string): Promise<AiSource> {
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`Unable to fetch source URL ${url}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const content = contentType.includes("html") || raw.includes("<")
    ? htmlToText(raw)
    : normalizeWhitespace(raw);

  return {
    content,
    kind: "url",
    label: url,
    url,
  };
}

async function materialSources(database: AppDb, materialIds: string[] = []) {
  if (materialIds.length === 0) {
    return [];
  }

  const rows = await database
    .select({
      bodyMd: materials.bodyMd,
      id: materials.id,
      planJson: materials.planJson,
      title: materials.title,
      type: materials.type,
    })
    .from(materials)
    .where(inArray(materials.id, materialIds));
  const byId = new Map(rows.map((row) => [row.id, row]));

  return materialIds.flatMap((materialId): AiSource[] => {
    const row = byId.get(materialId);

    if (!row) {
      return [];
    }

    const plan = row.planJson ? `\n\nPlan JSON:\n${JSON.stringify(row.planJson)}` : "";

    return [
      {
        content: `${row.bodyMd}${plan}`.trim(),
        kind: "material",
        label: row.title,
        materialId: row.id,
      },
    ];
  });
}

function combinedText(sources: AiSource[]) {
  return sources
    .map((source, index) =>
      [`## Source ${index + 1}: ${source.label}`, `Kind: ${source.kind}`, "", source.content].join(
        "\n",
      ),
    )
    .join("\n\n");
}

export async function collectAiSources(database: AppDb, input: CollectAiSourcesInput = {}) {
  const parsed = sourceInputSchema.parse(input);
  const sources: AiSource[] = [];
  const pastedText = parsed.pastedText?.trim();
  const youtubeTranscript = parsed.youtubeTranscript?.trim();

  if (pastedText) {
    sources.push({
      content: pastedText,
      kind: "paste",
      label: "Pasted source",
    });
  }

  for (const url of parsed.urls ?? []) {
    sources.push(await fetchUrlSource(input.fetchFn ?? fetch, url));
  }

  sources.push(...(await materialSources(database, parsed.materialIds)));

  if (youtubeTranscript) {
    sources.push({
      content: youtubeTranscript,
      kind: "youtube",
      label: parsed.youtubeUrl ?? "YouTube notes",
      url: parsed.youtubeUrl,
    });
  }

  return {
    combinedText: combinedText(sources),
    sources,
  };
}

export async function savePromptHistory(database: AppDb, input: SavePromptHistoryInput) {
  const parsed = promptHistorySchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [row] = await database
    .insert(promptHistory)
    .values({
      id: input.makeId?.() ?? createId(),
      feature: parsed.feature,
      inputJson: parsed.input,
      createdAt: now,
    })
    .returning();
  const rows = await listPromptHistory(database, parsed.feature);
  const overflow = rows.slice(20).map((history) => history.id);

  if (overflow.length > 0) {
    await database.delete(promptHistory).where(inArray(promptHistory.id, overflow));
  }

  return row;
}

export async function listPromptHistory(database: AppDb, feature: string) {
  const parsedFeature = z.string().trim().min(1).parse(feature);

  return database
    .select()
    .from(promptHistory)
    .where(eq(promptHistory.feature, parsedFeature))
    .orderBy(desc(promptHistory.createdAt), desc(promptHistory.id));
}
