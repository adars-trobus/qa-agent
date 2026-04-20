# Lessons

Self-improvement log. After any user correction, record:

- **Pattern**: What went wrong
- **Rule**: How to prevent it next time
- **Why**: The underlying reason

---

## Frontend

### Playwright browser confusion (2026-04-20)

- **Pattern**: `qa-frontend` saw a "browser not found" or "executable doesn't exist" error, assumed Playwright was broken, and gave up without running the spec — even though chromium was installed.
- **Rule**: Before treating a browser error as a blocker, decode *which* browser is missing. The **runner** (`yarn playwright test`) uses `~/Library/Caches/ms-playwright/chromium-*`; the **MCP server** uses `~/Library/Caches/ms-playwright/mcp-chrome-*`. Two independent installs. Fix the right one using the table in `.claude/agents/qa-frontend.md` → "Browser management". Run the preflight (`yarn playwright install --dry-run chromium`) before concluding the browser is missing.
- **Why**: The generic Playwright error message doesn't distinguish runner vs MCP. Reinstalling blindly wastes time (and may delete the wrong cache). Getting this wrong means tests never actually run, which is the worst possible failure mode for a QA agent.
