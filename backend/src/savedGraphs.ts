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

export type SavedGraphViewState = Record<string, unknown> | null;

export interface SavedGraphSummary {
  id: string;
  saveName: string;
  shareToken: string | null;
  sharedAt: string | null;
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
  viewState: SavedGraphViewState;
}

interface SavedGraphRow {
  id: string;
  save_name?: string | null;
  share_token?: string | null;
  shared_at?: Date | string | null;
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
  view_state?: SavedGraphViewState;
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
      save_name text NOT NULL DEFAULT 'Saved map',
      share_token text,
      shared_at timestamptz,
      repo_url text NOT NULL,
      repo_label text NOT NULL,
      commit_sha text,
      node_count integer NOT NULL,
      edge_count integer NOT NULL,
      graph_json jsonb NOT NULL,
      view_state jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    ALTER TABLE code_atlas_saved_graphs
      ADD COLUMN IF NOT EXISTS save_name text NOT NULL DEFAULT 'Saved map';
  `);
  await db.query(`
    ALTER TABLE code_atlas_saved_graphs
      ADD COLUMN IF NOT EXISTS view_state jsonb;
  `);
  await db.query(`
    ALTER TABLE code_atlas_saved_graphs
      ADD COLUMN IF NOT EXISTS share_token text;
  `);
  await db.query(`
    ALTER TABLE code_atlas_saved_graphs
      ADD COLUMN IF NOT EXISTS shared_at timestamptz;
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS code_atlas_saved_graphs_user_updated_idx
      ON code_atlas_saved_graphs (user_id, updated_at DESC);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS code_atlas_saved_graphs_user_repo_idx
      ON code_atlas_saved_graphs (user_id, repo_url);
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS code_atlas_saved_graphs_share_token_idx
      ON code_atlas_saved_graphs (share_token)
      WHERE share_token IS NOT NULL;
  `);
  dbSchemaReady = true;
}

export async function listSavedGraphsForSession(session: GitHubSession): Promise<SavedGraphSummary[]> {
  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();
    const result = await db.query<SavedGraphRow>(
      `
        SELECT id, save_name, share_token, shared_at, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
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
        SELECT id, user_id, user_login, save_name, share_token, shared_at, repo_url, repo_label, commit_sha, node_count, edge_count, graph_json, view_state, created_at, updated_at
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
  const record = records.find((candidate) => candidate.id === id && candidate.userId === sessionUserId(session));
  return record ? normalizeRecord(record) : null;
}

export async function saveGraphForSession(
  session: GitHubSession,
  repoUrl: string,
  saveName: string,
  graph: SavedGraphPayload,
  viewState: SavedGraphViewState
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
    const graphJson = JSON.stringify(graph);
    const viewStateJson = viewState ? JSON.stringify(viewState) : null;

    const id = crypto.randomUUID();
    const result = await db.query<SavedGraphRow>(
      `
        INSERT INTO code_atlas_saved_graphs (
          id, user_id, user_login, save_name, repo_url, repo_label, commit_sha, node_count, edge_count, graph_json, view_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
        RETURNING id, save_name, share_token, shared_at, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
      `,
      [id, userId, session.user.login, saveName, repoUrl, repoLabel, commitSha, nodeCount, edgeCount, graphJson, viewStateJson]
    );

    return summaryFromRow(result.rows[0]);
  }

  const records = await readFileStore();
  const record: SavedGraphRecord = {
    id: crypto.randomUUID(),
    userId,
    userLogin: session.user.login,
    saveName,
    shareToken: null,
    sharedAt: null,
    repoUrl,
    repoLabel,
    commitSha,
    nodeCount,
    edgeCount,
    graph,
    viewState,
    createdAt: now,
    updatedAt: now
  };

  records.push(record);

  await writeFileStore(records);
  return summaryFromRecord(record);
}

export async function shareSavedGraphForSession(
  session: GitHubSession,
  id: string
): Promise<SavedGraphSummary | null> {
  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = generateShareToken();

      try {
        const result = await db.query<SavedGraphRow>(
          `
            UPDATE code_atlas_saved_graphs
            SET
              share_token = COALESCE(share_token, $3),
              shared_at = COALESCE(shared_at, now())
            WHERE id = $1 AND user_id = $2
            RETURNING id, save_name, share_token, shared_at, repo_url, repo_label, commit_sha, node_count, edge_count, created_at, updated_at
          `,
          [id, sessionUserId(session), token]
        );

        return result.rows[0] ? summaryFromRow(result.rows[0]) : null;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
  }

  const records = await readFileStore();
  const index = records.findIndex((record) => record.id === id && record.userId === sessionUserId(session));

  if (index < 0) {
    return null;
  }

  const record = normalizeRecord(records[index]);

  if (!record.shareToken) {
    record.shareToken = generateLocalShareToken(records);
    record.sharedAt = new Date().toISOString();
    records[index] = record;
    await writeFileStore(records);
  }

  return summaryFromRecord(record);
}

export async function loadSavedGraphByShareToken(token: string): Promise<SavedGraphRecord | null> {
  const shareToken = token.trim();

  if (!shareToken) {
    return null;
  }

  const db = savedGraphPool();

  if (db) {
    await ensureSavedGraphStore();
    const result = await db.query<SavedGraphRow>(
      `
        SELECT id, user_id, user_login, save_name, share_token, shared_at, repo_url, repo_label, commit_sha, node_count, edge_count, graph_json, view_state, created_at, updated_at
        FROM code_atlas_saved_graphs
        WHERE share_token = $1
        LIMIT 1
      `,
      [shareToken]
    );
    const row = result.rows[0];

    return row ? recordFromRow(row) : null;
  }

  const records = await readFileStore();
  const record = records.find((candidate) => normalizeRecord(candidate).shareToken === shareToken);
  return record ? normalizeRecord(record) : null;
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
    saveName: row.save_name ?? row.repo_label ?? "Saved map",
    shareToken: row.share_token ?? null,
    sharedAt: nullableDateString(row.shared_at),
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
    graph: row.graph_json ?? { nodes: [], edges: [] },
    viewState: row.view_state ?? null
  };
}

function summaryFromRecord(record: SavedGraphRecord): SavedGraphSummary {
  return {
    id: record.id,
    saveName: record.saveName ?? record.repoLabel ?? "Saved map",
    shareToken: record.shareToken ?? null,
    sharedAt: record.sharedAt ?? null,
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

function nullableDateString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return dateString(value);
}

async function readFileStore(): Promise<SavedGraphRecord[]> {
  const fileStorePath = savedGraphFileStorePath();

  if (!existsSync(fileStorePath)) {
    return [];
  }

  const payload = JSON.parse(await readFile(fileStorePath, "utf8")) as { records?: SavedGraphRecord[] };
  return Array.isArray(payload.records) ? payload.records.map(normalizeRecord) : [];
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

function normalizeRecord(record: SavedGraphRecord): SavedGraphRecord {
  return {
    ...record,
    saveName: record.saveName ?? record.repoLabel ?? "Saved map",
    shareToken: record.shareToken ?? null,
    sharedAt: record.sharedAt ?? null,
    viewState: record.viewState ?? null
  };
}

function generateShareToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function generateLocalShareToken(records: SavedGraphRecord[]): string {
  const existingTokens = new Set(records.map((record) => normalizeRecord(record).shareToken).filter(Boolean));
  let token = generateShareToken();

  while (existingTokens.has(token)) {
    token = generateShareToken();
  }

  return token;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function savedGraphFileStorePath(): string {
  return process.env.SAVED_GRAPHS_FILE
    ? path.resolve(process.env.SAVED_GRAPHS_FILE)
    : path.resolve(currentDir, "../.data/saved-graphs.json");
}
