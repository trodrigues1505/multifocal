// ── sync.js ───────────────────────────────────────────────────────────────────
// Autenticação, sincronização com Firestore, localStorage e PWA install.

import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, setDoc, onSnapshot
} from "../firebase-config.js";

import { LS_KEY, LS_LGPD } from "./constants.js";
import { appState }        from "./state.js";
import { $, toast }        from "./utils.js";

// ── Referência ao render global (injetada pelo app.js para evitar ciclo) ──────
let _render = () => {};
export function setRenderFn(fn) { _render = fn; }

// ── Persistência ──────────────────────────────────────────────────────────────
export function saveLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      tasks:  appState.tasks,
      cats:   appState.cats,
      nextId: appState.nextId,
    }));
  } catch(_) {}
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      appState.tasks  = d.tasks  || [];
      appState.cats   = d.cats   || [];
      appState.nextId = d.nextId || 1;
    }
  } catch(_) {
    initDefaults();
  }
}

export function persist() {
  saveLocal();
  pushToFirestore();
}

// ── Firestore ─────────────────────────────────────────────────────────────────
export function startSync(uid) {
  stopSync();
  const ref = doc(db, "users", uid, "data", "main");
  appState.firestoreUnsubscribe = onSnapshot(ref, snap => {
    if (snap.exists()) {
      const d = snap.data();
      appState.tasks  = d.tasks  || [];
      appState.cats   = d.cats   || [];
      appState.nextId = d.nextId || 1;
    } else {
      initDefaults();
      pushToFirestore();
    }
    _render();
    setSyncState("ok");
  }, err => {
    console.error("Firestore:", err);
    setSyncState("error");
    loadLocal();
    _render();
  });
}

export function stopSync() {
  if (appState.firestoreUnsubscribe) {
    appState.firestoreUnsubscribe();
    appState.firestoreUnsubscribe = null;
  }
}

export async function pushToFirestore() {
  if (!appState.currentUser) return;
  setSyncState("syncing");
  try {
    await setDoc(
      doc(db, "users", appState.currentUser.uid, "data", "main"),
      { tasks: appState.tasks, cats: appState.cats, nextId: appState.nextId }
    );
    setSyncState("ok");
  } catch(e) {
    console.error("Save:", e);
    setSyncState("error");
    saveLocal();
  }
}

function setSyncState(s) {
  const el = $("sync-indicator");
  if (!el) return;
  el.className = "sync-indicator"
    + (s === "syncing" ? " syncing" : s === "error" ? " error" : "");
  el.innerHTML =
    s === "syncing" ? `<i class="ti ti-refresh"></i>`
    : s === "error" ? `<i class="ti ti-cloud-off"></i>`
    :                 `<i class="ti ti-cloud-check"></i>`;
  el.title =
    s === "syncing" ? "Salvando..."
    : s === "error" ? "Erro ao salvar"
    :                 "Sincronizado";
}

// ── Defaults (novo usuário) ───────────────────────────────────────────────────
export function initDefaults() {
  const { today, addDays, now } = await import("./utils.js").then(m => m);
  // utils são síncronas — import estático resolvido
  // (chamamos direto pois utils.js não tem side effects)
}

// Versão síncrona (utils já importadas estaticamente acima no app.js)
export function initDefaultsSync(todayFn, addDaysFn, nowFn) {
  appState.cats = [
    { id:"work",     label:"Trabalho", color:"#3B82F6" },
    { id:"personal", label:"Pessoal",  color:"#4CAF8A" },
    { id:"learn",    label:"Estudos",  color:"#7C5CBF" },
  ];
  const t = todayFn();
  appState.tasks = [
    { id:1, title:"Revisar relatório trimestral", desc:"Checar números e formatar PDF",
      status:"doing", priority:"high", due:t, cat:"work", deps:[], subs:[
        {id:"s1",title:"Ler rascunho inicial",done:true,completedAt:nowFn()-3600000,createdAt:nowFn()-86400000},
        {id:"s2",title:"Ajustar gráficos",done:false,createdAt:nowFn()-3600000}
      ], comments:[], tags:["#relatório","#cliente"], recurrence:"", note:"", timeEst:2, created:nowFn()-86400000 },
    { id:2, title:"Enviar proposta ao cliente", desc:"", status:"blocked", priority:"urgent",
      due:addDaysFn(t,2), cat:"work", deps:[1], subs:[], comments:[
        {id:"c1",text:"Cliente pediu ajuste no escopo",createdAt:nowFn()-7200000}
      ], tags:["#proposta"], recurrence:"", note:"", timeEst:1, created:nowFn()-70000000 },
    { id:3, title:"Estudar capítulo 4", desc:"", status:"todo", priority:"low",
      due:addDaysFn(t,6), cat:"learn", deps:[], subs:[], comments:[], tags:["#livro"],
      recurrence:"weekly", note:"", timeEst:1.5, created:nowFn()-50000000 },
    { id:4, title:"Comprar mantimentos", desc:"Frutas, arroz, café", status:"todo", priority:"medium",
      due:t, cat:"personal", deps:[], subs:[
        {id:"s3",title:"Frutas",done:false,createdAt:nowFn()-1000000},
        {id:"s4",title:"Café",done:true,completedAt:nowFn()-500000,createdAt:nowFn()-1000000}
      ], comments:[], tags:[], recurrence:"weekly", note:"", timeEst:0.5, created:nowFn()-30000000 },
    { id:5, title:"Preparar apresentação", desc:"Slides da reunião semanal", status:"review",
      priority:"high", due:addDaysFn(t,3), cat:"work", deps:[1], subs:[], comments:[],
      tags:["#slides"], recurrence:"", note:"", timeEst:3, created:nowFn()-20000000 },
    { id:6, title:"Pagar conta de luz", desc:"", status:"done", priority:"medium",
      due:addDaysFn(t,-2), cat:"personal", deps:[], subs:[], comments:[], tags:[],
      recurrence:"monthly", note:"", timeEst:0, created:nowFn()-10000000 },
  ];
  appState.nextId = 10;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, user => {
    if (user) {
      appState.currentUser = user;
      onLogin(user);
      startSync(user.uid);
      checkLgpd();
    } else {
      appState.currentUser = null;
      stopSync();
      onLogout();
    }
  });
}

export async function signIn() {
  try { await signInWithPopup(auth, provider); }
  catch(_) { toast("Erro no login"); }
}

export async function signOut2() {
  try { stopSync(); await signOut(auth); }
  catch(_) { toast("Erro ao sair"); }
}

// ── LGPD ─────────────────────────────────────────────────────────────────────
function lgpdKey() {
  return LS_LGPD + (appState.currentUser ? "_" + appState.currentUser.uid : "_guest");
}

export function checkLgpd() {
  const el = $("lgpd-banner");
  if (!el) return;
  if (!localStorage.getItem(lgpdKey())) {
    el.style.display = "block";
    el.classList.add("visible");
  } else {
    el.style.display = "none";
    el.classList.remove("visible");
  }
}

export function acceptLgpd() {
  localStorage.setItem(lgpdKey(), "1");
  const el = $("lgpd-banner");
  if (el) { el.style.display = "none"; el.classList.remove("visible"); }
}

export function openPrivacy() {
  $("privacy-overlay").classList.remove("hidden");
}

// ── PWA Install ───────────────────────────────────────────────────────────────
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  appState.deferredInstallPrompt = e;
});
window.addEventListener("appinstalled", () => {
  appState.deferredInstallPrompt = null;
  toast("Jarvis instalado com sucesso!");
});

export function installPWA() {
  $("install-overlay").classList.remove("hidden");
  const nativeDiv = $("install-native");
  if (appState.deferredInstallPrompt && nativeDiv) nativeDiv.style.display = "block";
}

export async function triggerInstall() {
  if (!appState.deferredInstallPrompt) return;
  appState.deferredInstallPrompt.prompt();
  await appState.deferredInstallPrompt.userChoice;
  appState.deferredInstallPrompt = null;
  $("install-overlay").classList.add("hidden");
}

// ── Import / Export JSON ──────────────────────────────────────────────────────
export function exportJSON() {
  const blob = new Blob(
    [JSON.stringify({ tasks: appState.tasks, cats: appState.cats, nextId: appState.nextId }, null, 2)],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "jarvis-backup.json";
  a.click();
  toast("Exportado ✓");
}

export function triggerImport() { $("import-input").click(); }

export function importJSON(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.tasks && d.cats) {
        appState.tasks  = d.tasks;
        appState.cats   = d.cats;
        appState.nextId = d.nextId || 1;
        persist();
        _render();
        toast("Importado ✓");
      } else {
        toast("Arquivo inválido");
      }
    } catch { toast("Erro ao importar"); }
    e.target.value = "";
  };
  r.readAsText(f);
}
