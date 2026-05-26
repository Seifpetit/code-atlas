# Code Atlas

**A spatial interface for navigating software architecture — no AI, no magic, just structure.**

→ Live: [code-atlas.up.railway.app](https://code-atlas.up.railway.app) *(paste any public GitHub URL — no login required)*
→ Stack: Node.js · Express · React · React Flow · TypeScript · Docker · Railway

---

![Code Atlas Demo](docs/demo.gif)

---

## What it does

Paste a GitHub repository URL. Code Atlas clones it, extracts its folder and file topology, resolves import relationships between source files, and renders the result as an interactive spatial graph you can navigate layer by layer.

The goal is to make a codebase feel like a place you can walk through, not a file tree you have to mentally assemble.

---

## Screenshots

| Root view — domains and root-level files | Click focus — details panel and relation lens |
|---|---|
| ![Root view](screenshots/root.png) | ![Focus state](screenshots/focus.png) |

| Architectural time — commit-aware highlights | Descent — continuity-preserving structural navigation |
|---|---|
| ![Timeline](screenshots/timeline.png) | ![Descent](screenshots/descent.png) |

---

## Technical decisions worth reading

**No LLMs, no embeddings.** The graph is deterministic. Every node and edge comes from the file system and static import analysis. This was a deliberate product constraint: the prototype had to be explainable and reproducible, not probabilistic.

**Progressive focus view instead of infinite zoom.** The entire repository is never rendered at once. Double-clicking a folder enters it as the current context. Only its direct children are visible. Ancestor contexts persist as non-interactive path anchor nodes in the canvas so spatial memory is preserved. This was the most important navigation decision — it keeps the graph readable at any scale.

**History as a lightweight overlay.** Git commit history decorates the structural map rather than replacing it. Hovering a commit previews which files it touched. Selecting one persists the highlights. The structural canvas stays calm; history adds context without becoming a dashboard.

**Relation apparitions, not permanent wiring.** Import edges are hidden by default — not because they're hard to compute, but because permanent wiring is visual noise that competes with navigation. Most graph tools render every dependency on screen and call it powerful. The opposite call was made here: relationships appear only when an object is selected, only for that object's immediate neighborhood, and disappear when focus moves. The canvas stays readable at any repo size because the default state has no edges at all.

**Focus-and-fade selection model.** Clicking any object dims unrelated nodes and surfaces a details panel with path, children count, import counts, and visible neighbors. Switching focus is immediate. The interaction model treats the graph as a navigable space, not a diagram.

---

## Architecture

```
code-atlas/
├── backend/          Express API — repo cloning, file graph extraction, git history
│   ├── src/
│   │   ├── routes/   POST /analyze, POST /diff, GET /health
│   │   ├── graph/    AST import parsing (ts-morph), structural extraction
│   │   └── git/      git log, git diff, file history metadata
├── frontend/         React + React Flow
│   ├── src/
│   │   ├── graph/    layout engine, context projection, edge routing
│   │   ├── nodes/    domain, folder, file, path-anchor custom node types
│   │   ├── panels/   timeline, details, structural context, breadcrumb
│   │   └── state/    structural state machine — currentContextId, focusedNodeId, breadcrumbPath
└── Dockerfile        Single-image build — frontend dist served by Express
```

The backend separates **structural visibility** from **import parsing**. `.md`, `.json`, `.yml`, `.css` files appear in the graph as structural objects but are not scanned for dependency edges. Only JS/TS source files contribute import relationships. This keeps topology exploration honest: you can navigate any folder, not just the source graph.

---

## What I'd highlight to an engineering team

- **Graph layout engine** written from scratch. React Flow handles rendering; the layout logic — context projection, path anchor placement, collision avoidance, paging — is custom TypeScript that runs before anything hits the canvas.
- **Architectural time slider.** The timeline drives a date-filtered view of the repository. Commits are bucketed, files are highlighted, and the whole thing updates without re-fetching the repo.
- **Single Docker image deployment.** The Dockerfile builds the frontend, compiles the backend, and serves everything from one Express process. Railway picks it up with zero config beyond a health check.
- **Stateless analysis per request.** Each `/analyze` call clones the repo fresh into a temp directory, extracts the graph, and discards the clone. No database, no persistence layer.

---

## Run it locally

```bash
git clone https://github.com/Seifpetit/code-atlas
cd code-atlas

cd backend && npm install
cd ../frontend && npm install

# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Then open the Vite URL and paste any public GitHub repository.

---

## What's next

- **Functional clustering profile** — grouping files by role (hooks, utils, services) rather than folder containment.
- **Stable hover interactions** — hover-driven relationship apparitions are currently deferred due to a React Flow pointer event conflict. The interaction design is ready; the implementation is being rethought.
- **Cross-context relationship tracing** — following an import edge into a sibling domain without losing the current navigation position.
