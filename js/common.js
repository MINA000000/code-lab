// Shared helpers for the student page and the teacher page.
const CONFIG = window.APP_CONFIG;
const isConfigured =
  CONFIG && !CONFIG.SUPABASE_URL.includes("YOUR-PROJECT") && !CONFIG.SUPABASE_ANON_KEY.includes("YOUR-");

const sb = isConfigured ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;

const LANG_LABEL = { python: "Python", javascript: "JavaScript" };

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
}

function showView(id) {
  $all("[data-view]").forEach((el) => (el.hidden = el.dataset.view !== id));
}

function toast(message, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Returns { user, email, role, full_name } for an allowed account, null when logged out,
// or { user, denied: true } when logged in but not on the class list.
async function getAccess() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const email = session.user.email.toLowerCase();
  const { data, error } = await sb.from("allowed_emails").select("*").eq("email", email).maybeSingle();
  if (error) throw error;
  if (!data) return { user: session.user, email, denied: true };
  return { user: session.user, email, role: data.role, full_name: data.full_name };
}

async function logout() {
  await sb.auth.signOut();
  location.href = "index.html";
}

// Light is the default; dark only when the viewer chooses it (remembered on this device).
const editors = [];

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function editorTheme() {
  return isDark() ? "material-darker" : "default";
}

function setTheme(theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // storage unavailable; the choice lasts until the page is closed
  }
  editors.forEach((editor) => editor.setOption("theme", editorTheme()));
  updateThemeButton();
}

function updateThemeButton() {
  const button = $("#theme-toggle");
  if (!button) return;
  button.textContent = isDark() ? "☀️" : "🌙";
  button.title = isDark() ? "Switch to light mode" : "Switch to dark mode";
}

document.addEventListener("DOMContentLoaded", () => {
  const button = $("#theme-toggle");
  if (!button) return;
  updateThemeButton();
  button.addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
});

function makeEditor(container, { language = "python", value = "", readOnly = false, minLines } = {}) {
  const indent = language === "python" ? 4 : 2;
  const editor = CodeMirror(container, {
    value,
    mode: language,
    theme: editorTheme(),
    lineNumbers: true,
    indentUnit: indent,
    tabSize: indent,
    matchBrackets: true,
    autoCloseBrackets: true,
    readOnly,
    extraKeys: {
      Tab: (cm) =>
        cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection(" ".repeat(indent)),
      "Shift-Tab": (cm) => cm.indentSelection("subtract"),
    },
  });
  if (minLines) container.style.setProperty("--editor-min-lines", minLines);
  editors.push(editor);
  return editor;
}

function setEditorLanguage(editor, language) {
  const indent = language === "python" ? 4 : 2;
  editor.setOption("mode", language);
  editor.setOption("indentUnit", indent);
  editor.setOption("tabSize", indent);
}

// HTML for a list of test results from CodeRunner.runTests
function renderTestResults(results, total) {
  const passed = results.filter((r) => r.passed).length;
  const done = results.length === total;
  const summary = done
    ? `<div class="result-summary ${passed === total ? "all-pass" : "some-fail"}">
         ${passed === total ? "✅ All tests passed!" : `${passed} of ${total} tests passed`}
       </div>`
    : `<div class="result-summary running">Running tests… ${results.length}/${total}</div>`;
  const items = results.map((r) => {
    let detail = "";
    if (!r.passed) {
      if (r.expected !== undefined) {
        detail = `
          ${r.input ? `<div class="kv"><span>Input</span><pre>${escapeHtml(r.input)}</pre></div>` : ""}
          <div class="kv"><span>Expected</span><pre>${escapeHtml(r.expected) || "<em>(nothing)</em>"}</pre></div>
          <div class="kv"><span>Your output</span><pre>${escapeHtml(r.got) || "<em>(nothing)</em>"}</pre></div>`;
      } else {
        detail = `<pre class="error">${escapeHtml(r.message)}</pre>`;
      }
    }
    return `<li class="${r.passed ? "pass" : "fail"}">
      <div class="test-name">${r.passed ? "✓" : "✗"} ${escapeHtml(r.name)}</div>${detail}
    </li>`;
  }).join("");
  return `${summary}<ul class="test-results">${items}</ul>`;
}

// Groups tasks or PDFs by chapter, in chapter order; items without a chapter go last as "Other".
// Returns [{ chapter, key, title, items }], skipping chapters with no items unless keepEmpty.
function groupByChapter(items, chapters, { keepEmpty = false } = {}) {
  const ordered = [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const groups = ordered.map((c) => ({ chapter: c, key: String(c.id), title: c.title, items: [] }));
  const byId = new Map(groups.map((g) => [g.chapter.id, g]));
  const other = { chapter: null, key: "none", title: chapters.length ? "Other" : "All", items: [] };
  for (const item of items) (byId.get(item.chapter_id) || other).items.push(item);
  return [...groups, other].filter((g) => g.items.length || (keepEmpty && g.chapter));
}

function chapterOptions(chapters, selectedId) {
  const sorted = [...chapters].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return `<option value="">— No chapter —</option>` + sorted.map((c) =>
    `<option value="${c.id}" ${c.id === selectedId ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("");
}

// 8 -> "8", 7.5 -> "7.5", 7.25 -> "7.25"
function formatPoints(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

// A "YYYY-MM-DD" date as a short local day, e.g. "17 Oct 2026"
function formatDay(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// Rank levels (Codeforces style): the highest level whose min_points the student has reached.
function sortLevels(levels) {
  return [...levels].sort((a, b) => Number(a.min_points) - Number(b.min_points));
}

function levelFor(points, levels) {
  let found = null;
  for (const l of sortLevels(levels)) if (Number(points) >= Number(l.min_points)) found = l;
  return found;
}

function nextLevel(points, levels) {
  return sortLevels(levels).find((l) => Number(l.min_points) > Number(points)) || null;
}

// A name (or any text) coloured by the level for these points
function levelName(text, points, levels) {
  const level = levelFor(points, levels);
  if (!level) return `<span class="lvl-name">${escapeHtml(text)}</span>`;
  return `<span class="lvl-name lvl" style="--c:${level.color}" title="${escapeHtml(level.title)}">${escapeHtml(text)}</span>`;
}

function levelTitle(points, levels) {
  const level = levelFor(points, levels);
  return level ? `<span class="lvl lvl-title" style="--c:${level.color}">${escapeHtml(level.title)}</span>` : "";
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Materials are private files, so each open/download uses a short-lived signed link.
async function openMaterial(material, download) {
  // open the tab right away (inside the click) so popup blockers allow it
  const tab = download ? null : window.open("", "_blank");
  const { data, error } = await sb.storage
    .from("materials")
    .createSignedUrl(material.file_path, 60 * 60, download ? { download: material.file_name } : undefined);
  if (error) {
    if (tab) tab.close();
    toast("Could not open the file: " + error.message, "error");
    return;
  }
  if (tab) tab.location = data.signedUrl;
  else location.href = data.signedUrl;
}

function materialRow(m, actions, titleHtml = escapeHtml(m.title)) {
  return `<li class="material" data-id="${m.id}">
    <span class="material-icon" aria-hidden="true">PDF</span>
    <div class="material-info">
      <div class="material-title">${titleHtml}</div>
      <div class="muted small">${formatSize(m.size_bytes)} · ${formatDate(m.created_at)}</div>
    </div>
    <div class="toolbar">${actions}</div>
  </li>`;
}

function setupNotice() {
  return `<div class="card notice">
    <h2>Almost there</h2>
    <p>The site is not connected to a database yet. Open <code>config.js</code> and fill in
    your Supabase URL and anon key (see <code>README.md</code>).</p>
  </div>`;
}
