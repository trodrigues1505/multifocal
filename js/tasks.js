// ── tasks.js ──────────────────────────────────────────────────────────────────
// Toda a lógica de criação, edição e exclusão de tarefas.

import { STATUS_LABEL, PRIO_LABEL, RECUR_LABEL }  from "./constants.js";
import { appState }  from "./state.js";
import { $, esc, today, addDays, fmtDate, fmtDT, now, toast } from "./utils.js";
import { persist }   from "./sync.js";

// Injetadas pelo app.js para evitar ciclo de importação
let _render       = () => {};
let _renderDetail = () => {};
export function setTaskRenderFns(renderFn, renderDetailFn) {
  _render       = renderFn;
  _renderDetail = renderDetailFn;
}

// ── Toggle concluída ──────────────────────────────────────────────────────────
export function toggleDone(id) {
  const t = appState.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = t.status === "done" ? "todo" : "done";
  if (t.status === "done") {
    (t.subs || []).forEach(s => s.done = true);
    if (t.recurrence && t.due) {
      const next = nextRecur(t.recurrence, t.due);
      appState.tasks.push({
        ...JSON.parse(JSON.stringify(t)),
        id: appState.nextId++,
        status: "todo",
        due: next,
        created: now(),
        subs: [],
        comments: [],
      });
    }
  }
  persist();
  _render();
  if (appState.selId === id) _renderDetail(id);
  toast(t.status === "done" ? "Concluída ✓" : "Reaberta");
}

function nextRecur(r, d) {
  return addDays(d, r === "daily" ? 1 : r === "weekly" ? 7 : 30);
}

// ── Selecionar tarefa (abre detail panel) ─────────────────────────────────────
export function selTask(id) {
  if (appState.selId === id) {
    appState.selId = null;
    $("detail-panel").classList.add("hidden");
    _render();
    return;
  }
  appState.selId = id;
  $("detail-panel").classList.remove("hidden");
  _render();
  _renderDetail(id);
}

// ── Atualizar campo ───────────────────────────────────────────────────────────
export function upd(id, field, val) {
  const t = appState.tasks.find(x => x.id === id);
  if (!t) return;
  t[field] = val;
  persist();
  _render();
  _renderDetail(id);
}

export function updNote(id, val) {
  const t = appState.tasks.find(x => x.id === id);
  if (t) { t.note = val; persist(); }
}

export function updTags(id, val) {
  const t = appState.tasks.find(x => x.id === id);
  if (!t) return;
  t.tags = val.trim().split(/\s+/).filter(Boolean)
    .map(tag => tag.startsWith("#") ? tag : "#" + tag);
  persist();
  _render();
  _renderDetail(id);
}

// ── Subtarefas ────────────────────────────────────────────────────────────────
export function toggleSub(tid, sid) {
  const t = appState.tasks.find(x => x.id === tid);
  if (!t) return;
  const s = (t.subs || []).find(x => x.id === sid);
  if (!s) return;
  s.done = !s.done;
  if (s.done) s.completedAt = now();
  else delete s.completedAt;
  persist();
  _render();
  _renderDetail(tid);
}

export function delSub(tid, sid) {
  const t = appState.tasks.find(x => x.id === tid);
  if (!t) return;
  t.subs = (t.subs || []).filter(x => x.id !== sid);
  persist();
  _render();
  _renderDetail(tid);
}

export function addSub(tid) {
  const inp = $("ns-" + tid);
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  const t = appState.tasks.find(x => x.id === tid);
  if (!t) return;
  if (!t.subs) t.subs = [];
  t.subs.push({ id: "s" + now(), title: v, done: false, createdAt: now() });
  inp.value = "";
  persist();
  _render();
  _renderDetail(tid);
}

// ── Comentários ───────────────────────────────────────────────────────────────
export function addComment(tid) {
  const ta = $("nc-" + tid);
  if (!ta) return;
  const v = ta.value.trim();
  if (!v) return;
  const t = appState.tasks.find(x => x.id === tid);
  if (!t) return;
  if (!t.comments) t.comments = [];
  t.comments.push({ id: "c" + now(), text: v, createdAt: now() });
  ta.value = "";
  persist();
  _render();
  _renderDetail(tid);
  toast("Comentário adicionado");
}

export function delComment(tid, cid) {
  const t = appState.tasks.find(x => x.id === tid);
  if (!t) return;
  t.comments = (t.comments || []).filter(c => c.id !== cid);
  persist();
  _render();
  _renderDetail(tid);
}

// ── Dependências ──────────────────────────────────────────────────────────────
export function addDep(id) {
  const sel = $("nd-" + id);
  if (!sel || !sel.value) return;
  const depId = parseInt(sel.value);
  const t = appState.tasks.find(x => x.id === id);
  if (!t) return;
  if (!t.deps) t.deps = [];
  if (!t.deps.includes(depId)) {
    t.deps.push(depId);
    persist();
    _render();
    _renderDetail(id);
  }
}

export function removeDep(id, depId) {
  const t = appState.tasks.find(x => x.id === id);
  if (!t) return;
  t.deps = (t.deps || []).filter(d => d !== depId);
  persist();
  _render();
  _renderDetail(id);
}

// ── Excluir tarefa ────────────────────────────────────────────────────────────
export function delTask(id) {
  appState.tasks = appState.tasks.filter(t => t.id !== id);
  appState.tasks.forEach(t => {
    t.deps = (t.deps || []).filter(d => d !== id);
  });
  appState.selId = null;
  $("detail-panel").classList.add("hidden");
  persist();
  _render();
  toast("Tarefa excluída");
}

// ── Limpar tudo ───────────────────────────────────────────────────────────────
export function confirmClearAll() {
  $("clear-confirm-input").value = "";
  $("btn-clear-confirm").disabled = true;
  $("clear-overlay").classList.remove("hidden");
  setTimeout(() => $("clear-confirm-input").focus(), 60);
}

export function checkClearConfirm() {
  $("btn-clear-confirm").disabled =
    $("clear-confirm-input").value.trim().toUpperCase() !== "CONFIRMAR";
}

export function clearAllTasks() {
  if ($("clear-confirm-input").value.trim().toUpperCase() !== "CONFIRMAR") return;
  appState.tasks = [];
  appState.selId = null;
  $("detail-panel").classList.add("hidden");
  $("clear-overlay").classList.add("hidden");
  persist();
  _render();
  toast("Todas as tarefas foram excluídas");
}

// ── Modal de tarefa ───────────────────────────────────────────────────────────
export function openModal(eid) {
  appState.editId = eid || null;
  const t = eid ? appState.tasks.find(x => x.id === eid) : null;
  $("modal-title").textContent = t ? "Editar tarefa" : "Nova tarefa";
  $("m-title").value  = t ? t.title       : "";
  $("m-desc").value   = t ? t.desc  || "" : "";
  $("m-status").value = t ? t.status      : "todo";
  $("m-prio").value   = t ? t.priority || "medium" : "medium";
  $("m-due").value    = t ? t.due   || "" : "";
  $("m-est").value    = t ? t.timeEst || "" : "";
  $("m-recur").value  = t ? t.recurrence || "" : "";
  $("m-tags").value   = t ? (t.tags || []).join(" ") : "";
  const cs = $("m-cat");
  cs.innerHTML = appState.cats
    .map(c => `<option value="${c.id}">${esc(c.label)}</option>`)
    .join("");
  if (t) cs.value = t.cat;
  $("modal-overlay").classList.remove("hidden");
  setTimeout(() => $("m-title").focus(), 60);
}

export function closeModal() {
  $("modal-overlay").classList.add("hidden");
  appState.editId = null;
}

export function closeModalOut(e) {
  if (e.target === $("modal-overlay")) closeModal();
}

export function saveTask() {
  const title = $("m-title").value.trim();
  if (!title) { $("m-title").focus(); return; }
  const tags = $("m-tags").value.trim().split(/\s+/).filter(Boolean)
    .map(tag => tag.startsWith("#") ? tag : "#" + tag);

  if (appState.editId) {
    const t = appState.tasks.find(x => x.id === appState.editId);
    t.title       = title;
    t.desc        = $("m-desc").value;
    t.status      = $("m-status").value;
    t.priority    = $("m-prio").value;
    t.due         = $("m-due").value;
    t.cat         = $("m-cat").value;
    t.timeEst     = parseFloat($("m-est").value) || 0;
    t.recurrence  = $("m-recur").value;
    t.tags        = tags;
    if (appState.selId === appState.editId) _renderDetail(appState.editId);
    toast("Tarefa atualizada");
  } else {
    appState.tasks.push({
      id:         appState.nextId++,
      title,
      desc:       $("m-desc").value,
      status:     $("m-status").value,
      priority:   $("m-prio").value,
      due:        $("m-due").value,
      cat:        $("m-cat").value,
      deps:       [],
      subs:       [],
      comments:   [],
      tags,
      recurrence: $("m-recur").value,
      timeEst:    parseFloat($("m-est").value) || 0,
      note:       "",
      created:    now(),
    });
    toast("Tarefa criada ✓");
  }
  closeModal();
  persist();
  _render();
}
