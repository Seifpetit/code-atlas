import { FormEvent, useEffect, useState } from "react";
import {
  analyzeRepo,
  getGitHubAuthStatus,
  githubConnectUrl,
  loadGitHubRepositories,
  logoutGitHub,
  searchPublicGitHubRepositories,
  type AtlasGraph,
  type GitHubAuthStatus,
  type GitHubRepository
} from "./api";
import { clusteringOptions, type ClusteringMode } from "./graph/clustering";
import { GraphView } from "./graph/GraphView";

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [publicSearchOpen, setPublicSearchOpen] = useState(false);
  const [publicSearchQuery, setPublicSearchQuery] = useState("");
  const [publicSearchLoading, setPublicSearchLoading] = useState(false);
  const [publicSearchError, setPublicSearchError] = useState<string | null>(null);
  const [publicSearchResults, setPublicSearchResults] = useState<GitHubRepository[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [clusteringMode, setClusteringMode] = useState<ClusteringMode>("structural");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeElapsedMs, setAnalyzeElapsedMs] = useState(0);
  const [lastAnalyzeTiming, setLastAnalyzeTiming] = useState<AtlasGraph["analyzeTiming"]>();
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus>({
    configured: false,
    connected: false,
    user: null
  });
  const [githubQuery, setGithubQuery] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [selectedGitHubRepoUrl, setSelectedGitHubRepoUrl] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  function compactUpdatedAt(isoDate?: string | null): string {
    if (!isoDate) {
      return "Unknown update";
    }

    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return "Unknown update";
    }

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = ms / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }

  function estimateAnalyzeDuration(repository: GitHubRepository): number {
    const stars = repository.stargazersCount ?? 0;
    const topicFactor = Math.min(8, repository.topics?.length ?? 0) * 2200;
    const starFactor = Math.min(180000, Math.log10(stars + 10) * 26000);
    const baseMs = 22000;
    return Math.round(baseMs + starFactor + topicFactor);
  }

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
          if (!nextStatus.connected) {
            setSelectedGitHubRepoUrl("");
          }
        }
      } catch {
        if (!cancelled) {
          setGithubStatus((current) => ({ ...current, connected: false, user: null }));
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
            setSelectedGitHubRepoUrl((current) =>
              current && repositories.some((repository) => repository.htmlUrl === current)
                ? current
                : repositories[0]?.htmlUrl ?? ""
            );
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
    setAnalyzeElapsedMs(0);
    setLastAnalyzeTiming(undefined);

    try {
      const result = await analyzeRepo(targetRepoUrl);
      setGraph(result);
      setLastAnalyzeTiming(result.analyzeTiming);
      setStatus(`${result.nodes.length} nodes, ${result.edges.length} imports, ${result.commits?.length ?? 0} commits`);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Analysis failed.";
      setError(message);
      setStatus("Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  useEffect(() => {
    if (!isAnalyzing) {
      return;
    }

    const timer = window.setInterval(() => {
      setAnalyzeElapsedMs((current) => current + 250);
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [isAnalyzing]);

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
    setSelectedGitHubRepoUrl(repository.htmlUrl);
    await runAnalysis(repository.htmlUrl, repository.fullName);
  }

  async function handleGitHubSelectorAnalyze() {
    const repository = githubRepos.find((repo) => repo.htmlUrl === selectedGitHubRepoUrl);

    if (!repository) {
      return;
    }

    await handleGitHubRepoAnalyze(repository);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      return;
    }
    await runAnalysis(trimmed);
  }

  useEffect(() => {
    let cancelled = false;

    if (!publicSearchOpen) {
      return;
    }

    const query = publicSearchQuery.trim();
    if (query.length < 2) {
      setPublicSearchResults([]);
      setPublicSearchLoading(false);
      setPublicSearchError(null);
      return;
    }

    setPublicSearchLoading(true);
    setPublicSearchError(null);

    const timer = window.setTimeout(() => {
      searchPublicGitHubRepositories(query)
        .then((repositories) => {
          if (!cancelled) {
            setPublicSearchResults(repositories);
          }
        })
        .catch((caughtError) => {
          if (!cancelled) {
            const message = caughtError instanceof Error ? caughtError.message : "Failed to search public repositories.";
            setPublicSearchError(message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPublicSearchLoading(false);
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [publicSearchOpen, publicSearchQuery]);

  async function handleAnalyzePublicRepository(repository: GitHubRepository) {
    setPublicSearchOpen(false);
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
          {githubStatus.connected ? (
            <section className="github-repo-panel" aria-label="Connected GitHub repositories">
              <div className="github-repo-panel__header">
                <span>GitHub: <strong>@{githubStatus.user?.login}</strong></span>
                <button type="button" onClick={handleLogoutGitHub}>Disconnect</button>
              </div>
              <div className="github-repo-panel__selector">
                <input
                  className="github-repo-panel__search"
                  value={githubQuery}
                  onChange={(event) => setGithubQuery(event.target.value)}
                  placeholder="Search connected repos"
                  aria-label="Search connected GitHub repositories"
                />
                <div className="atlas-select">
                  <select
                    aria-label="Connected repository selector"
                    value={selectedGitHubRepoUrl}
                    onChange={(event) => setSelectedGitHubRepoUrl(event.target.value)}
                    disabled={githubLoading || githubRepos.length === 0}
                  >
                    {githubRepos.map((repository) => (
                      <option key={repository.id} value={repository.htmlUrl}>
                        {repository.fullName} {repository.private ? "(Private)" : "(Public)"}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true" className="atlas-select__chevron" />
                </div>
                <button
                  type="button"
                  disabled={isAnalyzing || !selectedGitHubRepoUrl}
                  onClick={() => void handleGitHubSelectorAnalyze()}
                >
                  Analyze Selected
                </button>
              </div>
              {githubLoading ? <span className="github-repo-panel__empty">Loading repositories</span> : null}
              {!githubLoading && githubRepos.length === 0 ? (
                <span className="github-repo-panel__empty">No repositories found</span>
              ) : null}
              {githubError ? <p className="github-repo-panel__error">{githubError}</p> : null}
            </section>
          ) : (
            <div className="github-connect-strip">
              <button type="button" onClick={handleConnectGitHub}>
                Connect GitHub
              </button>
              <span>
                {githubStatus.configured
                  ? "Select connected repositories without leaving Code Atlas."
                  : "Set GitHub OAuth env vars to enable connected repositories."}
              </span>
            </div>
          )}

          <div className="analyze-form is-secondary">
            <button
              type="button"
              className="public-search-trigger"
              onClick={() => setPublicSearchOpen(true)}
              disabled={isAnalyzing}
            >
              Search Public Repos
            </button>
            {isAnalyzing ? (
              <div className="analyze-progress-chip" aria-live="polite">
                <span>Analyzing</span>
                <strong>{formatDuration(analyzeElapsedMs)}</strong>
              </div>
            ) : null}
            {!isAnalyzing && lastAnalyzeTiming ? (
              <div className="analyze-progress-chip is-timing" aria-live="polite">
                <span>Clone {formatDuration(lastAnalyzeTiming.cloneMs)}</span>
                <span>Graph {formatDuration(lastAnalyzeTiming.extractGraphMs)}</span>
                <span>History {formatDuration(lastAnalyzeTiming.extractHistoryMs)}</span>
                <strong>Total {formatDuration(lastAnalyzeTiming.totalMs)}</strong>
              </div>
            ) : null}
            <form className="analyze-form analyze-form--inline" onSubmit={handleSubmit}>
              <input
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/owner/repo"
                aria-label="GitHub repository URL"
              />
              <button type="submit" disabled={isAnalyzing || repoUrl.trim().length === 0}>
                {isAnalyzing ? "Analyzing" : "Analyze URL"}
              </button>
            </form>
          </div>
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
        onConnectGitHub={handleConnectGitHub}
      />
      {publicSearchOpen ? (
        <div className="public-search-modal" role="dialog" aria-modal="true" aria-label="Search public GitHub repositories">
          <div className="public-search-modal__backdrop" onClick={() => setPublicSearchOpen(false)} />
          <div className="public-search-modal__panel">
            <header className="public-search-modal__header">
              <h2>Search Public GitHub Repositories</h2>
              <button type="button" onClick={() => setPublicSearchOpen(false)} aria-label="Close public repository search">
                Close
              </button>
            </header>
            <input
              value={publicSearchQuery}
              onChange={(event) => setPublicSearchQuery(event.target.value)}
              placeholder="e.g. react flow graph"
              aria-label="Search public GitHub repositories"
              autoFocus
            />
            <div className="public-search-modal__results">
              {publicSearchQuery.trim().length < 2 ? <p>Type at least 2 characters.</p> : null}
              {publicSearchLoading ? <p>Searching repositories...</p> : null}
              {!publicSearchLoading && publicSearchQuery.trim().length >= 2 && publicSearchResults.length === 0 ? (
                <p>No repositories found.</p>
              ) : null}
              {publicSearchResults.map((repository) => (
                <button
                  key={repository.id}
                  type="button"
                  onClick={() => void handleAnalyzePublicRepository(repository)}
                  disabled={isAnalyzing}
                >
                  <strong>{repository.fullName}</strong>
                  <span>{repository.description ?? "No description."}</span>
                  <div className="public-search-modal__repo-meta">
                    <span className="public-search-modal__estimate">
                      Est. Analyze {formatDuration(estimateAnalyzeDuration(repository))}
                    </span>
                    <span>{repository.language ?? "Unknown language"}</span>
                    <span>★ {repository.stargazersCount ?? 0}</span>
                    <span>Updated {compactUpdatedAt(repository.updatedAt)}</span>
                  </div>
                  {(repository.topics?.length ?? 0) > 0 ? (
                    <div className="public-search-modal__repo-topics">
                      {repository.topics?.slice(0, 4).map((topic) => (
                        <span key={topic}>{topic}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
              ))}
              {publicSearchError ? <p className="public-search-modal__error">{publicSearchError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

