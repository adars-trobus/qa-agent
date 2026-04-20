from datetime import date, timedelta


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_list_tasks_empty(client):
    resp = client.get("/tasks")
    assert resp.status_code == 200
    assert resp.json() == []


# --- Create ---


def test_create_task(client):
    resp = client.post("/tasks", json={"title": "buy milk"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "buy milk"
    assert body["done"] is False
    assert body["description"] == ""
    assert body["priority"] == "medium"
    assert body["due_date"] is None
    assert "created_at" in body
    assert "updated_at" in body
    assert isinstance(body["id"], int)


def test_create_task_with_all_fields(client):
    resp = client.post("/tasks", json={
        "title": "deploy v2",
        "description": "Deploy the new version to production",
        "priority": "high",
        "due_date": "2026-04-25",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "deploy v2"
    assert body["description"] == "Deploy the new version to production"
    assert body["priority"] == "high"
    assert body["due_date"] == "2026-04-25"


def test_create_task_rejects_empty_title(client):
    resp = client.post("/tasks", json={"title": "   "})
    assert resp.status_code == 400


def test_create_task_empty_string_title(client):
    resp = client.post("/tasks", json={"title": ""})
    assert resp.status_code == 400


def test_create_task_missing_title_field(client):
    resp = client.post("/tasks", json={})
    assert resp.status_code == 422


def test_create_task_invalid_priority(client):
    resp = client.post("/tasks", json={"title": "test", "priority": "urgent"})
    assert resp.status_code == 422


def test_create_task_invalid_due_date(client):
    resp = client.post("/tasks", json={"title": "test", "due_date": "not-a-date"})
    assert resp.status_code == 422


def test_create_task_very_long_title(client):
    long_title = "a" * 10_000
    resp = client.post("/tasks", json={"title": long_title})
    assert resp.status_code == 201
    assert resp.json()["title"] == long_title


def test_create_task_special_characters(client):
    title = "Buy <milk> & \"eggs\" 'now' \u00e9\u00e0\u00fc \u2603 \u2764"
    resp = client.post("/tasks", json={"title": title})
    assert resp.status_code == 201
    assert resp.json()["title"] == title


def test_create_multiple_tasks(client):
    titles = ["first", "second", "third"]
    ids = []
    for t in titles:
        resp = client.post("/tasks", json={"title": t})
        assert resp.status_code == 201
        ids.append(resp.json()["id"])
    assert len(set(ids)) == 3
    tasks = client.get("/tasks").json()
    assert len(tasks) == 3


def test_create_task_extra_unknown_fields_ignored(client):
    resp = client.post("/tasks", json={"title": "valid", "color": "red"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "valid"
    assert "color" not in body


# --- Update ---


def test_toggle_task(client):
    created = client.post("/tasks", json={"title": "walk dog"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"done": True})
    assert resp.status_code == 200
    assert resp.json()["done"] is True


def test_update_title_only(client):
    created = client.post("/tasks", json={"title": "original"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"title": "updated"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "updated"
    assert body["done"] is False


def test_update_description(client):
    created = client.post("/tasks", json={"title": "task"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"description": "Details here"})
    assert resp.status_code == 200
    assert resp.json()["description"] == "Details here"


def test_update_priority(client):
    created = client.post("/tasks", json={"title": "task"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"priority": "high"})
    assert resp.status_code == 200
    assert resp.json()["priority"] == "high"


def test_update_due_date(client):
    created = client.post("/tasks", json={"title": "task"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"due_date": "2026-05-01"})
    assert resp.status_code == 200
    assert resp.json()["due_date"] == "2026-05-01"


def test_clear_due_date(client):
    created = client.post("/tasks", json={"title": "task", "due_date": "2026-05-01"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"clear_due_date": True})
    assert resp.status_code == 200
    assert resp.json()["due_date"] is None


def test_update_sets_updated_at(client):
    created = client.post("/tasks", json={"title": "task"}).json()
    original_updated = created["updated_at"]
    resp = client.patch(f"/tasks/{created['id']}", json={"title": "changed"})
    assert resp.json()["updated_at"] >= original_updated


def test_update_with_empty_title_rejected(client):
    created = client.post("/tasks", json={"title": "valid"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"title": ""})
    assert resp.status_code == 400


def test_update_with_whitespace_title_rejected(client):
    created = client.post("/tasks", json={"title": "valid"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"title": "   "})
    assert resp.status_code == 400


def test_update_with_invalid_done_value(client):
    created = client.post("/tasks", json={"title": "task"}).json()
    resp = client.patch(f"/tasks/{created['id']}", json={"done": "notabool"})
    assert resp.status_code == 422


def test_update_missing_task_returns_404(client):
    resp = client.patch("/tasks/9999", json={"done": True})
    assert resp.status_code == 404


# --- Filter by status ---


def test_filter_active_tasks(client):
    client.post("/tasks", json={"title": "active task"})
    done_task = client.post("/tasks", json={"title": "done task"}).json()
    client.patch(f"/tasks/{done_task['id']}", json={"done": True})

    active = client.get("/tasks?status=active").json()
    assert len(active) == 1
    assert active[0]["title"] == "active task"


def test_filter_completed_tasks(client):
    client.post("/tasks", json={"title": "active task"})
    done_task = client.post("/tasks", json={"title": "done task"}).json()
    client.patch(f"/tasks/{done_task['id']}", json={"done": True})

    completed = client.get("/tasks?status=completed").json()
    assert len(completed) == 1
    assert completed[0]["title"] == "done task"


def test_filter_all_tasks(client):
    client.post("/tasks", json={"title": "one"})
    done_task = client.post("/tasks", json={"title": "two"}).json()
    client.patch(f"/tasks/{done_task['id']}", json={"done": True})

    all_tasks = client.get("/tasks?status=all").json()
    assert len(all_tasks) == 2


def test_filter_invalid_status(client):
    resp = client.get("/tasks?status=invalid")
    assert resp.status_code == 422


# --- Filter by priority ---


def test_filter_by_priority(client):
    client.post("/tasks", json={"title": "low task", "priority": "low"})
    client.post("/tasks", json={"title": "high task", "priority": "high"})

    high = client.get("/tasks?priority=high").json()
    assert len(high) == 1
    assert high[0]["title"] == "high task"


# --- Search ---


def test_search_tasks(client):
    client.post("/tasks", json={"title": "buy groceries"})
    client.post("/tasks", json={"title": "walk the dog"})
    client.post("/tasks", json={"title": "buy flowers"})

    results = client.get("/tasks?search=buy").json()
    assert len(results) == 2
    assert all("buy" in t["title"] for t in results)


def test_search_no_results(client):
    client.post("/tasks", json={"title": "buy groceries"})
    results = client.get("/tasks?search=nonexistent").json()
    assert len(results) == 0


# --- Sort ---


def test_sort_by_priority(client):
    client.post("/tasks", json={"title": "low", "priority": "low"})
    client.post("/tasks", json={"title": "high", "priority": "high"})
    client.post("/tasks", json={"title": "medium", "priority": "medium"})

    asc = client.get("/tasks?sort_by=priority&sort_order=asc").json()
    assert [t["priority"] for t in asc] == ["low", "medium", "high"]

    desc = client.get("/tasks?sort_by=priority&sort_order=desc").json()
    assert [t["priority"] for t in desc] == ["high", "medium", "low"]


def test_sort_by_created_at(client):
    t1 = client.post("/tasks", json={"title": "first"}).json()
    t2 = client.post("/tasks", json={"title": "second"}).json()

    asc = client.get("/tasks?sort_by=created_at&sort_order=asc").json()
    assert asc[0]["id"] == t1["id"]

    desc = client.get("/tasks?sort_by=created_at&sort_order=desc").json()
    assert desc[0]["id"] == t2["id"]


# --- Stats ---


def test_stats_empty(client):
    resp = client.get("/tasks/stats")
    assert resp.status_code == 200
    assert resp.json() == {"total": 0, "completed": 0, "active": 0, "overdue": 0}


def test_stats_with_tasks(client):
    client.post("/tasks", json={"title": "active"})
    done = client.post("/tasks", json={"title": "done"}).json()
    client.patch(f"/tasks/{done['id']}", json={"done": True})

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    client.post("/tasks", json={"title": "overdue", "due_date": yesterday})

    stats = client.get("/tasks/stats").json()
    assert stats["total"] == 3
    assert stats["completed"] == 1
    assert stats["active"] == 2
    assert stats["overdue"] == 1


def test_stats_completed_task_not_overdue(client):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    task = client.post("/tasks", json={"title": "done past", "due_date": yesterday}).json()
    client.patch(f"/tasks/{task['id']}", json={"done": True})

    stats = client.get("/tasks/stats").json()
    assert stats["overdue"] == 0


# --- Delete ---


def test_delete_task(client):
    created = client.post("/tasks", json={"title": "sweep"}).json()
    resp = client.delete(f"/tasks/{created['id']}")
    assert resp.status_code == 204
    assert client.get("/tasks").json() == []


def test_delete_missing_task_returns_404(client):
    resp = client.delete("/tasks/9999")
    assert resp.status_code == 404


def test_delete_then_delete_again_returns_404(client):
    created = client.post("/tasks", json={"title": "ephemeral"}).json()
    resp1 = client.delete(f"/tasks/{created['id']}")
    assert resp1.status_code == 204
    resp2 = client.delete(f"/tasks/{created['id']}")
    assert resp2.status_code == 404


# --- Full lifecycle ---


def test_full_lifecycle(client):
    created = client.post("/tasks", json={
        "title": "lifecycle",
        "description": "Test full cycle",
        "priority": "high",
        "due_date": "2026-05-01",
    }).json()
    task_id = created["id"]
    assert created["done"] is False
    assert created["priority"] == "high"

    client.patch(f"/tasks/{task_id}", json={"title": "lifecycle-updated"})
    client.patch(f"/tasks/{task_id}", json={"done": True})

    tasks = client.get("/tasks").json()
    assert len(tasks) == 1
    assert tasks[0]["title"] == "lifecycle-updated"
    assert tasks[0]["done"] is True
    assert tasks[0]["description"] == "Test full cycle"

    resp = client.delete(f"/tasks/{task_id}")
    assert resp.status_code == 204
    assert client.get("/tasks").json() == []
