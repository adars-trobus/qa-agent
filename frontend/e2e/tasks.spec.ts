import { test, expect } from "@playwright/test";

const API = "http://localhost:8000";

test.beforeEach(async ({ request }) => {
  const tasks = await (await request.get(`${API}/tasks`)).json();
  for (const t of tasks) {
    await request.delete(`${API}/tasks/${t.id}`);
  }
});

// --- Core CRUD ---

test("empty state renders when no tasks exist", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("user can add, toggle, and delete a task", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("new-task-input").fill("write the docs");
  await page.getByTestId("add-task-button").click();

  const list = page.getByTestId("task-list");
  await expect(list).toContainText("write the docs");

  await page.getByLabel("toggle write the docs").click();
  await expect(page.getByLabel("toggle write the docs")).toBeChecked();

  await page.getByLabel("delete write the docs").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("adding an empty task does nothing", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-task-input").fill("   ");
  await page.getByTestId("add-task-button").click();
  await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("input clears after adding a task", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("new task title");
  await input.fill("buy groceries");
  await page.getByTestId("add-task-button").click();
  await expect(page.getByTestId("task-list")).toContainText("buy groceries");
  await expect(input).toHaveValue("");
});

test("keyboard submit via Enter key adds a task", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("new task title");
  await input.fill("submitted with enter");
  await input.press("Enter");
  await expect(page.getByTestId("task-list")).toContainText("submitted with enter");
  await expect(input).toHaveValue("");
});

test("adding a task removes empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();

  await page.getByLabel("new task title").fill("first task");
  await page.getByTestId("add-task-button").click();

  await expect(page.getByTestId("empty-state")).not.toBeAttached();
  await expect(page.getByTestId("task-list")).toBeVisible();
});

// --- Stats Bar ---

test("stats bar shows correct counts", async ({ page, request }) => {
  await request.post(`${API}/tasks`, { data: { title: "active one" } });
  const done = await (
    await request.post(`${API}/tasks`, { data: { title: "done one" } })
  ).json();
  await request.patch(`${API}/tasks/${done.id}`, { data: { done: true } });

  await page.goto("/");
  const statsBar = page.getByTestId("stats-bar");
  await expect(statsBar).toContainText("2");
  await expect(statsBar).toContainText("1");
});

// --- Priority & Details ---

test("user can add task with priority and description", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("new-task-input").fill("deploy v2");
  await page.getByTestId("toggle-details").click();

  await page.getByTestId("task-description-input").fill("Push to production");
  await page.getByTestId("priority-high").click();
  await page.getByTestId("add-task-button").click();

  const list = page.getByTestId("task-list");
  await expect(list).toContainText("deploy v2");
  await expect(list).toContainText("Push to production");
  const firstTask = list.getByRole("listitem").first();
  await expect(firstTask).toContainText("high");
});

test("task shows priority badge", async ({ page, request }) => {
  const task = await (
    await request.post(`${API}/tasks`, {
      data: { title: "urgent fix", priority: "high" },
    })
  ).json();

  await page.goto("/");
  await expect(page.getByTestId(`priority-badge-${task.id}`)).toContainText(
    "high"
  );
});

// --- Due Date ---

test("user can add task with due date", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("new-task-input").fill("deadline task");
  await page.getByTestId("toggle-details").click();
  await page.getByTestId("due-date-input").fill("2026-05-01");
  await page.getByTestId("add-task-button").click();

  const list = page.getByTestId("task-list");
  await expect(list).toContainText("deadline task");
  await expect(list).toContainText("May 1");
});

test("overdue task shows overdue indicator", async ({ page, request }) => {
  const task = await (
    await request.post(`${API}/tasks`, {
      data: { title: "past due", due_date: "2020-01-01" },
    })
  ).json();

  await page.goto("/");
  await expect(page.getByTestId(`due-date-${task.id}`)).toContainText(
    "Overdue"
  );
});

// --- Filtering ---

test("filter tabs show correct tasks", async ({ page, request }) => {
  await request.post(`${API}/tasks`, { data: { title: "active task" } });
  const done = await (
    await request.post(`${API}/tasks`, { data: { title: "completed task" } })
  ).json();
  await request.patch(`${API}/tasks/${done.id}`, { data: { done: true } });

  await page.goto("/");

  // All tab - both visible
  const list = page.getByTestId("task-list");
  await expect(list.getByRole("listitem")).toHaveCount(2);

  // Active tab
  await page.getByTestId("filter-active").click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("active task");

  // Completed tab
  await page.getByTestId("filter-completed").click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("completed task");
});

// --- Search ---

test("search filters tasks by title", async ({ page, request }) => {
  await request.post(`${API}/tasks`, { data: { title: "buy groceries" } });
  await request.post(`${API}/tasks`, { data: { title: "walk the dog" } });
  await request.post(`${API}/tasks`, { data: { title: "buy flowers" } });

  await page.goto("/");
  await page.getByTestId("search-input").fill("buy");

  const list = page.getByTestId("task-list");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("buy groceries");
  await expect(list).toContainText("buy flowers");
});

// --- Inline Edit ---

test("user can edit a task inline", async ({ page, request }) => {
  const task = await (
    await request.post(`${API}/tasks`, {
      data: { title: "original title", description: "old desc" },
    })
  ).json();

  await page.goto("/");
  await page.getByTestId(`edit-${task.id}`).click();

  await page.getByTestId("edit-title-input").fill("updated title");
  await page.getByTestId("edit-description-input").fill("new desc");
  await page.getByTestId("edit-priority-high").click();
  await page.getByTestId("save-edit").click();

  const list = page.getByTestId("task-list");
  await expect(list).toContainText("updated title");
  await expect(list).toContainText("new desc");
  await expect(list).toContainText("high");
});

test("cancel edit discards changes", async ({ page, request }) => {
  const task = await (
    await request.post(`${API}/tasks`, { data: { title: "keep me" } })
  ).json();

  await page.goto("/");
  await page.getByTestId(`edit-${task.id}`).click();
  await page.getByTestId("edit-title-input").fill("changed");
  await page.getByTestId("cancel-edit").click();

  await expect(page.getByTestId("task-list")).toContainText("keep me");
});

// --- Sort ---

test("sort order toggle works", async ({ page, request }) => {
  await request.post(`${API}/tasks`, { data: { title: "first" } });
  await request.post(`${API}/tasks`, { data: { title: "second" } });

  await page.goto("/");
  const sortButton = page.getByTestId("sort-order");
  await expect(sortButton).toContainText("Descending");

  await sortButton.click();
  await expect(sortButton).toContainText("Ascending");
});

// --- XSS ---

test("special characters render as text not HTML", async ({ page }) => {
  await page.goto("/");
  const xssTitle = "<script>alert('xss')</script>";
  await page.getByLabel("new task title").fill(xssTitle);
  await page.getByTestId("add-task-button").click();

  const list = page.getByTestId("task-list");
  await expect(list).toContainText(xssTitle);
  const taskItem = list.getByRole("listitem");
  const innerHTML = await taskItem.innerHTML();
  expect(innerHTML).toContain("&lt;script&gt;");
});
