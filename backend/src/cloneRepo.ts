import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";

const GITHUB_REPO_URL_PATTERN =
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/;

interface CloneRepoOptions {
  githubToken?: string;
}

export function validateRepoUrl(repoUrl: string): void {
  if (!GITHUB_REPO_URL_PATTERN.test(repoUrl)) {
    throw new Error("repoUrl must be a GitHub repository HTTPS URL.");
  }
}

export async function cloneRepo(repoUrl: string, options: CloneRepoOptions = {}): Promise<string> {
  validateRepoUrl(repoUrl);

  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-atlas-"));
  const git = simpleGit();
  const cloneUrl = cloneUrlFor(repoUrl, options.githubToken);

  try {
    await git.clone(cloneUrl, repoDir, ["--depth", "120", "--single-branch"]);
  } catch {
    await cleanupRepo(repoDir);
    throw new Error(
      options.githubToken
        ? "Failed to clone repository with the connected GitHub account. Confirm the account has access."
        : "Failed to clone repository. Public repositories can be analyzed directly; private repositories require GitHub connection."
    );
  }

  return repoDir;
}

export async function cleanupRepo(repoPath: string): Promise<void> {
  await fs.rm(repoPath, { recursive: true, force: true });
}

function cloneUrlFor(repoUrl: string, githubToken?: string): string {
  const normalizedRepoUrl = repoUrl.endsWith(".git")
    ? repoUrl
    : `${repoUrl.replace(/\/$/, "")}.git`;

  if (!githubToken) {
    return normalizedRepoUrl;
  }

  const authenticatedUrl = new URL(normalizedRepoUrl);
  authenticatedUrl.username = "x-access-token";
  authenticatedUrl.password = githubToken;

  return authenticatedUrl.toString();
}
