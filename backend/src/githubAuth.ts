import type { Request, Response } from "express";
import crypto from "node:crypto";

export interface GitHubUser {
  id: number;
  login: string;
  name?: string | null;
  avatarUrl?: string;
  htmlUrl?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  ownerLogin: string;
  defaultBranch: string;
  description?: string | null;
  pushedAt?: string | null;
  updatedAt?: string | null;
}

export interface GitHubSession {
  accessToken: string;
  user: GitHubUser;
  createdAt: number;
}

interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubApiUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
}

interface GitHubApiRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  owner: {
    login: string;
  };
  default_branch: string;
  description?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
}

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";
const SESSION_COOKIE = "code_atlas_session";
const OAUTH_STATE_COOKIE = "code_atlas_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REPO_PAGES = 4;

const sessions = new Map<string, GitHubSession>();

export function githubOAuthConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function startGitHubOAuth(request: Request, response: Response): void {
  if (!githubOAuthConfigured()) {
    response.status(501).send("GitHub OAuth is not configured.");
    return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID ?? "",
    redirect_uri: githubCallbackUrl(request),
    scope: process.env.GITHUB_OAUTH_SCOPE ?? "repo read:user",
    state
  });

  setCookie(response, request, OAUTH_STATE_COOKIE, state, OAUTH_STATE_TTL_SECONDS);
  response.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`);
}

export async function completeGitHubOAuth(request: Request, response: Response): Promise<void> {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const returnedState = typeof request.query.state === "string" ? request.query.state : "";
  const expectedState = cookiesFor(request)[OAUTH_STATE_COOKIE] ?? "";

  if (!githubOAuthConfigured()) {
    response.status(501).send("GitHub OAuth is not configured.");
    return;
  }

  if (!code || !returnedState || returnedState !== expectedState) {
    clearCookie(response, request, OAUTH_STATE_COOKIE);
    response.redirect(authRedirectUrl(request, "failed"));
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, githubCallbackUrl(request));
    const user = await fetchGitHubUser(token);
    const sessionId = crypto.randomBytes(32).toString("hex");

    sessions.set(sessionId, {
      accessToken: token,
      user,
      createdAt: Date.now()
    });

    clearCookie(response, request, OAUTH_STATE_COOKIE);
    setCookie(response, request, SESSION_COOKIE, sessionId, Math.floor(SESSION_TTL_MS / 1000));
    response.redirect(authRedirectUrl(request, "connected"));
  } catch (error) {
    clearCookie(response, request, OAUTH_STATE_COOKIE);
    response.redirect(authRedirectUrl(request, "failed"));
  }
}

export function githubAuthStatus(request: Request, response: Response): void {
  const session = githubSessionFor(request);

  response.json({
    configured: githubOAuthConfigured(),
    connected: Boolean(session),
    user: session?.user ?? null
  });
}

export function logoutGitHub(request: Request, response: Response): void {
  const sessionId = cookiesFor(request)[SESSION_COOKIE];

  if (sessionId) {
    sessions.delete(sessionId);
  }

  clearCookie(response, request, SESSION_COOKIE);
  response.json({ ok: true });
}

export function githubSessionFor(request: Request): GitHubSession | null {
  const sessionId = cookiesFor(request)[SESSION_COOKIE];

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export async function repositoriesForGitHubSession(
  session: GitHubSession,
  query: string
): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];

  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const pageRepos = await fetchGitHubApi<GitHubApiRepository[]>(
      session.accessToken,
      `/user/repos?${new URLSearchParams({
        affiliation: "owner,collaborator,organization_member",
        sort: "pushed",
        per_page: "100",
        page: String(page)
      }).toString()}`
    );

    repositories.push(...pageRepos.map(toGitHubRepository));

    if (pageRepos.length < 100) {
      break;
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? repositories.filter((repository) =>
        [
          repository.fullName,
          repository.name,
          repository.ownerLogin,
          repository.description ?? ""
        ].some((value) => value.toLowerCase().includes(normalizedQuery))
      )
    : repositories;

  return filtered.slice(0, 60);
}

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    })
  });

  const payload = await response.json() as GitHubTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub token exchange failed.");
  }

  return payload.access_token;
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const user = await fetchGitHubApi<GitHubApiUser>(accessToken, "/user");

  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url
  };
}

async function fetchGitHubApi<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Code-Atlas",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}.`);
  }

  return await response.json() as T;
}

function toGitHubRepository(repository: GitHubApiRepository): GitHubRepository {
  return {
    id: repository.id,
    name: repository.name,
    fullName: repository.full_name,
    private: repository.private,
    htmlUrl: repository.html_url,
    ownerLogin: repository.owner.login,
    defaultBranch: repository.default_branch,
    description: repository.description,
    pushedAt: repository.pushed_at,
    updatedAt: repository.updated_at
  };
}

function githubCallbackUrl(request: Request): string {
  return process.env.GITHUB_OAUTH_CALLBACK_URL ?? `${publicBaseUrl(request)}/auth/github/callback`;
}

function publicBaseUrl(request: Request): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  const protocol = request.get("x-forwarded-proto") ?? request.protocol;
  const host = request.get("host") ?? `localhost:${process.env.PORT ?? 4000}`;

  return `${protocol}://${host}`;
}

function authRedirectUrl(request: Request, status: "connected" | "failed"): string {
  const base = process.env.GITHUB_AUTH_REDIRECT_URL ?? process.env.FRONTEND_URL ?? publicBaseUrl(request);
  const redirectUrl = new URL(base);

  redirectUrl.searchParams.set("github", status);
  return redirectUrl.toString();
}

function cookiesFor(request: Request): Record<string, string> {
  const header = request.headers.cookie;

  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(";").flatMap((cookie) => {
      const [rawName, ...rawValue] = cookie.trim().split("=");
      const name = rawName?.trim();

      if (!name) {
        return [];
      }

      return [[name, decodeURIComponent(rawValue.join("="))]];
    })
  );
}

function setCookie(
  response: Response,
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number
): void {
  response.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secureCookie(request)}`
  );
}

function clearCookie(response: Response, request: Request, name: string): void {
  response.append(
    "Set-Cookie",
    `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie(request)}`
  );
}

function secureCookie(request: Request): string {
  const forwardedProtocol = request.get("x-forwarded-proto");

  return process.env.NODE_ENV === "production" || request.secure || forwardedProtocol === "https"
    ? "; Secure"
    : "";
}
