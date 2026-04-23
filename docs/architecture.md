# Architecture

High-level design of the QA + Jira + Confluence automation pipeline. Read this for "why does it look like this?"; read `setup.md` for "how do I build it?"

---

## Goals

1. **Requirement → delivery pipeline without manual orchestration**: a BA writes a requirement; an Epic + sub-tasks appear in Jira; PRs that implement the requirement come with tests automatically.
2. **Draft-with-approval everywhere a human matters**: AI never creates tickets or pushes code to `main` without a human gate.
3. **Work with what we already have**: Claude Code subscription, GitHub Actions, Atlassian Cloud. No new infra, no API keys, no bot accounts required for the POC.
4. **Extensible, not rigid**: each flow is independent — turning one off doesn't break the others.

---

## 10,000-ft view

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Confluence  │     │    Jira      │     │   GitHub     │
│    (QAA)     │     │    (QAT)     │     │   (qa-agent) │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  ────── BA writes requirements ──────▶  │
       │                    │                    │
       │                    │  ── BA opens PR ─▶ │
       │                    │                    │
       │                    ◀────────────────────┤
       │                         proposals,      │
       │                      companion test PRs │
       │                    │                    │
       └───── label ───▶ [Automation rules] ──▶ [GitHub Actions]
              "needs-triage"                          │
                                                      │
                                                 ┌────┴─────┐
                                                 │  Claude  │
                                                 │  Code    │
                                                 │ (headless)│
                                                 └────┬─────┘
                                                      │
                                                ┌─────┴─────┐
                                                │    MCP    │
                                                │ servers   │
                                                │           │
                                                │ atlassian │
                                                │ playwright│
                                                └───────────┘
```

Three "products" (Confluence, Jira, GitHub) exchange events via webhooks. Claude Code runs in GitHub Actions as the *only* compute that understands intent — everything else is dumb plumbing.

---

## Components

### 1. The sample app (`backend/` + `frontend/`)
A deliberately realistic Task Manager. FastAPI + SQLModel on the backend, Next.js 16 + Tailwind on the frontend, wired together via a simple HTTP API. Exists purely to give the QA agents something to test — it's the **artifact under test**, not the product.

### 2. QA agents (`.claude/agents/`)
Two subagent definitions Claude Code loads at session start:
- **`qa-backend`** — pytest-first. Writes test cases, runs `uv run pytest`, patches test or source until green.
- **`qa-frontend`** — Playwright + Playwright MCP. Validates intent live in a real browser before codifying as a spec, then runs `yarn playwright test`.

Both are invoked via the Task tool by the orchestrator prompt in the QA workflow. Clear separation: one agent per layer, so each has focused tooling and conventions.

### 3. QA Agent workflow (`.github/workflows/qa-agent.yml`)
Fires on `pull_request` to `main` with a path filter. Orchestrator prompt reads the PR diff, delegates to the right subagent, and opens a companion `qa/<sha>` PR **against the feature branch** so tests travel with the feature.

### 4. Jira Agent workflow (`.github/workflows/jira-agent.yml`)
Fires on `repository_dispatch`. Four event types, four jobs:

| Event type | Job | Inputs from Jira/Confluence | Work |
| --- | --- | --- | --- |
| `jira-epic-created` | `triage` | issue_key, issue_summary | Read epic → post `🤖 QA Agent proposal` |
| `jira-epic-approved` | `create-subtasks` | issue_key, comment_author | Find latest proposal → parse → create Subtasks |
| `jira-epic-refine` | `refine-proposal` | issue_key, comment_body | Read latest proposal + instructions → post v`N+1` |
| `confluence-page-triaged` | `confluence-triage` | page_id, page_title, page_url, space_key | Fetch page → create Epic → triage → back-link |

### 5. MCP servers
- **`@playwright/mcp`** (stdio) — driven by the QA frontend agent to navigate a real browser
- **`mcp-atlassian`** (`uvx`, stdio) — used by all Jira Agent jobs to read/write Jira + Confluence with a single API token

MCP is a structured tool interface over external systems. Simpler than raw `curl` in the agent prompt: handles ADF formatting for Jira comments, pagination for searches, and exposes clear tool names the agent can reason about.

### 6. Automation rules (in Atlassian, not code)
- **Jira Rule A** — "Epic created (and not Confluence-sourced) → trigger triage"
- **Jira Rule B** — "Comment equals `approve` → trigger sub-task creation"
- **Jira Rule C** — "Comment starts with `refine:` → trigger re-proposal"
- **Confluence Rule** — "Label `needs-triage` added → trigger Epic creation + triage"

All four use the same pattern: `Send web request` action → `repository_dispatch` on GitHub. The rules are the "event bus"; the workflow jobs are the consumers.

---

## Event flow diagrams

### Flow 1 — QA on a PR
```
Developer push ──▶ PR opened (frontend/** or backend/**)
                    │
                    ▼
          [GitHub Actions: qa-agent.yml]
                    │
                    ▼
       Orchestrator reads git diff
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      qa-backend          qa-frontend
      (pytest)            (Playwright + MCP browser)
          │                   │
          └─────────┬─────────┘
                    ▼
         git checkout qa/<sha> (off PR head)
         git commit + push
         gh pr create --base <feature-branch>
                    │
                    ▼
         Comment on original PR with companion URL
```

### Flow 2 — BA creates Jira Epic directly
```
BA creates Epic in QAT
        │
        ▼
[Jira Rule A] ── conditions pass? ── if desc contains [Confluence-sourced] → skip
        │ yes
        ▼
POST /repos/<org>/<repo>/dispatches {event_type:"jira-epic-created"}
        │
        ▼
[GitHub Actions: jira-agent.yml — triage job]
        │
        ▼
Claude reads Epic via Atlassian MCP
Claude posts 🤖 QA Agent proposal comment
        │
        ▼
BA comments `approve` or `refine: …` or discusses
        │
   ┌────┴────┐
   │         │
`approve`  `refine: …`
   │         │
   ▼         ▼
Rule B     Rule C
   │         │
   ▼         ▼
[create-subtasks]  [refine-proposal]
   │         │                 │
   ▼         ▼                 │
Subtasks   Proposal v2 ◀───────┘
created
```

### Flow 3 — BA writes Confluence page
```
BA publishes page in space QAA
        │
        ▼
BA adds label `needs-triage`
        │
        ▼
[Confluence Rule]
        │
        ▼
POST /dispatches {event_type:"confluence-page-triaged"}
        │
        ▼
[GitHub Actions: confluence-triage job]
        │
        ▼
Claude fetches page content via Atlassian MCP
        │
        ▼
Idempotency check:
  search Jira for Epic whose description contains
  "Confluence Page ID: <page_id>"
        │
    ┌───┴───┐
    │       │
  exists   none
    │       │
    ▼       ▼
comment + exit   Claude creates Epic in QAT with
                 `[Confluence-sourced]` marker
                 + Page ID + paraphrased requirements
                         │
                         ▼
              Standard triage flow (same prompt as flow 2):
              Claude posts 🤖 QA Agent proposal on new Epic
                         │
                         ▼
              Claude adds back-link comment on Confluence page
                         │
                         ▼
              [Rule A evaluates]: desc DOES contain marker → skip ✅
                         │
                         ▼
              Flow continues as Flow 2 (BA → approve/refine)
```

---

## Key design decisions

### D1 — Subscription OAuth, not API key
Claude Code's `claude setup-token` issues a 1-year token scoped to inference only. Works in CI, costs nothing beyond the subscription you already have, and keeps the same rate limits / billing surface as local use. Means no "who owns the Anthropic bill" conversation to have before shipping.

**Trade-off**: rate-limit exhaustion from CI blocks interactive use. Worth keeping an eye on in high-PR-volume repos.

### D2 — Companion PRs target the feature branch, not `main`
When `qa-agent` produces tests for a PR, it opens `qa/<sha>` → `<feature-branch>`, **not** `qa/<sha>` → `main`. Reason: tests must travel with the feature as one atomic merge. If tests were a separate PR to `main`, they could merge before (dangling tests for missing code) or after (code shipped without coverage) the feature.

**Trade-off**: reviewers see a mini-PR-within-a-PR. Acceptable — PR list stays clean.

### D3 — Draft-with-approval for Jira tickets, not auto-create
The triage job *only* posts a proposal comment. Nothing enters Jira as a real ticket until a human types `approve`. This is intentional: hallucinated Jira tickets are expensive to clean up and erode trust in the pipeline fast.

**Trade-off**: one more click in the BA's day. Worth it.

### D4 — `refine:` keyword instead of freeform approval changes
The alternative was letting BAs say `approve but drop X and add Y` in one comment. Rejected because it conflates "I'm happy" with "here are changes" — ambiguity risk. Two separate signals: `refine: …` (iterate) vs `approve` (commit). Same reason `approve` is an **exact match**, not a substring: the proposal comment itself contains the word "approve" in its instructions.

### D5 — `[Confluence-sourced]` marker as the skip mechanism
The Confluence-triage job creates an Epic in Jira. That creation fires Jira's Rule A. Without a guard, Rule A would triage the same Epic the agent just triaged. Options considered:
- Turn Rule A off entirely (rejected — removes the direct-Jira path)
- Use Jira issue labels (rejected — needs project config)
- Use a custom field (rejected — more setup, more fragile)
- **Marker string in description** (picked — zero config, visible to humans)

Marker is `[Confluence-sourced]` on the first line of the description. Rule A gets a condition: `{{issue.description}}` does not contain that string.

### D6 — Idempotency via `Confluence Page ID: <id>` search
Confluence labels can be removed and re-added. Without idempotency, each re-label creates a duplicate Epic. The `confluence-triage` job searches Jira for `"Confluence Page ID: <page_id>"` before creating; on a hit, it comments on the existing Epic and exits. Simple substring search via MCP — no custom fields needed.

### D7 — Personal account as the bot (POC only)
All AI-authored Jira/Confluence edits happen under the user's own Atlassian account, because the API token belongs to that user. Simple for POC; non-ideal for audit. Graduate to a dedicated "QA Agent" service account before productionizing — same token flow, different account.

### D8 — Recursion and path-filter hygiene
- `qa-agent.yml` recurses into itself unless: `if: ${{ !startsWith(github.head_ref, 'qa/') }}` blocks agent-opened companion PRs.
- `jira-agent.yml` uses `repository_dispatch`, which only fires on workflows that exist on the **default branch**. So new jobs must land on `main` before they can be triggered.
- Jira Rule B uses *exact* match on `approve` to not self-fire on the AI's own proposal comment (which contains the word "approve" in its instructions).

---

## Security model

### What's where
| Secret | Lives in | Used by | Rotation |
| --- | --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | GitHub repo secrets | `claude-code-action` | 1 year; regen via `claude setup-token` |
| `JIRA_*` + `CONFLUENCE_BASE_URL` | GitHub repo secrets | `mcp-atlassian` in CI | On any leak or when employee leaves |
| GitHub PAT | Jira / Confluence rule headers (Hidden) | `Send web request` action | 90 days, fine-grained, scoped to one repo |

### Blast radius
- **Claude OAuth token leak**: attacker can run Claude inference on your subscription. Limited to inference — cannot read your code or open PRs on its own.
- **Jira API token leak**: attacker can read/write everything you can on the Atlassian site. High blast radius — rotate immediately.
- **GitHub PAT leak**: attacker can trigger `repository_dispatch` events and (if scoped broadly) write code. The fine-grained PAT is scoped to `contents: write` on one repo → limited to running workflows / opening PRs.

### Invariants the workflows enforce
- QA agents in CI cannot push to `main` (`permissions: contents: write` is used for branch creation + PR opening, not main push)
- Jira Agent jobs have **no** `git` or `gh` in their allowed tools — they can't touch the repo at all
- Jira Automation rules use `Hidden: true` on Authorization headers so the token doesn't leak in audit logs
- Every rule ticks "Delay execution until response received" — failures are loud, not silent

---

## Extension points

The cleanest ways to grow this without breaking existing paths:

1. **Slack notifications**: add a final `curl` step in each job that posts to a Slack webhook summarizing what happened. No MCP needed; Slack accepts a simple POST.

2. **Richer agent prompts**: improve triage quality by teaching the agent about your stack conventions (e.g. "we use Jest for unit tests, not Vitest"). Edit the subagent .md files; no workflow changes needed.

3. **Bot account**: replace the personal Atlassian account with a dedicated "QA Agent" user. Same token flow; only change is who the audit log attributes actions to.

4. **PR ↔ Epic auto-linking**: when a PR title contains a Jira key, add a Jira comment on that Epic linking to the PR. Another small `mcp-atlassian` call in the QA workflow prompt.

5. **Production hardening**:
   - Dedicated GitHub organization-level secrets if this scales beyond one repo
   - Cost caps via repository variables (`MAX_JIRA_AGENT_RUNS_PER_DAY`)
   - Mandatory CODEOWNERS review on agent-opened PRs before merge
   - Separate Confluence space per product team, with per-space Automation rules routing to different Jira projects

6. **Observability**: push structured logs from each workflow run to a central log aggregator. Useful once you're running dozens of these per day and need to debug "why did this BA's Epic never get triaged?"

---

## Known limitations

- **Rate limits are shared**: Claude subscription, Atlassian API, GitHub Actions minutes all share a pool. A runaway agent can temporarily deny interactive use.
- **No rollback for created Jira tickets**: if the agent creates wrong sub-tasks on approval, a human has to delete them. Consider adding a "rollback" keyword.
- **Confluence rich content is lossy in triage**: the agent reads page content as text. Tables, embedded images, and Confluence-specific macros (like inline Jira links) may not survive cleanly into the Epic description.
- **Single project, single site**: everything is hardcoded to project `QAT` / site `trobustech.atlassian.net`. Making it multi-project requires reading those from the dispatch payload or per-rule body.
- **No tests for the workflow itself**: the QA agent tests application code, but nothing tests the Jira Agent workflow end-to-end in CI. Manual verification per `setup.md` phase 6.
