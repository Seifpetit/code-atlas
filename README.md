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

Archive checklist:

- Update `VOCABULARY.md` when a recurring concept, component, interaction, or technical term is introduced or renamed.
- Update `DECISIONS.md` when a product, UX, or architecture direction is accepted, reversed, or deprecated.
- Update `BUGS.md` when a bug is found, fixed, removed, deferred, or causes a feature to be disabled.
- Use `WORKFLOW.md` for the full production loop.
- Use `ai-prompts/archive-pass.md` as the prompt command for an end-of-session archive pass.
- Use the skill specs in `ai-skills/` to keep archive updates consistent.

Quick command:

```text
Run an archive pass using ai-prompts/archive-pass.md.
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
      "parent": "src/components"
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
