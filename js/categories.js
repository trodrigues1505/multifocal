// ── categories.js ─────────────────────────────────────────────────────────────
// Criação, edição e exclusão de categorias.

import { CAT_COLORS }  from "./constants.js";
import { appState }    from "./state.js";
import { $, esc, now, toast } from "./utils.js";
import { persist }     from "./sync.js";

let _render = () => {};
export function setCatRenderFn(fn) { _render = fn; }

// ── Abrir modal (criar ou editar) ─────────────────────────────────────────────
export function openNewCat() { openCatModal(null); }

export function openCatModal(catId) {
  const cat   = catId ? appState.cats.find(c => c.id === catId) : null;
  const color = cat ? cat.color : CAT_COLORS[appState.cats.length % CAT_COLORS.length];
  $("cat-modal-title").textContent = cat ? "Editar categoria" : "Nova categoria";
  $("cat-modal-id").value          = catId || "";
  $("cat-name-input").value        = cat ? cat.label : "";
  $("cat-color-input").value       = color;
  $("cat-modal-overlay").classList.remove("hidden");
  setTimeout(() => $("cat-name-input").focus(), 60);
}

export function closeCatModal() {
  $("cat-modal-overlay").classList.add("hidden");
}

export function saveCat() {
  const name = $("cat-name-input").value.trim();
  if (!name) { $("cat-name-input").focus(); return; }
  const color      = $("cat-color-input").value;
  const existingId = $("cat-modal-id").value;

  if (existingId) {
    const cat = appState.cats.find(c => c.id === existingId);
    if (cat) { cat.label = name; cat.color = color; }
    toast("Categoria atualizada");
  } else {
    appState.cats.push({ id: "c" + now(), label: name, color });
    toast("Categoria criada");
  }
  closeCatModal();
  persist();
  _render();
}

// ── Confirmar exclusão ────────────────────────────────────────────────────────
export function confirmDeleteCat(catId) {
  const cat = appState.cats.find(c => c.id === catId);
  if (!cat) return;

  const taskCount = appState.tasks.filter(t => t.cat === catId).length;
  $("del-cat-name").textContent = cat.label;
  $("del-cat-id").value         = catId;

  const others      = appState.cats.filter(c => c.id !== catId);
  const moveSelect  = $("del-cat-move-select");
  moveSelect.innerHTML = others
    .map(c => `<option value="${c.id}">${esc(c.label)}</option>`)
    .join("");

  const taskSection = $("del-cat-task-section");
  taskSection.style.display = taskCount > 0 ? "block" : "none";
  $("del-cat-task-count").textContent = taskCount;
  $("del-cat-action").value = others.length > 0 ? "move" : "delete";

  updateDelCatUI();
  $("del-cat-overlay").classList.remove("hidden");
}

export function updateDelCatUI() {
  const action = $("del-cat-action").value;
  $("del-cat-move-row").style.display = action === "move" ? "flex" : "none";
}

export function executeDeleteCat() {
  const catId     = $("del-cat-id").value;
  const action    = $("del-cat-action").value;
  const taskCount = appState.tasks.filter(t => t.cat === catId).length;

  if (taskCount > 0) {
    if (action === "move") {
      const targetId = $("del-cat-move-select").value;
      appState.tasks.forEach(t => { if (t.cat === catId) t.cat = targetId; });
      toast("Tarefas movidas e categoria excluída");
    } else {
      appState.tasks = appState.tasks.filter(t => t.cat !== catId);
      toast("Categoria e tarefas excluídas");
    }
  } else {
    toast("Categoria excluída");
  }

  appState.cats = appState.cats.filter(c => c.id !== catId);
  if (appState.view === "cat:" + catId) appState.view = "all";
  $("del-cat-overlay").classList.add("hidden");
  persist();
  _render();
}
