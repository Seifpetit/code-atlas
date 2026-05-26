# Code Atlas

Code Atlas is a deterministic prototype for visualizing a GitHub repository as a spatial architecture graph.

It has three stages:

1. Repo Fetch: clone a public GitHub repository into a temporary backend folder.
2. Structure Extraction: read folders, source files, and relative import/export relationships.
3. Graph Rendering: render the result in React Flow.

This prototype intentionally does not use LLMs, embeddings, agents, summaries, or semantic interpretation.

## Run Locally

Install dependencies:

```bash
cd backend
npm install

cd ../frontend
npm install
```

Start the backend:

```bash
cd backend
npm run dev
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open the Vite URL and paste a public GitHub repository URL such as:

```text
https://github.com/vitejs/vite
```

## Deploy On Railway

The repository is prepared for a single Railway service.

Deployment shape:

- Railway builds from the root `Dockerfile`.
- The Docker image builds both `frontend/` and `backend/`.
- Express serves the built frontend from `frontend/dist`.
- API requests use the same origin in production, so no separate `VITE_API_BASE_URL` is required.
- `git` is installed in the runtime image because repo analysis clones public repositories at request time.

Railway setup:

1. Create a new Railway project from this GitHub repository.
2. Deploy from the repository root.
3. Let Railway use the root `Dockerfile`.
4. Generate a public domain for the service.
5. Open the generated domain and submit a public GitHub repository URL.

Useful endpoints:

- `GET /health`
- `POST /analyze`

Local production build:

```bash
npm --prefix frontend run build
npm --prefix backend run build
npm --prefix backend start
```

## Production Workflow

Use the archive workflow whenever a change affects product intent, UI language, decisions, or known bugs.

Read root `CONTEXT.md` first when resuming meaningful work. It is a derived current
summary; the existing archive and session-note files remain authoritative.

Archive checklist:

- Update `docs/VOCABULARY.md` when a recurring concept, component, interaction, or technical term is introduced or renamed.
- Update `docs/DECISIONS.md` when a product, UX, or architecture direction is accepted, reversed, or deprecated.
- Update `docs/BUGS.md` when a bug is found, fixed, removed, deferred, or causes a feature to be disabled.
- Use `docs/WORKFLOW.md` for the full production loop.
- Use `docs/ai-prompts/archive-pass.md` as the prompt command for an end-of-session archive pass.
- Use the skill specs in `docs/ai-skills/` to keep archive updates consistent.

Quick command:

```text
Run an archive pass using docs/ai-prompts/archive-pass.md.
```

Close-session command:

```text
Close the session using docs/ai-prompts/close-session.md.
```

Close session updates `docs/SESSION_NOTES.md` and refreshes the explicit current
handoff in `CONTEXT.md` for the next session.

Local close-session check:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/close-session-check.ps1 -VerificationCommand "npm.cmd run build"
```

## API

`POST /analyze`

```json
{
  "repoUrl": "https://github.com/owner/repo"
}
```

Returns:

```json
{
  "nodes": [
    {
      "id": "src/components/Button.tsx",
      "type": "file",
      "label": "Button.tsx",
      "path": "src/components/Button.tsx",
      "parent": "src/components",
      "metadata": {
        "extension": ".tsx",
        "importCount": 2,
        "linesOfCode": 86,
        "functionCount": 3
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "src/App.tsx",
      "target": "src/components/Button.tsx",
      "type": "import"
    }
  ]
}
```

File metadata is extracted deterministically: all visible files carry
`linesOfCode`, while JS/TS-family files also carry `functionCount`. Files classified as low-signal
may additionally return `compressionLevel: "low-signal"` and explicit
`compressionReasons`; the UI renders them more quietly without removing them.

`POST /diff`

Backend-only retained endpoint for comparing two commits from the most recently analyzed repository.
The explicit compare UI is currently disabled while the product focuses on continuity-preserving structural descent.

```json
{
  "baseCommit": "abc123...",
  "targetCommit": "def456..."
}
```

Returns:

```json
{
  "baseCommit": "abc123...",
  "targetCommit": "def456...",
  "changedFiles": [
    {
      "path": "src/App.tsx",
      "status": "modified",
      "additions": 12,
      "deletions": 4
    }
  ]
}
```
