from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from enum import Enum
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Field, Session, SQLModel, create_engine, select


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


class TaskBase(SQLModel):
    title: str
    description: str = ""
    priority: Priority = Priority.medium
    due_date: date | None = None
    done: bool = False


class Task(TaskBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TaskCreate(SQLModel):
    title: str
    description: str = ""
    priority: Priority = Priority.medium
    due_date: date | None = None


class TaskRead(TaskBase):
    id: int
    created_at: datetime
    updated_at: datetime


class TaskUpdate(SQLModel):
    title: str | None = None
    description: str | None = None
    priority: Priority | None = None
    due_date: date | None = None
    done: bool | None = None
    clear_due_date: bool = False


class StatsRead(SQLModel):
    total: int
    completed: int
    active: int
    overdue: int


DATABASE_URL = "sqlite:///./tasks.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


@asynccontextmanager
async def lifespan(app: FastAPI):
    SQLModel.metadata.create_all(engine)
    yield


app = FastAPI(lifespan=lifespan, title="TaskFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tasks", response_model=list[TaskRead])
def list_tasks(
    session: SessionDep,
    status: str = Query("all", pattern="^(all|active|completed)$"),
    priority: Priority | None = None,
    search: str | None = None,
    sort_by: str = Query("created_at", pattern="^(created_at|due_date|priority)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    stmt = select(Task)

    if status == "active":
        stmt = stmt.where(Task.done == False)  # noqa: E712
    elif status == "completed":
        stmt = stmt.where(Task.done == True)  # noqa: E712

    if priority is not None:
        stmt = stmt.where(Task.priority == priority)

    if search:
        stmt = stmt.where(Task.title.contains(search))

    if sort_by == "priority":
        tasks = session.exec(stmt).all()
        tasks.sort(
            key=lambda t: PRIORITY_ORDER.get(t.priority, 1),
            reverse=(sort_order == "asc"),
        )
        return tasks

    order_col = Task.created_at if sort_by == "created_at" else Task.due_date
    if sort_order == "asc":
        stmt = stmt.order_by(order_col.asc())
    else:
        stmt = stmt.order_by(order_col.desc())

    return session.exec(stmt).all()


@app.get("/tasks/stats", response_model=StatsRead)
def task_stats(session: SessionDep):
    all_tasks = session.exec(select(Task)).all()
    total = len(all_tasks)
    completed = sum(1 for t in all_tasks if t.done)
    today = date.today()
    overdue = sum(
        1 for t in all_tasks if not t.done and t.due_date and t.due_date < today
    )
    return StatsRead(
        total=total,
        completed=completed,
        active=total - completed,
        overdue=overdue,
    )


@app.get("/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/tasks", response_model=TaskRead, status_code=201)
def create_task(payload: TaskCreate, session: SessionDep):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    task = Task(
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        due_date=payload.due_date,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@app.patch("/tasks/{task_id}", response_model=TaskRead)
def update_task(task_id: int, payload: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data and not data["title"].strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    if data.pop("clear_due_date", False):
        task.due_date = None
    for key, value in data.items():
        setattr(task, key, value)
    task.updated_at = datetime.now(timezone.utc)
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()
    return None
