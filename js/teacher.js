// Teacher dashboard: manage tasks, the class list, and see results.
const T = {
  access: null,
  chapters: [],
  tasks: [],
  people: [],
  editingId: null, // task id being edited, or null for a new task
  tests: [],       // tests in the form being edited
  starterEditor: null,
  solutionEditor: null,
};

const TEST_HELP = {
  python: "“Check a value” runs Python after the student’s code, e.g. assert add(2, 3) == 5. " +
    "“Check printed output” feeds the input lines to input() and compares what the program prints.",
  javascript: "“Check a value” runs JavaScript after the student’s code, e.g. assertEqual(add(2, 3), 5) " +
    "or assert(isEven(4)). “Check printed output” feeds the input lines to input() and compares console.log output.",
};

const TEST_PLACEHOLDER = {
  python: "assert add(2, 3) == 5\nassert add(-1, 1) == 0",
  javascript: "assertEqual(add(2, 3), 5);\nassertEqual(add(-1, 1), 0);",
};

// ---------- start ----------

async function boot() {
  document.title = `${CONFIG.SITE_NAME} · Teacher`;
  $("#brand").textContent = CONFIG.SITE_NAME;
  if (!isConfigured) {
    $("#setup").innerHTML = setupNotice();
    showView("setup");
    return;
  }
  T.access = await getAccess();
  if (!T.access) {
    location.href = "index.html";
    return;
  }
  if (T.access.denied || T.access.role !== "teacher") {
    showView("not-teacher");
    return;
  }
  $("#user-nav").hidden = false;
  $("#user-email").textContent = T.access.email;
  showView("dashboard");
  T.starterEditor = makeEditor($("#f-starter"));
  T.solutionEditor = makeEditor($("#f-solution"));
  await Promise.all([loadChapters(), loadMaterials()]);
  await loadTasks();
  openTab(location.hash.slice(1) || "tasks");
}

function openTab(name) {
  if (!["chapters", "tasks", "materials", "students", "results", "quizzes"].includes(name)) name = "tasks";
  $all(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $all("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, "", "#" + name);
  if (name === "chapters") renderChapters();
  if (name === "materials") loadMaterials();
  if (name === "students") loadPeople();
  if (name === "results") loadResults();
  if (name === "quizzes") loadQuizzes();
}

$all(".tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));

// ---------- chapters ----------

T.editingChapterId = null;

async function loadChapters() {
  const { data, error } = await sb.from("chapters").select("*").order("sort_order").order("id");
  if (error) return toast(error.message, "error");
  T.chapters = data;
  renderChapterPickers();
}

function renderChapterPickers() {
  for (const id of ["#m-chapter", "#q-chapter"]) {
    const keep = $(id).value;
    $(id).innerHTML = chapterOptions(T.chapters, keep ? Number(keep) : null);
  }
}

function renderChapters() {
  const rows = $("#chapter-rows");
  if (!T.chapters.length) {
    rows.innerHTML = `<tr><td colspan="5" class="muted">No chapters yet. Add your first one above.</td></tr>`;
    return;
  }
  const count = (list, id) => list.filter((x) => x.chapter_id === id).length;
  rows.innerHTML = T.chapters.map((c) => {
    if (c.id === T.editingChapterId) {
      return `<tr data-chapter="${c.id}">
        <td><input class="order-input" type="number" data-chapter-order value="${c.sort_order}" aria-label="Order"></td>
        <td><input class="name-input" data-chapter-title value="${escapeHtml(c.title)}" aria-label="Chapter title"></td>
        <td>${count(T.tasks, c.id)}</td><td>${count(T.materials, c.id)}</td>
        <td class="right nowrap"><button class="btn btn-small btn-primary" data-save-chapter>Save</button>
          <button class="btn btn-small btn-ghost" data-cancel-chapter>Cancel</button></td>
      </tr>`;
    }
    return `<tr data-chapter="${c.id}">
      <td>${c.sort_order}</td>
      <td><strong>${escapeHtml(c.title)}</strong></td>
      <td>${count(T.tasks, c.id)}</td><td>${count(T.materials, c.id)}</td>
      <td class="right nowrap"><button class="btn btn-small btn-ghost" data-edit-chapter>Edit</button>
        <button class="btn btn-small btn-ghost" data-delete-chapter>Delete</button></td>
    </tr>`;
  }).join("");
  const input = $("[data-chapter-title]");
  if (input) input.focus();
}

$("#chapter-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#c-title").value.trim();
  if (!title) return;
  const sort_order = T.chapters.length ? Math.max(...T.chapters.map((c) => c.sort_order)) + 1 : 1;
  const { error } = await sb.from("chapters").insert({ title, sort_order });
  if (error) return toast(error.message, "error");
  toast(`Chapter “${title}” added.`, "success");
  e.target.reset();
  await loadChapters();
  renderChapters();
});

async function saveChapter() {
  const title = $("[data-chapter-title]").value.trim();
  if (!title) return toast("The chapter needs a title.", "error");
  const sort_order = Number($("[data-chapter-order]").value) || 0;
  const { error } = await sb.from("chapters").update({ title, sort_order }).eq("id", T.editingChapterId);
  if (error) return toast(error.message, "error");
  T.editingChapterId = null;
  toast("Chapter saved.", "success");
  await loadChapters();
  renderChapters();
}

$("#chapter-rows").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-chapter]");
  if (!row) return;
  const chapter = T.chapters.find((c) => c.id === Number(row.dataset.chapter));
  if (e.target.closest("[data-edit-chapter]")) {
    T.editingChapterId = chapter.id;
    renderChapters();
  } else if (e.target.closest("[data-cancel-chapter]")) {
    T.editingChapterId = null;
    renderChapters();
  } else if (e.target.closest("[data-save-chapter]")) {
    await saveChapter();
  } else if (e.target.closest("[data-delete-chapter]")) {
    if (!confirm(`Delete “${chapter.title}”? Its tasks and PDFs are kept and move to “Other”.`)) return;
    const { error } = await sb.from("chapters").delete().eq("id", chapter.id);
    if (error) return toast(error.message, "error");
    toast("Chapter deleted.", "success");
    await Promise.all([loadChapters(), loadMaterials()]);
    await loadTasks();
    renderChapters();
  }
});

$("#chapter-rows").addEventListener("keydown", (e) => {
  if (!e.target.closest("[data-chapter-title], [data-chapter-order]")) return;
  if (e.key === "Enter") saveChapter();
  if (e.key === "Escape") {
    T.editingChapterId = null;
    renderChapters();
  }
});

// ---------- tasks ----------

async function loadTasks() {
  const { data, error } = await sb.from("tasks").select("*").order("sort_order").order("id");
  if (error) return toast(error.message, "error");
  T.tasks = data;
  renderTaskRows();
}

function renderTaskRows() {
  const rows = $("#task-rows");
  if (!T.tasks.length) {
    rows.innerHTML = `<tr><td colspan="6" class="muted">No tasks yet. Click “New task”.</td></tr>`;
    return;
  }
  rows.innerHTML = groupByChapter(T.tasks, T.chapters).map((g) => `
    <tr class="group-row"><th colspan="6">${escapeHtml(g.title)}</th></tr>` + g.items.map((t) => `
    <tr>
      <td>${t.sort_order}</td>
      <td><strong>${escapeHtml(t.title)}</strong></td>
      <td><span class="badge badge-${t.language}">${LANG_LABEL[t.language]}</span></td>
      <td>${(t.tests || []).length}</td>
      <td><label class="switch"><input type="checkbox" data-publish="${t.id}" ${t.published ? "checked" : ""}>
        <span>${t.published ? "Visible" : "Hidden"}</span></label></td>
      <td class="right"><button class="btn btn-small" data-edit="${t.id}">Edit</button></td>
    </tr>`).join("")).join("");
}

$("#task-rows").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) openTaskForm(T.tasks.find((t) => t.id === Number(edit.dataset.edit)));
});

$("#task-rows").addEventListener("change", async (e) => {
  const box = e.target.closest("[data-publish]");
  if (!box) return;
  const id = Number(box.dataset.publish);
  const { error } = await sb.from("tasks").update({ published: box.checked }).eq("id", id);
  if (error) {
    box.checked = !box.checked;
    return toast(error.message, "error");
  }
  T.tasks.find((t) => t.id === id).published = box.checked;
  box.nextElementSibling.textContent = box.checked ? "Visible" : "Hidden";
  toast(box.checked ? "Students can now see this task." : "Task hidden from students.", "success");
});

function openTaskForm(task) {
  T.editingId = task ? task.id : null;
  $("#task-form-title").textContent = task ? "Edit task" : "New task";
  $("#delete-task-btn").hidden = !task;
  $("#f-title").value = task ? task.title : "";
  $("#f-chapter").innerHTML = chapterOptions(T.chapters, task ? task.chapter_id : null);
  $("#f-language").value = task ? task.language : "python";
  $("#f-order").value = task ? task.sort_order : (T.tasks.length ? Math.max(...T.tasks.map((t) => t.sort_order)) + 1 : 1);
  $("#f-published").checked = task ? task.published : false;
  $("#f-description").value = task ? task.description : "";
  T.tests = task ? structuredClone(task.tests || []) : [];
  T.starterEditor.setValue(task ? task.starter_code : "");
  T.solutionEditor.setValue("");
  $("#try-results").innerHTML = "";
  applyFormLanguage();
  $("#task-list-view").hidden = true;
  $("#task-form").hidden = false;
  T.starterEditor.refresh();
  T.solutionEditor.refresh();
  window.scrollTo(0, 0);
}

function closeTaskForm() {
  $("#task-form").hidden = true;
  $("#task-list-view").hidden = false;
}

function applyFormLanguage() {
  const lang = $("#f-language").value;
  setEditorLanguage(T.starterEditor, lang);
  setEditorLanguage(T.solutionEditor, lang);
  $("#tests-help").textContent = TEST_HELP[lang];
  renderTestsEditor();
}

$("#f-language").addEventListener("change", applyFormLanguage);

function renderTestsEditor() {
  const lang = $("#f-language").value;
  const box = $("#tests-editor");
  if (!T.tests.length) {
    box.innerHTML = `<p class="muted">No tests yet. Add at least one so students can submit.</p>`;
    return;
  }
  box.innerHTML = T.tests.map((t, i) => `
    <div class="test-row card soft" data-index="${i}">
      <div class="row-between">
        <span class="badge">${t.type === "output" ? "Printed output" : "Check a value"}</span>
        <button type="button" class="btn btn-small btn-ghost" data-remove="${i}">Remove</button>
      </div>
      <label>Name <input data-field="name" value="${escapeHtml(t.name)}" placeholder="Test ${i + 1}"></label>
      ${t.type === "output" ? `
        <div class="two-col">
          <label>Input (one per line)<textarea data-field="input" rows="3" spellcheck="false">${escapeHtml(t.input)}</textarea></label>
          <label>Expected output<textarea data-field="expected" rows="3" spellcheck="false">${escapeHtml(t.expected)}</textarea></label>
        </div>` : `
        <label>Test code<textarea data-field="code" rows="3" spellcheck="false"
          placeholder="${escapeHtml(TEST_PLACEHOLDER[lang])}">${escapeHtml(t.code)}</textarea></label>`}
    </div>`).join("");
}

$("#tests-editor").addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  const row = e.target.closest("[data-index]");
  if (field && row) T.tests[Number(row.dataset.index)][field] = e.target.value;
});

$("#tests-editor").addEventListener("click", (e) => {
  const remove = e.target.closest("[data-remove]");
  if (!remove) return;
  T.tests.splice(Number(remove.dataset.remove), 1);
  renderTestsEditor();
});

$("#add-assert-btn").addEventListener("click", () => {
  T.tests.push({ name: "", type: "assert", code: "" });
  renderTestsEditor();
});

$("#add-output-btn").addEventListener("click", () => {
  T.tests.push({ name: "", type: "output", input: "", expected: "" });
  renderTestsEditor();
});

function cleanTests() {
  return T.tests.map((t, i) => {
    const name = (t.name || "").trim() || `Test ${i + 1}`;
    return t.type === "output"
      ? { name, type: "output", input: t.input || "", expected: t.expected || "" }
      : { name, type: "assert", code: t.code || "" };
  });
}

$("#try-tests-btn").addEventListener("click", async () => {
  const tests = cleanTests();
  if (!tests.length) return toast("Add a test first.");
  const button = $("#try-tests-btn");
  button.disabled = true;
  button.textContent = "Running…";
  try {
    await CodeRunner.runTests($("#f-language").value, T.solutionEditor.getValue(), tests, (partial) => {
      $("#try-results").innerHTML = renderTestResults(partial, tests.length);
    });
  } catch (err) {
    toast("Could not run: " + err.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Run tests on this solution";
  }
});

$("#task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const row = {
    title: $("#f-title").value.trim(),
    language: $("#f-language").value,
    sort_order: Number($("#f-order").value) || 0,
    chapter_id: Number($("#f-chapter").value) || null,
    published: $("#f-published").checked,
    description: $("#f-description").value,
    starter_code: T.starterEditor.getValue(),
    tests: cleanTests(),
  };
  const query = T.editingId
    ? sb.from("tasks").update(row).eq("id", T.editingId)
    : sb.from("tasks").insert(row);
  const { error } = await query;
  if (error) return toast(error.message, "error");
  toast("Task saved.", "success");
  closeTaskForm();
  await loadTasks();
});

$("#new-task-btn").addEventListener("click", () => openTaskForm(null));
$("#cancel-task-btn").addEventListener("click", closeTaskForm);

$("#delete-task-btn").addEventListener("click", async () => {
  if (!confirm("Delete this task and all student submissions for it? This cannot be undone.")) return;
  const { error } = await sb.from("tasks").delete().eq("id", T.editingId);
  if (error) return toast(error.message, "error");
  toast("Task deleted.", "success");
  closeTaskForm();
  await loadTasks();
});

// ---------- materials ----------

const MAX_PDF_BYTES = 50 * 1024 * 1024;
T.materials = [];

async function loadMaterials() {
  const { data, error } = await sb.from("materials").select("*").order("created_at", { ascending: false });
  if (error) return toast(error.message, "error");
  T.materials = data;
  renderMaterials();
}

T.renamingMaterialId = null; // the PDF whose title is being edited

function renderMaterials() {
  const list = $("#teacher-material-list");
  if (!T.materials.length) {
    list.innerHTML = `<li class="muted">No PDFs yet.</li>`;
    return;
  }
  list.innerHTML = groupByChapter(T.materials, T.chapters).map((g) => `
    <li class="group-title">${escapeHtml(g.title)}</li>` + g.items.map((m) => m.id === T.renamingMaterialId
    ? materialRow(m, `
      <button class="btn btn-small btn-primary" data-save-title>Save</button>
      <button class="btn btn-small btn-ghost" data-cancel-title>Cancel</button>`,
      `<input class="name-input title-input" data-title-input value="${escapeHtml(m.title)}" aria-label="PDF title">`)
    : materialRow(m, `
      <select class="chapter-select" data-move aria-label="Chapter">${chapterOptions(T.chapters, m.chapter_id)}</select>
      <label class="switch"><input type="checkbox" data-visible ${m.published ? "checked" : ""}>
        <span>${m.published ? "Visible" : "Hidden"}</span></label>
      <button class="btn btn-small" data-open>Open</button>
      <button class="btn btn-small btn-ghost" data-rename>Rename</button>
      <button class="btn btn-small btn-ghost" data-delete>Delete</button>`)).join("")).join("");
  const input = $("[data-title-input]");
  if (input) {
    input.focus();
    input.select();
  }
}

async function saveMaterialTitle() {
  const title = $("[data-title-input]").value.trim();
  if (!title) return toast("The PDF needs a title.", "error");
  const { error } = await sb.from("materials").update({ title }).eq("id", T.renamingMaterialId);
  if (error) return toast(error.message, "error");
  T.renamingMaterialId = null;
  toast(`Renamed to “${title}”.`, "success");
  await loadMaterials();
}

function safeFileName(name) {
  return name.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-80) || "file.pdf";
}

$("#upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#m-file").files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return toast("Please choose a PDF file.", "error");
  if (file.size > MAX_PDF_BYTES) {
    return toast(`This file is ${formatSize(file.size)}. The limit is 50 MB. Try compressing it first.`, "error");
  }
  const button = $("#upload-btn");
  const status = $("#upload-status");
  button.disabled = true;
  status.textContent = `Uploading ${formatSize(file.size)}…`;
  const path = `${Date.now()}-${safeFileName(file.name)}`;
  try {
    const up = await sb.storage.from("materials").upload(path, file, { contentType: "application/pdf" });
    if (up.error) return toast("Upload failed: " + up.error.message, "error");
    const { error } = await sb.from("materials").insert({
      title: $("#m-title").value.trim(),
      file_path: path,
      file_name: file.name,
      size_bytes: file.size,
      chapter_id: Number($("#m-chapter").value) || null,
      published: $("#m-published").checked,
    });
    if (error) {
      await sb.storage.from("materials").remove([path]);
      return toast("Upload failed: " + error.message, "error");
    }
    toast("PDF uploaded.", "success");
    const chapter = $("#m-chapter").value;
    e.target.reset();
    $("#m-chapter").value = chapter; // keep the chapter for the next upload
    $("#m-published").checked = true;
    await loadMaterials();
  } finally {
    button.disabled = false;
    status.textContent = "";
  }
});

$("#teacher-material-list").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const material = T.materials.find((m) => m.id === Number(row.dataset.id));
  if (e.target.closest("[data-rename]")) {
    T.renamingMaterialId = material.id;
    renderMaterials();
  } else if (e.target.closest("[data-cancel-title]")) {
    T.renamingMaterialId = null;
    renderMaterials();
  } else if (e.target.closest("[data-save-title]")) {
    await saveMaterialTitle();
  } else if (e.target.closest("[data-open]")) {
    openMaterial(material, false);
  } else if (e.target.closest("[data-delete]")) {
    if (!confirm(`Delete “${material.title}”? Students will no longer see it.`)) return;
    const { error } = await sb.from("materials").delete().eq("id", material.id);
    if (error) return toast(error.message, "error");
    await sb.storage.from("materials").remove([material.file_path]);
    toast("PDF deleted.", "success");
    await loadMaterials();
  }
});

$("#teacher-material-list").addEventListener("keydown", (e) => {
  if (!e.target.matches("[data-title-input]")) return;
  if (e.key === "Enter") saveMaterialTitle();
  if (e.key === "Escape") {
    T.renamingMaterialId = null;
    renderMaterials();
  }
});

$("#teacher-material-list").addEventListener("change", async (e) => {
  const move = e.target.closest("[data-move]");
  if (move) {
    const material = T.materials.find((m) => m.id === Number(move.closest("[data-id]").dataset.id));
    const chapter_id = Number(move.value) || null;
    const { error } = await sb.from("materials").update({ chapter_id }).eq("id", material.id);
    if (error) return toast(error.message, "error");
    toast("PDF moved.", "success");
    return loadMaterials();
  }
  const box = e.target.closest("[data-visible]");
  if (!box) return;
  const material = T.materials.find((m) => m.id === Number(box.closest("[data-id]").dataset.id));
  const { error } = await sb.from("materials").update({ published: box.checked }).eq("id", material.id);
  if (error) {
    box.checked = !box.checked;
    return toast(error.message, "error");
  }
  material.published = box.checked;
  box.nextElementSibling.textContent = box.checked ? "Visible" : "Hidden";
  toast(box.checked ? "Students can now see this PDF." : "PDF hidden from students.", "success");
});

// ---------- students ----------

async function loadPeople() {
  const { data, error } = await sb.from("allowed_emails").select("*").order("role").order("full_name");
  if (error) return toast(error.message, "error");
  T.people = data;
  renderPeople();
}

T.renamingEmail = null; // the row whose name is being edited

function renderPeople() {
  $("#student-rows").innerHTML = T.people.map((p) => {
    const email = escapeHtml(p.email);
    const editing = p.email === T.renamingEmail;
    const name = editing
      ? `<input class="name-input" data-name-input value="${escapeHtml(p.full_name)}" placeholder="Name" aria-label="Name">`
      : escapeHtml(p.full_name) || `<span class="muted">—</span>`;
    const actions = editing
      ? `<button class="btn btn-small btn-primary" data-save-name="${email}">Save</button>
         <button class="btn btn-small btn-ghost" data-cancel-name>Cancel</button>`
      : `<button class="btn btn-small btn-ghost" data-edit-name="${email}">Edit</button>
         ${p.email === T.access.email ? "" : `<button class="btn btn-small btn-ghost" data-remove-email="${email}">Remove</button>`}`;
    return `<tr data-email="${email}">
      <td>${name}</td>
      <td>${email}</td>
      <td>${p.role === "teacher" ? `<span class="badge">Teacher</span>` : "Student"}</td>
      <td class="muted small">${formatDate(p.created_at)}</td>
      <td class="right nowrap">${actions}</td>
    </tr>`;
  }).join("");
  const input = $("[data-name-input]");
  if (input) {
    input.focus();
    input.select();
  }
}

async function saveName(email) {
  const fullName = $("[data-name-input]").value.trim();
  const { error } = await sb.from("allowed_emails").update({ full_name: fullName }).eq("email", email);
  if (error) return toast(error.message, "error");
  T.renamingEmail = null;
  toast(fullName ? `Name changed to ${fullName}.` : "Name removed.", "success");
  await loadPeople();
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

async function addPeople(rows) {
  const { error } = await sb.from("allowed_emails").upsert(rows, { onConflict: "email", ignoreDuplicates: true });
  if (error) {
    toast(error.message, "error");
    return false;
  }
  await loadPeople();
  return true;
}

$("#add-student-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#s-email").value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return toast("That email doesn’t look right.", "error");
  const ok = await addPeople([{ email, full_name: $("#s-name").value.trim(), role: $("#s-role").value }]);
  if (ok) {
    toast(`${email} can now sign up.`, "success");
    e.target.reset();
  }
});

$("#bulk-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const rows = [];
  const bad = [];
  for (const line of $("#bulk-text").value.split("\n")) {
    if (!line.trim()) continue;
    const [email, ...name] = line.split(/[,\t;]/).map((s) => s.trim());
    if (EMAIL_RE.test(email)) rows.push({ email: email.toLowerCase(), full_name: name.join(" ").trim(), role: "student" });
    else bad.push(line.trim());
  }
  if (bad.length) return toast(`Fix these lines first: ${bad.join(" | ")}`, "error");
  if (!rows.length) return;
  if (await addPeople(rows)) {
    toast(`Added ${rows.length} student(s).`, "success");
    $("#bulk-text").value = "";
  }
});

$("#student-rows").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit-name]");
  if (edit) {
    T.renamingEmail = edit.dataset.editName;
    return renderPeople();
  }
  if (e.target.closest("[data-cancel-name]")) {
    T.renamingEmail = null;
    return renderPeople();
  }
  const save = e.target.closest("[data-save-name]");
  if (save) return saveName(save.dataset.saveName);
  const btn = e.target.closest("[data-remove-email]");
  if (!btn) return;
  const email = btn.dataset.removeEmail;
  if (!confirm(`Remove ${email}? They will lose access immediately.`)) return;
  const { error } = await sb.from("allowed_emails").delete().eq("email", email);
  if (error) return toast(error.message, "error");
  toast(`${email} removed.`, "success");
  await loadPeople();
});

$("#student-rows").addEventListener("keydown", (e) => {
  if (!e.target.matches("[data-name-input]")) return;
  if (e.key === "Enter") saveName(T.renamingEmail);
  if (e.key === "Escape") {
    T.renamingEmail = null;
    renderPeople();
  }
});

// ---------- quizzes ----------

T.quizzes = [];
T.quizScores = [];      // { quiz_id, email, score }
T.students = [];        // allowed_emails rows with role "student"
T.extra = [];           // extra points: { id, email, points, reason, given_on }
T.levels = [];          // rank levels as saved: { id, title, min_points, color }
T.levelDraft = [];      // levels in the editor (id is null for new ones)
T.editingQuizId = null; // quiz whose details are in the form, or null for a new one
T.markingQuiz = null;   // quiz whose marks are being entered

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadQuizzes() {
  const [quizRes, scoreRes, peopleRes, extraRes, levelRes] = await Promise.all([
    sb.from("quizzes").select("*").order("quiz_date", { ascending: false }).order("id", { ascending: false }),
    sb.from("quiz_scores").select("quiz_id, email, score"),
    sb.from("allowed_emails").select("*").eq("role", "student").order("full_name"),
    sb.from("extra_points").select("*").order("given_on", { ascending: false }).order("id", { ascending: false }),
    sb.from("rank_levels").select("*").order("min_points"),
  ]);
  const error = quizRes.error || scoreRes.error || peopleRes.error || extraRes.error || levelRes.error;
  if (error) return toast(error.message, "error");
  T.quizzes = quizRes.data;
  T.quizScores = scoreRes.data.map((s) => ({ ...s, score: Number(s.score) }));
  T.students = peopleRes.data;
  T.extra = extraRes.data.map((e) => ({ ...e, points: Number(e.points) }));
  T.levels = levelRes.data;
  T.levelDraft = T.levels.map((l) => ({ ...l, min_points: Number(l.min_points) }));
  renderLevels();
  if (!$("#q-date").value) $("#q-date").value = todayIso();
  const keep = $("#x-email").value;
  $("#x-email").innerHTML = `<option value="">— Choose a student —</option>` + T.students.map((p) =>
    `<option value="${escapeHtml(p.email)}">${escapeHtml(p.full_name || p.email)}</option>`).join("");
  $("#x-email").value = keep;
  renderQuizRows();
  renderExtra();
  renderRanking();
}

function scoresFor(quizId) {
  return T.quizScores.filter((s) => s.quiz_id === quizId);
}

function renderQuizRows() {
  const rows = $("#quiz-rows");
  if (!T.quizzes.length) {
    rows.innerHTML = `<tr><td colspan="7" class="muted">No quizzes yet. Add your first one above.</td></tr>`;
    return;
  }
  rows.innerHTML = groupByChapter(T.quizzes, T.chapters).map((g) => `
    <tr class="group-row"><th colspan="7">${escapeHtml(g.title)}</th></tr>` + g.items.map((q) => {
    const scores = scoresFor(q.id);
    const max = Number(q.max_score);
    const avg = scores.length
      ? `${formatPoints(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)} <span class="muted small">(${Math.round(
        (scores.reduce((sum, s) => sum + s.score, 0) / scores.length / max) * 100)}%)</span>`
      : `<span class="muted">—</span>`;
    return `<tr data-quiz="${q.id}">
      <td class="nowrap">${formatDay(q.quiz_date)}</td>
      <td><strong>${escapeHtml(q.title)}</strong></td>
      <td>${formatPoints(max)}</td>
      <td>${scores.length}/${T.students.length}</td>
      <td class="nowrap">${avg}</td>
      <td><label class="switch"><input type="checkbox" data-quiz-visible ${q.published ? "checked" : ""}>
        <span>${q.published ? "Visible" : "Hidden"}</span></label></td>
      <td class="right nowrap">
        <button class="btn btn-small btn-primary" data-marks>Marks</button>
        <button class="btn btn-small btn-ghost" data-edit-quiz>Edit</button>
        <button class="btn btn-small btn-ghost" data-delete-quiz>Delete</button>
      </td>
    </tr>`;
  }).join("")).join("");
}

function signedPoints(n) {
  return (n > 0 ? "+" : "") + formatPoints(n);
}

function studentName(email) {
  const p = T.students.find((s) => s.email === email);
  return p ? p.full_name || p.email : email;
}

function renderExtra() {
  const rows = $("#extra-rows");
  if (!T.extra.length) {
    rows.innerHTML = `<tr><td colspan="5" class="muted">No extra points given yet.</td></tr>`;
    return;
  }
  rows.innerHTML = T.extra.map((e) => `<tr data-extra="${e.id}">
    <td class="nowrap">${formatDay(e.given_on)}</td>
    <td>${escapeHtml(studentName(e.email))}</td>
    <td><strong class="${e.points < 0 ? "error" : ""}">${signedPoints(e.points)}</strong></td>
    <td>${escapeHtml(e.reason) || `<span class="muted">—</span>`}</td>
    <td class="right"><button class="btn btn-small btn-ghost" data-delete-extra>Delete</button></td>
  </tr>`).join("");
}

$("#extra-form").addEventListener("change", (e) => {
  if (e.target.name !== "x-mode") return;
  const removing = e.target.value === "remove";
  $("#extra-form").classList.toggle("removing", removing);
  $("#x-submit").textContent = removing ? "− Remove points" : "＋ Add points";
  $("#x-reason").placeholder = removing ? "e.g. No homework" : "e.g. Helped classmates";
});

$("#extra-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#x-email").value;
  const amount = Math.abs(Number($("#x-points").value));
  const removing = $("[name='x-mode']:checked").value === "remove";
  const points = removing ? -amount : amount;
  const reason = $("#x-reason").value.trim();
  if (!email) return toast("Choose a student.", "error");
  if (!Number.isFinite(amount) || amount === 0) return toast("Points can’t be 0.", "error");
  if (!reason) return toast("Write a reason so the student knows why.", "error");
  const { error } = await sb.from("extra_points").insert({ email, points, reason, given_on: todayIso() });
  if (error) return toast(error.message, "error");
  toast(`${signedPoints(points)} points for ${studentName(email)}.`, "success");
  $("#x-points").value = "";
  $("#x-reason").value = "";
  $("#x-email").value = "";
  await loadQuizzes();
});

$("#extra-rows").addEventListener("click", async (e) => {
  if (!e.target.closest("[data-delete-extra]")) return;
  const entry = T.extra.find((x) => x.id === Number(e.target.closest("[data-extra]").dataset.extra));
  if (!confirm(`Delete ${signedPoints(entry.points)} points for ${studentName(entry.email)}?`)) return;
  const { error } = await sb.from("extra_points").delete().eq("id", entry.id);
  if (error) return toast(error.message, "error");
  toast("Entry deleted. The points are back to how they were.", "success");
  await loadQuizzes();
});

// Full ranking for the teacher, counted the same way as the students' Top 3
// (marks on visible quizzes + extra points).
function renderRanking() {
  const visible = new Map(T.quizzes.filter((q) => q.published).map((q) => [q.id, q]));
  const ranked = T.students.map((p) => {
    const mine = T.quizScores.filter((s) => s.email === p.email && visible.has(s.quiz_id));
    const extras = T.extra.filter((x) => x.email === p.email);
    const quizPoints = mine.reduce((sum, s) => sum + s.score, 0);
    const extra = extras.reduce((sum, x) => sum + x.points, 0);
    const possible = mine.reduce((sum, s) => sum + Number(visible.get(s.quiz_id).max_score), 0);
    return {
      ...p, quizPoints, extra, points: quizPoints + extra, count: mine.length,
      hasAny: mine.length > 0 || extras.length > 0,
      pct: possible ? Math.round((quizPoints / possible) * 100) : null,
    };
  }).sort((a, b) => b.points - a.points || (a.full_name || a.email).localeCompare(b.full_name || b.email));

  if (!ranked.length) {
    $("#ranking-rows").innerHTML = `<tr><td colspan="7" class="muted">No students yet.</td></tr>`;
    return;
  }
  let place = 0;
  $("#ranking-rows").innerHTML = ranked.map((p, i) => {
    if (i === 0 || p.points !== ranked[i - 1].points) place = i + 1;
    const badge = p.points > 0 && place <= 3 ? MEDALS[place - 1] : place;
    return `<tr>
      <td><span class="rank">${p.hasAny ? badge : "—"}</span></td>
      <td>${p.hasAny ? levelName(p.full_name || p.email, p.points, T.levels) : escapeHtml(p.full_name || p.email)}
        </td>
      <td>${formatPoints(p.quizPoints)}</td>
      <td>${p.extra ? signedPoints(p.extra) : `<span class="muted">—</span>`}</td>
      <td><strong>${formatPoints(p.points)}</strong></td>
      <td>${p.count}</td>
      <td>${p.pct === null ? `<span class="muted">—</span>` : p.pct + "%"}</td>
    </tr>`;
  }).join("");
}

const MEDALS = ["🥇", "🥈", "🥉"];

// ----- levels editor -----

function renderLevels() {
  const rows = $("#level-rows");
  if (!T.levelDraft.length) {
    rows.innerHTML = `<tr><td colspan="5" class="muted">No levels. Names show without colours. Click “Add level”.</td></tr>`;
    return;
  }
  rows.innerHTML = T.levelDraft.map((l, i) => `<tr data-level="${i}">
    <td><input class="name-input" data-level-field="title" value="${escapeHtml(l.title)}" required aria-label="Level name"></td>
    <td><input class="order-input" type="number" step="any" data-level-field="min_points" value="${formatPoints(l.min_points)}" required aria-label="Minimum points"></td>
    <td><input class="color-input" type="color" data-level-field="color" value="${l.color}" aria-label="Colour"></td>
    <td><span class="lvl lvl-name" style="--c:${l.color}">${escapeHtml(l.title) || "Student"}</span></td>
    <td class="right"><button type="button" class="btn btn-small btn-ghost" data-remove-level>Remove</button></td>
  </tr>`).join("");
}

$("#level-rows").addEventListener("input", (e) => {
  const field = e.target.dataset.levelField;
  if (!field) return;
  const row = e.target.closest("[data-level]");
  const level = T.levelDraft[Number(row.dataset.level)];
  level[field] = field === "min_points" ? Number(e.target.value) : e.target.value;
  const preview = row.querySelector(".lvl");
  preview.style.setProperty("--c", level.color);
  preview.textContent = level.title || "Student";
});

$("#level-rows").addEventListener("click", (e) => {
  if (!e.target.closest("[data-remove-level]")) return;
  T.levelDraft.splice(Number(e.target.closest("[data-level]").dataset.level), 1);
  renderLevels();
});

$("#add-level-btn").addEventListener("click", () => {
  const top = T.levelDraft.reduce((max, l) => Math.max(max, Number(l.min_points) || 0), 0);
  T.levelDraft.push({ id: null, title: "", min_points: T.levelDraft.length ? top + 50 : 0, color: "#808080" });
  renderLevels();
  $all("[data-level-field='title']").at(-1).focus();
});

$("#levels-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const draft = T.levelDraft.map((l) => ({ ...l, title: l.title.trim() }));
  if (draft.some((l) => !l.title || !Number.isFinite(l.min_points))) {
    return toast("Every level needs a name and minimum points.", "error");
  }
  const mins = draft.map((l) => l.min_points);
  if (new Set(mins).size !== mins.length) return toast("Two levels can’t have the same minimum points.", "error");

  const keepIds = new Set(draft.filter((l) => l.id).map((l) => l.id));
  const removed = T.levels.filter((l) => !keepIds.has(l.id)).map((l) => l.id);
  if (removed.length) {
    const { error } = await sb.from("rank_levels").delete().in("id", removed);
    if (error) return toast(error.message, "error");
  }
  // minimum points must stay unique while saving, so park the kept rows on temporary values first
  const existing = draft.filter((l) => l.id);
  for (const [i, l] of existing.entries()) {
    const { error } = await sb.from("rank_levels").update({ min_points: -1e9 - i }).eq("id", l.id);
    if (error) return toast(error.message, "error");
  }
  for (const l of existing) {
    const { error } = await sb.from("rank_levels")
      .update({ title: l.title, min_points: l.min_points, color: l.color }).eq("id", l.id);
    if (error) return toast(error.message, "error");
  }
  const added = draft.filter((l) => !l.id).map(({ title, min_points, color }) => ({ title, min_points, color }));
  if (added.length) {
    const { error } = await sb.from("rank_levels").insert(added);
    if (error) return toast(error.message, "error");
  }
  toast("Levels saved.", "success");
  await loadQuizzes();
});

function resetQuizForm() {
  T.editingQuizId = null;
  $("#quiz-form").reset();
  $("#q-date").value = todayIso();
  $("#q-published").checked = true;
  $("#quiz-form-title").textContent = "New quiz";
  $("#quiz-save-btn").textContent = "+ Add quiz";
  $("#quiz-cancel-btn").hidden = true;
}

$("#quiz-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const row = {
    title: $("#q-title").value.trim(),
    max_score: Number($("#q-max").value),
    quiz_date: $("#q-date").value,
    chapter_id: Number($("#q-chapter").value) || null,
    published: $("#q-published").checked,
  };
  if (!row.title) return;
  if (!(row.max_score > 0)) return toast("The full mark must be more than 0.", "error");
  if (T.editingQuizId) {
    const highest = Math.max(0, ...scoresFor(T.editingQuizId).map((s) => s.score));
    if (highest > row.max_score) {
      return toast(`A student already has ${formatPoints(highest)}. The full mark can’t be lower than that.`, "error");
    }
  }
  const query = T.editingQuizId
    ? sb.from("quizzes").update(row).eq("id", T.editingQuizId)
    : sb.from("quizzes").insert(row).select().single();
  const { data, error } = await query;
  if (error) return toast(error.message, "error");
  const wasNew = !T.editingQuizId;
  toast(wasNew ? `Quiz “${row.title}” added. Now enter the marks.` : "Quiz saved.", "success");
  resetQuizForm();
  $("#q-chapter").value = row.chapter_id || "";
  await loadQuizzes();
  if (wasNew && data) openMarks(T.quizzes.find((q) => q.id === data.id));
});

$("#quiz-cancel-btn").addEventListener("click", resetQuizForm);

$("#quiz-rows").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-quiz]");
  if (!row) return;
  const quiz = T.quizzes.find((q) => q.id === Number(row.dataset.quiz));
  if (e.target.closest("[data-marks]")) {
    openMarks(quiz);
  } else if (e.target.closest("[data-edit-quiz]")) {
    T.editingQuizId = quiz.id;
    $("#q-title").value = quiz.title;
    $("#q-max").value = formatPoints(quiz.max_score);
    $("#q-date").value = quiz.quiz_date;
    $("#q-chapter").value = quiz.chapter_id || "";
    $("#q-published").checked = quiz.published;
    $("#quiz-form-title").textContent = "Edit quiz";
    $("#quiz-save-btn").textContent = "Save quiz";
    $("#quiz-cancel-btn").hidden = false;
    $("#quiz-form").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#q-title").focus();
  } else if (e.target.closest("[data-delete-quiz]")) {
    if (!confirm(`Delete “${quiz.title}” and all its marks? This cannot be undone.`)) return;
    const { error } = await sb.from("quizzes").delete().eq("id", quiz.id);
    if (error) return toast(error.message, "error");
    if (T.editingQuizId === quiz.id) resetQuizForm();
    toast("Quiz deleted.", "success");
    await loadQuizzes();
  }
});

$("#quiz-rows").addEventListener("change", async (e) => {
  const box = e.target.closest("[data-quiz-visible]");
  if (!box) return;
  const quiz = T.quizzes.find((q) => q.id === Number(box.closest("[data-quiz]").dataset.quiz));
  const { error } = await sb.from("quizzes").update({ published: box.checked }).eq("id", quiz.id);
  if (error) {
    box.checked = !box.checked;
    return toast(error.message, "error");
  }
  quiz.published = box.checked;
  box.nextElementSibling.textContent = box.checked ? "Visible" : "Hidden";
  renderRanking();
  toast(box.checked ? "Students can now see this quiz." : "Quiz hidden. Its marks don’t count for the Top 3.", "success");
});

// ----- entering marks -----

function openMarks(quiz) {
  T.markingQuiz = quiz;
  const max = Number(quiz.max_score);
  const current = new Map(scoresFor(quiz.id).map((s) => [s.email, s.score]));
  $("#marks-title").textContent = `Marks · ${quiz.title}`;
  $("#marks-hint").textContent = `Out of ${formatPoints(max)}. Leave a box empty if the student has no mark (for example, absent). ` +
    "Press Enter to jump to the next student.";
  $("#marks-rows").innerHTML = T.students.length ? T.students.map((p) => `
    <tr>
      <td>${escapeHtml(p.full_name) || `<span class="muted">—</span>`}</td>
      <td class="muted small">${escapeHtml(p.email)}</td>
      <td class="nowrap"><input class="mark-input" type="number" min="0" max="${max}" step="any" inputmode="decimal"
        data-mark-email="${escapeHtml(p.email)}" value="${current.has(p.email) ? formatPoints(current.get(p.email)) : ""}"
        aria-label="Mark for ${escapeHtml(p.full_name || p.email)}"> <span class="muted">/ ${formatPoints(max)}</span></td>
    </tr>`).join("")
    : `<tr><td colspan="3" class="muted">No students yet. Add them in the Students tab.</td></tr>`;
  $("#quiz-list-view").hidden = true;
  $("#marks-form").hidden = false;
  window.scrollTo(0, 0);
  const first = $("[data-mark-email]");
  if (first) first.focus();
}

function closeMarks() {
  T.markingQuiz = null;
  $("#marks-form").hidden = true;
  $("#quiz-list-view").hidden = false;
}

$("#marks-rows").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.matches("[data-mark-email]")) return;
  e.preventDefault();
  const inputs = $all("[data-mark-email]");
  const next = inputs[inputs.indexOf(e.target) + 1];
  if (next) next.focus();
  else $("#marks-form").requestSubmit();
});

$("#marks-cancel-btn").addEventListener("click", closeMarks);

$("#marks-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const quiz = T.markingQuiz;
  const max = Number(quiz.max_score);
  const had = new Set(scoresFor(quiz.id).map((s) => s.email));
  const upserts = [];
  const removes = [];
  for (const input of $all("[data-mark-email]")) {
    const email = input.dataset.markEmail;
    const text = input.value.trim();
    if (!text) {
      if (had.has(email)) removes.push(email);
      continue;
    }
    const score = Number(text);
    if (!Number.isFinite(score) || score < 0 || score > max) {
      input.focus();
      return toast(`Marks must be between 0 and ${formatPoints(max)}.`, "error");
    }
    upserts.push({ quiz_id: quiz.id, email, score, updated_at: new Date().toISOString() });
  }
  if (upserts.length) {
    const { error } = await sb.from("quiz_scores").upsert(upserts, { onConflict: "quiz_id,email" });
    if (error) return toast(error.message, "error");
  }
  if (removes.length) {
    const { error } = await sb.from("quiz_scores").delete().eq("quiz_id", quiz.id).in("email", removes);
    if (error) return toast(error.message, "error");
  }
  toast(`Saved ${upserts.length} mark(s) for “${quiz.title}”.`, "success");
  closeMarks();
  await loadQuizzes();
});

// ---------- results ----------

T.results = null;

async function loadResults() {
  const grid = $("#results-grid");
  grid.innerHTML = `<p class="muted">Loading…</p>`;
  const [peopleRes, subsRes] = await Promise.all([
    sb.from("allowed_emails").select("*").eq("role", "student").order("full_name"),
    sb.from("submissions").select("task_id, email, passed, total, created_at"),
  ]);
  if (peopleRes.error || subsRes.error) {
    grid.innerHTML = "";
    return toast((peopleRes.error || subsRes.error).message, "error");
  }
  // best submission and attempt count per (email, task)
  const cells = new Map();
  for (const s of subsRes.data) {
    const key = `${s.email}|${s.task_id}`;
    const cell = cells.get(key) || { best: null, attempts: 0 };
    cell.attempts++;
    if (!cell.best || s.passed / (s.total || 1) > cell.best.passed / (cell.best.total || 1)) cell.best = s;
    cells.set(key, cell);
  }
  T.results = { students: peopleRes.data, cells };
  renderResults();
}

function isSolved(email, taskId) {
  const cell = T.results.cells.get(`${email}|${taskId}`);
  return !!cell && cell.best.total > 0 && cell.best.passed === cell.best.total;
}

// One table: every chapter's tasks side by side, students ranked by tasks solved.
function renderResults() {
  const grid = $("#results-grid");
  const hint = $("#results-hint");
  const { students, cells } = T.results;
  const groups = groupByChapter(T.tasks.filter((t) => t.published), T.chapters);
  const tasks = groups.flatMap((g) => g.items);
  if (!tasks.length || !students.length) {
    hint.innerHTML = "";
    grid.innerHTML = `<p class="muted">Results appear here once you have visible tasks and students.</p>`;
    return;
  }
  hint.innerHTML = `<p class="muted small">Ranked by tasks solved.
    <span class="legend cell-pass">✓</span> solved
    <span class="legend cell-partial">2/4</span> tests passed
    <span class="legend cell-none">—</span> not tried.
    Click a cell to see the student’s code.</p>`;

  const ranked = students
    .map((p) => ({ ...p, solved: tasks.filter((t) => isSolved(p.email, t.id)).length }))
    .sort((a, b) => b.solved - a.solved || (a.full_name || a.email).localeCompare(b.full_name || b.email));
  const MEDALS = ["🥇", "🥈", "🥉"];
  let rank = 0;

  const chapterHead = groups.map((g) =>
    `<th class="chapter-col ch-start" colspan="${g.items.length}" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</th>`).join("");
  const firstIds = new Set(groups.map((g) => g.items[0].id));
  const taskHead = tasks.map((t) =>
    `<th class="task-col ${firstIds.has(t.id) ? "ch-start" : ""}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</th>`).join("");

  const body = ranked.map((p, i) => {
    if (i === 0 || p.solved !== ranked[i - 1].solved) rank = i + 1;
    const badge = p.solved > 0 && rank <= 3 ? MEDALS[rank - 1] : rank;
    const tds = tasks.map((t) => {
      const start = firstIds.has(t.id) ? " ch-start" : "";
      const cell = cells.get(`${p.email}|${t.id}`);
      if (!cell) return `<td class="cell cell-none${start}">—</td>`;
      const { passed, total } = cell.best;
      const full = total > 0 && passed === total;
      return `<td class="cell ${full ? "cell-pass" : "cell-partial"}${start}" data-email="${escapeHtml(p.email)}" data-task="${t.id}"
        title="${cell.attempts} attempt(s)">${full ? "✓" : `${passed}/${total}`}</td>`;
    }).join("");
    return `<tr>
      <th class="student-name" data-name="${escapeHtml(p.full_name || p.email)}"><span class="rank">${badge}</span>${escapeHtml(p.full_name || p.email)}</th>
      ${tds}
      <td class="total">${p.solved}/${tasks.length}</td>
    </tr>`;
  }).join("");

  const solvedBy = tasks.map((t) => {
    const n = students.filter((p) => isSolved(p.email, t.id)).length;
    return `<td class="${firstIds.has(t.id) ? "ch-start" : ""}">${n}/${students.length}</td>`;
  }).join("");

  grid.innerHTML = `<table class="table results-table">
    <thead>
      <tr><th class="student-name" rowspan="2">Student</th>${chapterHead}<th rowspan="2">Solved</th></tr>
      <tr>${taskHead}</tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="avg-row"><th class="student-name">Solved by</th>${solvedBy}<td></td></tr></tfoot>
  </table>`;
}

$("#refresh-results-btn").addEventListener("click", loadResults);

$("#results-grid").addEventListener("click", async (e) => {
  const cell = e.target.closest("td[data-task]");
  if (!cell) return;
  const task = T.tasks.find((t) => t.id === Number(cell.dataset.task));
  const studentName = cell.closest("tr").querySelector(".student-name").dataset.name;
  const { data, error } = await sb.from("submissions")
    .select("code, passed, total, created_at")
    .eq("email", cell.dataset.email)
    .eq("task_id", task.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data.length) return toast(error ? error.message : "No submission found.", "error");
  const sub = data[0];
  $("#code-dialog-title").textContent = `${studentName} · ${task.title}`;
  $("#code-dialog-meta").textContent =
    `Latest submission: ${formatDate(sub.created_at)} · ${sub.passed}/${sub.total} tests passed`;
  $("#code-dialog-code").textContent = sub.code;
  $("#code-dialog").showModal();
});

$("#close-dialog").addEventListener("click", () => $("#code-dialog").close());
$("#logout-btn").addEventListener("click", logout);

boot();
