from __future__ import annotations

import csv
import io
import json
import math
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

import streamlit as st

try:
    from streamlit_autorefresh import st_autorefresh
except ImportError:  # Local installs without requirements.txt still run, just without live ticks.
    st_autorefresh = None


TASK_LIMIT = 5
STATE_FILE = Path(".streamlit_data/focus_dashboard_state.json")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def date_key() -> str:
    return date.today().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def create_daily_record(day: str) -> dict[str, Any]:
    return {
        "date": day,
        "mainFocus": "",
        "tasksPlanned": 0,
        "tasksCompleted": 0,
        "tasksIncomplete": 0,
        "plannedTaskNames": [],
        "completedTaskNames": [],
        "incompleteTaskNames": [],
        "focusMinutesPlanned": 0,
        "focusMinutesCompleted": 0,
        "focusSessionsCompleted": 0,
        "notesCharacterCount": 0,
        "doneLogItems": [],
        "taskTimeEntries": [],
        "productivityScore": 0,
    }


def default_state() -> dict[str, Any]:
    return {
        "focus": "",
        "tasks": [
            {"id": new_id(), "text": "Pick today's main focus", "done": False},
            {"id": new_id(), "text": "Start one focus session", "done": False},
            {"id": new_id(), "text": "Write down one loose thought", "done": False},
        ],
        "notes": "",
        "doneLog": [],
        "timerMinutes": 20,
        "timerStartedAt": "",
        "timerEndsAt": "",
        "timerRunning": False,
        "activeTaskId": "",
        "activeTaskStartedAt": "",
        "activeTaskPlannedMinutes": 0,
        "dailyRecords": {},
    }


def read_number(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def load_disk_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return default_state()
    try:
        stored = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_state()

    state = default_state()
    state.update(stored)
    state.setdefault("dailyRecords", {})
    state.setdefault("timerStartedAt", "")
    state.setdefault("timerEndsAt", "")
    state.setdefault("timerRunning", False)
    state.setdefault("activeTaskId", "")
    state.setdefault("activeTaskStartedAt", "")
    state.setdefault("activeTaskPlannedMinutes", 0)
    return state


def save_disk_state() -> None:
    sync_today_record()
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(st.session_state.app_state, indent=2), encoding="utf-8")


def get_record(day: str) -> dict[str, Any]:
    records = st.session_state.app_state["dailyRecords"]
    records.setdefault(day, create_daily_record(day))
    return records[day]


def today_record() -> dict[str, Any]:
    return get_record(date_key())


def split_lines(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def serialize_task_time_entries(entries: list[dict[str, Any]]) -> str:
    lines = []
    for entry in entries or []:
        lines.append(
            " | ".join(
                [
                    str(entry.get("taskName", "")),
                    str(entry.get("startedAt", "")),
                    str(entry.get("finishedAt", "")),
                    str(entry.get("plannedMinutes", 0)),
                    str(entry.get("completedMinutes", 0)),
                ]
            )
        )
    return "\n".join(lines)


def parse_task_time_entries(value: str) -> list[dict[str, Any]]:
    entries = []
    for line in split_lines(value):
        parts = [part.strip() for part in line.split("|")]
        parts += [""] * (5 - len(parts))
        task_name, started_at, finished_at, planned_minutes, completed_minutes = parts[:5]
        entries.append(
            {
                "taskName": task_name,
                "startedAt": started_at,
                "finishedAt": finished_at,
                "plannedMinutes": read_number(planned_minutes),
                "completedMinutes": read_number(completed_minutes),
            }
        )
    return entries


def finalize_record(record: dict[str, Any]) -> None:
    record.setdefault("plannedTaskNames", [])
    record.setdefault("completedTaskNames", [])
    record.setdefault("doneLogItems", [])
    record.setdefault("taskTimeEntries", [])
    record["incompleteTaskNames"] = [
        task for task in record["plannedTaskNames"] if task not in record["completedTaskNames"]
    ]
    record["tasksPlanned"] = len(record["plannedTaskNames"])
    record["tasksCompleted"] = len(record["completedTaskNames"])
    record["tasksIncomplete"] = len(record["incompleteTaskNames"])
    record["focusMinutesPlanned"] = read_number(record.get("focusMinutesPlanned"))
    record["focusMinutesCompleted"] = read_number(record.get("focusMinutesCompleted"))
    record["focusSessionsCompleted"] = read_number(record.get("focusSessionsCompleted"))
    record["notesCharacterCount"] = read_number(record.get("notesCharacterCount"))

    task_rate = record["tasksCompleted"] / record["tasksPlanned"] if record["tasksPlanned"] else 0
    focus_rate = (
        min(record["focusMinutesCompleted"] / record["focusMinutesPlanned"], 1)
        if record["focusMinutesPlanned"]
        else 0
    )
    record["productivityScore"] = round((task_rate * 0.7 + focus_rate * 0.3) * 100)


def sync_today_record() -> None:
    state = st.session_state.app_state
    record = today_record()
    record["mainFocus"] = state.get("focus", "")
    record["notesCharacterCount"] = len(state.get("notes", ""))
    record["doneLogItems"] = [entry["text"] for entry in state.get("doneLog", [])]
    record["incompleteTaskNames"] = [task["text"] for task in state.get("tasks", [])]
    finalize_record(record)


def ensure_today_record() -> None:
    record = today_record()
    for task in st.session_state.app_state["tasks"]:
        if task["text"] not in record["plannedTaskNames"]:
            record["plannedTaskNames"].append(task["text"])
    for entry in st.session_state.app_state["doneLog"]:
        if entry["text"] not in record["doneLogItems"]:
            record["doneLogItems"].append(entry["text"])
    finalize_record(record)


def add_planned_task(text: str) -> None:
    today_record()["plannedTaskNames"].append(text)


def add_planned_task_if_missing(text: str) -> None:
    record = today_record()
    if text not in record["plannedTaskNames"]:
        record["plannedTaskNames"].append(text)


def remove_first_match(items: list[Any], value: Any) -> None:
    if value in items:
        items.remove(value)


def remove_planned_task(text: str) -> None:
    record = today_record()
    remove_first_match(record["plannedTaskNames"], text)
    remove_first_match(record["completedTaskNames"], text)


def add_completed_task(text: str) -> None:
    record = today_record()
    add_planned_task_if_missing(text)
    record["completedTaskNames"].append(text)


def remove_completed_task(text: str) -> None:
    remove_first_match(today_record()["completedTaskNames"], text)


def remove_last_task_time_entry(task_name: str) -> None:
    entries = today_record()["taskTimeEntries"]
    for index in range(len(entries) - 1, -1, -1):
        if entries[index].get("taskName") == task_name:
            del entries[index]
            return


def clear_active_task() -> None:
    state = st.session_state.app_state
    state["activeTaskId"] = ""
    state["activeTaskStartedAt"] = ""
    state["activeTaskPlannedMinutes"] = 0


def get_active_task() -> Optional[dict[str, Any]]:
    active_id = st.session_state.app_state.get("activeTaskId", "")
    return next((task for task in st.session_state.app_state["tasks"] if task["id"] == active_id), None)


def timer_remaining_seconds() -> int:
    state = st.session_state.app_state
    if not state.get("timerRunning"):
        return max(0, read_number(state.get("timerMinutes")) * 60)
    ends_at = parse_iso(state.get("timerEndsAt", ""))
    if not ends_at:
        return max(0, read_number(state.get("timerMinutes")) * 60)
    remaining = math.ceil((ends_at - datetime.now(timezone.utc)).total_seconds())
    if remaining <= 0:
        return 0
    return remaining


def set_timer_minutes(minutes: int) -> None:
    state = st.session_state.app_state
    state["timerMinutes"] = max(0, minutes)
    state["timerRunning"] = False
    state["timerStartedAt"] = ""
    state["timerEndsAt"] = ""


def add_timer_minutes(minutes: int) -> None:
    state = st.session_state.app_state
    remaining_minutes = math.ceil(timer_remaining_seconds() / 60)
    set_timer_minutes(remaining_minutes + minutes)
    today_record()["focusMinutesPlanned"] += max(0, minutes)
    save_disk_state()


def ensure_current_timer_is_planned() -> None:
    record = today_record()
    pending = max(0, record["focusMinutesPlanned"] - record["focusMinutesCompleted"])
    current_minutes = math.ceil(timer_remaining_seconds() / 60)
    if current_minutes > pending:
        record["focusMinutesPlanned"] += current_minutes - pending


def start_timer() -> None:
    state = st.session_state.app_state
    seconds = timer_remaining_seconds()
    if seconds <= 0:
        return
    ensure_current_timer_is_planned()
    started = datetime.now(timezone.utc)
    state["timerRunning"] = True
    state["timerStartedAt"] = started.isoformat()
    state["timerEndsAt"] = datetime.fromtimestamp(started.timestamp() + seconds, timezone.utc).isoformat()
    if state.get("activeTaskId"):
        state["activeTaskStartedAt"] = state.get("activeTaskStartedAt") or started.isoformat()
        state["activeTaskPlannedMinutes"] = math.ceil(seconds / 60)
    save_disk_state()


def pause_timer() -> None:
    set_timer_minutes(math.ceil(timer_remaining_seconds() / 60))
    save_disk_state()


def reset_timer() -> None:
    set_timer_minutes(0)
    save_disk_state()


def complete_focus_session() -> None:
    state = st.session_state.app_state
    active_task = get_active_task()
    completed_minutes = read_number(state.get("timerMinutes")) or max(1, math.ceil(timer_remaining_seconds() / 60))
    started_at = state.get("activeTaskStartedAt") or state.get("timerStartedAt") or now_iso()
    finished_at = now_iso()

    if active_task and parse_iso(started_at):
        elapsed = math.ceil((parse_iso(finished_at) - parse_iso(started_at)).total_seconds() / 60)
        completed_minutes = max(1, elapsed)

    record = today_record()
    record["focusMinutesCompleted"] += completed_minutes
    record["focusSessionsCompleted"] += 1

    if active_task:
        add_completed_task(active_task["text"])
        record["taskTimeEntries"].append(
            {
                "taskName": active_task["text"],
                "startedAt": started_at,
                "finishedAt": finished_at,
                "plannedMinutes": state.get("activeTaskPlannedMinutes") or read_number(state["timerMinutes"]),
                "completedMinutes": completed_minutes,
            }
        )
        state["tasks"] = [task for task in state["tasks"] if task["id"] != active_task["id"]]
        state["doneLog"].insert(
            0,
            {
                "id": new_id(),
                "type": "task",
                "text": active_task["text"],
                "startedAt": started_at,
                "finishedAt": finished_at,
                "completedAt": finished_at,
            },
        )
    else:
        state["doneLog"].insert(
            0,
            {
                "id": new_id(),
                "type": "focus",
                "text": f"{completed_minutes} minute focus session",
                "completedAt": finished_at,
            },
        )

    set_timer_minutes(0)
    clear_active_task()
    save_disk_state()


def complete_task(task_id: str) -> None:
    state = st.session_state.app_state
    task = next((entry for entry in state["tasks"] if entry["id"] == task_id), None)
    if not task:
        return
    if state["activeTaskId"] == task_id:
        clear_active_task()
    state["tasks"] = [entry for entry in state["tasks"] if entry["id"] != task_id]
    add_completed_task(task["text"])
    completed_at = now_iso()
    state["doneLog"].insert(
        0,
        {
            "id": new_id(),
            "type": "task",
            "text": task["text"],
            "startedAt": "",
            "finishedAt": completed_at,
            "completedAt": completed_at,
        },
    )
    save_disk_state()


def restore_done_item(done_id: str) -> None:
    state = st.session_state.app_state
    if len(state["tasks"]) >= TASK_LIMIT:
        return
    item = next((entry for entry in state["doneLog"] if entry["id"] == done_id), None)
    if not item or item.get("type") == "focus":
        return
    state["doneLog"] = [entry for entry in state["doneLog"] if entry["id"] != done_id]
    remove_completed_task(item["text"])
    remove_last_task_time_entry(item["text"])
    add_planned_task_if_missing(item["text"])
    restored = {"id": new_id(), "text": item["text"], "done": False}
    state["tasks"].append(restored)
    state["activeTaskId"] = state["activeTaskId"] or restored["id"]
    save_disk_state()


def move_task(task_id: str, direction: int) -> None:
    tasks = st.session_state.app_state["tasks"]
    index = next((idx for idx, task in enumerate(tasks) if task["id"] == task_id), -1)
    new_index = index + direction
    if index < 0 or new_index < 0 or new_index >= len(tasks):
        return
    task = tasks.pop(index)
    tasks.insert(new_index, task)
    save_disk_state()


def export_csv() -> str:
    sync_today_record()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "date",
            "mainFocus",
            "tasksPlanned",
            "tasksCompleted",
            "tasksIncomplete",
            "plannedTaskNames",
            "completedTaskNames",
            "incompleteTaskNames",
            "focusMinutesPlanned",
            "focusMinutesCompleted",
            "focusSessionsCompleted",
            "notesCharacterCount",
            "doneLogItems",
            "taskTimeEntries",
            "productivityScore",
        ]
    )
    for day in sorted(st.session_state.app_state["dailyRecords"]):
        record = get_record(day)
        finalize_record(record)
        writer.writerow(
            [
                record["date"],
                record["mainFocus"],
                record["tasksPlanned"],
                record["tasksCompleted"],
                record["tasksIncomplete"],
                "; ".join(record["plannedTaskNames"]),
                "; ".join(record["completedTaskNames"]),
                "; ".join(record["incompleteTaskNames"]),
                record["focusMinutesPlanned"],
                record["focusMinutesCompleted"],
                record["focusSessionsCompleted"],
                record["notesCharacterCount"],
                "; ".join(record["doneLogItems"]),
                serialize_task_time_entries(record["taskTimeEntries"]).replace("\n", " | "),
                record["productivityScore"],
            ]
        )
    return output.getvalue()


def install_css() -> None:
    st.markdown(
        """
        <style>
        :root {
          --ink: #172026;
          --muted: #687680;
          --line: #dfe6e3;
          --paper: #f5f7f2;
          --accent: #1f7a64;
          --accent-dark: #165747;
          --coral: #c95c4a;
        }

        .stApp {
          background:
            linear-gradient(135deg, rgba(31, 122, 100, 0.09), transparent 38%),
            linear-gradient(315deg, rgba(201, 92, 74, 0.12), transparent 32%),
            var(--paper);
          color: var(--ink);
        }

        .block-container {
          max-width: 1180px;
          padding-top: 1.8rem;
          padding-bottom: 2rem;
        }

        [data-testid="stMetric"] {
          background: rgba(255, 255, 255, 0.86);
          border: 1px solid rgba(223, 230, 227, 0.9);
          border-radius: 8px;
          padding: 0.85rem 1rem;
        }

        div[data-testid="stVerticalBlockBorderWrapper"] {
          border-radius: 8px;
          border-color: rgba(223, 230, 227, 0.9);
          background: rgba(255, 255, 255, 0.88);
        }

        .timer-card {
          background: #172026;
          color: white;
          border-radius: 8px;
          padding: 1.35rem;
          margin-bottom: 1rem;
        }

        .timer-display {
          font-size: clamp(3.5rem, 8vw, 5.8rem);
          font-weight: 900;
          line-height: 1;
          text-align: center;
          font-variant-numeric: tabular-nums;
          margin: 1.4rem 0 0.4rem;
        }

        .timer-caption {
          color: rgba(255, 255, 255, 0.72);
          font-weight: 800;
          text-align: center;
        }

        .small-label {
          color: var(--muted);
          font-size: 0.78rem;
          font-weight: 800;
          text-transform: uppercase;
          margin-bottom: 0;
        }

        .done-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fbfcfa;
          padding: 0.7rem 0.8rem;
          margin-bottom: 0.55rem;
        }

        .task-text {
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def format_clock(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def format_time(value: str) -> str:
    parsed = parse_iso(value)
    if not parsed:
        return ""
    return parsed.astimezone().strftime("%I:%M %p").lstrip("0")


def init_state() -> None:
    if "app_state" not in st.session_state:
        st.session_state.app_state = load_disk_state()
        ensure_today_record()


@dataclass
class HistoryEdit:
    main_focus: str
    planned_tasks: str
    completed_tasks: str
    done_items: str
    task_times: str
    focus_planned: int
    focus_completed: int
    focus_sessions: int
    notes_count: int


def render_tasks() -> None:
    state = st.session_state.app_state
    st.markdown('<p class="small-label">Priority lane</p>', unsafe_allow_html=True)
    st.subheader("Top 5 Tasks")

    with st.form("add_task", clear_on_submit=True):
        add_cols = st.columns([1, 0.22])
        text = add_cols[0].text_input(
            "Add a task",
            label_visibility="collapsed",
            disabled=len(state["tasks"]) >= TASK_LIMIT,
            max_chars=80,
            placeholder=f"Top {TASK_LIMIT} is full" if len(state["tasks"]) >= TASK_LIMIT else "Add a task",
        )
        submitted = add_cols[1].form_submit_button("Add", use_container_width=True)
        if submitted and text.strip() and len(state["tasks"]) < TASK_LIMIT:
            task = {"id": new_id(), "text": text.strip(), "done": False}
            state["tasks"].append(task)
            state["activeTaskId"] = state["activeTaskId"] or task["id"]
            add_planned_task(task["text"])
            save_disk_state()
            st.rerun()

    if not state["tasks"]:
        st.info(f"Add up to {TASK_LIMIT} tasks for today.")

    for index, task in enumerate(state["tasks"]):
        active = task["id"] == state.get("activeTaskId")
        row = st.columns([0.1, 0.1, 0.42, 0.16, 0.16, 0.16])
        if row[0].button("Done", key=f"done_{task['id']}", use_container_width=True):
            complete_task(task["id"])
            st.rerun()
        if row[1].button("Up" if index else "-", key=f"up_{task['id']}", disabled=index == 0):
            move_task(task["id"], -1)
            st.rerun()
        row[2].markdown(f"<span class='task-text'>{task['text']}</span>", unsafe_allow_html=True)
        if row[3].button(
            "Working" if active else "Work on",
            key=f"select_{task['id']}",
            type="primary" if active else "secondary",
            use_container_width=True,
        ):
            state["activeTaskId"] = task["id"]
            state["activeTaskStartedAt"] = ""
            state["activeTaskPlannedMinutes"] = math.ceil(timer_remaining_seconds() / 60)
            save_disk_state()
            st.rerun()
        if row[4].button("Down" if index < len(state["tasks"]) - 1 else "-", key=f"down_{task['id']}", disabled=index == len(state["tasks"]) - 1):
            move_task(task["id"], 1)
            st.rerun()
        if row[5].button("Remove", key=f"remove_{task['id']}", use_container_width=True):
            if state["activeTaskId"] == task["id"]:
                clear_active_task()
            remove_planned_task(task["text"])
            state["tasks"] = [entry for entry in state["tasks"] if entry["id"] != task["id"]]
            save_disk_state()
            st.rerun()

    if st.button("Clear all tasks", use_container_width=True):
        for task in deepcopy(state["tasks"]):
            remove_planned_task(task["text"])
        state["tasks"] = []
        clear_active_task()
        save_disk_state()
        st.rerun()


def render_timer() -> None:
    state = st.session_state.app_state
    if state.get("timerRunning") and st_autorefresh:
        st_autorefresh(interval=1000, key="focus_timer_tick")

    remaining = timer_remaining_seconds()
    if state.get("timerRunning") and remaining <= 0:
        complete_focus_session()
        st.rerun()

    active_task = get_active_task()
    caption = f"Working on: {active_task['text']}" if active_task else "No active task selected"

    st.markdown(
        f"""
        <div class="timer-card">
          <p class="small-label" style="color: rgba(255,255,255,.62)">Deep work</p>
          <h2 style="margin-top: .2rem">Focus Timer</h2>
          <div class="timer-display">{format_clock(remaining)}</div>
          <div class="timer-caption">{caption}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    timer_cols = st.columns(4)
    for col, minutes in zip(timer_cols, [20, 15, 10, 5]):
        if col.button(f"+{minutes}", key=f"timer_{minutes}", use_container_width=True):
            add_timer_minutes(minutes)
            st.rerun()

    custom_minutes = st.number_input(
        "Set timer minutes",
        min_value=0,
        step=1,
        value=math.ceil(remaining / 60),
        disabled=state.get("timerRunning", False),
    )
    if st.button("Apply minutes", use_container_width=True):
        previous = math.ceil(remaining / 60)
        set_timer_minutes(custom_minutes)
        if custom_minutes > previous:
            today_record()["focusMinutesPlanned"] += custom_minutes - previous
        save_disk_state()
        st.rerun()

    actions = st.columns(3)
    if state.get("timerRunning"):
        if actions[0].button("Pause", use_container_width=True):
            pause_timer()
            st.rerun()
    else:
        if actions[0].button("Start", disabled=remaining <= 0, use_container_width=True):
            start_timer()
            st.rerun()
    if actions[1].button("Complete", disabled=remaining <= 0, use_container_width=True):
        ensure_current_timer_is_planned()
        complete_focus_session()
        st.rerun()
    if actions[2].button("Reset", use_container_width=True):
        reset_timer()
        st.rerun()

    if state.get("timerRunning"):
        if st_autorefresh:
            st.caption("Timer is running.")
        else:
            st.caption("Timer is running. Install requirements.txt dependencies to enable live ticking.")
        if st.button("Refresh timer", use_container_width=True):
            st.rerun()


def render_notes() -> None:
    state = st.session_state.app_state
    st.markdown('<p class="small-label">Capture</p>', unsafe_allow_html=True)
    st.subheader("Quick Notes")
    notes = st.text_area(
        "Quick Notes",
        value=state["notes"],
        height=230,
        label_visibility="collapsed",
        placeholder="Park loose thoughts here so they stop tugging at you.",
    )
    if notes != state["notes"]:
        state["notes"] = notes
        save_disk_state()


def render_done_log() -> None:
    state = st.session_state.app_state
    st.markdown('<p class="small-label">Momentum</p>', unsafe_allow_html=True)
    st.subheader("Done Log")
    if not state["doneLog"]:
        st.info("Completed work will land here.")
    for entry in state["doneLog"][:8]:
        cols = st.columns([0.72, 0.14, 0.14])
        text = entry["text"]
        if entry.get("startedAt") and entry.get("finishedAt"):
            text = f"{text} ({format_time(entry['startedAt'])}-{format_time(entry['finishedAt'])})"
        cols[0].markdown(f"<span class='task-text'>{text}</span>", unsafe_allow_html=True)
        cols[1].caption(format_time(entry.get("completedAt", "")))
        disabled = len(state["tasks"]) >= TASK_LIMIT or entry.get("type") == "focus"
        if cols[2].button("Restore", key=f"restore_{entry['id']}", disabled=disabled):
            restore_done_item(entry["id"])
            st.rerun()

    if st.button("Clear done log", use_container_width=True):
        record = today_record()
        record["completedTaskNames"] = []
        record["taskTimeEntries"] = []
        state["doneLog"] = []
        save_disk_state()
        st.rerun()


def render_history() -> None:
    sync_today_record()
    dates = sorted(st.session_state.app_state["dailyRecords"], reverse=True)
    selected = st.selectbox("History date", dates, index=0 if dates else None)
    record = get_record(selected)
    finalize_record(record)

    summary = st.columns(4)
    summary[0].metric("Score", f"{record['productivityScore']}%")
    summary[1].metric("Completed", f"{record['tasksCompleted']}/{record['tasksPlanned']}")
    summary[2].metric("Incomplete", str(record["tasksIncomplete"]))
    summary[3].metric("Focus", f"{record['focusMinutesCompleted']}/{record['focusMinutesPlanned']} min")

    with st.form(f"history_{selected}"):
        col1, col2 = st.columns(2)
        edit = HistoryEdit(
            main_focus=col1.text_input("Main focus", value=record["mainFocus"]),
            planned_tasks=col1.text_area("Planned tasks", value="\n".join(record["plannedTaskNames"]), height=140),
            completed_tasks=col2.text_area("Completed tasks", value="\n".join(record["completedTaskNames"]), height=140),
            done_items=col1.text_area("Done log items", value="\n".join(record["doneLogItems"]), height=140),
            task_times=col2.text_area(
                "Task time entries",
                value=serialize_task_time_entries(record["taskTimeEntries"]),
                height=140,
            ),
            focus_planned=col1.number_input("Focus minutes planned", min_value=0, value=record["focusMinutesPlanned"]),
            focus_completed=col2.number_input("Focus minutes completed", min_value=0, value=record["focusMinutesCompleted"]),
            focus_sessions=col1.number_input("Focus sessions completed", min_value=0, value=record["focusSessionsCompleted"]),
            notes_count=col2.number_input("Notes character count", min_value=0, value=record["notesCharacterCount"]),
        )
        if st.form_submit_button("Save History"):
            record["mainFocus"] = edit.main_focus.strip()
            record["plannedTaskNames"] = split_lines(edit.planned_tasks)
            record["completedTaskNames"] = split_lines(edit.completed_tasks)
            record["doneLogItems"] = split_lines(edit.done_items)
            record["taskTimeEntries"] = parse_task_time_entries(edit.task_times)
            record["focusMinutesPlanned"] = edit.focus_planned
            record["focusMinutesCompleted"] = edit.focus_completed
            record["focusSessionsCompleted"] = edit.focus_sessions
            record["notesCharacterCount"] = edit.notes_count
            finalize_record(record)
            save_disk_state()
            st.success("History saved.")

    st.download_button(
        "Export CSV",
        data=export_csv(),
        file_name="focus-dashboard-history.csv",
        mime="text/csv",
        use_container_width=True,
    )


def main() -> None:
    st.set_page_config(page_title="Focus Dashboard", page_icon="✅", layout="wide")
    init_state()
    install_css()

    today_label = date.today().strftime("%A, %B %-d") if hasattr(date.today(), "strftime") else date_key()
    header_cols = st.columns([1, 0.18])
    header_cols[0].caption(today_label)
    header_cols[0].title("Focus Dashboard")
    if header_cols[1].button("Reset day", use_container_width=True):
        state = st.session_state.app_state
        state["doneLog"] = []
        state["tasks"] = []
        state["notes"] = ""
        state["focus"] = ""
        state["dailyRecords"][date_key()] = create_daily_record(date_key())
        set_timer_minutes(0)
        clear_active_task()
        save_disk_state()
        st.rerun()

    top_left, top_right = st.columns([1.1, 0.9], gap="large")
    with top_left:
        with st.container(border=True):
            render_tasks()
    with top_right:
        render_timer()

    bottom_left, bottom_right = st.columns([1.1, 0.9], gap="large")
    with bottom_left:
        with st.container(border=True):
            render_notes()
    with bottom_right:
        with st.container(border=True):
            render_done_log()

    with st.container(border=True):
        st.markdown('<p class="small-label">Dataset</p>', unsafe_allow_html=True)
        st.subheader("Daily History")
        render_history()


if __name__ == "__main__":
    main()
