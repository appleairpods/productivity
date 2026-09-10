import {
  t, formatDate, getWeekKey, getWeekDates, minutesToBlocks,
} from './i18n.js';
import {
  loadSettings, saveSettings, getDirections, saveDirection, deleteDirection,
  initDefaultDirection, getTasks, saveTask, deleteTask, addSession, getSessions,
  getAllWeekKeys, exportAllData, importAllData, generateId,
} from './storage.js';

const CIRCUMFERENCE = 2 * Math.PI * 90;

const state = {
  settings: null,
  directions: [],
  tasks: [],
  sessions: [],
  editingDirectionId: null,
  journalFilter: 'all',
  tickInterval: null,
  completingPhase: false,
  persistTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showToast(message) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function schedulePersist() {
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    persistSettings();
    state.persistTimer = null;
  }, 400);
}

async function init() {
  await initDefaultDirection();
  state.settings = await loadSettings();
  state.directions = await getDirections();
  state.tasks = await getTasks();
  state.sessions = await getSessions(getWeekKey());

  applyTheme(state.settings.theme);
  applyLang(state.settings.lang);

  if (!state.settings.onboardingDone) {
    showOnboarding();
  } else {
    showMainApp();
  }

  bindEvents();
  restoreTimerState();
  restoreMusic();
  renderAll();
}

function restoreMusic() {
  if (!state.settings.musicTrack) return;
  const trackBtn = document.querySelector(`.track[data-track="${state.settings.musicTrack}"]`);
  const audio = $(`#audio-${state.settings.musicTrack}`);
  if (trackBtn && audio) {
    trackBtn.classList.add('active');
    audio.play().catch(() => {});
  }
}

function updatePhaseVisuals() {
  const phase = state.settings.timerPhase;
  $('#section-timer').dataset.phase = phase;
  const dir = getActiveDirection();
  const color = phase === 'work' ? (dir?.color || '#14b8a6') : '#60a5fa';
  document.documentElement.style.setProperty('--ring-progress', phase === 'work' ? 'var(--text)' : color);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function applyLang(lang) {
  if (state.settings) state.settings.lang = lang;
  $$('.lang-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach(el => {
    if (el.children.length > 0 && !el.classList.contains('preset')) return;
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key, lang);
  });
  $$('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder, lang);
  });
  $$('.preset-unit').forEach(el => {
    el.textContent = t('min', lang);
  });
  updateOnboardingContent();
}

function showOnboarding() {
  $('#onboarding').classList.remove('hidden');
  $('#main-app').classList.add('hidden');
  state.onboardingStep = 0;
  updateOnboardingContent();
}

function showMainApp() {
  $('#onboarding').classList.add('hidden');
  $('#main-app').classList.remove('hidden');
}

function updateOnboardingContent() {
  const lang = state.settings.lang;
  const step = state.onboardingStep ?? 0;
  const data = t('onboarding', lang);
  const content = Array.isArray(data) ? data[step] : null;
  if (!content) return;

  $('#onboarding-title').textContent = content.title;
  $('#onboarding-text').textContent = content.text;
  const sub = $('#onboarding-subtext');
  if (content.subtext) {
    sub.textContent = content.subtext;
    sub.classList.remove('hidden');
  } else {
    sub.classList.add('hidden');
  }

  $$('.onboarding-dots .dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === step);
  });

  $('#onboarding-back').classList.toggle('hidden', step === 0);
  const isLast = step === 2;
  $('#onboarding-next').textContent = isLast ? t('setupDirections', lang) : t('next', lang);
}

function getActiveDirection() {
  return state.directions.find(d => d.id === state.settings.activeDirectionId)
    || state.directions.find(d => d.isDefault)
    || state.directions[0];
}

function getDirectionName(dir) {
  if (dir.nameKey) return t(dir.nameKey, state.settings.lang);
  return dir.name;
}

function getPhaseDuration(phase) {
  const s = state.settings;
  if (phase === 'work') return s.workDuration * 60;
  if (phase === 'shortBreak') return s.shortBreak * 60;
  return s.longBreak * 60;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const remaining = state.settings.timerRemaining;
  $('#timer-display').textContent = formatTime(remaining);
  $('#btn-pomodoro-num').textContent = `#${state.settings.pomodoroNumber}`;

  const total = getPhaseDuration(state.settings.timerPhase);
  const progress = 1 - remaining / total;
  const offset = CIRCUMFERENCE * (1 - progress);
  $('.ring-progress').style.strokeDashoffset = offset;

  const dir = getActiveDirection();
  $('#active-direction-label').textContent = getDirectionName(dir);
  $('#active-direction-btn').textContent = getDirectionName(dir);

  const startBtn = $('#btn-start');
  const label = startBtn.querySelector('span:last-child');
  const playIcon = startBtn.querySelector('.play-icon');
  if (state.settings.timerRunning) {
    startBtn.classList.add('running');
    label.textContent = t('pause', state.settings.lang);
    playIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  } else {
    startBtn.classList.remove('running');
    label.textContent = t('start', state.settings.lang);
    playIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }

  updatePhaseVisuals();

  $$('.phase-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.phase === state.settings.timerPhase);
  });

  $$('.preset').forEach(p => {
    const min = p.dataset.min;
    if (min === 'custom') {
      p.classList.toggle('active', ![25, 45, 50].includes(state.settings.workDuration));
    } else {
      p.classList.toggle('active', parseInt(min) === state.settings.workDuration);
    }
  });
}

function startTimerTick() {
  stopTimerTick();
  state.settings.timerStartedAt = Date.now();
  state.tickInterval = setInterval(tick, 1000);
}

function stopTimerTick() {
  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }
}

function tick() {
  if (!state.settings.timerRunning) return;
  if (state.settings.timerRemaining <= 0) {
    completePhase();
    return;
  }
  state.settings.timerRemaining--;
  updateTimerDisplay();
  schedulePersist();
}

function restoreTimerState() {
  if (state.settings.timerRunning && state.settings.timerStartedAt) {
    const elapsed = Math.floor((Date.now() - state.settings.timerStartedAt) / 1000);
    state.settings.timerRemaining = Math.max(0, state.settings.timerRemaining - elapsed);
    if (state.settings.timerRemaining <= 0) {
      completePhase();
    } else {
      startTimerTick();
    }
  }
  updateTimerDisplay();
}

async function completePhase() {
  if (state.completingPhase) return;
  state.completingPhase = true;
  stopTimerTick();

  const phase = state.settings.timerPhase;
  const totalSeconds = getPhaseDuration(phase);
  const completedSeconds = totalSeconds - state.settings.timerRemaining;

  if (phase === 'work' && completedSeconds >= 60) {
    const dir = getActiveDirection();
    await addSession({
      id: generateId(),
      directionId: dir.id,
      directionName: getDirectionName(dir),
      phase: 'work',
      durationSeconds: completedSeconds,
      pomodoroNumber: state.settings.pomodoroNumber,
      weekKey: getWeekKey(),
      completedAt: Date.now(),
    });
    state.sessions = await getSessions(getWeekKey());
  }

  notifyPhaseComplete(phase);

  if (phase === 'work') {
    const isLongBreak = state.settings.pomodoroNumber % state.settings.longBreakInterval === 0;
    state.settings.timerPhase = isLongBreak ? 'longBreak' : 'shortBreak';
  } else {
    state.settings.timerPhase = 'work';
    if (phase === 'shortBreak' || phase === 'longBreak') {
      state.settings.pomodoroNumber++;
    }
  }

  state.settings.timerRemaining = getPhaseDuration(state.settings.timerPhase);
  state.settings.timerRunning = false;
  state.settings.timerStartedAt = null;

  await persistSettings();
  updateTimerDisplay();
  renderWeeklyChart();
  renderJournal();
  state.completingPhase = false;
}

function notifyPhaseComplete(phase) {
  const lang = state.settings.lang;
  const title = t('timerDone', lang);
  const body = phase === 'work' ? t('workDone', lang) : t('breakDone', lang);

  if (state.settings.notificationsEnabled && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '🍅' });
  }

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.start();
    setTimeout(() => osc.stop(), 200);
  } catch (_) { /* ignore */ }
}

async function persistSettings() {
  await saveSettings(state.settings);
}

function toggleTimer() {
  state.settings.timerRunning = !state.settings.timerRunning;
  if (state.settings.timerRunning) {
    startTimerTick();
  } else {
    stopTimerTick();
    state.settings.timerStartedAt = null;
  }
  persistSettings();
  updateTimerDisplay();
}

function skipPhase() {
  stopTimerTick();
  state.settings.timerRemaining = 0;
  completePhase();
}

function setPhase(phase) {
  stopTimerTick();
  state.settings.timerPhase = phase;
  state.settings.timerRemaining = getPhaseDuration(phase);
  state.settings.timerRunning = false;
  state.settings.timerStartedAt = null;
  persistSettings();
  updateTimerDisplay();
}

function setWorkDuration(minutes) {
  state.settings.workDuration = minutes;
  if (state.settings.timerPhase === 'work' && !state.settings.timerRunning) {
    state.settings.timerRemaining = minutes * 60;
  }
  persistSettings();
  updateTimerDisplay();
}

function renderFocusMode() {
  const lang = state.settings.lang;
  const parallel = !!state.settings.parallelMode;

  $$('.mode-btn').forEach(btn => {
    const isParallelBtn = btn.dataset.mode === 'parallel';
    btn.classList.toggle('active', isParallelBtn ? parallel : !parallel);
  });

  $('#view-home')?.classList.toggle('parallel-mode', parallel);

  const hint = $('#mode-hint');
  if (hint) {
    hint.textContent = parallel ? t('modeParallelHint', lang) : t('modeSingleHint', lang);
    hint.classList.remove('hidden');
  }
}

function setFocusMode(mode) {
  const nextParallel = mode === 'parallel';
  if (state.settings.parallelMode === nextParallel) {
    if (!nextParallel) {
      $('#directions-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
  state.settings.parallelMode = nextParallel;
  persistSettings();
  renderFocusMode();
}

function renderDirections() {
  const container = $('#directions-list');
  container.innerHTML = '';
  const activeId = state.settings.activeDirectionId;

  state.directions.forEach(dir => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `direction-chip${dir.id === activeId ? ' active' : ''}`;
    btn.style.setProperty('--chip-color', dir.color);

    const usedBlocks = getUsedBlocks(dir.id);
    let meta;
    if (dir.unlimited) {
      meta = dir.isDefault ? t('otherMeta', state.settings.lang) : t('noLimitShort', state.settings.lang);
    } else {
      meta = `${usedBlocks.toFixed(1)} / ${dir.weeklyBlocks} ${t('blocksUsed', state.settings.lang)}`;
    }

    btn.innerHTML = `<span class="name">${escapeHtml(getDirectionName(dir))}</span><span class="meta">${meta}</span>`;
    btn.addEventListener('click', () => selectDirection(dir.id));
    container.appendChild(btn);
  });
}

function renderSettingsDirections() {
  const list = $('#settings-directions');
  list.innerHTML = '';
  state.directions.forEach(dir => {
    const li = document.createElement('li');
    let meta = dir.unlimited ? t('noLimitShort', state.settings.lang) : `${dir.weeklyBlocks} ${t('blocksUsed', state.settings.lang)}`;
    if (dir.isDefault) meta = t('otherMeta', state.settings.lang);

    li.innerHTML = `
      <span><span style="color:${dir.color}">●</span> ${escapeHtml(getDirectionName(dir))} · ${meta}</span>
      <span class="dir-actions">
        ${dir.isDefault ? '' : `<button type="button" data-edit="${dir.id}">${t('edit', state.settings.lang)}</button>`}
        ${dir.isDefault ? '' : `<button type="button" data-del="${dir.id}">${t('delete', state.settings.lang)}</button>`}
      </span>`;
    list.appendChild(li);
  });

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openDirectionModal(btn.dataset.edit));
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => removeDirection(btn.dataset.del));
  });
}

function getUsedBlocks(directionId, weekKey = getWeekKey()) {
  return state.sessions
    .filter(s => s.directionId === directionId && s.weekKey === weekKey && s.phase === 'work')
    .reduce((sum, s) => sum + minutesToBlocks(s.durationSeconds / 60), 0);
}

function selectDirection(id) {
  state.settings.activeDirectionId = id;
  persistSettings();
  renderDirections();
  updateTimerDisplay();
}

async function removeDirection(id) {
  if (id === 'default') return;
  await deleteDirection(id);
  if (state.settings.activeDirectionId === id) {
    state.settings.activeDirectionId = 'default';
  }
  state.directions = await getDirections();
  await persistSettings();
  renderAll();
}

function renderTasks() {
  const list = $('#tasks-list');
  const activeTasks = state.tasks.filter(tk => !tk.completed);
  $('#tasks-count').textContent = activeTasks.length;

  if (state.tasks.length === 0) {
    list.innerHTML = `<p class="empty-state">${t('noTasks', state.settings.lang)}</p>`;
    return;
  }

  list.innerHTML = '';
  state.tasks.forEach(task => {
    const dir = state.directions.find(d => d.id === task.directionId);
    const item = document.createElement('div');
    item.className = 'task-item';
    item.innerHTML = `
      <input type="checkbox" ${task.completed ? 'checked' : ''} data-task-check="${task.id}">
      <span class="task-title ${task.completed ? 'done' : ''}">${escapeHtml(task.title)}</span>
      <span class="task-direction">${dir ? escapeHtml(getDirectionName(dir)) : ''}</span>
      <span class="task-actions">
        <button type="button" data-task-del="${task.id}">✕</button>
      </span>`;
    list.appendChild(item);
  });

  list.querySelectorAll('[data-task-check]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const task = state.tasks.find(tk => tk.id === e.target.dataset.taskCheck);
      if (task) {
        task.completed = e.target.checked;
        await saveTask(task);
        renderTasks();
      }
    });
  });

  list.querySelectorAll('[data-task-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteTask(btn.dataset.taskDel);
      state.tasks = await getTasks();
      renderTasks();
    });
  });
}

function renderWeeklyChart() {
  const container = $('#weekly-chart');
  const lang = state.settings.lang;
  const weekKey = getWeekKey();
  const today = new Date();
  const weekDates = getWeekDates(today);

  $('#weekly-title').textContent = `${t('weeklyLimiter', lang)} · ${t('on', lang)} ${formatDate(today, lang)}`;

  const dirsWithLimits = state.directions.filter(d => !d.unlimited && !d.isDefault);

  if (dirsWithLimits.length === 0) {
    container.innerHTML = `<p class="empty-state">${t('weeklyEmpty', lang)}</p>`;
  } else {
    container.innerHTML = dirsWithLimits.map(dir => {
      const used = getUsedBlocks(dir.id, weekKey);
      const limit = dir.weeklyBlocks || 1;
      const pct = Math.min(100, (used / limit) * 100);
      return `
        <div class="week-row">
          <span class="label" style="color:${dir.color}">${escapeHtml(getDirectionName(dir))}</span>
          <div class="bar-wrap">
            <div class="bar-used" style="width:${pct}%;background:${dir.color}"></div>
          </div>
          <span class="stats">${used.toFixed(1)}/${limit}</span>
        </div>`;
    }).join('');
  }

  const daysHtml = weekDates.map((date, i) => {
    const isToday = date.toDateString() === today.toDateString();
    const daySessions = state.sessions.filter(s => {
      const sd = new Date(s.completedAt);
      return sd.toDateString() === date.toDateString() && s.phase === 'work';
    });
    const blocks = daySessions.reduce((sum, s) => sum + minutesToBlocks(s.durationSeconds / 60), 0);
    return `
      <div class="day-cell${isToday ? ' today' : ''}">
        <div class="day-name">${t('weekDays', lang)[i]}</div>
        <div class="day-blocks">${blocks.toFixed(1)}</div>
      </div>`;
  }).join('');

  container.innerHTML += `<div class="week-days">${daysHtml}</div>`;
}

async function renderJournal() {
  const list = $('#journal-list');
  const filters = $('#journal-filters');
  const lang = state.settings.lang;

  const weekKeys = await getAllWeekKeys();
  filters.innerHTML = `
    <button type="button" class="${state.journalFilter === 'all' ? 'active' : ''}" data-week="all">${t('allWeeks', lang)}</button>
    ${weekKeys.slice(0, 8).map(wk => `
      <button type="button" class="${state.journalFilter === wk ? 'active' : ''}" data-week="${wk}">${wk}</button>
    `).join('')}`;

  filters.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.journalFilter = btn.dataset.week;
      await renderJournal();
    });
  });

  let sessions;
  if (state.journalFilter === 'all') {
    sessions = await getSessions();
  } else {
    sessions = await getSessions(state.journalFilter);
  }

  if (sessions.length === 0) {
    list.innerHTML = `<p class="empty-state">${t('journalEmpty', lang)}</p>`;
    return;
  }

  list.innerHTML = sessions.slice(0, 100).map(s => {
    const phaseLabel = s.phase === 'work' ? t('phaseWork', lang)
      : s.phase === 'shortBreak' ? t('phaseShortBreak', lang) : t('phaseLongBreak', lang);
    const date = new Date(s.completedAt);
    const mins = Math.round(s.durationSeconds / 60);
    return `
      <div class="journal-entry">
        <div class="left">
          <span class="phase">${phaseLabel} · ${escapeHtml(s.directionName || '')}</span>
          <span class="meta">${date.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')} · #${s.pomodoroNumber || 1}</span>
        </div>
        <span class="duration">${mins} ${t('min', lang)}</span>
      </div>`;
  }).join('');
}

function renderAll() {
  renderDirections();
  renderSettingsDirections();
  renderTasks();
  renderWeeklyChart();
  renderJournal();
  updateTimerDisplay();

  $('#setting-short-break').value = state.settings.shortBreak;
  $('#setting-long-break').value = state.settings.longBreak;
  $('#setting-long-break-interval').value = state.settings.longBreakInterval;

  renderFocusMode();
}

function openDirectionModal(id = null) {
  state.editingDirectionId = id;
  const modal = $('#direction-modal');
  modal.classList.remove('hidden');

  if (id) {
    const dir = state.directions.find(d => d.id === id);
    $('#direction-modal-title').textContent = t('edit', state.settings.lang);
    $('#direction-name').value = dir.nameKey ? '' : dir.name;
    $('#direction-blocks').value = dir.weeklyBlocks || 10;
    $('#direction-unlimited').checked = dir.unlimited;
    $('#direction-color').value = dir.color;
  } else {
    $('#direction-modal-title').textContent = t('addDirection', state.settings.lang);
    $('#direction-name').value = '';
    $('#direction-blocks').value = 10;
    $('#direction-unlimited').checked = false;
    $('#direction-color').value = '#14b8a6';
  }
}

async function saveDirectionFromModal() {
  const name = $('#direction-name').value.trim();
  if (!name && !state.editingDirectionId) return;

  const unlimited = $('#direction-unlimited').checked;
  const dir = {
    id: state.editingDirectionId || generateId(),
    name: name || 'Direction',
    weeklyBlocks: unlimited ? null : parseInt($('#direction-blocks').value) || 10,
    unlimited,
    color: $('#direction-color').value,
    isDefault: false,
  };

  await saveDirection(dir);
  state.directions = await getDirections();
  $('#direction-modal').classList.add('hidden');
  showToast(t('directionSaved', state.settings.lang));
  renderAll();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function bindEvents() {
  // Language
  $$('.lang-switch button').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.settings.lang = btn.dataset.lang;
      await persistSettings();
      applyLang(btn.dataset.lang);
      renderAll();
    });
  });

  // Onboarding
  $('#onboarding-next').addEventListener('click', async () => {
    if (state.onboardingStep < 2) {
      state.onboardingStep++;
      updateOnboardingContent();
    } else {
      state.settings.onboardingDone = true;
      await persistSettings();
      showMainApp();
    }
  });

  $('#onboarding-back').addEventListener('click', () => {
    if (state.onboardingStep > 0) {
      state.onboardingStep--;
      updateOnboardingContent();
    }
  });

  $('#onboarding-skip').addEventListener('click', async () => {
    state.settings.onboardingDone = true;
    await persistSettings();
    showMainApp();
  });

  $$('.onboarding-dots .dot').forEach(dot => {
    dot.addEventListener('click', () => {
      state.onboardingStep = parseInt(dot.dataset.step);
      updateOnboardingContent();
    });
  });

  // Timer
  $('#btn-start').addEventListener('click', toggleTimer);
  $('#btn-skip').addEventListener('click', skipPhase);

  $$('.phase-tab').forEach(tab => {
    tab.addEventListener('click', () => setPhase(tab.dataset.phase));
  });

  $$('.preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const min = preset.dataset.min;
      if (min === 'custom') {
        $('#custom-work-min').value = state.settings.workDuration;
        $('#custom-duration-modal').classList.remove('hidden');
      } else {
        setWorkDuration(parseInt(min));
      }
    });
  });

  $('#custom-save').addEventListener('click', () => {
    setWorkDuration(parseInt($('#custom-work-min').value) || 25);
    $('#custom-duration-modal').classList.add('hidden');
  });
  $('#custom-cancel').addEventListener('click', () => {
    $('#custom-duration-modal').classList.add('hidden');
  });

  $('#btn-pomodoro-num').addEventListener('click', () => {
    $('#pomodoro-number-input').value = state.settings.pomodoroNumber;
    $('#pomodoro-modal').classList.remove('hidden');
  });
  $('#pomodoro-save').addEventListener('click', async () => {
    state.settings.pomodoroNumber = parseInt($('#pomodoro-number-input').value) || 1;
    await persistSettings();
    updateTimerDisplay();
    $('#pomodoro-modal').classList.add('hidden');
  });
  $('#pomodoro-cancel').addEventListener('click', () => {
    $('#pomodoro-modal').classList.add('hidden');
  });

  // Scroll
  $('#scroll-down').addEventListener('click', () => {
    $('#section-dashboard').scrollIntoView({ behavior: 'smooth' });
  });
  $('#scroll-up').addEventListener('click', () => {
    $('#section-timer').scrollIntoView({ behavior: 'smooth' });
  });

  // Navigation
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      $$('.view').forEach(v => v.classList.remove('active'));
      $(`#view-${item.dataset.view}`).classList.add('active');
    });
  });

  // Directions
  $('#btn-add-direction').addEventListener('click', () => openDirectionModal());
  $('#settings-add-direction').addEventListener('click', () => openDirectionModal());
  $('#direction-save').addEventListener('click', saveDirectionFromModal);
  $('#direction-cancel').addEventListener('click', () => {
    $('#direction-modal').classList.add('hidden');
  });

  // Tasks
  $('#btn-add-task').addEventListener('click', addNewTask);
  $('#new-task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewTask();
  });

  async function addNewTask() {
    const title = $('#new-task-input').value.trim();
    if (!title) return;
    const task = {
      id: generateId(),
      title,
      directionId: state.settings.activeDirectionId,
      completed: false,
      createdAt: Date.now(),
    };
    await saveTask(task);
    state.tasks = await getTasks();
    $('#new-task-input').value = '';
    showToast(t('taskAdded', state.settings.lang));
    renderTasks();
  }

  $('#mode-toggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    setFocusMode(btn.dataset.mode === 'parallel' ? 'parallel' : 'single');
  });

  // Settings
  $('#btn-settings').addEventListener('click', () => {
    $('#settings-modal').classList.remove('hidden');
    renderSettingsDirections();
  });
  $('#settings-back').addEventListener('click', () => {
    $('#settings-modal').classList.add('hidden');
  });
  $('.settings-content .modal-backdrop').addEventListener('click', () => {
    $('#settings-modal').classList.add('hidden');
  });

  $$('.theme-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.settings.theme = btn.dataset.theme;
      await persistSettings();
      applyTheme(btn.dataset.theme);
    });
  });

  ['setting-short-break', 'setting-long-break', 'setting-long-break-interval'].forEach(id => {
    $(`#${id}`).addEventListener('change', async (e) => {
      const key = id.replace('setting-', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const map = {
        shortBreak: 'shortBreak',
        longBreak: 'longBreak',
        longBreakInterval: 'longBreakInterval',
      };
      state.settings[map[key] || key] = parseInt(e.target.value);
      await persistSettings();
      if (state.settings.timerPhase !== 'work' && !state.settings.timerRunning) {
        state.settings.timerRemaining = getPhaseDuration(state.settings.timerPhase);
        updateTimerDisplay();
      }
    });
  });

  $('#btn-enable-notifications').addEventListener('click', requestNotifications);
  $('#btn-notifications').addEventListener('click', requestNotifications);

  async function requestNotifications() {
    if (!('Notification' in window)) {
      showToast('Notifications not supported');
      return;
    }
    const perm = await Notification.requestPermission();
    state.settings.notificationsEnabled = perm === 'granted';
    await persistSettings();
    $('#btn-notifications').classList.toggle('active', perm === 'granted');
    showToast(t(perm === 'granted' ? 'notificationsGranted' : 'notificationsDenied', state.settings.lang));
  }

  if (state.settings.notificationsEnabled && Notification.permission === 'granted') {
    $('#btn-notifications').classList.add('active');
  }

  $('#btn-reset-onboarding').addEventListener('click', async () => {
    state.settings.onboardingDone = false;
    await persistSettings();
    $('#settings-modal').classList.add('hidden');
    showOnboarding();
  });

  // Export / Import
  $('#btn-export').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-limit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importAllData(data);
      state.settings = await loadSettings();
      state.directions = await getDirections();
      state.tasks = await getTasks();
      state.sessions = await getSessions(getWeekKey());
      renderAll();
      showToast(t('importSuccess', state.settings.lang));
    } catch (err) {
      console.error(err);
      showToast(t('importError', state.settings.lang));
    }
    e.target.value = '';
  });

  // Music
  $('#btn-music').addEventListener('click', () => {
    $('#music-panel').classList.toggle('hidden');
  });
  $('.side-panel .close-panel').addEventListener('click', () => {
    $('#music-panel').classList.add('hidden');
  });

  const audios = {
    rain: $('#audio-rain'),
    forest: $('#audio-forest'),
    cafe: $('#audio-cafe'),
  };

  $$('.track').forEach(track => {
    track.addEventListener('click', () => {
      Object.values(audios).forEach(a => { a.pause(); a.currentTime = 0; });
      $$('.track').forEach(t => t.classList.remove('active'));

      const name = track.dataset.track;
      if (name !== 'off' && audios[name]) {
        audios[name].play().catch(() => {});
        track.classList.add('active');
        state.settings.musicTrack = name;
      } else {
        state.settings.musicTrack = null;
      }
      persistSettings();
    });
  });

  // Modal backdrops
  $$('.modal-content.small').forEach(content => {
    const backdrop = content.parentElement.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        content.parentElement.classList.add('hidden');
      });
    }
  });

  // Visibility change — recalculate timer
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.settings.timerRunning) {
      restoreTimerState();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, textarea, select')) return;
    if (!$('#settings-modal').classList.contains('hidden')) return;
    if (!$('#direction-modal').classList.contains('hidden')) return;
    if (!$('#custom-duration-modal').classList.contains('hidden')) return;
    if (!$('#pomodoro-modal').classList.contains('hidden')) return;
    if (!$('#onboarding').classList.contains('hidden')) return;
    e.preventDefault();
    toggleTimer();
  });
}

init().catch(console.error);
