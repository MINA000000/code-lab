// Student page: log in, list tasks, write code, run it and submit it for testing.
const state = {
  access: null,
  tasks: [],
  chapters: [],
  materials: [],
  quizzes: [],
  scores: new Map(), // my marks: quiz_id -> score
  extra: [],         // my extra points from the teacher: { points, reason, given_on }
  levels: [],        // rank levels: { title, min_points, color }
  submissions: [], // my submissions, without code: { task_id, passed, total, created_at }
  task: null,
  editor: null,
  busy: false,
};

// A password-reset link lands here with "type=recovery" in the URL.
let recoveringPassword = location.hash.includes("type=recovery");

// ---------- start ----------

async function boot() {
  document.title = CONFIG.SITE_NAME;
  $("#brand").textContent = CONFIG.SITE_NAME;
  if (!isConfigured) {
    $("#setup").innerHTML = setupNotice();
    showView("setup");
    return;
  }
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recoveringPassword = true;
      showView("new-password");
    }
  });
  if (recoveringPassword) {
    await sb.auth.getSession();
    showView("new-password");
    return;
  }
  await loadMain();
}

async function loadMain() {
  showView("loading");
  try {
    state.access = await getAccess();
  } catch (err) {
    toast("Could not reach the server: " + err.message, "error");
    return;
  }
  const access = state.access;
  if (!access) {
    $("#user-nav").hidden = true;
    setAuthMode("login");
    showView("login");
    return;
  }
  if (access.denied) {
    $("#denied-email").textContent = access.email;
    showView("denied");
    return;
  }
  $("#user-nav").hidden = false;
  $("#user-email").textContent = access.email;
  $("#teacher-link").hidden = access.role !== "teacher";
  $("#hello").textContent = access.full_name ? `Hi ${access.full_name.split(" ")[0]} 👋` : "Your tasks";
  await loadData();
  route();
}

async function loadData() {
  const [tasksRes, subsRes, materialsRes, chaptersRes, quizzesRes, scoresRes, extraRes, levelsRes] = await Promise.all([
    sb.from("tasks")
      .select("*")
      .eq("published", true)
      .order("sort_order")
      .order("id"),
    sb.from("submissions")
      .select("task_id, passed, total, created_at")
      .eq("user_id", state.access.user.id)
      .order("created_at", { ascending: false }),
    sb.from("materials")
      .select("*")
      .eq("published", true)
      .order("created_at", { ascending: false }),
    sb.from("chapters").select("*").order("sort_order").order("id"),
    sb.from("quizzes")
      .select("*")
      .eq("published", true)
      .order("quiz_date", { ascending: false })
      .order("id", { ascending: false }),
    sb.from("quiz_scores").select("quiz_id, score").eq("email", state.access.email),
    sb.from("extra_points")
      .select("points, reason, given_on")
      .eq("email", state.access.email)
      .order("given_on", { ascending: false })
      .order("id", { ascending: false }),
    sb.from("rank_levels").select("*").order("min_points"),
  ]);
  const error = tasksRes.error || subsRes.error || materialsRes.error || chaptersRes.error ||
    quizzesRes.error || scoresRes.error || extraRes.error || levelsRes.error;
  if (error) toast("Could not load everything: " + error.message, "error");
  state.tasks = tasksRes.data || [];
  state.submissions = subsRes.data || [];
  state.materials = materialsRes.data || [];
  state.chapters = chaptersRes.data || [];
  state.quizzes = quizzesRes.data || [];
  state.scores = new Map((scoresRes.data || []).map((s) => [s.quiz_id, Number(s.score)]));
  state.extra = (extraRes.data || []).map((e) => ({ ...e, points: Number(e.points) }));
  state.levels = levelsRes.data || [];
}

const LIST_TABS = { "#/materials": "materials", "#/quizzes": "quizzes", "#/top": "top" };

function route() {
  if (!state.access || state.access.denied || recoveringPassword) return;
  const match = location.hash.match(/^#\/task\/(\d+)/);
  if (match) openTask(Number(match[1]));
  else showTaskList(LIST_TABS[location.hash] || "tasks");
}

window.addEventListener("hashchange", route);

// ---------- task list ----------

function bestResult(taskId) {
  let best = null;
  for (const s of state.submissions) {
    if (s.task_id !== taskId) continue;
    if (!best || s.passed / (s.total || 1) > best.passed / (best.total || 1)) best = s;
  }
  return best;
}

function isPassed(taskId) {
  const best = bestResult(taskId);
  return !!best && best.total > 0 && best.passed === best.total;
}

function chapterCard(group, tiles, progress = "") {
  return `<section class="chapter">
    <div class="chapter-head">
      <h2>${escapeHtml(group.title)}</h2>
      <span class="muted small">${group.items.length} ${group.items.length === 1 ? "item" : "items"}</span>
      ${progress}
    </div>
    <div class="tile-grid">${tiles}</div>
  </section>`;
}

// "done" | "partial" | "new", plus the label shown on the tile
function taskStatus(taskId) {
  const best = bestResult(taskId);
  if (!best) return { state: "new", label: "Not started" };
  if (best.total > 0 && best.passed === best.total) return { state: "done", label: "Solved" };
  return { state: "partial", label: `${best.passed} of ${best.total} tests` };
}

const STATUS_ICON = { done: "✓", partial: "◐", new: "" };

function showTaskList(tab = "tasks") {
  state.task = null;
  $all("[data-stab]").forEach((t) => t.classList.toggle("active", t.dataset.stab === tab));
  $("#task-list").hidden = tab !== "tasks";
  $("#material-list").hidden = tab !== "materials";
  $("#quiz-list").hidden = tab !== "quizzes";
  $("#top-list").hidden = tab !== "top";
  if (tab === "quizzes") renderQuizResults();
  if (tab === "top") loadTopStudents();

  const taskGroups = groupByChapter(state.tasks, state.chapters);
  $("#task-list").innerHTML = taskGroups.length ? taskGroups.map((g) => {
    const solved = g.items.filter((t) => isPassed(t.id)).length;
    const pct = Math.round((solved / g.items.length) * 100);
    const progress = `<span class="chapter-progress">
      <span class="small nowrap"><strong>${solved}</strong>/${g.items.length} solved</span>
      <span class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>
    </span>`;
    const tiles = g.items.map((t, i) => {
      const status = taskStatus(t.id);
      return `
      <a class="tile tile-${status.state}" href="#/task/${t.id}">
        <span class="tile-top">
          <span class="tile-num">${String(i + 1).padStart(2, "0")}</span>
          <span class="badge badge-${t.language}">${LANG_LABEL[t.language]}</span>
        </span>
        <span class="tile-title">${escapeHtml(t.title)}</span>
        <span class="tile-foot">
          <span class="tile-status"><span class="status-dot" aria-hidden="true">${STATUS_ICON[status.state]}</span>${status.label}</span>
          <span class="tile-arrow" aria-hidden="true">→</span>
        </span>
      </a>`;
    }).join("");
    return chapterCard(g, tiles, progress);
  }).join("") : `<p class="muted">No tasks yet. Check back later!</p>`;

  const materialGroups = groupByChapter(state.materials, state.chapters);
  $("#material-list").innerHTML = materialGroups.length ? materialGroups.map((g) => chapterCard(g,
    g.items.map((m) => `
      <div class="tile file-tile" data-id="${m.id}">
        <span class="file-main">
          <span class="material-icon" aria-hidden="true">PDF</span>
          <span>
            <span class="tile-title">${escapeHtml(m.title)}</span>
            <span class="muted small">${formatSize(m.size_bytes)} · ${formatDate(m.created_at).split(",").slice(0, 2).join(",")}</span>
          </span>
        </span>
        <span class="file-actions">
          <button class="btn btn-small" data-open>Open</button>
          <button class="btn btn-small btn-primary" data-download>⤓ Download</button>
        </span>
      </div>`).join(""))).join("") : `<p class="muted">No materials yet.</p>`;
  showView("tasks");
}

$("#material-list").addEventListener("click", (e) => {
  const button = e.target.closest("[data-open], [data-download]");
  if (!button) return;
  const id = Number(button.closest("[data-id]").dataset.id);
  const material = state.materials.find((m) => m.id === id);
  if (material) openMaterial(material, button.hasAttribute("data-download"));
});

// ---------- quiz results ----------

function scoreLevel(pct) {
  if (pct >= 85) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

function renderQuizResults() {
  const box = $("#quiz-list");
  if (!state.quizzes.length && !state.extra.length) {
    box.innerHTML = `<p class="muted">No quizzes yet. Your marks will show up here.</p>`;
    return;
  }
  const marked = state.quizzes.filter((q) => state.scores.has(q.id));
  const quizPoints = marked.reduce((sum, q) => sum + state.scores.get(q.id), 0);
  const extraPoints = state.extra.reduce((sum, e) => sum + e.points, 0);
  const possible = marked.reduce((sum, q) => sum + Number(q.max_score), 0);
  const avg = possible ? Math.round((quizPoints / possible) * 100) : 0;
  const signed = (n) => (n > 0 ? "+" : "") + formatPoints(n);
  const total = quizPoints + extraPoints;
  const next = nextLevel(total, state.levels);
  const levelStat = state.levels.length ? `<div class="stat">
      <span class="stat-value stat-level">${levelTitle(total, state.levels) || "—"}</span>
      <span class="muted small">${next ? `${formatPoints(Number(next.min_points) - total)} more points to
        <span class="lvl" style="--c:${next.color}">${escapeHtml(next.title)}</span>` : "highest level 🎉"}</span>
    </div>` : "";

  const summary = `<section class="chapter quiz-summary">
    <div class="stat"><span class="stat-value">${formatPoints(total)}</span><span class="muted small">total points</span></div>
    ${levelStat}
    ${state.extra.length ? `<div class="stat"><span class="stat-value">${signed(extraPoints)}</span><span class="muted small">extra points</span></div>` : ""}
    <div class="stat"><span class="stat-value">${marked.length ? avg + "%" : "—"}</span><span class="muted small">quiz average</span></div>
    <div class="stat"><span class="stat-value">${marked.length}<small>/${state.quizzes.length}</small></span><span class="muted small">quizzes marked</span></div>
    <a class="btn btn-small" href="#/top">🏆 See top students</a>
  </section>`;

  const extraCard = state.extra.length ? `<section class="chapter">
    <div class="chapter-head"><h2>⭐ Points from your teacher</h2>
      <span class="muted small">added to or taken from your total</span></div>
    <ul class="extra-list">${state.extra.map((e) => `<li>
      <span class="extra-pts ${e.points < 0 ? "neg" : ""}">${signed(e.points)}</span>
      <span class="extra-reason">${escapeHtml(e.reason) || `<span class="muted">${e.points < 0 ? "Points removed" : "Extra points"}</span>`}</span>
      <span class="muted small nowrap">${formatDay(e.given_on)}</span>
    </li>`).join("")}</ul>
  </section>` : "";

  const groups = groupByChapter(state.quizzes, state.chapters);
  box.innerHTML = summary + extraCard + groups.map((g) => chapterCard(g, g.items.map((q) => {
    const max = Number(q.max_score);
    const has = state.scores.has(q.id);
    const score = state.scores.get(q.id);
    const pct = has ? Math.round((score / max) * 100) : 0;
    return `<div class="tile quiz-tile ${has ? "quiz-" + scoreLevel(pct) : "quiz-none"}">
      <span class="tile-top">
        <span class="muted small">${formatDay(q.quiz_date)}</span>
        ${has ? `<span class="quiz-pct">${pct}%</span>` : ""}
      </span>
      <span class="tile-title">${escapeHtml(q.title)}</span>
      <span class="tile-foot">
        <span class="quiz-score">${has ? `<strong>${formatPoints(score)}</strong> / ${formatPoints(max)}` : `<span class="muted">No mark yet · out of ${formatPoints(max)}</span>`}</span>
      </span>
      ${has ? `<span class="bar quiz-bar"><i style="width:${Math.min(100, pct)}%"></i></span>` : ""}
    </div>`;
  }).join(""))).join("");
}

// ---------- top students ----------


function levelLegend(levels) {
  if (!levels.length) return "";
  const sorted = sortLevels(levels).reverse();
  return `<section class="cf-box level-legend">
    <div class="cf-head">→ Levels</div>
    <table class="cf-table">
      <thead><tr><th>Level</th><th class="cf-points">Points needed</th></tr></thead>
      <tbody>${sorted.map((l) => `<tr>
        <td><span class="lvl lvl-name" style="--c:${l.color}">${escapeHtml(l.title)}</span></td>
        <td class="cf-points">${formatPoints(l.min_points)}+</td>
      </tr>`).join("")}</tbody>
    </table>
  </section>`;
}

async function loadTopStudents() {
  const box = $("#top-list");
  box.innerHTML = `<p class="muted">Loading…</p>`;
  const { data, error } = await sb.rpc("leaderboard");
  if (error) {
    box.innerHTML = "";
    return toast("Could not load the top students: " + error.message, "error");
  }
  const top = data.filter((r) => r.place <= 3 && Number(r.points) > 0);
  const me = data.find((r) => r.is_me);
  if (!top.length) {
    box.innerHTML = `<p class="muted">No quiz marks yet. The top 3 will appear here after the first quiz.</p>`;
    return;
  }
  // Codeforces-style "Top rated" box; ties share a place
  const rows = top.map((r) => `<tr class="${r.is_me ? "is-me" : ""}">
      <td class="cf-place">${r.place}</td>
      <td>${levelName(r.full_name, r.points, state.levels)}${r.is_me ? ` <span class="badge">You</span>` : ""}
</td>
      <td class="cf-points">${formatPoints(r.points)}</td>
    </tr>`).join("");
  let mine = "You don’t have any quiz marks yet.";
  if (me && me.place <= 3 && Number(me.points) > 0) {
    mine = "You’re in the top 3! Keep it up 🎉";
  } else if (me) {
    mine = `Your place: <strong>#${me.place}</strong> · ${levelName(formatPoints(me.points) + " points", me.points, state.levels)}`;
  }
  box.innerHTML = `<div class="top-layout">
    <div class="top-main">
      <section class="cf-box">
        <div class="cf-head">→ Top rated</div>
        <table class="cf-table">
          <thead><tr><th class="cf-place">#</th><th>Student</th><th class="cf-points">Points</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="cf-foot">${mine}</div>
      </section>
      <p class="muted small cf-note">Points = all quiz marks + extra points.</p>
    </div>
    <div class="top-side">
      ${progressBox(me)}
      ${levelLegend(state.levels)}
    </div>
  </div>`;
}

// "Your progress": current level, points, and a bar towards the next level
function progressBox(me) {
  const points = me ? Number(me.points) : 0;
  const level = levelFor(points, state.levels);
  const next = nextLevel(points, state.levels);
  let bar = "";
  if (next) {
    const from = level ? Number(level.min_points) : 0;
    const pct = Math.max(0, Math.min(100, ((points - from) / (Number(next.min_points) - from)) * 100));
    bar = `<span class="bar progress-bar"><i style="width:${pct}%; background:${next.color}"></i></span>
      <div class="small">${formatPoints(Number(next.min_points) - points)} more points to
        <span class="lvl lvl-name" style="--c:${next.color}">${escapeHtml(next.title)}</span></div>`;
  } else if (level) {
    bar = `<div class="small">You reached the highest level 🎉</div>`;
  }
  return `<section class="cf-box">
    <div class="cf-head">→ Your progress</div>
    <div class="progress-body">
      <div class="progress-level">${levelTitle(points, state.levels) || "—"}</div>
      <div class="progress-points"><strong>${formatPoints(points)}</strong> points${me ? ` · place <strong>#${me.place}</strong>` : ""}</div>
      ${bar}
    </div>
  </section>`;
}

// ---------- one task ----------

function draftKey(taskId) {
  return `draft:${state.access.user.id}:${taskId}`;
}

function readDraft(taskId) {
  try {
    return localStorage.getItem(draftKey(taskId));
  } catch {
    return null;
  }
}

function saveDraft() {
  if (!state.task) return;
  try {
    localStorage.setItem(draftKey(state.task.id), state.editor.getValue());
  } catch {
    // storage unavailable; the code is still saved on Submit
  }
}

function renderTestPreview(tests) {
  if (!tests.length) return `<li class="muted">No tests yet.</li>`;
  return tests.map((t, i) => {
    const name = escapeHtml(t.name || `Test ${i + 1}`);
    if (t.type === "output") {
      return `<li><strong>${name}</strong>
        ${t.input ? `<div class="kv"><span>Input</span><pre>${escapeHtml(t.input)}</pre></div>` : ""}
        <div class="kv"><span>Expected output</span><pre>${escapeHtml(t.expected)}</pre></div></li>`;
    }
    return `<li><strong>${name}</strong><pre>${escapeHtml(t.code)}</pre></li>`;
  }).join("");
}

async function openTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) {
    location.hash = "#/";
    return;
  }
  state.task = task;
  $("#task-title").textContent = task.title;
  $("#task-lang").textContent = LANG_LABEL[task.language];
  $("#task-lang").className = `badge badge-${task.language}`;
  $("#task-description").innerHTML = renderMarkdown(task.description);
  $("#task-tests").innerHTML = renderTestPreview(task.tests || []);
  $("#output-panel").hidden = true;
  $("#results-panel").hidden = true;
  $("#stdin").value = "";
  showView("task");

  if (!state.editor) {
    state.editor = makeEditor($("#editor"), { language: task.language });
    state.editor.setOption("extraKeys", {
      ...state.editor.getOption("extraKeys"),
      "Ctrl-Enter": runCode,
      "Cmd-Enter": runCode,
    });
    state.editor.on("change", saveDraft);
  }
  setEditorLanguage(state.editor, task.language);

  let code = readDraft(id);
  if (code === null) {
    const { data } = await sb.from("submissions")
      .select("code")
      .eq("task_id", id)
      .eq("user_id", state.access.user.id)
      .order("created_at", { ascending: false })
      .limit(1);
    code = data && data.length ? data[0].code : task.starter_code;
  }
  if (state.task !== task) return; // the student moved on while we were loading
  state.editor.setValue(code);
  state.editor.clearHistory();
  state.editor.refresh();
  state.editor.focus();

  const status = $("#runner-status");
  status.textContent = task.language === "python" ? "Loading Python…" : "";
  CodeRunner.preloadRunner(task.language)
    .then(() => { if (state.task === task) status.textContent = ""; })
    .catch(() => { status.textContent = "Could not load the code runner. Check your internet."; });
}

function setBusy(busy, label = "") {
  state.busy = busy;
  $("#run-btn").disabled = busy;
  $("#submit-btn").disabled = busy;
  $("#runner-status").textContent = label;
}

async function runCode() {
  if (state.busy || !state.task) return;
  setBusy(true, "Running…");
  try {
    const result = await CodeRunner.runCode(state.task.language, state.editor.getValue(), $("#stdin").value);
    const out = $("#output");
    out.innerHTML = escapeHtml(result.stdout) +
      (result.error ? `<span class="error">${escapeHtml(result.error)}</span>` : "");
    if (!result.stdout && !result.error) out.innerHTML = `<span class="muted">(no output)</span>`;
    $("#output-panel").hidden = false;
  } catch (err) {
    toast("Could not run the code: " + err.message, "error");
  } finally {
    setBusy(false);
  }
}

async function submitCode() {
  if (state.busy || !state.task) return;
  const task = state.task;
  const tests = task.tests || [];
  if (!tests.length) {
    toast("This task has no tests yet.");
    return;
  }
  const code = state.editor.getValue();
  const panel = $("#results-panel");
  panel.hidden = false;
  setBusy(true, "Testing…");
  try {
    const results = await CodeRunner.runTests(task.language, code, tests, (partial) => {
      panel.innerHTML = renderTestResults(partial, tests.length);
    });
    const passed = results.filter((r) => r.passed).length;
    const { data, error } = await sb.from("submissions")
      .insert({ task_id: task.id, code, passed, total: tests.length })
      .select("task_id, passed, total, created_at")
      .single();
    if (error) {
      toast("Your result could not be saved: " + error.message, "error");
    } else {
      state.submissions.unshift(data);
      toast(passed === tests.length ? "Submitted. Great job! 🎉" : "Submitted. Keep going!", "success");
    }
  } catch (err) {
    toast("Could not run the tests: " + err.message, "error");
  } finally {
    setBusy(false);
  }
}

$("#run-btn").addEventListener("click", runCode);
$("#submit-btn").addEventListener("click", submitCode);
$("#reset-btn").addEventListener("click", () => {
  if (state.task && confirm("Replace your code with the starting code?")) {
    state.editor.setValue(state.task.starter_code);
  }
});

// ---------- log in / sign up / reset ----------

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  const titles = { login: "Log in", signup: "Create account", reset: "Reset password" };
  const buttons = { login: "Log in", signup: "Create account", reset: "Send reset link" };
  $("#auth-title").textContent = titles[mode];
  $("#auth-submit").textContent = buttons[mode];
  $("#pass-label").hidden = mode === "reset";
  $("#auth-password").required = mode !== "reset";
  $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $all(".auth-links a").forEach((a) => (a.hidden = a.dataset.show !== mode));
  showAuthMessage("");
}

function showAuthMessage(text, kind = "error") {
  const el = $("#auth-message");
  el.hidden = !text;
  el.textContent = text;
  el.className = `form-message ${kind}`;
}

$all(".auth-links a").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(a.dataset.mode);
  }));

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim().toLowerCase();
  const password = $("#auth-password").value;
  const button = $("#auth-submit");
  button.disabled = true;
  showAuthMessage("");
  try {
    if (authMode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        showAuthMessage(/invalid login/i.test(error.message)
          ? "Wrong email or password. New here? Create an account first."
          : error.message);
        return;
      }
      await loadMain();
    } else if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) {
        showAuthMessage(/database error|EMAIL_NOT_ALLOWED/i.test(error.message)
          ? "This email is not on the class list. Ask your teacher to add you."
          : error.message);
        return;
      }
      if (!data.session) {
        setAuthMode("login");
        showAuthMessage("Check your email and click the confirmation link, then log in here.", "success");
        return;
      }
      await loadMain();
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
      showAuthMessage(error ? error.message : "If this email has an account, a reset link is on its way.",
        error ? "error" : "success");
    }
  } finally {
    button.disabled = false;
  }
});

$("#new-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#new-password").value });
  if (error) {
    toast(error.message, "error");
    return;
  }
  toast("Password saved.", "success");
  recoveringPassword = false;
  history.replaceState(null, "", location.pathname + "#/");
  await loadMain();
});

$("#logout-btn").addEventListener("click", logout);
$("#denied-logout").addEventListener("click", logout);

boot();
