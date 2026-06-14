// ── state.js ──────────────────────────────────────────────────────────────────
// Estado global mutável compartilhado entre módulos.
// Exportado como objeto para que mutações sejam visíveis em todos os importadores.

export const appState = {
  // Dados persistidos
  tasks:  [],
  cats:   [],
  nextId: 1,

  // Sessão
  currentUser:          null,
  firestoreUnsubscribe: null,
  deferredInstallPrompt: null,

  // UI
  view:  "all",   // filtro de navegação ativo
  sf:    "all",   // filtro de status ativo
  selId: null,    // id da tarefa selecionada no detail panel
  editId: null,   // id da tarefa sendo editada no modal
};
