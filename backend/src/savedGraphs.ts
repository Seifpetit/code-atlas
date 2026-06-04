import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { GitHubSession } from "./githubAuth.js";
import type { GraphJson } from "./types.js";

export interface SavedGraphPayload extends GraphJson {
  analyzeTiming?: unknown;
}

export interface SavedGraphSummary {
  id: string;
  repoUrl: string;
  repoLabel: string;
  commitSha: string | null;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedGraphRecord extends SavedGraphSummary {
  userId: string;
  userLogin: string;
  graph: SavedGraphPayload;
}

interface SavedGraphRow {
  id: string;
  repo_url: string;
  repo_label: string;
  commit_sha: string | null;
  node_count: number;
  edge_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  user_id?: string;
  user_login?: string;
  graph_json?: SavedGraphPayload;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));

let dbSchemaReady = false;
let pool: Pool | null | undefined;

export async function ensureSavedGraphStore(): Promise<void> {
  const db = savedGraphPool();

  if (!db || dbSchemaReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS code_atlas_saved_graphs (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      user_login text NOT NULL,
      repo_url text NOT NULL,
      repo_label text NOT NULL,
      commit_sha text,
      node_count integer NOT NULL,
      edge_count integer NOT NULL,
      graph_json jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS code_atlas_saved_graphs_user_updated_idx
      ON code_atlas_saved_graphs (user_id, updated_at DESC);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS code_atlas_saved_graphs_user_repo_idx
      ON code_atlas_saved_graphs (user_id, repo_url);
  `);
  dbSchemaReady = true;
}

export async function listSavedGraphsForSession(session: GitHubSession): Promise<SavedGraphSummary[]> {
  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();
    const result = await db.query<SavedGraphRow>(
      `
        SELECT id, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
        FROM code_atlas_saved_graphs
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT 80
      `,
      [sessionUserId(session)]
    );

    return result.rows.map(summaryFromRow);
  }

  const records = await readFileStore();
  return records
    .filter((record) => record.userId === sessionUserId(session))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 80)
    .map(summaryFromRecord);
}

export async function loadSavedGraphForSession(session: GitHubSession, id: string): Promise<SavedGraphRecord | null> {
  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();
    const result = await db.query<SavedGraphRow>(
      `
        SELECT id, user_id, user_login, repo_url, repo_label, commit_sha, node_count, edge_count, graph_json, created_at, updated_at
        FROM code_atlas_saved_graphs
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [id, sessionUserId(session)]
    );
    const row = result.rows[0];

    return row ? recordFromRow(row) : null;
  }

  const records = await readFileStore();
  return records.find((record) => record.id === id && record.userId === sessionUserId(session)) ?? null;
}

export async function saveGraphForSession(
  session: GitHubSession,
  repoUrl: string,
  graph: SavedGraphPayload
): Promise<SavedGraphSummary> {
  const now = new Date().toISOString();
  const userId = sessionUserId(session);
  const commitSha = graph.commits?.[0]?.hash ?? null;
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const repoLabel = repoLabelFromUrl(repoUrl);

  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();
    const existing = await db.query<{ id: string }>(
      `
        SELECT id
        FROM code_atlas_saved_graphs
        WHERE user_id = $1
          AND repo_url = $2
          AND (
            (commit_sha IS NULL AND $3::text IS NULL)
            OR commit_sha = $3
          )
        LIMIT 1
      `,
      [userId, repoUrl, commitSha]
    );
    const existingId = existing.rows[0]?.id;
    const graphJson = JSON.stringify(graph);

    if (existingId) {
      const result = await db.query<SavedGraphRow>(
        `
          UPDATE code_atlas_saved_graphs
          SET user_login = $2,
              repo_label = $3,
              node_count = $4,
              edge_count = $5,
              graph_json = $6::jsonb,
              updated_at = now()
          WHERE id = $1 AND user_id = $7
          RETURNING id, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
        `,
        [existingId, session.user.login, repoLabel, nodeCount, edgeCount, graphJson, userId]
      );

      return summaryFromRow(result.rows[0]);
    }

    const id = crypto.randomUUID();
    const result = await db.query<SavedGraphRow>(
      `
        INSERT INTO code_atlas_saved_graphs (
          id, user_id, user_login, repo_url, repo_label, commit_sha, node_count, edge_count, graph_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING id, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
      `,
      [id, userId, session.user.login, repoUrl, repoLabel, commitSha, nodeCount, edgeCount, graphJson]
    );

    return summaryFromRow(result.rows[0]);
  }

  const records = await readFileStore();
  const existingIndex = records.findIndex((record) => (
    record.userId === userId &&
    record.repoUrl === repoUrl &&
    record.commitSha === commitSha
  ));
  const existing = existingIndex >= 0 ? records[existingIndex] : null;
  const record: SavedGraphRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    userId,
    userLogin: session.user.login,
    repoUrl,
    repoLabel,
    commitSha,
    nodeCount,
    edgeCount,
    graph,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    records[existingIndex] = record;
  } else {
    records.push(record);
  }

  await writeFileStore(records);
  return summaryFromRecord(record);
}

function sessionUserId(session: GitHubSession): string {
  return String(session.user.id);
}

function repoLabelFromUrl(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    // Fall through to the raw input.
  }

  return repoUrl;
}

function summaryFromRow(row: SavedGraphRow): SavedGraphSummary {
  return {
    id: row.id,
    repoUrl: row.repo_url,
    repoLabel: row.repo_label,
    commitSha: row.commit_sha,
    nodeCount: Number(row.node_count),
    edgeCount: Number(row.edge_count),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at)
  };
}

function recordFromRow(row: SavedGraphRow): SavedGraphRecord {
  return {
    ...summaryFromRow(row),
    userId: row.user_id ?? "",
    userLogin: row.user_login ?? "",
    graph: row.graph_json ?? { nodes: [], edges: [] }
  };
}

function summaryFromRecord(record: SavedGraphRecord): SavedGraphSummary {
  return {
    id: record.id,
    repoUrl: record.repoUrl,
    repoLabel: record.repoLabel,
    commitSha: record.commitSha,
    nodeCount: record.nodeCount,
    edgeCount: record.edgeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function readFileStore(): Promise<SavedGraphRecord[]> {
  const fileStorePath = savedGraphFileStorePath();

  if (!existsSync(fileStorePath)) {
    return [];
  }

  const payload = JSON.parse(await readFile(fileStorePath, "utf8")) as { records?: SavedGraphRecord[] };
  return Array.isArray(payload.records) ? payload.records : [];
}

async function writeFileStore(records: SavedGraphRecord[]): Promise<void> {
  const fileStorePath = savedGraphFileStorePath();

  await mkdir(path.dirname(fileStorePath), { recursive: true });
  await writeFile(fileStorePath, JSON.stringify({ records }, null, 2), "utf8");
}

function savedGraphPool(): Pool | null {
  if (pool !== undefined) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
      })
    : null;

  return pool;
}

function savedGraphFileStorePath(): string {
  return process.env.SAVED_GRAPHS_FILE
    ? path.resolve(process.env.SAVED_GRAPHS_FILE)
    : path.resolve(currentDir, "../.data/saved-graphs.json");
}
