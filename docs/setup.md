# Setup walk-through

This document captures every step followed to build the QA + Jira + Confluence automation pipeline in this repo, in order. Use it to reproduce the setup on a fresh repo / Atlassian site, or to onboard someone who has to maintain it.

> Assumes: macOS dev machine, zsh, Node 20+, Python 3.13+, `uv`, `yarn`, `gh` CLI, and a Claude Code subscription (Pro / Max / Team). No Anthropic API key required.

---

## Phase 0 — Repo scaffold

Goal: a small but realistic full-stack app so the QA agents have something concrete to reason about.

1. **Working directory**
   ```bash
   mkdir -p /Users/<you>/Desktop/work/<org>/qa-automation
   cd !$
   ```

2. **FastAPI backend** (Task Manager API)
   ```bash
   uv init backend --app
   rm -rf backend/.git                       # uv init creates a nested repo; remove it
   cd backend
   uv add fastapi "uvicorn[standard]" sqlmodel
   uv add --dev pytest httpx
   ```
   Implemented `backend/main.py` with `/tasks` CRUD + `/tasks/stats` + `/tasks/{task_id}` using `SQLModel`. Seed tests in `backend/test_tasks.py` using a `TestClient` fixture in `conftest.py` backed by an in-memory SQLite engine (`StaticPool`) — so the real DB file is never touched in tests.

3. **Next.js frontend** (Tailwind, App Router, TypeScript)
   ```bash
   npx --yes create-next-app@latest frontend \
     --typescript --tailwind --app --src-dir --no-import-alias \
     --use-yarn --no-turbopack --no-eslint --yes
   rm -rf frontend/.git
   cd frontend
   yarn add -D @playwright/test
   yarn playwright install chromium            # runner-side Chrome, cached at ~/Library/Caches/ms-playwright
   ```
   Rewrote `src/app/page.tsx` as a client component talking to the FastAPI backend via `NEXT_PUBLIC_API_URL` (set in `.env.local` → `http://localhost:8000`). Added stable `data-testid` attributes on every interactive element so Playwright selectors stay semantic.

4. **Playwright config** (`frontend/playwright.config.ts`)
   - `testDir: ./e2e`
   - `webServer:` boots **both** `yarn dev` and the backend (`cd ../backend && uv run uvicorn main:app --port 8000`) so `yarn playwright test` is a one-command full-stack run
   - `reuseExistingServer: !process.env.CI` so local dev servers aren't killed
   - `trace: retain-on-failure`, `screenshot: only-on-failure`

5. **Seed e2e spec** (`frontend/e2e/tasks.spec.ts`) — `beforeEach` nukes all tasks via backend DELETEs to keep tests independent.

6. **`.gitignore`** additions: `backend/tasks.db`, `backend/.pytest_cache/`, `frontend/playwright-report/`, `frontend/test-results/`, `frontend/playwright/.cache/`.

---

## Phase 1 — QA agent definitions

Goal: two subagents that can autonomously write, run, validate, and fix tests.

1. **`CLAUDE.md`** at repo root — project-wide instructions (plan mode default, subagent strategy, self-improvement loop, verification gate, elegance demand, autonomous bug fixing, task management format).

2. **`.claude/agents/qa-backend.md`** — pytest-first agent. Tools: `Read, Write, Edit, Glob, Grep, Bash`. Key rules:
   - One endpoint → one logical test function, happy path + ≥ 1 error case
   - Uses the `client` fixture from `conftest.py` — never touches `tasks.db` directly
   - If it fixes a bug, adds a regression test that fails before the fix and passes after

3. **`.claude/agents/qa-frontend.md`** — Playwright + Playwright MCP. Tools: above + `mcp__playwright__browser_*`. Key rules:
   - Starts stack, uses `browser_snapshot` (accessibility tree — cheaper than screenshots), and only *then* codifies the interaction as a spec
   - Semantic selectors preferred: `getByRole > getByLabel > getByTestId`
   - Cleans state between tests via `beforeEach` hitting backend DELETE
   - "Browser management — READ THIS FIRST" preamble: explains the two independent browser installs (`chromium-*` for `yarn playwright test` vs `mcp-chrome-*` for the MCP server) so the agent doesn't reinstall the wrong one when it hits "executable not found"

4. **`.mcp.json`** at repo root — registers the Playwright MCP server:
   ```json
   {
     "mcpServers": {
       "playwright": {
         "command": "npx",
         "args": ["-y", "@playwright/mcp@latest"]
       }
     }
   }
   ```

5. **`.claude/settings.json`** — scoped permissions allowlist (`Bash(uv:*)`, `Bash(yarn:*)`, `Bash(npx playwright:*)`, etc.) and a small deny list (`Bash(rm -rf *)`, `Bash(git push:*)`).

6. **`tasks/lessons.md`** — self-improvement log. Seeded with a note about the Playwright dual-browser gotcha after the first real user correction.

---

## Phase 2 — Claude Code auth for CI

Goal: run Claude Code in GitHub Actions without an Anthropic API key, using only a Claude subscription.

1. **Generate a long-lived OAuth token** (locally, once):
   ```bash
   claude setup-token
   ```
   Output is a 1-year token scoped to inference-only. Requires Pro / Max / Team / Enterprise plan.

2. **Paste it into GitHub secrets** as `CLAUDE_CODE_OAUTH_TOKEN`:
   - Repo → Settings → Secrets and variables → Actions → New repository secret
   - **Gotcha hit during setup**: if your terminal adds a trailing newline, the token becomes invalid when the SDK puts it into an `Authorization` header. Symptom: `API Error: Header '14' has invalid value: '***'` in Actions logs. Fix: re-paste without the trailing newline, or pipe with `printf '%s' '<token>' | gh secret set …`.

3. **Install the official Claude Code GitHub App** on the repo:
   - https://github.com/apps/claude → **Install** → scope to the target repo (or "All repositories")
   - Required — without it, `anthropics/claude-code-action@v1` fails with *"Claude Code is not installed on this repository"*

4. **Workflow permissions on the repo**:
   - Settings → Actions → General → Workflow permissions → **Read and write permissions**
   - Tick **"Allow GitHub Actions to create and approve pull requests"**
   - Without these, `gh pr create` from the agent 403s.

---

## Phase 3 — QA agent GitHub Action

Goal: every PR that touches `backend/` or `frontend/` gets autonomous test coverage.

File: `.github/workflows/qa-agent.yml`

Key pieces:

- **Trigger**: `pull_request` on `main` with `paths: frontend/** backend/** .claude/** .mcp.json .github/workflows/qa-agent.yml`
- **Recursion guard**: `if: ${{ !startsWith(github.head_ref, 'qa/') }}` — prevents agent-opened companion PRs (`qa/<sha>`) from retriggering the workflow
- **Concurrency**: `cancel-in-progress` scoped per-PR so pushing new commits cancels older runs
- **Permissions**: `contents: write`, `pull-requests: write`, `id-token: write`
- **Timeout**: 20 min; agent max-turns: 25
- **Setup steps**: `actions/setup-node@v4` (Node 20, yarn cache), `astral-sh/setup-uv@v5` (uv cache), `actions/cache@v4` keyed on `yarn.lock` for `~/.cache/ms-playwright`, plus `yarn playwright install-deps chromium` on cache hit (APT packages aren't in the browser cache dir)
- **Agent step**: `anthropics/claude-code-action@v1` with:
  - `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
  - `claude_args: --max-turns 25 --mcp-config .mcp.json --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Task,mcp__playwright__*"`
  - Orchestrator prompt that runs `git diff`, classifies changes, delegates to `qa-backend` / `qa-frontend` via the Task tool, and opens a companion PR targeting the **feature branch** (not `main`) so tests ride the feature as one atomic merge

**Gotchas hit during setup**:
- `id-token: write` permission is required even when using OAuth (the action fetches OIDC for internal handshake)
- Workflow file content on the PR branch must match `main` exactly — for PRs that modify the workflow itself, you have to land the workflow to `main` first, then PR from a branch based on that
- First-run Playwright MCP browser fetch (`mcp-chrome-*`) adds ~30–60s

---

## Phase 4 — Jira setup

Goal: BAs can trigger automatic triage from Jira Epics.

### 4.1 Atlassian account & site

- New (or existing) free Jira Cloud site. For this POC: `https://trobustech.atlassian.net`
- Create project **`QAT`** ("QA Agent Automation"), team-managed, Kanban template
- Verify all three issue types are present: `Epic`, `Task`, `Subtask`

### 4.2 API token

- https://id.atlassian.com/manage-profile/security/api-tokens → **Create API token** → name it `qa-test`
- Treat the token as a password — never paste it in chat, screenshots, or logs
- The same token works for **both Jira and Confluence** on the same site — no need to generate a second one for Confluence

### 4.3 Three GitHub secrets for Jira

| Name | Value |
| --- | --- |
| `JIRA_BASE_URL` | `https://trobustech.atlassian.net` |
| `JIRA_USER_EMAIL` | your Atlassian email (used as HTTP Basic Auth username) |
| `JIRA_API_TOKEN` | the token above |

### 4.4 Jira MCP config

File: `.claude/mcp-jira.json`

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "uvx",
      "args": ["mcp-atlassian"]
    }
  }
}
```

The MCP server (`sooperset/mcp-atlassian`) reads `JIRA_URL`, `JIRA_USERNAME`, `JIRA_API_TOKEN` (and `CONFLUENCE_*` equivalents) from the parent process env. `uvx` ephemerally installs the Python package on first use (~10–20s cold; then cached by `astral-sh/setup-uv`).

### 4.5 Jira workflow

File: `.github/workflows/jira-agent.yml` — triggers on `repository_dispatch` events. Four dispatch types, four jobs (all conditional on `github.event.action`):

| Event type | Job | What it does |
| --- | --- | --- |
| `jira-epic-created` | `triage` | Reads epic, posts proposal comment (no writes) |
| `jira-epic-approved` | `create-subtasks` | Finds the latest proposal (v1 / v2 / v3…), parses it, creates Jira Subtasks as children of the Epic |
| `jira-epic-refine` | `refine-proposal` | Reads BA's `refine: <instructions>`, rewrites the proposal, posts a v`N+1` version |
| `confluence-page-triaged` | `confluence-triage` | Fetches Confluence page, creates Epic with `[Confluence-sourced]` marker, triages, back-links the page |

All four reuse the same permissions + Atlassian MCP config. Each is bounded by `timeout-minutes` and `--max-turns`.

### 4.6 Three Jira Automation rules

Path in Jira: QAT space → Space settings → Automation → Create rule → Create from scratch.

Each rule ends in a **Send web request** action to `https://api.github.com/repos/<org>/<repo>/dispatches`, with headers:

- `Authorization: Bearer <github_pat>` (the PAT needs `contents: write` on the target repo) — mark **Hidden**
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- `Content-Type: application/json`

Bodies (Custom data):

**Rule A — Epic created → QA Agent triage**
- Trigger: `Work item created`
- Conditions (both must pass):
  - `Work type` / `equals` / `Epic`
  - **Advanced compare**: `{{issue.description}}` / `does not contain` / `[Confluence-sourced]` *(this skips Epics that the agent itself created via the Confluence path — prevents double triage)*
- Body:
  ```json
  {
    "event_type": "jira-epic-created",
    "client_payload": {
      "issue_key": "{{issue.key}}",
      "issue_summary": "{{issue.summary}}"
    }
  }
  ```

**Rule B — Approve comment → QA Agent create sub-tasks**
- Trigger: `Work item commented`
- Conditions:
  - `Work type` / `equals` / `Epic`
  - **Advanced compare**: `{{comment.body}}` / `equals` / `approve` *(exact match avoids firing on the proposal comment itself, which contains the word "approve" in its instructions)*
- Body:
  ```json
  {
    "event_type": "jira-epic-approved",
    "client_payload": {
      "issue_key": "{{issue.key}}",
      "comment_author": "{{comment.author.emailAddress}}"
    }
  }
  ```

**Rule C — Refine comment → QA Agent re-propose**
- Trigger: `Work item commented`
- Conditions:
  - `Work type` / `equals` / `Epic`
  - **Advanced compare**: `{{comment.body}}` / `starts with` / `refine:`
- Body:
  ```json
  {
    "event_type": "jira-epic-refine",
    "client_payload": {
      "issue_key": "{{issue.key}}",
      "comment_body": "{{comment.body}}",
      "comment_author": "{{comment.author.emailAddress}}"
    }
  }
  ```

All three: ✅ tick **"Delay execution of subsequent rule actions until we've received a response for this web request"** — surfaces failures in the audit log instead of swallowing them.

---

## Phase 5 — Confluence setup

Goal: BAs can write requirements in Confluence and get Epics + proposals created automatically (Option B).

### 5.1 Confluence space

Space: **`QAA`** ("QA Agent Automation") — auto-created alongside the Jira project in Atlassian Cloud. If absent, create a global (not personal) space.

### 5.2 One new GitHub secret

| Name | Value |
| --- | --- |
| `CONFLUENCE_BASE_URL` | `https://trobustech.atlassian.net/wiki` |

The existing `JIRA_USER_EMAIL` and `JIRA_API_TOKEN` secrets are reused as Confluence credentials — same site = same auth.

### 5.3 Confluence Automation rule

Path: Confluence → QAA space → Space settings → Automation → Create rule → Create from scratch.

**Trigger**: `Label added to page` with label filter `needs-triage`

**Action**: `Send web request` — same URL + headers as Jira rules. Body:
```json
{
  "event_type": "confluence-page-triaged",
  "client_payload": {
    "page_id": "{{page.id}}",
    "page_title": "{{page.title}}",
    "page_url": "{{page.url}}",
    "space_key": "{{space.key}}"
  }
}
```

Tick the delay-execution checkbox. Name it `Confluence label → QA Agent triage` and turn it on.

---

## Phase 6 — Validation / smoke tests

### QA agent path
1. Create a feature branch, touch `backend/main.py` (add a stub endpoint without tests)
2. Open a PR to `main`
3. Within ~5 min, a companion `qa/<sha>` PR opens against the feature branch with tests added

### Jira → GitHub direct path
1. Create an Epic in QAT with a real description
2. Audit log shows Rule A firing, status SUCCESS / 204
3. GitHub Actions → "Jira Agent" run (triage job)
4. Proposal comment appears on the Epic within ~2 min
5. Comment `approve` on the Epic → Rule B fires → `create-subtasks` job → 3 Sub-tasks created

### Refine path
1. On an Epic with a v1 proposal, comment `refine: drop Data Schema Review; add perf testing sub-task`
2. Rule C fires → `refine-proposal` job → proposal v2 appears

### Confluence path
1. In space QAA, publish a page with a real requirement + acceptance criteria
2. Add label `needs-triage`
3. Confluence audit log shows rule firing
4. Actions → `confluence-triage` job runs
5. A new Epic appears in QAT with `[Confluence-sourced]` marker, a `🤖 QA Agent proposal` comment, and a back-link comment on the Confluence page
6. Rule A does NOT fire on this agent-created Epic (skipped by the `does not contain` condition)

---

## Environment / secrets reference

### GitHub repository secrets
| Secret | Purpose |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude inference, subscription-based (no API key) |
| `JIRA_BASE_URL` | `https://<site>.atlassian.net` |
| `JIRA_USER_EMAIL` | Atlassian account email |
| `JIRA_API_TOKEN` | Atlassian API token (works for Jira + Confluence) |
| `CONFLUENCE_BASE_URL` | `https://<site>.atlassian.net/wiki` |

### Tokens stored elsewhere (NOT GitHub secrets)
- **GitHub PAT** used by Jira / Confluence automation rules → pasted into the `Authorization: Bearer …` header of each Send-web-request action. Needs `contents: write` on the target repo. Fine-grained PAT recommended; rotate regularly.

---

## Troubleshooting — issues hit during real setup

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `Could not fetch an OIDC token. Did you remember to add id-token: write?` | Workflow permissions missing `id-token: write` | Add to `permissions:` block |
| `Claude Code is not installed on this repository` | GitHub App not installed | Install at https://github.com/apps/claude |
| `Workflow validation failed. The workflow file must exist and have identical content to the default branch` | PR branch modifies the workflow file; App validates it against `main` | Land the workflow change on `main` first, then PR from a branch based on that |
| `API Error: Header '14' has invalid value: '***'` in Actions | `CLAUDE_CODE_OAUTH_TOKEN` value has embedded newline/whitespace | Re-paste cleanly: `printf '%s' '<token>' \| gh secret set CLAUDE_CODE_OAUTH_TOKEN` |
| Playwright `Executable doesn't exist at .../chromium-*/` | Runner browser missing | `cd frontend && yarn playwright install chromium` |
| Playwright MCP fails with "browser missing" but `yarn playwright test` works | Two independent browser installs — MCP uses `mcp-chrome-*`, runner uses `chromium-*` | Retry the MCP call; the server fetches on first use. See `.claude/agents/qa-frontend.md` > "Browser management" |
| Rule B auto-fires on the AI's proposal comment | Used `contains "approve"`; proposal text contains the word "approve" | Use `equals "approve"` (exact match) |
| Rule B doesn't fire when BA comments approve | BA included an `@mention` before `approve`; body is no longer exactly `approve` | Comment literally just `approve` — no mention, no punctuation |
| Duplicate triage when Confluence-sourced Epic is created | Rule A fires on every new Epic | Add `{{issue.description}} does not contain [Confluence-sourced]` condition to Rule A |
| Confluence rule fires but GitHub returns 401 | Wrong PAT format in Authorization header | Use `Bearer <token>` (not `token <token>` or `Basic …`) |

---

## Housekeeping reminders

- Rotate any token that was ever pasted in chat, email, tickets, or screenshots — **before** graduating the test site to production use.
- Close merged demo PRs and delete stale `demo/*` and `qa/*` branches periodically.
- Node 20 GitHub Actions runners are deprecated mid-2026. When warnings escalate to errors, bump `actions/setup-node@v4` → `@v5` and `astral-sh/setup-uv@v5` → `@v6` in both workflow files.
