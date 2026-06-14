import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupRepo, cloneRepo } from "./cloneRepo.js";
import { extractGraph } from "./extractGraph.js";
import { extractGitDiff } from "./gitDiff.js";
import { extractGitHistory } from "./gitHistory.js";
import {
  completeGitHubOAuth,
  estimateRepositoryAnalysis,
  githubAuthStatus,
  githubSessionFor,
  logoutGitHub,
  repositoriesForGitHubSession,
  searchPublicRepositories,
  startGitHubOAuth
} from "./githubAuth.js";
import {
  ensureSavedGraphStore,
  listSavedGraphsForSession,
  loadSavedGraphByShareToken,
  loadSavedGraphForSession,
  saveGraphForSession,
  shareSavedGraphForSession,
  type SavedGraphPayload
} from "./savedGraphs.js";
import type { GraphJson } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
let lastAnalyzedRepoUrl: string | null = null;
const INITIAL_ANALYSIS_DEPTH = 3;
const ANALYSIS_JOB_TTL_MS = 30 * 60 * 1000;

type AnalyzeJobStatus = "running" | "complete" | "failed";

interface AnalyzeJobRecord {
  id: string;
  repoUrl: string;
  status: AnalyzeJobStatus;
  phase: string;
  startedAt: number;
  updatedAt: number;
  graph?: GraphJson;
  error?: string;
}

const analyzeJobs = new Map<string, AnalyzeJobRecord>();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(currentDir, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");
const backendEnvPath = path.resolve(currentDir, "../.env");

loadEnvFile(backendEnvPath);

app.set("trust proxy", 1);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const allowedOrigins = (process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const isLoopbackOrigin = (() => {
      if (!origin) {
        return false;
      }

      try {
        const url = new URL(origin);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
      } catch {
        return false;
      }
    })();

    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || isLoopbackOrigin) {
      callback(null, origin);
      return;
    }

    callback(new Error("Origin is not allowed by Code Atlas CORS policy."));
  }
}));
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

function cleanupAnalyzeJobs(): void {
  const now = Date.now();

  for (const [jobId, job] of analyzeJobs.entries()) {
    if (now - job.updatedAt > ANALYSIS_JOB_TTL_MS) {
      analyzeJobs.delete(jobId);
    }
  }
}

function analyzeJobPayload(job: AnalyzeJobRecord): Omit<AnalyzeJobRecord, "graph"> {
  return {
    id: job.id,
    repoUrl: job.repoUrl,
    status: job.status,
    phase: job.phase,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {})
  };
}

async function runCompleteAnalysisJob(
  jobId: string,
  repoPath: string,
  cloneMs: number,
  analyzeStartedAt: number
): Promise<void> {
  const job = analyzeJobs.get(jobId);

  if (!job) {
    await cleanupRepo(repoPath);
    return;
  }

  try {
    job.phase = "Reading git history";
    job.updatedAt = Date.now();
    const historyStartedAt = Date.now();
    const history = await extractGitHistory(repoPath);
    const extractHistoryMs = Date.now() - historyStartedAt;

    job.phase = "Completing deep graph analysis";
    job.updatedAt = Date.now();
    const graphStartedAt = Date.now();
    const graph = await extractGraph(repoPath, history.fileHistory, {
      analysis: {
        mode: "complete",
        pending: false,
        jobId,
        status: "complete",
        message: "Deep analysis complete"
      }
    });
    const extractGraphMs = Date.now() - graphStartedAt;

    job.graph = {
      ...graph,
      commits: history.commits,
      fileHistory: history.fileHistory,
      analyzeTiming: {
        cloneMs,
        extractGraphMs,
        extractHistoryMs,
        totalMs: Date.now() - analyzeStartedAt
      }
    };
    job.status = "complete";
    job.phase = "Complete";
    job.updatedAt = Date.now();
  } catch (error) {
    job.status = "failed";
    job.phase = "Failed";
    job.error = error instanceof Error ? error.message : "Failed to complete repository analysis.";
    job.updatedAt = Date.now();
  } finally {
    await cleanupRepo(repoPath);
  }
}

app.get("/auth/github", (request, response) => {
  if (typeof request.query.code === "string" || typeof request.query.state === "string") {
    void completeGitHubOAuth(request, response);
    return;
  }

  startGitHubOAuth(request, response);
});
app.get("/auth/github/callback", completeGitHubOAuth);
app.get("/auth/github/status", githubAuthStatus);
app.post("/auth/github/logout", logoutGitHub);

app.get("/github/repos", async (request, response) => {
  const session = githubSessionFor(request);

  if (!session) {
    response.status(401).json({ error: "Connect a GitHub account first." });
    return;
  }

  try {
    const query = typeof request.query.query === "string" ? request.query.query : "";
    response.json({ repositories: await repositoriesForGitHubSession(session, query) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load GitHub repositories.";
    response.status(500).json({ error: message });
  }
});

app.get("/github/public-repos", async (request, response) => {
  try {
    const query = typeof request.query.query === "string" ? request.query.query : "";
    const session = githubSessionFor(request);
    response.json({ repositories: await searchPublicRepositories(query, session?.accessToken) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search public repositories.";
    response.status(500).json({ error: message });
  }
});

app.get("/analyze/estimate", async (request, response) => {
  const repoUrl = typeof request.query.repoUrl === "string" ? request.query.repoUrl : "";

  if (!repoUrl.trim()) {
    response.status(400).json({ error: "repoUrl is required." });
    return;
  }

  try {
    const session = githubSessionFor(request);
    response.json(await estimateRepositoryAnalysis(repoUrl.trim(), session?.accessToken));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to estimate repository analysis.";
    response.status(500).json({ error: message });
  }
});

app.get("/graphs", async (request, response) => {
  const session = githubSessionFor(request);

  if (!session) {
    response.status(401).json({ error: "Connect GitHub before loading saved maps." });
    return;
  }

  try {
    response.json({ graphs: await listSavedGraphsForSession(session) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load saved maps.";
    response.status(500).json({ error: message });
  }
});

app.get("/graphs/:id", async (request, response) => {
  const session = githubSessionFor(request);

  if (!session) {
    response.status(401).json({ error: "Connect GitHub before opening saved maps." });
    return;
  }

  try {
    const savedGraph = await loadSavedGraphForSession(session, request.params.id);

    if (!savedGraph) {
      response.status(404).json({ error: "Saved map not found." });
      return;
    }

    response.json({
      savedGraph: savedGraphSummaryPayload(savedGraph),
      graph: savedGraph.graph,
      viewState: savedGraph.viewState
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open saved map.";
    response.status(500).json({ error: message });
  }
});

app.post("/graphs/:id/share", async (request, response) => {
  const session = githubSessionFor(request);

  if (!session) {
    response.status(401).json({ error: "Connect GitHub before sharing saved maps." });
    return;
  }

  try {
    const savedGraph = await shareSavedGraphForSession(session, request.params.id);

    if (!savedGraph) {
      response.status(404).json({ error: "Saved map not found." });
      return;
    }

    response.json({ savedGraph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create share link.";
    response.status(500).json({ error: message });
  }
});

app.post("/graphs", async (request, response) => {
  const session = githubSessionFor(request);

  if (!session) {
    response.status(401).json({ error: "Connect GitHub before saving maps." });
    return;
  }

  const repoUrl = request.body?.repoUrl;
  const saveName = request.body?.name;
  const graph = request.body?.graph as SavedGraphPayload | undefined;
  const viewState = request.body?.viewState;

  if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
    response.status(400).json({ error: "repoUrl is required." });
    return;
  }

  if (typeof saveName !== "string" || saveName.trim().length === 0) {
    response.status(400).json({ error: "A save name is required." });
    return;
  }

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    response.status(400).json({ error: "A valid graph payload is required." });
    return;
  }

  try {
    const savedGraph = await saveGraphForSession(
      session,
      repoUrl.trim(),
      saveName.trim(),
      graph,
      viewState && typeof viewState === "object" ? viewState : null
    );
    response.json({ savedGraph });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save map.";
    response.status(500).json({ error: message });
  }
});

app.get("/shared-graphs/:shareToken", async (request, response) => {
  try {
    const savedGraph = await loadSavedGraphByShareToken(request.params.shareToken);

    if (!savedGraph) {
      response.status(404).json({ error: "Shared map not found." });
      return;
    }

    response.json({
      savedGraph: savedGraphSummaryPayload(savedGraph),
      graph: savedGraph.graph,
      viewState: savedGraph.viewState
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open shared map.";
    response.status(500).json({ error: message });
  }
});

app.post("/analyze", async (request, response) => {
  const repoUrl = request.body?.repoUrl;

  if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
    response.status(400).json({ error: "repoUrl is required." });
    return;
  }

  let repoPath: string | undefined;
  let pendingJobId: string | undefined;
  const analyzeStartedAt = Date.now();
  cleanupAnalyzeJobs();

  try {
    lastAnalyzedRepoUrl = repoUrl.trim();
    const cloneStartedAt = Date.now();
    repoPath = await cloneRepo(lastAnalyzedRepoUrl, {
      githubToken: githubSessionFor(request)?.accessToken
    });
    const cloneMs = Date.now() - cloneStartedAt;

    const jobId = randomUUID();
    pendingJobId = jobId;
    const job: AnalyzeJobRecord = {
      id: jobId,
      repoUrl: lastAnalyzedRepoUrl,
      status: "running",
      phase: "Initial map ready; deep analysis continuing",
      startedAt: analyzeStartedAt,
      updatedAt: Date.now()
    };
    analyzeJobs.set(jobId, job);

    const initialGraphStartedAt = Date.now();
    const graph = await extractGraph(repoPath, {}, {
      maxDepth: INITIAL_ANALYSIS_DEPTH,
      parseSource: false,
      analysis: {
        mode: "partial",
        pending: true,
        depth: INITIAL_ANALYSIS_DEPTH,
        jobId,
        status: "running",
        message: "Initial map ready; deep analysis continuing"
      }
    });
    const extractGraphMs = Date.now() - initialGraphStartedAt;
    const initialPayload = {
      ...graph,
      analyzeTiming: {
        cloneMs,
        extractGraphMs,
        extractHistoryMs: 0,
        totalMs: Date.now() - analyzeStartedAt
      }
    };

    response.json(initialPayload);
    void runCompleteAnalysisJob(jobId, repoPath, cloneMs, analyzeStartedAt);
    repoPath = undefined;
    pendingJobId = undefined;
  } catch (error) {
    if (pendingJobId) {
      analyzeJobs.delete(pendingJobId);
    }
    const message = error instanceof Error ? error.message : "Failed to analyze repository.";
    response.status(message.includes("too large to analyze safely") ? 413 : 500).json({ error: message });
  } finally {
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
});

app.get("/analyze/jobs/:jobId", (request, response) => {
  cleanupAnalyzeJobs();
  const job = analyzeJobs.get(request.params.jobId);

  if (!job) {
    response.status(404).json({ error: "Analysis job not found." });
    return;
  }

  response.json({
    job: analyzeJobPayload(job),
    ...(job.status === "complete" && job.graph ? { graph: job.graph } : {})
  });
});

app.post("/diff", async (request, response) => {
  const baseCommit = request.body?.baseCommit;
  const targetCommit = request.body?.targetCommit;

  if (typeof baseCommit !== "string" || typeof targetCommit !== "string" || !baseCommit || !targetCommit) {
    response.status(400).json({ error: "baseCommit and targetCommit are required." });
    return;
  }

  if (!lastAnalyzedRepoUrl) {
    response.status(400).json({ error: "Analyze a repository before comparing commits." });
    return;
  }

  let repoPath: string | undefined;

  try {
    repoPath = await cloneRepo(lastAnalyzedRepoUrl, {
      githubToken: githubSessionFor(request)?.accessToken
    });
    response.json(await extractGitDiff(repoPath, baseCommit, targetCommit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compare commits.";
    response.status(500).json({ error: message });
  } finally {
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
});

if (existsSync(frontendIndexPath)) {
  app.use(express.static(frontendDistPath));

  app.get("*", (_request, response) => {
    response.sendFile(frontendIndexPath);
  });
}

app.listen(port, () => {
  console.log(`Code Atlas backend listening on http://localhost:${port}`);
});

void ensureSavedGraphStore().catch((error) => {
  const message = error instanceof Error ? error.message : "Saved graph store initialization failed.";
  console.error(message);
});

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function savedGraphSummaryPayload(savedGraph: {
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
}) {
  return {
    id: savedGraph.id,
    saveName: savedGraph.saveName,
    shareToken: savedGraph.shareToken,
    sharedAt: savedGraph.sharedAt,
    repoUrl: savedGraph.repoUrl,
    repoLabel: savedGraph.repoLabel,
    commitSha: savedGraph.commitSha,
    nodeCount: savedGraph.nodeCount,
    edgeCount: savedGraph.edgeCount,
    createdAt: savedGraph.createdAt,
    updatedAt: savedGraph.updatedAt
  };
}
