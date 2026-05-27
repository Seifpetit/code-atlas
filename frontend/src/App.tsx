import { FormEvent, useEffect, useState } from "react";
import {
  analyzeRepo,
  getGitHubAuthStatus,
  githubConnectUrl,
  loadGitHubRepositories,
  logoutGitHub,
  type AtlasGraph,
  type GitHubAuthStatus,
  type GitHubRepository
} from "./api";
import { clusteringOptions, type ClusteringMode } from "./graph/clustering";
import { GraphView } from "./graph/GraphView";

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [clusteringMode, setClusteringMode] = useState<ClusteringMode>("structural");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus>({
    configured: false,
    connected: false,
    user: null
  });
  const [githubQuery, setGithubQuery] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubResult = params.get("github");

    if (githubResult === "connected") {
      setStatus("GitHub connected");
    } else if (githubResult === "failed") {
      setError("GitHub connection failed.");
      setStatus("GitHub connection failed");
    }

    if (githubResult) {
      params.delete("github");
      const nextQuery = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshGitHubStatus() {
      try {
        const nextStatus = await getGitHubAuthStatus();

        if (!cancelled) {
          setGithubStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setGithubStatus({ configured: false, connected: false, user: null });
          setGithubError("GitHub connection status unavailable.");
        }
      }
    }

    void refreshGitHubStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!githubStatus.connected) {
      setGithubRepos([]);
      setGithubLoading(false);
      return;
    }

    setGithubLoading(true);
    setGithubError(null);

    const timer = window.setTimeout(() => {
      loadGitHubRepositories(githubQuery)
        .then((repositories) => {
          if (!cancelled) {
            setGithubRepos(repositories);
          }
        })
        .catch((caughtError) => {
          if (!cancelled) {
            const message = caughtError instanceof Error ? caughtError.message : "Failed to load GitHub repositories.";
            setGithubError(message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setGithubLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [githubQuery, githubStatus.connected]);

  async function runAnalysis(targetRepoUrl: string, label = targetRepoUrl) {
    setError(null);
    setStatus(`Cloning and extracting ${label}...`);
    setIsAnalyzing(true);

    try {
      const result = await analyzeRepo(targetRepoUrl);
      setGraph(result);
      setStatus(`${result.nodes.length} nodes, ${result.edges.length} imports, ${result.commits?.length ?? 0} commits`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Analysis failed.";
      setError(message);
      setStatus("Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAnalysis(repoUrl.trim());
  }

  function handleConnectGitHub() {
    window.location.href = githubConnectUrl();
  }

  async function handleLogoutGitHub() {
    try {
      await logoutGitHub();
      setGithubStatus({ configured: githubStatus.configured, connected: false, user: null });
      setGithubRepos([]);
      setGithubQuery("");
      setStatus("GitHub disconnected");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to disconnect GitHub.";
      setGithubError(message);
    }
  }

  async function handleGitHubRepoAnalyze(repository: GitHubRepository) {
    setRepoUrl(repository.htmlUrl);
    await runAnalysis(repository.htmlUrl, repository.fullName);
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">CA</span>
          <div>
            <h1>Code Atlas</h1>
            <p>for JavaScript and Python ecosystems</p>
            <p className="brand__subtitle">Deterministic repository structure graph</p>
          </div>
        </div>

        <div className="repo-entry">
          <form className="analyze-form" onSubmit={handleSubmit}>
            <input
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              aria-label="GitHub repository URL"
            />
            <button type="submit" disabled={isAnalyzing || repoUrl.trim().length === 0}>
              {isAnalyzing ? "Analyzing" : "Analyze"}
            </button>
          </form>

          {githubStatus.connected ? (
            <section className="github-repo-panel" aria-label="Connected GitHub repositories">
              <div className="github-repo-panel__header">
                <span>GitHub: <strong>@{githubStatus.user?.login}</strong></span>
                <button type="button" onClick={handleLogoutGitHub}>Disconnect</button>
              </div>
              <input
                value={githubQuery}
                onChange={(event) => setGithubQuery(event.target.value)}
                placeholder="Search connected repos"
                aria-label="Search connected GitHub repositories"
              />
              <div className="github-repo-panel__list">
                {githubLoading ? <span className="github-repo-panel__empty">Loading repositories</span> : null}
                {!githubLoading && githubRepos.length === 0 ? (
                  <span className="github-repo-panel__empty">No repositories found</span>
                ) : null}
                {!githubLoading
                  ? githubRepos.slice(0, 5).map((repository) => (
                      <button
                        key={repository.id}
                        type="button"
                        disabled={isAnalyzing}
                        onClick={() => void handleGitHubRepoAnalyze(repository)}
                      >
                        <span>{repository.fullName}</span>
                        <small>{repository.private ? "Private" : "Public"}</small>
                      </button>
                    ))
                  : null}
              </div>
              {githubError ? <p className="github-repo-panel__error">{githubError}</p> : null}
            </section>
          ) : (
            <div className="github-connect-strip">
              <button type="button" disabled={!githubStatus.configured} onClick={handleConnectGitHub}>
                Connect GitHub
              </button>
              <span>
                {githubStatus.configured
                  ? "Select connected repositories without leaving Code Atlas."
                  : "Set GitHub OAuth env vars to enable connected repositories."}
              </span>
            </div>
          )}
        </div>
        {isAnalyzing ? (
          <div className="repo-fetch-bar" role="progressbar" aria-label="Fetching repository">
            <span />
          </div>
        ) : null}
      </header>

      <section className="toolbar">
        <div className="status">
          <span className={error ? "status__dot status__dot--error" : "status__dot"} />
          {error ?? status}
        </div>
        <div className="toolbar__controls">
          <div className="cluster-switch" aria-label="Clustering mode">
            {clusteringOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.id === clusteringMode ? "cluster-switch__button is-active" : "cluster-switch__button"}
                disabled={!option.enabled}
                title={option.enabled ? `${option.label} clustering` : `${option.label} clustering is planned`}
                onClick={() => setClusteringMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="search-input"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search files or folders"
            aria-label="Search files or folders"
          />
        </div>
      </section>

      <GraphView
        graph={graph}
        searchTerm={searchTerm}
        clusteringMode={clusteringMode}
        githubConnected={githubStatus.connected}
        githubUserLogin={githubStatus.user?.login}
        onConnectGitHub={githubStatus.configured ? handleConnectGitHub : undefined}
      />
    </main>
  );
}
