import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";

const GITHUB_REPO_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

export function validateRepoUrl(repoUrl: string): void {
  if (!GITHUB_REPO_URL_PATTERN.test(repoUrl)) {
    throw new Error("repoUrl must be a public GitHub repository HTTPS URL.");
  }
}

export async function cloneRepo(repoUrl: string): Promise<string> {
  validateRepoUrl(repoUrl);

  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-atlas-"));
  const git = simpleGit();

  await git.clone(repoUrl, repoDir, ["--depth", "1", "--single-branch"]);

  return repoDir;
}

export async function cleanupRepo(repoPath: string): Promise<void> {
  await fs.rm(repoPath, { recursive: true, force: true });
}
