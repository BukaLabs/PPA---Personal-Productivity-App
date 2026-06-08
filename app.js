const STORAGE_KEY = "focus-dashboard-state-v1";
const TASK_LIMIT = 5;
const NOTIFICATION_THRESHOLDS_SECONDS = [5 * 60, 60];

const todayKey = getDateKey(new Date());

const defaultState = {
  focus: "",
  tasks: [
    { id: crypto.randomUUID(), text: "Pick today's main focus", done: false },
    { id: crypto.randomUUID(), text: "Start one focus session", done: false },
    { id: crypto.randomUUID(), text: "Write down one loose thought", done: false }
  ],
  notes: "",
  doneLog: [],
  timerMinutes: 20,
  activeTaskId: "",
  activeTaskStartedAt: "",
  activeTaskPlannedMinutes: 0,
  dailyRecords: {}
};

const state = loadState();
state.dailyRecords ||= {};
state.activeTaskId ||= "";
state.activeTaskStartedAt ||= "";
state.activeTaskPlannedMinutes ||= 0;
ensureTodayRecord();

let timerSeconds = Math.max(0, Number(state.timerMinutes) || 0) * 60;
let timerId = null;
let notifiedThresholds = new Set();
let taskDrag = null;

const todayLabel = document.querySelector("#todayLabel");
const taskForm = document.querySelector("#taskForm");
const taskInput = document.querySelector("#taskInput");
const addTaskButton = document.querySelector("#addTaskButton");
const taskList = document.querySelector("#taskList");
const doneList = document.querySelector("#doneList");
const notesInput = document.querySelector("#notesInput");
const saveState = document.querySelector("#saveState");
const timerDisplay = document.querySelector("#timerDisplay");
const activeTaskLabel = document.querySelector("#activeTaskLabel");
const startPauseButton = document.querySelector("#startPauseButton");
const completeTimerButton = document.querySelector("#completeTimerButton");
const resetTimerButton = document.querySelector("#resetTimerButton");
const clearTasksButton = document.querySelector("#clearTasksButton");
const clearDoneButton = document.querySelector("#clearDoneButton");
const resetDayButton = document.querySelector("#resetDayButton");
const historyDateSelect = document.querySelector("#historyDateSelect");
const historySummary = document.querySelector("#historySummary");
const historyForm = document.querySelector("#historyForm");
const historyMainFocus = document.querySelector("#historyMainFocus");
const historyPlannedTasks = document.querySelector("#historyPlannedTasks");
const historyCompletedTasks = document.querySelector("#historyCompletedTasks");
const historyDoneItems = document.querySelector("#historyDoneItems");
const historyTaskTimes = document.querySelector("#historyTaskTimes");
const historyFocusPlanned = document.querySelector("#historyFocusPlanned");
const historyFocusCompleted = document.querySelector("#historyFocusCompleted");
const historyFocusSessions = document.querySelector("#historyFocusSessions");
const historyNotesCount = document.querySelector("#historyNotesCount");
const exportCsvButton = document.querySelector("#exportCsvButton");
const timerTabs = Array.from(document.querySelectorAll(".timer-tab"));

todayLabel.textContent = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric"
}).format(new Date());

notesInput.value = state.notes;

syncTodayRecord();
render();
updateTimerDisplay();

notesInput.addEventListener("input", () => {
  state.notes = notesInput.value;
  saveStateSoon();
  renderHistory();
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();

  if (!text || state.tasks.length >= TASK_LIMIT) {
    taskInput.value = "";
    return;
  }

  state.tasks.push({ id: crypto.randomUUID(), text, done: false });
  state.activeTaskId ||= state.tasks[0]?.id || "";
  addPlannedTask(text);
  taskInput.value = "";
  saveStateSoon();
  render();
});

taskList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-task-id]");
  if (!item) return;

  const taskId = item.dataset.taskId;
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;

  if (event.target.matches("input[type='checkbox']")) {
    completeTask(taskId);
  }

  if (event.target.matches("[data-select-task]")) {
    selectActiveTask(taskId);
  }

  if (event.target.matches("[data-move-task]")) {
    moveTask(taskId, Number(event.target.dataset.moveTask));
  }

  if (event.target.matches("[data-remove-task]")) {
    if (state.activeTaskId === taskId) {
      clearActiveTask();
    }
    removePlannedTask(task.text);
    state.tasks = state.tasks.filter((entry) => entry.id !== taskId);
    saveStateSoon();
    render();
  }
});

taskList.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("button, input, select, textarea")) return;

  const item = event.target.closest("[data-task-id]");
  if (!item) return;

  taskDrag = {
    id: item.dataset.taskId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
  item.setPointerCapture(event.pointerId);
});

taskList.addEventListener("pointermove", (event) => {
  if (!taskDrag || taskDrag.pointerId !== event.pointerId) return;

  const draggedItem = taskList.querySelector(`[data-task-id="${taskDrag.id}"]`);
  if (!draggedItem) return;

  const movedDistance = Math.hypot(event.clientX - taskDrag.startX, event.clientY - taskDrag.startY);
  if (!taskDrag.active && movedDistance < 8) return;

  taskDrag.active = true;
  draggedItem.classList.add("dragging");

  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-task-id]");
  if (!item || item === draggedItem) {
    clearDropTargets({ keepDragging: true });
    return;
  }

  const position = getDropPosition(item, event.clientY);
  clearDropTargets({ keepDragging: true });
  item.classList.add(position === "before" ? "drop-before" : "drop-after");
  item.dataset.dropPosition = position;
});

taskList.addEventListener("pointerup", (event) => {
  if (!taskDrag || taskDrag.pointerId !== event.pointerId) return;

  const item = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-task-id]");
  if (taskDrag.active && item && item.dataset.taskId !== taskDrag.id) {
    reorderTask(taskDrag.id, item.dataset.taskId, item.dataset.dropPosition || getDropPosition(item, event.clientY));
  }

  taskDrag = null;
  clearDropTargets();
});

taskList.addEventListener("pointercancel", () => {
  taskDrag = null;
  clearDropTargets();
});

window.addEventListener("pointerup", () => {
  if (!taskDrag) return;

  taskDrag = null;
  clearDropTargets();
});

clearTasksButton.addEventListener("click", () => {
  state.tasks.forEach((task) => removePlannedTask(task.text));
  state.tasks = [];
  clearActiveTask();
  saveStateSoon();
  render();
});

clearDoneButton.addEventListener("click", () => {
  const record = getTodayRecord();
  record.completedTaskNames = [];
  record.taskTimeEntries = [];
  state.doneLog = [];
  saveStateSoon();
  render();
});

doneList.addEventListener("click", (event) => {
  const restoreButton = event.target.closest("[data-restore-done]");
  if (!restoreButton) return;

  restoreDoneItem(restoreButton.dataset.restoreDone);
});

resetDayButton.addEventListener("click", () => {
  state.doneLog = [];
  state.tasks = [];
  state.notes = "";
  state.focus = "";
  clearActiveTask();
  notesInput.value = "";
  state.dailyRecords[todayKey] = createDailyRecord(todayKey);
  stopTimer();
  state.timerMinutes = 0;
  timerSeconds = 0;
  resetTimerNotifications();
  updateTimerDisplay();
  saveStateSoon();
  render();
});

timerTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const addedMinutes = Number(button.dataset.minutes);
    state.timerMinutes += addedMinutes;
    timerSeconds += addedMinutes * 60;
    resetTimerNotifications();
    addFocusPlanned(addedMinutes);
    saveStateSoon();
    renderTimerTabs();
    updateTimerDisplay();
    renderHistory();
  });
});

timerDisplay.addEventListener("focus", () => {
  timerDisplay.value = String(Math.ceil(timerSeconds / 60));
  timerDisplay.select();
});

timerDisplay.addEventListener("beforeinput", (event) => {
  if (!event.data) return;

  if (!/^\d+$/.test(event.data)) {
    event.preventDefault();
  }
});

timerDisplay.addEventListener("input", () => {
  timerDisplay.value = timerDisplay.value.replace(/\D/g, "");
});

timerDisplay.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;

  event.preventDefault();
  applyTypedTimerValue();
  timerDisplay.blur();
});

timerDisplay.addEventListener("blur", () => {
  applyTypedTimerValue();
});

startPauseButton.addEventListener("click", () => {
  if (timerSeconds <= 0) return;

  if (timerId) {
    stopTimer();
    return;
  }

  requestNotificationPermission();
  ensureCurrentTimerIsPlanned();
  beginActiveTaskTimer();
  startPauseButton.textContent = "Pause";
  timerId = window.setInterval(() => {
    timerSeconds -= 1;
    updateTimerDisplay();
    notifyTimerThreshold();

    if (timerSeconds <= 0) {
      completeFocusSession();
    }
  }, 1000);
});

completeTimerButton.addEventListener("click", () => {
  if (timerSeconds <= 0) return;

  ensureCurrentTimerIsPlanned();
  completeFocusSession();
});

resetTimerButton.addEventListener("click", () => {
  stopTimer();
  state.timerMinutes = 0;
  timerSeconds = 0;
  resetTimerNotifications();
  saveStateSoon();
  updateTimerDisplay();
});

historyDateSelect.addEventListener("change", () => {
  loadHistoryEditor(historyDateSelect.value);
});

historyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveHistoryEdits();
});

exportCsvButton.addEventListener("click", exportHistoryCsv);

function completeTask(taskId) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task) return;

  if (state.activeTaskId === taskId) {
    clearActiveTask();
  }
  state.tasks = state.tasks.filter((entry) => entry.id !== taskId);
  addCompletedTask(task.text);
  state.doneLog.unshift({
    id: crypto.randomUUID(),
    type: "task",
    text: task.text,
    startedAt: "",
    finishedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  });
  saveStateSoon();
  render();
}

function restoreDoneItem(doneId) {
  if (state.tasks.length >= TASK_LIMIT) return;

  const doneItem = state.doneLog.find((entry) => entry.id === doneId);
  if (!doneItem) return;
  if (!isRestorableDoneItem(doneItem)) return;

  state.doneLog = state.doneLog.filter((entry) => entry.id !== doneId);
  removeCompletedTask(doneItem.text);
  removeLastTaskTimeEntry(doneItem.text);
  addPlannedTaskIfMissing(doneItem.text);
  const restoredTask = {
    id: crypto.randomUUID(),
    text: doneItem.text,
    done: false
  };
  state.tasks.push(restoredTask);
  state.activeTaskId ||= restoredTask.id;
  saveStateSoon();
  render();
}

function isRestorableDoneItem(entry) {
  return entry.type === "task" || !entry.text.includes("minute focus session");
}

function completeFocusSession() {
  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId);
  const completedMinutes = getCompletedFocusMinutes(activeTask);
  const record = getTodayRecord();
  record.focusMinutesCompleted += completedMinutes;
  record.focusSessionsCompleted += 1;

  if (activeTask) {
    completeActiveTaskFromTimer(activeTask, completedMinutes);
  } else {
    state.doneLog.unshift({
      id: crypto.randomUUID(),
      type: "focus",
      text: `${completedMinutes} minute focus session`,
      completedAt: new Date().toISOString()
    });
  }

  stopTimer();
  state.timerMinutes = 0;
  timerSeconds = 0;
  resetTimerNotifications();
  clearActiveTask();
  saveStateSoon();
  render();
  updateTimerDisplay();
}

function getCompletedFocusMinutes(activeTask) {
  if (activeTask && state.activeTaskStartedAt) {
    return Math.max(1, Math.ceil((Date.now() - new Date(state.activeTaskStartedAt)) / 60000));
  }

  return Math.ceil(Math.max(timerSeconds, state.timerMinutes * 60) / 60);
}

function completeActiveTaskFromTimer(task, fallbackMinutes) {
  const finishedAt = new Date().toISOString();
  const startedAt = state.activeTaskStartedAt || finishedAt;
  const elapsedMinutes = Math.max(0, Math.ceil((new Date(finishedAt) - new Date(startedAt)) / 60000));
  const completedMinutes = elapsedMinutes || fallbackMinutes;
  const plannedMinutes = state.activeTaskPlannedMinutes || Math.ceil(timerSeconds / 60);
  const record = getTodayRecord();

  addCompletedTask(task.text);
  record.taskTimeEntries.push({
    taskName: task.text,
    startedAt,
    finishedAt,
    plannedMinutes,
    completedMinutes
  });
  state.tasks = state.tasks.filter((entry) => entry.id !== task.id);
  state.doneLog.unshift({
    id: crypto.randomUUID(),
    type: "task",
    text: task.text,
    startedAt,
    finishedAt,
    completedAt: finishedAt
  });
}

function selectActiveTask(taskId) {
  state.activeTaskId = taskId;
  state.activeTaskStartedAt = "";
  state.activeTaskPlannedMinutes = Math.ceil(timerSeconds / 60);
  saveStateSoon();
  render();
}

function beginActiveTaskTimer() {
  if (!state.activeTaskId) return;

  state.activeTaskStartedAt ||= new Date().toISOString();
  state.activeTaskPlannedMinutes = Math.ceil(timerSeconds / 60);
  saveStateSoon();
}

function clearActiveTask() {
  state.activeTaskId = "";
  state.activeTaskStartedAt = "";
  state.activeTaskPlannedMinutes = 0;
}

function moveTask(taskId, direction) {
  const index = state.tasks.findIndex((task) => task.id === taskId);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= state.tasks.length) return;

  const [task] = state.tasks.splice(index, 1);
  state.tasks.splice(nextIndex, 0, task);
  saveStateSoon();
  render();
}

function reorderTask(taskId, targetTaskId, position) {
  const fromIndex = state.tasks.findIndex((task) => task.id === taskId);
  const targetIndex = state.tasks.findIndex((task) => task.id === targetTaskId);

  if (fromIndex < 0 || targetIndex < 0 || taskId === targetTaskId) return;

  const [task] = state.tasks.splice(fromIndex, 1);
  const adjustedTargetIndex = state.tasks.findIndex((entry) => entry.id === targetTaskId);
  const insertIndex = position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
  state.tasks.splice(insertIndex, 0, task);
  saveStateSoon();
  render();
}

function getDropPosition(item, clientY) {
  const rect = item.getBoundingClientRect();
  return clientY - rect.top > rect.height / 2 ? "after" : "before";
}

function clearDropTargets(options = {}) {
  taskList.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((item) => {
    item.classList.remove("drop-before", "drop-after");
    if (!options.keepDragging) {
      item.classList.remove("dragging");
    }
    delete item.dataset.dropPosition;
  });
}

function addPlannedTask(text) {
  const record = getTodayRecord();
  record.plannedTaskNames.push(text);
}

function removePlannedTask(text) {
  const record = getTodayRecord();
  removeFirstMatch(record.plannedTaskNames, text);
  removeFirstMatch(record.completedTaskNames, text);
}

function addCompletedTask(text) {
  const record = getTodayRecord();
  addPlannedTaskIfMissing(text);
  record.completedTaskNames.push(text);
}

function removeCompletedTask(text) {
  removeFirstMatch(getTodayRecord().completedTaskNames, text);
}

function addPlannedTaskIfMissing(text) {
  const record = getTodayRecord();
  if (!record.plannedTaskNames.includes(text)) {
    record.plannedTaskNames.push(text);
  }
}

function addFocusPlanned(minutes) {
  getTodayRecord().focusMinutesPlanned += Math.max(0, minutes);
}

function ensureCurrentTimerIsPlanned() {
  const record = getTodayRecord();
  const pendingPlannedMinutes = Math.max(0, record.focusMinutesPlanned - record.focusMinutesCompleted);
  const currentTimerMinutes = Math.ceil(timerSeconds / 60);

  if (currentTimerMinutes > pendingPlannedMinutes) {
    addFocusPlanned(currentTimerMinutes - pendingPlannedMinutes);
  }
}

function render() {
  syncTodayRecord();
  renderTasks();
  renderDoneLog();
  renderTimerTabs();
  renderTaskInputState();
  renderHistory();
}

function renderTasks() {
  taskList.innerHTML = "";

  if (state.tasks.length === 0) {
    taskList.append(createEmptyState(`Add up to ${TASK_LIMIT} tasks for today.`));
    return;
  }

  state.tasks.forEach((task, index) => {
    const item = document.createElement("li");
    item.className = "task-item";
    item.dataset.taskId = task.id;
    item.classList.toggle("active-task", state.activeTaskId === task.id);

    const orderControls = document.createElement("div");
    orderControls.className = "order-controls";

    const moveUpButton = document.createElement("button");
    moveUpButton.className = "mini-icon-button";
    moveUpButton.type = "button";
    moveUpButton.dataset.moveTask = "-1";
    moveUpButton.textContent = "↑";
    moveUpButton.title = "Move task up";
    moveUpButton.disabled = index === 0;

    const moveDownButton = document.createElement("button");
    moveDownButton.className = "mini-icon-button";
    moveDownButton.type = "button";
    moveDownButton.dataset.moveTask = "1";
    moveDownButton.textContent = "↓";
    moveDownButton.title = "Move task down";
    moveDownButton.disabled = index === state.tasks.length - 1;

    orderControls.append(moveUpButton, moveDownButton);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `task-${task.id}`;
    checkbox.ariaLabel = `Complete ${task.text}`;

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const selectButton = document.createElement("button");
    selectButton.className = "mini-button";
    selectButton.type = "button";
    selectButton.dataset.selectTask = "true";
    selectButton.textContent = state.activeTaskId === task.id ? "Working" : "Work on";

    const removeButton = document.createElement("button");
    removeButton.className = "mini-button";
    removeButton.type = "button";
    removeButton.dataset.removeTask = "true";
    removeButton.textContent = "Remove";

    item.append(orderControls, checkbox, text, selectButton, removeButton);
    taskList.append(item);
  });
}

function renderDoneLog() {
  doneList.innerHTML = "";

  if (state.doneLog.length === 0) {
    doneList.append(createEmptyState("Completed work will land here."));
    return;
  }

  state.doneLog.slice(0, 8).forEach((entry) => {
    const item = document.createElement("li");
    item.className = "done-item";
    const restoreDisabled = state.tasks.length >= TASK_LIMIT || !isRestorableDoneItem(entry);

    const restoreButton = document.createElement("button");
    restoreButton.className = "done-restore-button";
    restoreButton.type = "button";
    restoreButton.dataset.restoreDone = entry.id;
    restoreButton.title = restoreDisabled ? "Cannot move back to priority lane" : "Move back to priority lane";
    restoreButton.disabled = restoreDisabled;

    const text = document.createElement("span");
    text.textContent = entry.startedAt && entry.finishedAt
      ? `${entry.text} (${formatTime(entry.startedAt)}-${formatTime(entry.finishedAt)})`
      : entry.text;

    const time = document.createElement("time");
    time.dateTime = entry.completedAt;
    time.textContent = formatTime(entry.completedAt);

    restoreButton.append(text, time);
    item.append(restoreButton);
    doneList.append(item);
  });
}

function renderTimerTabs() {
  timerTabs.forEach((button) => {
    const minutes = Number(button.dataset.minutes);
    button.classList.remove("active");
    button.removeAttribute("aria-pressed");
    button.setAttribute("aria-label", `Add ${minutes} minutes`);
  });
}

function renderTaskInputState() {
  const taskLimitReached = state.tasks.length >= TASK_LIMIT;
  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId);
  taskInput.disabled = taskLimitReached;
  addTaskButton.disabled = taskLimitReached;
  taskInput.placeholder = taskLimitReached ? `Top ${TASK_LIMIT} is full` : "Add a task";
  activeTaskLabel.textContent = activeTask ? `Working on: ${activeTask.text}` : "No active task selected";
}

function renderHistory() {
  syncTodayRecord();
  const selectedDate = historyDateSelect.value || todayKey;
  const dates = Object.keys(state.dailyRecords).sort().reverse();
  historyDateSelect.innerHTML = "";

  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = date;
    historyDateSelect.append(option);
  });

  historyDateSelect.value = dates.includes(selectedDate) ? selectedDate : todayKey;
  loadHistoryEditor(historyDateSelect.value);
}

function loadHistoryEditor(date) {
  const record = getRecord(date);
  historyMainFocus.value = record.mainFocus;
  historyPlannedTasks.value = record.plannedTaskNames.join("\n");
  historyCompletedTasks.value = record.completedTaskNames.join("\n");
  historyDoneItems.value = record.doneLogItems.join("\n");
  historyTaskTimes.value = serializeTaskTimeEntries(record.taskTimeEntries);
  historyFocusPlanned.value = String(record.focusMinutesPlanned);
  historyFocusCompleted.value = String(record.focusMinutesCompleted);
  historyFocusSessions.value = String(record.focusSessionsCompleted);
  historyNotesCount.value = String(record.notesCharacterCount);
  historySummary.innerHTML = "";

  [
    ["Score", `${record.productivityScore}%`],
    ["Completed", `${record.tasksCompleted}/${record.tasksPlanned}`],
    ["Incomplete", String(record.tasksIncomplete)],
    ["Focus", `${record.focusMinutesCompleted}/${record.focusMinutesPlanned} min`]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "history-stat";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    historySummary.append(item);
  });
}

function saveHistoryEdits() {
  const date = historyDateSelect.value;
  const record = getRecord(date);
  record.mainFocus = historyMainFocus.value.trim();
  record.plannedTaskNames = splitLines(historyPlannedTasks.value);
  record.completedTaskNames = splitLines(historyCompletedTasks.value);
  record.doneLogItems = splitLines(historyDoneItems.value);
  record.taskTimeEntries = parseTaskTimeEntries(historyTaskTimes.value);
  record.focusMinutesPlanned = readNumber(historyFocusPlanned.value);
  record.focusMinutesCompleted = readNumber(historyFocusCompleted.value);
  record.focusSessionsCompleted = readNumber(historyFocusSessions.value);
  record.notesCharacterCount = readNumber(historyNotesCount.value);
  finalizeRecord(record);
  saveStateSoon();
  loadHistoryEditor(date);
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.max(timerSeconds % 60, 0).toString().padStart(2, "0");
  if (document.activeElement !== timerDisplay) {
    timerDisplay.value = `${minutes}:${seconds}`;
  }
  startPauseButton.disabled = timerSeconds <= 0 && !timerId;
  completeTimerButton.disabled = timerSeconds <= 0;
}

function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return;

  Notification.requestPermission();
}

function notifyTimerThreshold() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!NOTIFICATION_THRESHOLDS_SECONDS.includes(timerSeconds)) return;
  if (notifiedThresholds.has(timerSeconds)) return;

  notifiedThresholds.add(timerSeconds);
  const minutesLeft = Math.ceil(timerSeconds / 60);
  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId);
  const taskText = activeTask ? ` for ${activeTask.text}` : "";

  new Notification("Focus timer", {
    body: `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} left${taskText}.`,
    tag: `focus-timer-${timerSeconds}`,
    renotify: true
  });
}

function resetTimerNotifications() {
  notifiedThresholds = new Set();
}

function applyTypedTimerValue() {
  const previousMinutes = Math.ceil(timerSeconds / 60);
  const seconds = parseTimerInput(timerDisplay.value);
  const newMinutes = Math.ceil(seconds / 60);
  timerSeconds = seconds;
  state.timerMinutes = newMinutes;
  resetTimerNotifications();

  if (newMinutes > previousMinutes) {
    addFocusPlanned(newMinutes - previousMinutes);
  }

  saveStateSoon();
  updateTimerDisplay();
  renderHistory();
}

function parseTimerInput(value) {
  const cleanValue = value.trim();
  if (!cleanValue) return 0;

  return Math.max(0, Number.parseInt(cleanValue.replace(/\D/g, ""), 10) || 0) * 60;
}

function syncTodayRecord() {
  const record = getTodayRecord();
  record.mainFocus = state.focus;
  record.notesCharacterCount = state.notes.length;
  record.doneLogItems = state.doneLog.map((entry) => entry.text);
  record.incompleteTaskNames = state.tasks.map((task) => task.text);
  finalizeRecord(record);
}

function finalizeRecord(record) {
  record.plannedTaskNames = record.plannedTaskNames || [];
  record.completedTaskNames = record.completedTaskNames || [];
  record.incompleteTaskNames = record.plannedTaskNames.filter((text) => !record.completedTaskNames.includes(text));
  record.doneLogItems = record.doneLogItems || [];
  record.taskTimeEntries = record.taskTimeEntries || [];
  record.tasksPlanned = record.plannedTaskNames.length;
  record.tasksCompleted = record.completedTaskNames.length;
  record.tasksIncomplete = record.incompleteTaskNames.length;
  record.focusMinutesPlanned = readNumber(record.focusMinutesPlanned);
  record.focusMinutesCompleted = readNumber(record.focusMinutesCompleted);
  record.focusSessionsCompleted = readNumber(record.focusSessionsCompleted);
  record.notesCharacterCount = readNumber(record.notesCharacterCount);
  record.productivityScore = calculateProductivityScore(record);
}

function calculateProductivityScore(record) {
  const taskRate = record.tasksPlanned ? record.tasksCompleted / record.tasksPlanned : 0;
  const focusRate = record.focusMinutesPlanned
    ? Math.min(record.focusMinutesCompleted / record.focusMinutesPlanned, 1)
    : 0;
  return Math.round((taskRate * 0.7 + focusRate * 0.3) * 100);
}

function getTodayRecord() {
  return getRecord(todayKey);
}

function getRecord(date) {
  state.dailyRecords[date] ||= createDailyRecord(date);
  return state.dailyRecords[date];
}

function ensureTodayRecord() {
  const record = getTodayRecord();
  state.tasks.forEach((task) => {
    if (!record.plannedTaskNames.includes(task.text)) {
      record.plannedTaskNames.push(task.text);
    }
  });
  state.doneLog.forEach((entry) => {
    if (!record.doneLogItems.includes(entry.text)) {
      record.doneLogItems.push(entry.text);
    }
  });
  finalizeRecord(record);
}

function createDailyRecord(date) {
  return {
    date,
    mainFocus: "",
    tasksPlanned: 0,
    tasksCompleted: 0,
    tasksIncomplete: 0,
    plannedTaskNames: [],
    completedTaskNames: [],
    incompleteTaskNames: [],
    focusMinutesPlanned: 0,
    focusMinutesCompleted: 0,
    focusSessionsCompleted: 0,
    notesCharacterCount: 0,
    doneLogItems: [],
    taskTimeEntries: [],
    productivityScore: 0
  };
}

function exportHistoryCsv() {
  syncTodayRecord();
  const rows = Object.keys(state.dailyRecords)
    .sort()
    .map((date) => {
      const record = getRecord(date);
      finalizeRecord(record);
      return [
        record.date,
        record.mainFocus,
        record.tasksPlanned,
        record.tasksCompleted,
        record.tasksIncomplete,
        record.plannedTaskNames.join("; "),
        record.completedTaskNames.join("; "),
        record.incompleteTaskNames.join("; "),
        record.focusMinutesPlanned,
        record.focusMinutesCompleted,
        record.focusSessionsCompleted,
        record.notesCharacterCount,
        record.doneLogItems.join("; "),
        serializeTaskTimeEntries(record.taskTimeEntries).replaceAll("\n", " | "),
        record.productivityScore
      ];
    });
  const header = [
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
    "productivityScore"
  ];
  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "focus-dashboard-history.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function stopTimer() {
  window.clearInterval(timerId);
  timerId = null;
  startPauseButton.textContent = "Start";
}

function createEmptyState(message) {
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  return item;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readNumber(value) {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function removeFirstMatch(list, text) {
  const index = list.indexOf(text);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function removeLastTaskTimeEntry(taskName) {
  const entries = getTodayRecord().taskTimeEntries;
  const index = entries.map((entry) => entry.taskName).lastIndexOf(taskName);

  if (index >= 0) {
    entries.splice(index, 1);
  }
}

function serializeTaskTimeEntries(entries) {
  return (entries || [])
    .map((entry) => [
      entry.taskName,
      entry.startedAt,
      entry.finishedAt,
      entry.plannedMinutes,
      entry.completedMinutes
    ].join(" | "))
    .join("\n");
}

function parseTaskTimeEntries(value) {
  return splitLines(value).map((line) => {
    const [taskName = "", startedAt = "", finishedAt = "", plannedMinutes = "0", completedMinutes = "0"] =
      line.split("|").map((part) => part.trim());

    return {
      taskName,
      startedAt,
      finishedAt,
      plannedMinutes: readNumber(plannedMinutes),
      completedMinutes: readNumber(completedMinutes)
    };
  });
}

function escapeCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

let saveTimeout = null;
function saveStateSoon() {
  syncTodayRecord();
  saveState.textContent = "Saving";
  window.clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveState.textContent = "Saved";
  }, 180);
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaultState, ...stored };
  } catch {
    return structuredClone(defaultState);
  }
}
