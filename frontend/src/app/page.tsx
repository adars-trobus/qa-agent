"use client";

import { useCallback, useEffect, useState } from "react";

type Task = {
  id: number;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  done: boolean;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  completed: number;
  active: number;
  overdue: number;
};

type StatusFilter = "all" | "active" | "completed";
type SortBy = "created_at" | "due_date" | "priority";
type SortOrder = "asc" | "desc";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PRIORITY_COLORS = {
  low: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.done) return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    completed: 0,
    active: 0,
    overdue: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  // Filter & sort state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Task["priority"]>("medium");
  const [editDueDate, setEditDueDate] = useState("");

  // Expanded task descriptions
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Task detail modal — fetched fresh via GET /tasks/{id}
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [viewingError, setViewingError] = useState<string | null>(null);

  async function viewTask(taskId: number) {
    setViewingTask(null);
    setViewingError(null);
    setViewingLoading(true);
    try {
      const res = await fetch(`${API_URL}/tasks/${taskId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GET /tasks/${taskId} ${res.status}`);
      setViewingTask(await res.json());
    } catch (e) {
      setViewingError((e as Error).message);
    } finally {
      setViewingLoading(false);
    }
  }

  function closeViewing() {
    setViewingTask(null);
    setViewingError(null);
    setViewingLoading(false);
  }

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tasks/stats`, { cache: "no-store" });
      if (res.ok) setStats(await res.json());
    } catch {
      /* stats are non-critical */
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("sort_by", sortBy);
      params.set("sort_order", sortOrder);
      if (search) params.set("search", search);

      const res = await fetch(`${API_URL}/tasks?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GET /tasks ${res.status}`);
      setTasks(await res.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sortBy, sortOrder, search]);

  useEffect(() => {
    fetchTasks();
    fetchStats();
  }, [fetchTasks, fetchStats]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const body: Record<string, unknown> = {
      title: trimmed,
      description: description.trim(),
      priority,
    };
    if (dueDate) body.due_date = dueDate;
    const res = await fetch(`${API_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError(`Failed to create task`);
      return;
    }
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setShowDetails(false);
    await Promise.all([fetchTasks(), fetchStats()]);
  }

  async function toggle(task: Task) {
    await fetch(`${API_URL}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    await Promise.all([fetchTasks(), fetchStats()]);
  }

  async function remove(task: Task) {
    await fetch(`${API_URL}/tasks/${task.id}`, { method: "DELETE" });
    await Promise.all([fetchTasks(), fetchStats()]);
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditDueDate(task.due_date ?? "");
  }

  async function saveEdit() {
    if (editingId === null) return;
    const trimmed = editTitle.trim();
    if (!trimmed) return;
    const body: Record<string, unknown> = {
      title: trimmed,
      description: editDescription.trim(),
      priority: editPriority,
    };
    if (editDueDate) {
      body.due_date = editDueDate;
    } else {
      body.clear_due_date = true;
    }
    const res = await fetch(`${API_URL}/tasks/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError("Failed to update task");
      return;
    }
    setEditingId(null);
    await Promise.all([fetchTasks(), fetchStats()]);
  }

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">TaskFlow</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage your work, stay on track</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div
        data-testid="stats-bar"
        className="mt-6 grid grid-cols-4 gap-3"
      >
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-2xl font-semibold">{stats.total}</div>
          <div className="text-xs text-zinc-500">Total</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-2xl font-semibold text-blue-600">{stats.active}</div>
          <div className="text-xs text-zinc-500">Active</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-2xl font-semibold text-emerald-600">
            {stats.completed}
          </div>
          <div className="text-xs text-zinc-500">Done</div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-2xl font-semibold text-red-600">{stats.overdue}</div>
          <div className="text-xs text-zinc-500">Overdue</div>
        </div>
      </div>

      {/* Add Task Form */}
      <form onSubmit={addTask} className="mt-8" data-testid="add-task-form">
        <div className="flex gap-2">
          <input
            aria-label="new task title"
            data-testid="new-task-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            data-testid="add-task-button"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Add
          </button>
        </div>

        {/* Toggle details */}
        <button
          type="button"
          data-testid="toggle-details"
          onClick={() => setShowDetails(!showDetails)}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {showDetails ? "- Hide details" : "+ Add details"}
        </button>

        {showDetails && (
          <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <textarea
              aria-label="task description"
              data-testid="task-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Priority</label>
                <div
                  className="mt-1 flex gap-1"
                  data-testid="priority-selector"
                >
                  {(["low", "medium", "high"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      data-testid={`priority-${p}`}
                      onClick={() => setPriority(p)}
                      className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                        priority === p
                          ? PRIORITY_COLORS[p]
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Due date</label>
                <input
                  type="date"
                  aria-label="due date"
                  data-testid="due-date-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            </div>
          </div>
        )}
      </form>

      {error && (
        <p data-testid="error" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Filter & Sort Bar */}
      <div className="mt-8 space-y-3">
        <div className="flex items-center gap-2">
          {/* Status tabs */}
          <div
            className="flex rounded-lg border border-zinc-200 dark:border-zinc-800"
            data-testid="status-filter"
          >
            {(["all", "active", "completed"] as const).map((s) => (
              <button
                key={s}
                data-testid={`filter-${s}`}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  statusFilter === s
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="search"
            aria-label="search tasks"
            data-testid="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="flex-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900"
          />
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Sort by</span>
          <select
            aria-label="sort by"
            data-testid="sort-by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-800"
          >
            <option value="created_at">Date created</option>
            <option value="due_date">Due date</option>
            <option value="priority">Priority</option>
          </select>
          <button
            data-testid="sort-order"
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            {sortOrder === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <p className="mt-8 text-sm text-zinc-500">Loading...</p>
      ) : tasks.length === 0 ? (
        <div data-testid="empty-state" className="mt-12 text-center">
          <div className="text-4xl">
            {statusFilter === "completed"
              ? "No completed tasks yet"
              : statusFilter === "active"
                ? "All caught up!"
                : ""}
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            {statusFilter === "all" && !search
              ? "No tasks yet. Add one above to get started."
              : search
                ? `No tasks matching "${search}".`
                : "Nothing here."}
          </p>
        </div>
      ) : (
        <ul data-testid="task-list" className="mt-6 space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              data-testid={`task-${task.id}`}
              className={`rounded-lg border p-4 transition-colors ${
                task.done
                  ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
              }`}
            >
              {editingId === task.id ? (
                /* Edit mode */
                <div className="space-y-3" data-testid={`edit-form-${task.id}`}>
                  <input
                    data-testid="edit-title-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <textarea
                    data-testid="edit-description-input"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    placeholder="Description"
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <div className="flex flex-wrap gap-3">
                    <div className="flex gap-1">
                      {(["low", "medium", "high"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          data-testid={`edit-priority-${p}`}
                          onClick={() => setEditPriority(p)}
                          className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
                            editPriority === p
                              ? PRIORITY_COLORS[p]
                              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <input
                      type="date"
                      data-testid="edit-due-date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      data-testid="save-edit"
                      onClick={saveEdit}
                      className="rounded bg-black px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-black"
                    >
                      Save
                    </button>
                    <button
                      data-testid="cancel-edit"
                      onClick={() => setEditingId(null)}
                      className="rounded px-3 py-1 text-xs text-zinc-500 hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Display mode */
                <>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`toggle ${task.title}`}
                      checked={task.done}
                      onChange={() => toggle(task)}
                      className="mt-1 h-4 w-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-medium ${
                            task.done
                              ? "text-zinc-400 line-through"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {task.title}
                        </span>
                        <span
                          data-testid={`priority-badge-${task.id}`}
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_COLORS[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                      </div>
                      {task.description && (
                        <button
                          onClick={() => toggleExpanded(task.id)}
                          className="mt-1 text-left"
                        >
                          <p
                            className={`text-xs text-zinc-500 ${
                              expandedIds.has(task.id) ? "" : "line-clamp-1"
                            }`}
                          >
                            {task.description}
                          </p>
                        </button>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400">
                        {task.due_date && (
                          <span
                            data-testid={`due-date-${task.id}`}
                            className={isOverdue(task) ? "font-medium text-red-500" : ""}
                          >
                            {isOverdue(task) ? "Overdue: " : "Due: "}
                            {formatDate(task.due_date)}
                          </span>
                        )}
                        <span>{timeAgo(task.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`view ${task.title}`}
                        data-testid={`view-${task.id}`}
                        onClick={() => viewTask(task.id)}
                        className="rounded p-1 text-xs text-zinc-400 hover:text-emerald-600"
                      >
                        view
                      </button>
                      <button
                        aria-label={`edit ${task.title}`}
                        data-testid={`edit-${task.id}`}
                        onClick={() => startEdit(task)}
                        className="rounded p-1 text-xs text-zinc-400 hover:text-blue-600"
                      >
                        edit
                      </button>
                      <button
                        aria-label={`delete ${task.title}`}
                        data-testid={`delete-${task.id}`}
                        onClick={() => remove(task)}
                        className="rounded p-1 text-xs text-zinc-400 hover:text-red-600"
                      >
                        delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {(viewingTask || viewingLoading || viewingError) && (
        <div
          data-testid="task-detail-modal"
          role="dialog"
          aria-label="task details"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeViewing}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">Task details</h2>
              <button
                aria-label="close details"
                data-testid="close-detail"
                onClick={closeViewing}
                className="rounded p-1 text-zinc-400 hover:text-zinc-700"
              >
                ×
              </button>
            </div>

            {viewingLoading && (
              <p data-testid="detail-loading" className="text-sm text-zinc-500">
                Loading…
              </p>
            )}

            {viewingError && (
              <p data-testid="detail-error" className="text-sm text-red-600">
                {viewingError}
              </p>
            )}

            {viewingTask && (
              <dl className="space-y-3 text-sm" data-testid="detail-body">
                <div>
                  <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                    Title
                  </dt>
                  <dd data-testid="detail-title" className="mt-0.5">
                    {viewingTask.title}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                    Description
                  </dt>
                  <dd data-testid="detail-description" className="mt-0.5">
                    {viewingTask.description || (
                      <span className="text-zinc-400">None</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-6">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                      Priority
                    </dt>
                    <dd
                      data-testid="detail-priority"
                      className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_COLORS[viewingTask.priority]}`}
                    >
                      {viewingTask.priority}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                      Status
                    </dt>
                    <dd data-testid="detail-status" className="mt-0.5">
                      {viewingTask.done ? "Completed" : "Active"}
                    </dd>
                  </div>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                    Due date
                  </dt>
                  <dd data-testid="detail-due-date" className="mt-0.5">
                    {viewingTask.due_date ? (
                      formatDate(viewingTask.due_date)
                    ) : (
                      <span className="text-zinc-400">None</span>
                    )}
                  </dd>
                </div>
                <div className="flex gap-6">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                      Created
                    </dt>
                    <dd data-testid="detail-created-at" className="mt-0.5">
                      {timeAgo(viewingTask.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase text-zinc-400">
                      Updated
                    </dt>
                    <dd data-testid="detail-updated-at" className="mt-0.5">
                      {timeAgo(viewingTask.updated_at)}
                    </dd>
                  </div>
                </div>
              </dl>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
