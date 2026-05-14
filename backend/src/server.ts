import cors from "cors";
import express from "express";
import { cleanupRepo, cloneRepo } from "./cloneRepo.js";
import { extractGraph } from "./extractGraph.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/analyze", async (request, response) => {
  const repoUrl = request.body?.repoUrl;

  if (typeof repoUrl !== "string" || repoUrl.trim().length === 0) {
    response.status(400).json({ error: "repoUrl is required." });
    return;
  }

  let repoPath: string | undefined;

  try {
    repoPath = await cloneRepo(repoUrl.trim());
    const graph = await extractGraph(repoPath);
    response.json(graph);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze repository.";
    response.status(500).json({ error: message });
  } finally {
    if (repoPath) {
      await cleanupRepo(repoPath);
    }
  }
});

app.listen(port, () => {
  console.log(`Code Atlas backend listening on http://localhost:${port}`);
});
