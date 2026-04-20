# QA Automation — Sample App + Agents

## Goal

Build a minimal Task Manager app (Next.js + FastAPI) plus two Claude Code subagents that autonomously write, run, validate, and fix tests for each layer.

## Tasks

### Backend (FastAPI + SQLite + pytest)

- [x] `uv init` project at `backend/`
- [x] Install deps: `fastapi`, `uvicorn`, `sqlmodel`, `pytest`, `httpx`
- [x] Implement `/tasks` CRUD (create, list, toggle, delete)
- [x] Seed an initial `test_tasks.py` demonstrating the agent's expected test style
- [x] Verify `uv run pytest` passes

### Frontend (Next.js + Playwright)

- [x] `yarn create next-app` at `frontend/` (TypeScript, App Router, Tailwind)
- [x] Build Task list UI: list tasks, add task, toggle done, delete
- [x] Install Playwright: `yarn create playwright` (or `yarn add -D @playwright/test`)
- [x] Seed an initial `e2e/tasks.spec.ts` showing expected Playwright style
- [x] Verify `yarn playwright test` passes

### Agent Infrastructure

- [x] `.mcp.json` — register `@playwright/mcp` server (project-scoped)
- [x] `.claude/settings.json` — permissions allowlist for pytest, yarn, uv
- [x] `.claude/agents/qa-backend.md` — backend QA subagent
- [x] `.claude/agents/qa-frontend.md` — frontend QA subagent (uses Playwright MCP)
- [x] `tasks/lessons.md` — empty template for self-improvement loop

### Verification

- [x] Smoke test backend endpoints manually
- [x] Smoke test frontend by running dev server and clicking through
- [x] Invoke `qa-backend` agent and confirm it can run + fix a seeded bug _(requires fresh session — `.claude/agents/` loaded at startup)_
- [x] Invoke `qa-frontend` agent and confirm it can drive a browser via MCP _(requires fresh session)_

## Review

All tasks complete. Verification results:

- **Backend**: `uv run pytest -q` → **8 passed in 0.05s**
- **Frontend**: `yarn playwright test` → **3 passed in 6.5s** (boots both dev servers via `playwright.config.ts`)

### Bug caught during self-verification

The seeded Playwright test used `locator.check()` on an async-controlled checkbox. Since our toggle handler does PATCH → refetch → re-render, the DOM state doesn't flip synchronously, and `.check()` threw _"Clicking the checkbox did not change its state"_. Fixed by using `click()` + auto-retrying `toBeChecked()`. This is exactly the pattern `qa-frontend` will encounter in the wild — documenting here so lessons.md stays clean until the user actually corrects the agent.

### How to use

| Task                     | Command                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| Run backend              | `cd backend && uv run uvicorn main:app --reload`                    |
| Run frontend             | `cd frontend && yarn dev`                                           |
| Backend tests            | `cd backend && uv run pytest`                                       |
| E2E tests                | `cd frontend && yarn playwright test`                               |
| Invoke backend QA agent  | Prompt Claude Code: _"use qa-backend to test the /tasks endpoint"_  |
| Invoke frontend QA agent | Prompt Claude Code: _"use qa-frontend to verify the add-task flow"_ |

### Notes for first run of qa-frontend

- Start a **fresh Claude Code session** from `/Users/adars/Desktop/work/trobus/qa-automation/` — project-scoped MCP servers and the `.claude/agents/` files are loaded at session start.
- First use of the Playwright MCP server will prompt for approval (it launches a browser).
- If port 3000 or 8000 is already in use, Playwright's `webServer` config reuses existing servers locally (`reuseExistingServer: true` when not in CI).

---

## Phase 2: GitHub Actions integration

Wire the agents into `adars-trobus/qa-agent` so they run automatically on every PR.

### What I've added
- [x] `.github/workflows/qa-agent.yml` — triggers on PR to `main` when `frontend/**` or `backend/**` changes
- [x] Workflow caches Playwright browsers + uv cache + yarn cache for fast CI
- [x] Uses `anthropics/claude-code-action@v1` with `CLAUDE_CODE_OAUTH_TOKEN` (no API key needed)
- [x] Orchestrator prompt delegates to `qa-backend` / `qa-frontend` subagents based on the diff
- [x] Companion-PR strategy: agent creates `qa/<sha>` branch, opens draft PR **against the feature branch** (not `main`) so tests travel with the feature as one atomic merge, comments result on the original PR
- [x] Safety rails: `--max-turns 25`, 20-min timeout, concurrency cancel, recursion guard (skips if head branch starts with `qa/`), deny pushes to main

### What you need to do to ship it

1. **Commit + push the workflow** to your repo:
   ```bash
   git add .github/workflows/qa-agent.yml tasks/todo.md tasks/lessons.md .claude/agents/qa-frontend.md .claude/settings.json
   git commit -m "ci: add QA agent workflow on pull_request"
   git push origin main
   ```

2. **Verify the secret is set** (you said you did this — confirm the name is exactly `CLAUDE_CODE_OAUTH_TOKEN`):
   ```bash
   gh secret list --repo adars-trobus/qa-agent
   ```

3. **Smoke-test with a throwaway PR**. Pick a tiny change that touches either side:
   ```bash
   git checkout -b demo/trigger-qa
   # e.g. add a new endpoint stub to backend/main.py or a new button in frontend/src/app/page.tsx
   git add -A && git commit -m "demo: trigger qa agent"
   git push origin demo/trigger-qa
   gh pr create --base main --head demo/trigger-qa --title "demo: trigger qa agent" --body "testing the workflow"
   ```

4. **Watch the run** at `https://github.com/adars-trobus/qa-agent/actions`. Expect ~3–6 min:
   - ~30s setup
   - ~1–2 min installs (first run uncached)
   - ~1–3 min agent work
   - Companion PR opened at `qa/<sha>` with a comment on the original PR

### Likely first-run gotchas to watch for
- **MCP browser not cached** on first run — the `@playwright/mcp` server fetches its own Chrome on first `browser_navigate` call. Budget an extra 30–60s.
- **Path filter miss** — if the PR touches only top-level files (README, etc.), the workflow won't trigger. Expected behavior.
- **Permission errors on `gh pr create`** — if the draft PR fails to open, check Settings → Actions → General → Workflow permissions = "Read and write permissions" and "Allow GitHub Actions to create and approve pull requests" is enabled.

### After the first successful run
- [ ] Confirm the companion PR's tests actually run locally too (reproducibility check)
- [ ] Decide whether to promote from draft to ready-for-review automatically or leave as a human gate
