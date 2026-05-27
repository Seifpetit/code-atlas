import { FormEvent, useState } from "react";
import { analyzeRepo, type AtlasGraph } from "./api";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("Cloning and extracting structure...");
    setIsAnalyzing(true);

    try {
      const result = await analyzeRepo(repoUrl);
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

      <GraphView graph={graph} searchTerm={searchTerm} clusteringMode={clusteringMode} />
    </main>
  );
}
