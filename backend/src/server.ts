import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupRepo, cloneRepo } from "./cloneRepo.js";
import { extractGraph } from "./extractGraph.js";
import { extractGitDiff } from "./gitDiff.js";
import { extractGitHistory } from "./gitHistory.js";
import {
  completeGitHubOAuth,
  githubAuthStatus,
  githubSessionFor,
  logoutGitHub,
  repositoriesForGitHubSession,
  startGitHubOAuth
} from "./githubAuth.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
let lastAnalyzedRepoUrl: string | null = null;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDistPath = path.resolve(currentDir, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDistPath, "index.html");

app.set("trust proxy", 1);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    const allowedOrigins = (process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, origin);
      return;
    }

    callback(new Error("Origin is not allowed by Code Atlas CORS policy."));
  }
}));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/auth/github", startGitHubOAuth);
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

app.post("/analyze", async (request, response) => {
  const repoUrl = request.body?.repoUrl;

  if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
    response.status(400).json({ error: "repoUrl is required." });
    return;
  }

  let repoPath: string | undefined;

  try {
    lastAnalyzedRepoUrl = repoUrl.trim();
    repoPath = await cloneRepo(lastAnalyzedRepoUrl, {
      githubToken: githubSessionFor(request)?.accessToken
    });
    const [graph, history] = await Promise.all([
      extractGraph(repoPath),
      extractGitHistory(repoPath)
    ]);
    response.json({
      ...graph,
      commits: history.commits,
      fileHistory: history.fileHistory
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze repository.";
    response.status(500).json({ error: message });
  } finally {
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
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
