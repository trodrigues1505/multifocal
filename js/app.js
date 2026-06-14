// ── app.js ────────────────────────────────────────────────────────────────────
// Entry point. Importa todos os módulos e conecta as dependências circulares
// usando funções de injeção (setter pattern).

import { today, addDays, now, toast } from "./utils.js";
import { appState }     from "./state.js";

import {
  initAuth, signIn, signOut2,
  persist, saveLocal, loadLocal,
  initDefaultsSync, checkLgpd, acceptLgpd, openPrivacy,
  startSync, setRenderFn,
  installPWA, triggerInstall,
  exportJSON, triggerImport, importJSON,
} from "./sync.js";

import {
  render, renderDetail,
  setView, setSt,
  showLogin, showApp,
  openDashboard, closeDashboard,
  openShortcuts,
} from "./ui.js";

import {
  setTaskRenderFns,
  toggleDone, selTask,
  upd, updNote, updTags,
  toggleSub, delSub, addSub,
  addComment, delComment,
  addDep, removeDep,
  delTask,
  openModal, closeModal, closeModalOut, saveTask,
  confirmClearAll, checkClearConfirm, clearAllTasks,
} from "./tasks.js";

import {
  setCatRenderFn,
  openNewCat, openCatModal, closeCatModal, saveCat,
  confirmDeleteCat, updateDelCatUI, executeDeleteCat,
} from "./categories.js";

import {
  setMobileRenderFns,
  openMobileNav, closeMobileNav,
  setViewMobile, tabTasks, focusSearch,
  closeDetail, showDetailSheet,
  syncMobileStats,
} from "./mobile.js";

import {
  setVoiceRenderFn,
  toggleVoice, stopAll,
} from "./voice.js";

// ── Injeção de dependências (resolve ciclos) ──────────────────────────────────
// renderFull é a função que todos os módulos chamam para re-renderizar
function renderFull() {
  render();
  syncMobileStats();
}

// Injeta renderFull em módulos que precisam renderizar
setRenderFn(renderFull);
setTaskRenderFns(renderFull, renderDetail);
setCatRenderFn(renderFull);
setMobileRenderFns(renderFull, renderDetail, setView);
setVoiceRenderFn(renderFull);

// ── Auth init ─────────────────────────────────────────────────────────────────
// Passa as utils para initDefaultsSync via window (resolvido em sync.js)
window._jarvisInitDefaults = () => initDefaultsSync(today, addDays, now);

initAuth(
  // onLogin
  user => {
    showApp(user);
    checkLgpd();
  },
  // onLogout
  () => {
    showLogin();
    checkLgpd();
  }
);

// ── Selecionar tarefa com suporte ao sheet backdrop mobile ────────────────────
function selTaskFull(id) {
  selTask(id);
  showDetailSheet(id);
}

// ── Atalhos de teclado ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const tag    = document.activeElement.tagName.toLowerCase();
  const typing = ["input", "textarea", "select"].includes(tag);
  if (e.key === "Escape") {
    closeModal();
    closeDashboard({ target: document.getElementById("dashboard-overlay") });
    document.getElementById("shortcuts-overlay")?.classList.add("hidden");
    document.getElementById("clear-overlay")?.classList.add("hidden");
    document.getElementById("install-overlay")?.classList.add("hidden");
    document.getElementById("privacy-overlay")?.classList.add("hidden");
    return;
  }
  if (typing) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); openModal(); }
  if (e.key === "d" || e.key === "D") { e.preventDefault(); openDashboard(); }
  if (e.key === "/")                  { e.preventDefault(); document.getElementById("search").focus(); }
  if (e.key === "?")                  { e.preventDefault(); openShortcuts(); }
  if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleVoice(); }
});

// ── window.App — expõe funções para o HTML ────────────────────────────────────
window.App = {
  // Auth
  signIn,
  signOut: signOut2,

  // Navegação
  setView,
  setSt,

  // Tarefas
  openModal, closeModal, closeModalOut, saveTask,
  selTask:    selTaskFull,
  toggleDone,
  upd, updNote, updTags,
  toggleSub, delSub, addSub,
  addComment, delComment,
  addDep, removeDep,
  delTask,
  confirmClearAll, checkClearConfirm, clearAllTasks,

  // Categorias
  openNewCat, openCatModal, closeCatModal, saveCat,
  confirmDeleteCat, updateDelCatUI, executeDeleteCat,

  // Dashboard
  openDashboard, closeDashboard,

  // Import / Export
  exportJSON, triggerImport, importJSON,

  // PWA
  installPWA, triggerInstall,

  // UI misc
  openShortcuts,
  openPrivacy, acceptLgpd,
  render: renderFull,

  // Mobile
  openMobileNav, closeMobileNav,
  setViewMobile, tabTasks, focusSearch, closeDetail,

  // Voz
  toggleVoice, stopAll,
};

// ── Primeiro render ───────────────────────────────────────────────────────────
renderFull();

// ── Iniciar Jarvis (wake word) após render ────────────────────────────────────
setTimeout(() => {
  import("./voice.js").then(m => m.initJarvis?.());
}, 800);
