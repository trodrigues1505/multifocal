import {
  auth, db, provider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, setDoc, getDoc, deleteDoc, onSnapshot
} from "./firebase-config.js";

// ── Constants ────────────────────────────────────────────────────────────────
const PRIO_ORDER   = { urgent:0, high:1, medium:2, low:3 };
const PRIO_LABEL   = { urgent:"Urgente", high:"Alta", medium:"Média", low:"Baixa" };
const PRIO_CLS     = { urgent:"urgent", high:"high", medium:"medium", low:"low" };
const STATUS_LABEL = { todo:"A fazer", doing:"Em andamento", review:"Revisão", blocked:"Bloqueada", done:"Concluída" };
const STATUS_CLS   = { todo:"b-todo", doing:"b-doing", review:"b-review", blocked:"b-blocked", done:"b-done" };
const RECUR_LABEL  = { daily:"Diária", weekly:"Semanal", monthly:"Mensal" };
const DAYS_PT      = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
const LS_KEY       = "jarvis_v1";
const LS_LGPD      = "jarvis_lgpd";

// ── State ────────────────────────────────────────────────────────────────────
let state = { tasks:[], cats:[], nextId:1 };
let currentUser = null;
let unsubscribe  = null;
let view = "all", sf = "all", selId = null, editId = null;
let deferredInstallPrompt = null;

// ── Utils ─────────────────────────────────────────────────────────────────────
const $       = id => document.getElementById(id);
const esc     = s  => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const today   = () => new Date().toISOString().split("T")[0];
const addDays = (d,n) => { const dt=new Date(d); dt.setDate(dt.getDate()+n); return dt.toISOString().split("T")[0]; };
const weekEnd = () => { const dt=new Date(); dt.setDate(dt.getDate()+(6-dt.getDay())); return dt.toISOString().split("T")[0]; };
const fmtDate = d => { if(!d) return ""; const [y,m,day]=d.split("-"); return `${day}/${m}/${y}`; };
const fmtDT   = ts => { if(!ts) return ""; const d=new Date(ts); return d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})+" "+d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); };
const getCat  = id => state.cats.find(c=>c.id===id) || {label:id||"",color:"#888"};
const now     = () => Date.now();

// ── LGPD ──────────────────────────────────────────────────────────────────────
function lgpdKey() {
  // Per-user key so each new user sees the banner
  return LS_LGPD + (currentUser ? "_" + currentUser.uid : "_guest");
}
function checkLgpd() {
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
function acceptLgpd() {
  localStorage.setItem(lgpdKey(), "1");
  const el = $("lgpd-banner");
  if (el) { el.style.display = "none"; el.classList.remove("visible"); }
}
function openPrivacy() {
  $("privacy-overlay").classList.remove("hidden");
}

// ── PWA install ───────────────────────────────────────────────────────────────
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Button is always visible — native prompt now available
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  toast("App instalado com sucesso!");
});

function installPWA() {
  $("install-overlay").classList.remove("hidden");
  const nativeDiv = $("install-native");
  if (deferredInstallPrompt && nativeDiv) nativeDiv.style.display = "block";
}
async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("install-overlay").classList.add("hidden");
}

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp(user);
    startSync(user.uid);
    checkLgpd();
  } else {
    currentUser = null;
    stopSync();
    showLogin();
  }
});

function showLogin() {
  $("screen-login").classList.remove("hidden");
  $("screen-app").classList.add("hidden");
  checkLgpd();
}
function showApp(user) {
  $("screen-login").classList.add("hidden");
  $("screen-app").classList.remove("hidden");
  renderUserRow(user);
}
function renderUserRow(user) {
  const initials = (user.displayName||user.email||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  $("user-row").innerHTML = `
    <div class="user-avatar">
      ${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : initials}
    </div>
    <span class="user-name">${esc(user.displayName||user.email||"")}</span>`;
}

// ── Sync indicator ────────────────────────────────────────────────────────────
function setSyncState(s) {
  const el = $("sync-indicator");
  if (!el) return;
  el.className = "sync-indicator" + (s==="syncing" ? " syncing" : s==="error" ? " error" : "");
  el.innerHTML = s==="syncing" ? `<i class="ti ti-refresh"></i>`
               : s==="error"   ? `<i class="ti ti-cloud-off"></i>`
               :                 `<i class="ti ti-cloud-check"></i>`;
  el.title = s==="syncing" ? "Salvando..." : s==="error" ? "Erro ao salvar" : "Sincronizado";
}

// ── Firestore ─────────────────────────────────────────────────────────────────
function startSync(uid) {
  stopSync();
  const ref = doc(db, "users", uid, "data", "main");
  unsubscribe = onSnapshot(ref, snap => {
    if (snap.exists()) {
      const d = snap.data();
      state = { tasks: d.tasks||[], cats: d.cats||[], nextId: d.nextId||1 };
    } else {
      initDefaults();
      pushToFirestore();
    }
    render();
    setSyncState("ok");
  }, err => {
    console.error("Firestore:", err);
    setSyncState("error");
    loadLocal(); render();
  });
}
function stopSync() { if (unsubscribe) { unsubscribe(); unsubscribe = null; } }

async function pushToFirestore() {
  if (!currentUser) return;
  setSyncState("syncing");
  try {
    await setDoc(doc(db,"users",currentUser.uid,"data","main"),
      { tasks: state.tasks, cats: state.cats, nextId: state.nextId });
    setSyncState("ok");
  } catch(e) {
    console.error("Save:", e);
    setSyncState("error");
    saveLocal();
  }
}

// ── LocalStorage ──────────────────────────────────────────────────────────────
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) {} }
function loadLocal() { try { const d=localStorage.getItem(LS_KEY); if(d) state=JSON.parse(d); } catch(e) { initDefaults(); } }

// ── Defaults ──────────────────────────────────────────────────────────────────
function initDefaults() {
  state.cats = [
    { id:"work",     label:"Trabalho", color:"#3B82F6" },
    { id:"personal", label:"Pessoal",  color:"#4CAF8A" },
    { id:"learn",    label:"Estudos",  color:"#7C5CBF" }
  ];
  const t = today();
  state.tasks = [
    { id:1, title:"Revisar relatório trimestral", desc:"Checar números e formatar PDF", status:"doing", priority:"high", due:t, cat:"work", deps:[], subs:[
        {id:"s1",title:"Ler rascunho inicial",done:true,completedAt:now()-3600000,createdAt:now()-86400000},
        {id:"s2",title:"Ajustar gráficos",done:false,createdAt:now()-3600000}
      ], comments:[], tags:["#relatório","#cliente"], recurrence:"", note:"", timeEst:2, created:now()-86400000 },
    { id:2, title:"Enviar proposta ao cliente", desc:"", status:"blocked", priority:"urgent", due:addDays(t,2), cat:"work", deps:[1], subs:[], comments:[
        {id:"c1",text:"Cliente pediu ajuste no escopo — aguardando e-mail de confirmação",createdAt:now()-7200000}
      ], tags:["#proposta"], recurrence:"", note:"", timeEst:1, created:now()-70000000 },
    { id:3, title:"Estudar capítulo 4", desc:"", status:"todo", priority:"low", due:addDays(t,6), cat:"learn", deps:[], subs:[], comments:[], tags:["#livro"], recurrence:"weekly", note:"", timeEst:1.5, created:now()-50000000 },
    { id:4, title:"Comprar mantimentos", desc:"Frutas, arroz, café", status:"todo", priority:"medium", due:t, cat:"personal", deps:[], subs:[
        {id:"s3",title:"Frutas",done:false,createdAt:now()-1000000},
        {id:"s4",title:"Café",done:true,completedAt:now()-500000,createdAt:now()-1000000}
      ], comments:[], tags:[], recurrence:"weekly", note:"", timeEst:0.5, created:now()-30000000 },
    { id:5, title:"Preparar apresentação", desc:"Slides da reunião semanal", status:"review", priority:"high", due:addDays(t,3), cat:"work", deps:[1], subs:[], comments:[], tags:["#slides"], recurrence:"", note:"", timeEst:3, created:now()-20000000 },
    { id:6, title:"Pagar conta de luz", desc:"", status:"done", priority:"medium", due:addDays(t,-2), cat:"personal", deps:[], subs:[], comments:[], tags:[], recurrence:"monthly", note:"", timeEst:0, created:now()-10000000 },
  ];
  state.nextId = 10;
}

// ── Filter / sort ─────────────────────────────────────────────────────────────
function getFiltered() {
  const q    = ($("search").value||"").toLowerCase();
  const sort = $("sort-sel").value;
  const td=today(), we=weekEnd();
  let arr = state.tasks.filter(t => {
    if (q) { const h=[t.title,t.desc||"",...(t.tags||[])].join(" ").toLowerCase(); if(!h.includes(q)) return false; }
    if (sf!=="all" && t.status!==sf) return false;
    if (view==="today"     && (t.due!==td||t.status==="done"))                     return false;
    if (view==="week"      && (!t.due||t.due>we||t.due<td||t.status==="done"))     return false;
    if (view==="doing"     && t.status!=="doing")                                  return false;
    if (view==="urgent"    && (t.priority!=="urgent"||t.status==="done"))          return false;
    if (view==="blocked"   && t.status!=="blocked")                                return false;
    if (view==="overdue"   && (t.status==="done"||!t.due||t.due>=td))             return false;
    if (view==="recurring" && !t.recurrence)                                       return false;
    if (view.startsWith("cat:") && t.cat!==view.slice(4))                         return false;
    return true;
  });
  arr.sort((a,b) => {
    if (sort==="due")      { if(!a.due&&!b.due) return 0; if(!a.due) return 1; if(!b.due) return -1; return a.due.localeCompare(b.due); }
    if (sort==="priority") return (PRIO_ORDER[a.priority||"medium"]||2)-(PRIO_ORDER[b.priority||"medium"]||2);
    if (sort==="title")    return a.title.localeCompare(b.title);
    return (b.created||0)-(a.created||0);
  });
  return arr;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const all=state.tasks, td=today(), we=weekEnd();
  const done=all.filter(t=>t.status==="done");
  const pct=all.length?Math.round(done.length/all.length*100):0;
  $("stat-total").textContent   = all.length;
  $("stat-doing").textContent   = all.filter(t=>t.status==="doing").length;
  $("stat-overdue").textContent = all.filter(t=>t.status!=="done"&&t.due&&t.due<td).length;
  $("prog-label").textContent   = `${pct}% concluído`;
  $("prog-bar").style.width     = `${pct}%`;
  $("b-all").textContent       = all.length;
  $("b-today").textContent     = all.filter(t=>t.due===td&&t.status!=="done").length;
  $("b-week").textContent      = all.filter(t=>t.due&&t.due>=td&&t.due<=we&&t.status!=="done").length;
  $("b-doing").textContent     = all.filter(t=>t.status==="doing").length;
  $("b-urgent").textContent    = all.filter(t=>t.priority==="urgent"&&t.status!=="done").length;
  $("b-blocked").textContent   = all.filter(t=>t.status==="blocked").length;
  $("b-overdue").textContent   = all.filter(t=>t.status!=="done"&&t.due&&t.due<td).length;
  $("b-recurring").textContent = all.filter(t=>t.recurrence).length;
}

function renderCats() {
  $("cat-nav").innerHTML = state.cats.map(c => `
    <div class="nav-item cat-nav-item${view==="cat:"+c.id?" active":""}" onclick="App.setView(this,'cat:${c.id}')">
      <span class="cat-dot" style="background:${c.color}"></span>
      <span style="flex:1">${esc(c.label)}</span>
      <span class="nav-badge">${state.tasks.filter(t=>t.cat===c.id&&t.status!=="done").length}</span>
      <span class="cat-actions">
        <button class="cat-action-btn" onclick="event.stopPropagation();App.openCatModal('${c.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        <button class="cat-action-btn danger" onclick="event.stopPropagation();App.confirmDeleteCat('${c.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
      </span>
    </div>`).join("");
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  updateStats(); renderCats();
  const items = getFiltered();
  const list  = $("task-list");
  const td    = today();
  if (!items.length) {
    const isSearch = ($("search").value||"").length > 0;
    list.innerHTML = `<div class="empty">
      <i class="ti ti-checklist"></i>
      <p>${isSearch ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa aqui ainda."}</p>
      ${!isSearch ? `<button onclick="App.openModal()"><i class="ti ti-plus" style="margin-right:4px"></i>Criar tarefa</button>` : ""}
    </div>`;
    return;
  }
  list.innerHTML = items.map(t => {
    const done=t.status==="done", prio=t.priority||"medium";
    const subs=t.subs||[], subDone=subs.filter(s=>s.done).length;
    const tags=(t.tags||[]).slice(0,3);
    const cat=getCat(t.cat);
    let dueCls="due";
    if (t.due&&!done) { if(t.due<td) dueCls="due over"; else if(t.due<=addDays(td,2)) dueCls="due soon"; }
    return `<div class="task-card${done?" done":""}${selId===t.id?" selected":""} p-${prio}" onclick="App.selTask(${t.id})">
      <div class="task-row1">
        <div class="task-check${done?" done":""}" onclick="event.stopPropagation();App.toggleDone(${t.id})" title="${done?"Reabrir":"Concluir"}">
          <i class="ti ti-check"></i>
        </div>
        <span class="task-title${done?" done":""}">${esc(t.title)}</span>
      </div>
      <div class="task-meta">
        <span class="badge ${STATUS_CLS[t.status]||"b-todo"}">${STATUS_LABEL[t.status]||t.status}</span>
        <span class="p-label ${PRIO_CLS[prio]}">${PRIO_LABEL[prio]}</span>
        <span class="cat-dot" style="background:${cat.color}" title="${esc(cat.label)}"></span>
        <span class="meta-icon" style="font-size:11px;color:var(--text3)">${esc(cat.label)}</span>
        ${t.due?`<span class="${dueCls}"><i class="ti ti-calendar" style="font-size:11px"></i>${fmtDate(t.due)}</span>`:""}
        ${t.recurrence?`<span class="recur-badge"><i class="ti ti-refresh" style="font-size:10px"></i>${RECUR_LABEL[t.recurrence]||""}</span>`:""}
        ${subs.length?`<span class="meta-icon"><i class="ti ti-check"></i>${subDone}/${subs.length}</span>`:""}
        ${(t.deps||[]).length?`<span class="meta-icon"><i class="ti ti-git-branch"></i>${t.deps.length}</span>`:""}
        ${(t.comments||[]).length?`<span class="meta-icon"><i class="ti ti-message"></i>${t.comments.length}</span>`:""}
        ${tags.map(tag=>`<span class="meta-tag">${esc(tag)}</span>`).join("")}
      </div>
    </div>`;
  }).join("");
}

// ── Task actions ──────────────────────────────────────────────────────────────
function toggleDone(id) {
  const t=state.tasks.find(x=>x.id===id); if(!t) return;
  t.status = t.status==="done" ? "todo" : "done";
  if (t.status==="done") {
    (t.subs||[]).forEach(s=>s.done=true);
    if (t.recurrence && t.due) {
      const next = nextRecur(t.recurrence, t.due);
      state.tasks.push({...JSON.parse(JSON.stringify(t)), id:state.nextId++, status:"todo", due:next, created:now(), subs:[], comments:[]});
    }
  }
  persist(); render(); if(selId===id) renderDetail(id);
  toast(t.status==="done" ? "Concluída ✓" : "Reaberta");
}
function nextRecur(r,d) { return addDays(d, r==="daily"?1:r==="weekly"?7:30); }

function selTask(id) {
  if (selId===id) { selId=null; $("detail-panel").classList.add("hidden"); render(); return; }
  selId=id; $("detail-panel").classList.remove("hidden"); render(); renderDetail(id);
}

// ── Detail ────────────────────────────────────────────────────────────────────
function renderDetail(id) {
  const t=state.tasks.find(x=>x.id===id);
  if (!t) { $("detail-panel").classList.add("hidden"); return; }
  const subs=t.subs||[], deps=t.deps||[], comments=t.comments||[];
  const subDone=subs.filter(s=>s.done).length;
  const subPct=subs.length?Math.round(subDone/subs.length*100):0;
  const depOpts=state.tasks.filter(x=>x.id!==id).map(x=>`<option value="${x.id}">${esc(x.title.slice(0,28))}</option>`).join("");
  const subItems=subs.map(s=>`
    <div class="sub-item">
      <div class="sub-check${s.done?" done":""}" onclick="App.toggleSub(${id},'${s.id}')"><i class="ti ti-check"></i></div>
      <div class="sub-item-main">
        <span class="sub-item-title${s.done?" done":""}">${esc(s.title)}</span>
        <span class="sub-item-date">${s.done&&s.completedAt?"✓ "+fmtDT(s.completedAt):"Adicionada "+fmtDT(s.createdAt)}</span>
      </div>
      <button class="sub-del" onclick="App.delSub(${id},'${s.id}')"><i class="ti ti-x"></i></button>
    </div>`).join("");
  const depItems=deps.map(d=>{
    const f=state.tasks.find(x=>x.id===d); if(!f) return "";
    return `<div class="dep-item"><i class="ti ti-git-branch" style="font-size:12px;color:var(--text3)"></i><span style="flex:1">${esc(f.title.slice(0,24))}…</span><button onclick="App.removeDep(${id},${d})"><i class="ti ti-x"></i></button></div>`;
  }).join("");
  const commentItems=comments.map(c=>`
    <div class="comment-item">
      <button class="comment-del" onclick="App.delComment(${id},'${c.id}')"><i class="ti ti-x"></i></button>
      ${esc(c.text)}
      <div class="comment-meta">${fmtDT(c.createdAt)}</div>
    </div>`).join("");

  $("detail-panel").innerHTML = `
    <div class="dp-head">
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input
          type="text"
          class="dp-title-input"
          value="${esc(t.title)}"
          onchange="App.upd(${id},'title',this.value)"
          onblur="App.upd(${id},'title',this.value)"
          placeholder="Título da tarefa"
        >
        <span style="font-size:10px;color:var(--text3)"><i class="ti ti-device-floppy" style="font-size:10px"></i> Salvo automaticamente ao alterar</span>
      </div>
      <button class="icon-btn" onclick="App.selTask(${id})"><i class="ti ti-x"></i></button>
    </div>
    <div class="dp-body">
      <div class="dp-field"><label>Status</label>
        <select onchange="App.upd(${id},'status',this.value)">
          ${Object.entries(STATUS_LABEL).map(([v,l])=>`<option value="${v}"${t.status===v?" selected":""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Prioridade</label>
        <select onchange="App.upd(${id},'priority',this.value)">
          ${Object.entries(PRIO_LABEL).map(([v,l])=>`<option value="${v}"${(t.priority||"medium")===v?" selected":""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Prazo</label>
        <input type="date" value="${t.due||""}" onchange="App.upd(${id},'due',this.value)">
      </div>
      <div class="dp-field"><label>Categoria</label>
        <select onchange="App.upd(${id},'cat',this.value)">
          ${state.cats.map(c=>`<option value="${c.id}"${t.cat===c.id?" selected":""}>${esc(c.label)}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Tags</label>
        <input type="text" value="${esc((t.tags||[]).join(" "))}" placeholder="#tag1 #tag2" onchange="App.updTags(${id},this.value)">
      </div>
      <div class="dp-field"><label>Recorrência</label>
        <select onchange="App.upd(${id},'recurrence',this.value)">
          <option value=""${!t.recurrence?" selected":""}>Sem recorrência</option>
          <option value="daily"${t.recurrence==="daily"?" selected":""}>Diária</option>
          <option value="weekly"${t.recurrence==="weekly"?" selected":""}>Semanal</option>
          <option value="monthly"${t.recurrence==="monthly"?" selected":""}>Mensal</option>
        </select>
      </div>
      <div class="dp-field"><label>Tempo estimado (h)</label>
        <input type="number" value="${t.timeEst||0}" min="0" step="0.5" onchange="App.upd(${id},'timeEst',parseFloat(this.value)||0)">
      </div>
      <div class="dp-field"><label>Descrição</label>
        <textarea placeholder="Descrição..." onchange="App.upd(${id},'desc',this.value)" onblur="App.upd(${id},'desc',this.value)">${esc(t.desc||"")}</textarea>
      </div>
      <div class="dp-field"><label>Notas</label>
        <textarea placeholder="Anotações livres..." onchange="App.updNote(${id},this.value)">${esc(t.note||"")}</textarea>
      </div>
      <div>
        <div class="dp-section-label">Subtarefas / Histórico${subs.length?` <span style="font-weight:400;color:var(--text3);margin-left:4px">${subDone}/${subs.length}</span>`:""}</div>
        ${subs.length?`<div class="sub-prog-wrap"><div class="sub-prog-row"><span>${subPct}% concluído</span></div><div class="sub-prog-track"><div class="sub-prog-fill" style="width:${subPct}%"></div></div></div>`:""}
        <div class="sub-list">${subItems||`<p style="font-size:11px;color:var(--text3)">Nenhuma ação registrada ainda.</p>`}</div>
        <div class="sub-add-row">
          <input type="text" id="ns-${id}" placeholder="Registrar ação..." onkeydown="if(event.key==='Enter')App.addSub(${id})">
          <button onclick="App.addSub(${id})"><i class="ti ti-plus"></i> Adicionar</button>
        </div>
      </div>
      <div>
        <div class="dp-section-label">Comentários (${comments.length})</div>
        <div class="comment-list">${commentItems||`<p style="font-size:11px;color:var(--text3)">Nenhum comentário.</p>`}</div>
        <div class="comment-add" style="margin-top:6px">
          <textarea id="nc-${id}" placeholder="Adicionar comentário..."></textarea>
          <button onclick="App.addComment(${id})"><i class="ti ti-message"></i> Comentar</button>
        </div>
      </div>
      <div>
        <div class="dp-section-label">Dependências</div>
        <div>${depItems||`<p style="font-size:11px;color:var(--text3);margin-bottom:4px">Nenhuma dependência.</p>`}</div>
        <div class="dep-add-row">
          <select id="nd-${id}">${depOpts}</select>
          <button onclick="App.addDep(${id})"><i class="ti ti-plus"></i></button>
        </div>
      </div>
      <div class="dp-actions">
        <button onclick="App.openModal(${id})"><i class="ti ti-edit"></i> Editar</button>
        <button class="btn-del" onclick="App.delTask(${id})"><i class="ti ti-trash"></i> Excluir</button>
      </div>
    </div>`;
}

// ── Field updates ─────────────────────────────────────────────────────────────
function upd(id,field,val)     { const t=state.tasks.find(x=>x.id===id); if(t){t[field]=val; persist(); render(); renderDetail(id);} }
function updNote(id,val)       { const t=state.tasks.find(x=>x.id===id); if(t){t.note=val; persist();} }
function updTags(id,val)       { const t=state.tasks.find(x=>x.id===id); if(!t) return; t.tags=val.trim().split(/\s+/).filter(Boolean).map(tag=>tag.startsWith("#")?tag:"#"+tag); persist(); render(); renderDetail(id); }
function toggleSub(tid,sid)    { const t=state.tasks.find(x=>x.id===tid); if(!t) return; const s=(t.subs||[]).find(x=>x.id===sid); if(!s) return; s.done=!s.done; if(s.done) s.completedAt=now(); else delete s.completedAt; persist(); render(); renderDetail(tid); }
function delSub(tid,sid)       { const t=state.tasks.find(x=>x.id===tid); if(!t) return; t.subs=(t.subs||[]).filter(x=>x.id!==sid); persist(); render(); renderDetail(tid); }
function addSub(tid)           { const inp=$("ns-"+tid); if(!inp) return; const v=inp.value.trim(); if(!v) return; const t=state.tasks.find(x=>x.id===tid); if(!t) return; if(!t.subs) t.subs=[]; t.subs.push({id:"s"+now(),title:v,done:false,createdAt:now()}); inp.value=""; persist(); render(); renderDetail(tid); }
function addComment(tid)       { const ta=$("nc-"+tid); if(!ta) return; const v=ta.value.trim(); if(!v) return; const t=state.tasks.find(x=>x.id===tid); if(!t) return; if(!t.comments) t.comments=[]; t.comments.push({id:"c"+now(),text:v,createdAt:now()}); ta.value=""; persist(); render(); renderDetail(tid); toast("Comentário adicionado"); }
function delComment(tid,cid)   { const t=state.tasks.find(x=>x.id===tid); if(!t) return; t.comments=(t.comments||[]).filter(c=>c.id!==cid); persist(); render(); renderDetail(tid); }
function addDep(id)            { const sel=$("nd-"+id); if(!sel||!sel.value) return; const depId=parseInt(sel.value); const t=state.tasks.find(x=>x.id===id); if(!t) return; if(!t.deps) t.deps=[]; if(!t.deps.includes(depId)){t.deps.push(depId); persist(); render(); renderDetail(id);} }
function removeDep(id,depId)   { const t=state.tasks.find(x=>x.id===id); if(!t) return; t.deps=(t.deps||[]).filter(d=>d!==depId); persist(); render(); renderDetail(id); }
function delTask(id)           { state.tasks=state.tasks.filter(t=>t.id!==id); state.tasks.forEach(t=>{t.deps=(t.deps||[]).filter(d=>d!==id);}); selId=null; $("detail-panel").classList.add("hidden"); persist(); render(); toast("Tarefa excluída"); }

// ── Clear all ─────────────────────────────────────────────────────────────────
function confirmClearAll() {
  $("clear-confirm-input").value = "";
  $("btn-clear-confirm").disabled = true;
  $("clear-overlay").classList.remove("hidden");
  setTimeout(()=>$("clear-confirm-input").focus(), 60);
}
function checkClearConfirm() {
  $("btn-clear-confirm").disabled = $("clear-confirm-input").value.trim().toUpperCase() !== "CONFIRMAR";
}
function clearAllTasks() {
  if ($("clear-confirm-input").value.trim().toUpperCase() !== "CONFIRMAR") return;
  state.tasks = [];
  selId = null;
  $("detail-panel").classList.add("hidden");
  $("clear-overlay").classList.add("hidden");
  persist(); render();
  toast("Todas as tarefas foram excluídas");
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(eid) {
  editId=eid||null;
  const t=eid?state.tasks.find(x=>x.id===eid):null;
  $("modal-title").textContent = t?"Editar tarefa":"Nova tarefa";
  $("m-title").value  = t?t.title:"";
  $("m-desc").value   = t?t.desc||"":"";
  $("m-status").value = t?t.status:"todo";
  $("m-prio").value   = t?t.priority||"medium":"medium";
  $("m-due").value    = t?t.due||"":"";
  $("m-est").value    = t?t.timeEst||"":"";
  $("m-recur").value  = t?t.recurrence||"":"";
  $("m-tags").value   = t?(t.tags||[]).join(" "):"";
  const cs=$("m-cat"); cs.innerHTML=state.cats.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join("");
  if(t) cs.value=t.cat;
  $("modal-overlay").classList.remove("hidden");
  setTimeout(()=>$("m-title").focus(),60);
}
function closeModal()        { $("modal-overlay").classList.add("hidden"); editId=null; }
function closeModalOut(e)    { if(e.target===$("modal-overlay")) closeModal(); }
function saveTask() {
  const title=$("m-title").value.trim(); if(!title){$("m-title").focus();return;}
  const tags=$("m-tags").value.trim().split(/\s+/).filter(Boolean).map(tag=>tag.startsWith("#")?tag:"#"+tag);
  if (editId) {
    const t=state.tasks.find(x=>x.id===editId);
    t.title=$("m-title").value.trim(); t.desc=$("m-desc").value;
    t.status=$("m-status").value; t.priority=$("m-prio").value;
    t.due=$("m-due").value; t.cat=$("m-cat").value;
    t.timeEst=parseFloat($("m-est").value)||0; t.recurrence=$("m-recur").value; t.tags=tags;
    if(selId===editId) renderDetail(editId);
    toast("Tarefa atualizada");
  } else {
    state.tasks.push({ id:state.nextId++, title, desc:$("m-desc").value, status:$("m-status").value,
      priority:$("m-prio").value, due:$("m-due").value, cat:$("m-cat").value,
      deps:[], subs:[], comments:[], tags, recurrence:$("m-recur").value,
      timeEst:parseFloat($("m-est").value)||0, note:"", created:now() });
    toast("Tarefa criada ✓");
  }
  closeModal(); persist(); render();
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setView(el,v) { view=v; document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active")); el.classList.add("active"); render(); }
function setSt(el,s)   { sf=s;   document.querySelectorAll(".chip").forEach(x=>x.classList.remove("active"));     el.classList.add("active"); render(); }

// ── Categories ────────────────────────────────────────────────────────────────
// ── Category management ──────────────────────────────────────────────────────
const CAT_COLORS = ["#3B82F6","#4CAF8A","#7C5CBF","#F59500","#E53935","#0EA5E9","#D946EF","#EC4899","#14B8A6","#F97316"];

function openNewCat() { openCatModal(null); }

function openCatModal(catId) {
  const cat = catId ? state.cats.find(c=>c.id===catId) : null;
  const color = cat ? cat.color : CAT_COLORS[state.cats.length % CAT_COLORS.length];
  $("cat-modal-title").textContent = cat ? "Editar categoria" : "Nova categoria";
  $("cat-modal-id").value = catId || "";
  $("cat-name-input").value = cat ? cat.label : "";
  $("cat-color-input").value = color;
  $("cat-modal-overlay").classList.remove("hidden");
  setTimeout(() => $("cat-name-input").focus(), 60);
}

function saveCat() {
  const name = $("cat-name-input").value.trim();
  if (!name) { $("cat-name-input").focus(); return; }
  const color = $("cat-color-input").value;
  const existingId = $("cat-modal-id").value;
  if (existingId) {
    const cat = state.cats.find(c=>c.id===existingId);
    if (cat) { cat.label = name; cat.color = color; }
    toast("Categoria atualizada");
  } else {
    state.cats.push({ id:"c"+now(), label:name, color });
    toast("Categoria criada");
  }
  $("cat-modal-overlay").classList.add("hidden");
  persist(); render();
}

function closeCatModal() { $("cat-modal-overlay").classList.add("hidden"); }

function confirmDeleteCat(catId) {
  const cat = state.cats.find(c=>c.id===catId);
  if (!cat) return;
  const taskCount = state.tasks.filter(t=>t.cat===catId).length;
  $("del-cat-name").textContent = cat.label;
  $("del-cat-id").value = catId;
  // Build move options (other cats)
  const others = state.cats.filter(c=>c.id!==catId);
  const moveSelect = $("del-cat-move-select");
  moveSelect.innerHTML = others.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join("");
  const taskSection = $("del-cat-task-section");
  taskSection.style.display = taskCount > 0 ? "block" : "none";
  $("del-cat-task-count").textContent = taskCount;
  $("del-cat-action").value = others.length > 0 ? "move" : "delete";
  updateDelCatUI();
  $("del-cat-overlay").classList.remove("hidden");
}

function updateDelCatUI() {
  const action = $("del-cat-action").value;
  $("del-cat-move-row").style.display = action === "move" ? "flex" : "none";
}

function executeDeleteCat() {
  const catId = $("del-cat-id").value;
  const action = $("del-cat-action").value;
  const taskCount = state.tasks.filter(t=>t.cat===catId).length;
  if (taskCount > 0) {
    if (action === "move") {
      const targetId = $("del-cat-move-select").value;
      state.tasks.forEach(t=>{ if(t.cat===catId) t.cat=targetId; });
      toast("Tarefas movidas e categoria excluída");
    } else {
      state.tasks = state.tasks.filter(t=>t.cat!==catId);
      toast("Categoria e tarefas excluídas");
    }
  } else {
    toast("Categoria excluída");
  }
  state.cats = state.cats.filter(c=>c.id!==catId);
  if (view === "cat:"+catId) { view="all"; }
  $("del-cat-overlay").classList.add("hidden");
  persist(); render();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function openDashboard()  { $("btn-dashboard").classList.add("active"); $("dashboard-overlay").classList.remove("hidden"); renderDashboard(); }
function closeDashboard(e){ if(e&&e.target!==$("dashboard-overlay")) return; $("btn-dashboard").classList.remove("active"); $("dashboard-overlay").classList.add("hidden"); }

function renderDashboard() {
  const all=state.tasks, td=today();
  const done=all.filter(t=>t.status==="done"), active=all.filter(t=>t.status!=="done");
  const pct=all.length?Math.round(done.length/all.length*100):0;
  const overdue=all.filter(t=>t.status!=="done"&&t.due&&t.due<td);
  const totalEst=all.reduce((s,t)=>s+(t.timeEst||0),0);
  const doneEst=done.reduce((s,t)=>s+(t.timeEst||0),0);
  const catDist=state.cats.map(c=>({label:c.label,color:c.color,total:all.filter(t=>t.cat===c.id).length,done:done.filter(t=>t.cat===c.id).length})).filter(c=>c.total>0);
  const maxCat=Math.max(...catDist.map(c=>c.total),1);
  const statusDist=[
    {label:"A fazer",   color:"#3B82F6", count:all.filter(t=>t.status==="todo").length},
    {label:"Andamento", color:"#F59500", count:all.filter(t=>t.status==="doing").length},
    {label:"Revisão",   color:"#7C5CBF", count:all.filter(t=>t.status==="review").length},
    {label:"Bloqueada", color:"#E53935", count:all.filter(t=>t.status==="blocked").length},
    {label:"Concluída", color:"#4CAF8A", count:done.length},
  ].filter(s=>s.count>0);
  const stTotal=all.length||1;
  const prioDist=[
    {label:"Urgente",color:"#E53935",count:active.filter(t=>t.priority==="urgent").length},
    {label:"Alta",   color:"#F59500",count:active.filter(t=>t.priority==="high").length},
    {label:"Média",  color:"#3B82F6",count:active.filter(t=>t.priority==="medium").length},
    {label:"Baixa",  color:"#B0B3C8",count:active.filter(t=>t.priority==="low").length},
  ];
  const maxPrio=Math.max(...prioDist.map(p=>p.count),1);
  const weekData=Array.from({length:7},(_,i)=>{ const d=addDays(td,i-6); return {day:DAYS_PT[new Date(d+"T12:00:00").getDay()],isToday:d===td,count:done.filter(t=>t.due===d).length}; });
  const maxWeek=Math.max(...weekData.map(d=>d.count),1);
  let cum=0; const CIRC=2*Math.PI*30;
  const donutSlices=statusDist.map(s=>{ const frac=s.count/stTotal,dash=frac*CIRC,offset=cum*CIRC; cum+=frac; return `<circle cx="40" cy="40" r="30" fill="none" stroke="${s.color}" stroke-width="10" stroke-dasharray="${dash.toFixed(2)} ${(CIRC-dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`; }).join("");

  $("dashboard-panel").innerHTML = `
    <div class="dash-header">
      <h2>Dashboard</h2>
      <button class="icon-btn" onclick="App.closeDashboard({target:document.getElementById('dashboard-overlay')})" title="Fechar"><i class="ti ti-x" style="font-size:18px"></i></button>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dc-num">${all.length}</div><div class="dc-label">Total de tarefas</div></div>
      <div class="dash-card green"><div class="dc-num">${pct}%</div><div class="dc-label">Taxa de conclusão</div><div class="dc-sub">${done.length} de ${all.length}</div></div>
      <div class="dash-card red"><div class="dc-num">${overdue.length}</div><div class="dc-label">Atrasadas</div></div>
      <div class="dash-card amber"><div class="dc-num">${totalEst.toFixed(1)}h</div><div class="dc-label">Horas estimadas</div><div class="dc-sub">${doneEst.toFixed(1)}h concluídas</div></div>
    </div>
    <div class="dash-chart-row">
      <div class="dash-chart-box"><h4>Por categoria</h4><div class="bar-chart">${catDist.map(c=>`<div class="bar-row"><span class="bar-label">${esc(c.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(c.total/maxCat*100)}%;background:${c.color}"></div></div><span class="bar-val">${c.total}</span></div>`).join("")||`<p style="font-size:12px;color:var(--text3)">Sem dados</p>`}</div></div>
      <div class="dash-chart-box"><h4>Por status</h4><div class="donut-wrap"><div class="donut"><svg viewBox="0 0 80 80" width="80" height="80">${donutSlices}</svg></div><div class="donut-legend">${statusDist.map(s=>`<div class="donut-leg-item"><span class="donut-leg-dot" style="background:${s.color}"></span><span>${s.label} <strong>${s.count}</strong></span></div>`).join("")}</div></div></div>
    </div>
    <div class="dash-chart-row">
      <div class="dash-chart-box"><h4>Por prioridade (ativas)</h4><div class="bar-chart">${prioDist.map(p=>`<div class="bar-row"><span class="bar-label">${p.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(p.count/maxPrio*100)}%;background:${p.color}"></div></div><span class="bar-val">${p.count}</span></div>`).join("")}</div></div>
      <div class="dash-chart-box"><h4>Conclusões — últimos 7 dias</h4><div class="week-bars">${weekData.map(d=>`<div class="week-bar-wrap"><div class="week-bar-track"><div class="week-bar${d.isToday?" today":""}" style="height:${Math.round(d.count/maxWeek*100)}%"></div></div><span class="week-day">${d.day}${d.isToday?"*":""}</span></div>`).join("")}</div></div>
    </div>
    ${overdue.length?`<div class="dash-section"><h3>Atrasadas (${overdue.length})</h3><div class="overdue-list">${overdue.slice(0,8).map(t=>`<div class="overdue-item"><span class="overdue-title">${esc(t.title)}</span><span class="overdue-date">${fmtDate(t.due)}</span><span class="badge ${STATUS_CLS[t.status]||"b-todo"}" style="font-size:10px">${STATUS_LABEL[t.status]||""}</span></div>`).join("")}</div></div>`:""}`;
}

// ── Import / Export ───────────────────────────────────────────────────────────
function exportJSON() {
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="jarvis-backup.json"; a.click();
  toast("Exportado ✓");
}
function triggerImport() { $("import-input").click(); }
function importJSON(e) {
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{ try { const d=JSON.parse(ev.target.result); if(d.tasks&&d.cats){state=d;persist();render();toast("Importado ✓");} else toast("Arquivo inválido"); } catch{ toast("Erro ao importar"); } e.target.value=""; };
  r.readAsText(f);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function signIn()   { try { await signInWithPopup(auth,provider); } catch(e) { toast("Erro no login"); } }
async function signOut2() { try { stopSync(); await signOut(auth); } catch(e) { toast("Erro ao sair"); } }

// ── Shortcuts modal ───────────────────────────────────────────────────────────
function openShortcuts() { $("shortcuts-overlay").classList.remove("hidden"); }

// ── Persist ───────────────────────────────────────────────────────────────────
function persist() { saveLocal(); pushToFirestore(); }

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg) { const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); }

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  const tag = document.activeElement.tagName.toLowerCase();
  const typing = ["input","textarea","select"].includes(tag);
  if (e.key==="Escape") { closeModal(); closeDashboard({target:$("dashboard-overlay")}); $("shortcuts-overlay").classList.add("hidden"); $("clear-overlay").classList.add("hidden"); $("install-overlay").classList.add("hidden"); $("privacy-overlay").classList.add("hidden"); return; }
  if (typing) return;
  if (e.key==="n"||e.key==="N") { e.preventDefault(); openModal(); }
  if (e.key==="d"||e.key==="D") { e.preventDefault(); openDashboard(); }
  if (e.key==="/")               { e.preventDefault(); $("search").focus(); }
  if (e.key==="?")               { e.preventDefault(); openShortcuts(); }
});

// ── Expose ────────────────────────────────────────────────────────────────────
window.App = {
  signIn, signOut: signOut2,
  setView, setSt,
  openModal, closeModal, closeModalOut, saveTask,
  selTask, toggleDone,
  toggleSub, delSub, addSub,
  addComment, delComment,
  addDep, removeDep,
  upd, updNote, updTags,
  delTask,
  openNewCat, openCatModal, saveCat, closeCatModal,
  confirmDeleteCat, updateDelCatUI, executeDeleteCat,
  openDashboard, closeDashboard,
  exportJSON, triggerImport, importJSON,
  installPWA, triggerInstall,
  confirmClearAll, checkClearConfirm, clearAllTasks,
  openShortcuts,
  openPrivacy, acceptLgpd,
  render
};

// [mobile nav block moved to voice system section below]

// ══════════════════════════════════════════════════════════════════════════════
// ── JARVIS VOICE SYSTEM ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── Text-to-Speech (Jarvis fala) ──────────────────────────────────────────────
function speak(text, onEnd) {
  if (!window.speechSynthesis) { onEnd && onEnd(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'pt-BR';
  utt.rate = 1.05;
  utt.pitch = 1;
  // Prefer a PT-BR voice if available
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.startsWith('pt')) || null;
  if (ptVoice) utt.voice = ptVoice;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

// ── Voice state machine ────────────────────────────────────────────────────────
// States: idle | listening | processing | task_creation
let voiceState   = 'idle';
let voiceRec     = null;
let voiceTimeout = null;

// Task creation flow state
let taskFlow = {
  active: false,
  mode: null,   // 'step' | 'oneshot'
  step: 0,
  data: {}
};

const TASK_STEPS = [
  { field: 'title',      question: 'Qual é o título da tarefa?' },
  { field: 'priority',   question: 'Qual a prioridade? Urgente, alta, média ou baixa?' },
  { field: 'due',        question: 'Qual o prazo? Diga: hoje, amanhã, nome do dia, ou pule.' },
  { field: 'cat',        question: 'Qual categoria? ' + (() => state.cats.map(c=>c.label).join(', '))() || 'Diga o nome da categoria ou pule.' },
  { field: 'status',     question: 'Qual o status? A fazer, em andamento, revisão ou bloqueada.' },
];

// ── Init recognition ──────────────────────────────────────────────────────────
function initVoiceRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'pt-BR';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 5;

  rec.onresult = e => {
    const transcripts = Array.from(e.results[0]).map(r => r.transcript.trim().toLowerCase());
    const text = transcripts[0];
    console.log('[Jarvis] ouviu:', transcripts);
    setVoiceUI('processing');
    handleVoiceInput(text, transcripts);
  };

  rec.onerror = e => {
    if (e.error === 'no-speech') { setVoiceUI('idle'); return; }
    if (e.error === 'not-allowed') {
      speak('Permissão de microfone negada. Habilite nas configurações do navegador.');
      setVoiceUI('idle'); return;
    }
    console.warn('[Voice]', e.error);
    setVoiceUI('idle');
  };

  rec.onend = () => {
    // If still in task flow, keep listening for next step (after TTS)
    if (voiceState !== 'task_creation') setVoiceUI('idle');
  };

  return rec;
}

// ── Start / stop listening ────────────────────────────────────────────────────
function startListening(afterSpeak) {
  if (!voiceRec) voiceRec = initVoiceRec();
  if (!voiceRec) {
    toast('Reconhecimento de voz não suportado neste navegador');
    return;
  }
  const go = () => {
    try {
      voiceRec.abort();
    } catch(_) {}
    setTimeout(() => {
      try {
        voiceRec.start();
        setVoiceUI('listening');
        clearTimeout(voiceTimeout);
        voiceTimeout = setTimeout(() => stopListening(), 10000);
      } catch(e) {
        console.warn('[Voice start]', e);
        setVoiceUI('idle');
      }
    }, 150);
  };
  afterSpeak ? speak(afterSpeak, go) : go();
}

function stopListening() {
  clearTimeout(voiceTimeout);
  try { voiceRec && voiceRec.abort(); } catch(_) {}
  taskFlow = { active:false, mode:null, step:0, data:{} };
  voiceState = 'idle';
  setVoiceUI('idle');
}

// ── Main toggle (button / shortcut V) ────────────────────────────────────────
function toggleVoice() {
  if (voiceState !== 'idle') { stopListening(); return; }
  voiceState = 'listening';
  startListening('Olá! O que posso fazer por você?');
}

// ── Process any voice input ───────────────────────────────────────────────────
function handleVoiceInput(text, alts) {
  if (taskFlow.active) {
    handleTaskFlowInput(text, alts);
    return;
  }
  routeCommand(text, alts);
}

// ── Command router ────────────────────────────────────────────────────────────
function routeCommand(text, alts) {
  // ── Task creation triggers ──
  if (/\b(criar|nova|adicionar|registrar)\s+tarefa\b/i.test(text)) {
    // Check if user sent everything at once: "criar tarefa reunião amanhã urgente"
    const rest = text.replace(/\b(criar|nova|adicionar|registrar)\s+tarefa\b/i,'').trim();
    if (rest.length > 3) {
      startOneShotTask(rest);
    } else {
      startStepTask();
    }
    return;
  }

  // ── Navigation ──
  const navMap = [
    { re: /\b(todas|tudo|geral)\b/i,             v:'all' },
    { re: /\b(hoje)\b/i,                          v:'today' },
    { re: /\b(semana|essa semana)\b/i,             v:'week' },
    { re: /\b(em andamento|andamento|fazendo)\b/i, v:'doing' },
    { re: /\b(urgente|urgentes)\b/i,               v:'urgent' },
    { re: /\b(bloqueada|bloqueadas)\b/i,           v:'blocked' },
    { re: /\b(atrasad[ao]|atrasadas)\b/i,          v:'overdue' },
    { re: /\b(recorrente|recorrentes)\b/i,         v:'recurring' },
  ];
  for (const {re,v} of navMap) {
    if (re.test(text)) {
      const el = document.querySelector(`[data-v="${v}"]`);
      if (el) { App.setView(el,v); speak(`Mostrando ${v==='all'?'todas as tarefas':text}`); return; }
    }
  }

  // ── Category nav ──
  for (const cat of state.cats) {
    if (text.includes(cat.label.toLowerCase())) {
      const el = document.querySelector(`[data-v="cat:${cat.id}"]`) || { classList:{add:()=>{},remove:()=>{},toggle:()=>{}}, dataset:{} };
      App.setView(el, 'cat:'+cat.id);
      speak(`Mostrando categoria ${cat.label}`);
      return;
    }
  }

  // ── Search ──
  if (/\b(buscar|pesquisar|procurar|achar|encontrar)\b/i.test(text)) {
    const q = text.replace(/\b(buscar|pesquisar|procurar|achar|encontrar)\b/i,'').trim();
    if (q) { const s=$('search'); s.value=q; App.render(); speak(`Buscando ${q}`); return; }
  }
  if (/\b(limpar busca|limpar pesquisa|limpar filtro)\b/i.test(text)) {
    const s=$('search'); s.value=''; App.render(); speak('Busca limpa'); return;
  }

  // ── Dashboard ──
  if (/\b(dashboard|painel|gráfico|estatísticas|relatório)\b/i.test(text)) {
    App.openDashboard(); speak('Abrindo dashboard'); return;
  }

  // ── Shortcuts / help ──
  if (/\b(ajuda|atalhos|help)\b/i.test(text)) {
    App.openShortcuts(); speak('Abrindo atalhos'); return;
  }

  // ── Export ──
  if (/\b(exportar|backup|salvar arquivo)\b/i.test(text)) {
    App.exportJSON(); speak('Exportando dados'); return;
  }

  // ── Close / cancel ──
  if (/\b(fechar|voltar|cancelar|sair)\b/i.test(text)) {
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    speak('Fechando'); return;
  }

  // ── Fallback: search ──
  const s=$('search'); s.value=text; App.render();
  speak(`Buscando por ${text}`);
  setVoiceUI('idle');
}

// ── Step-by-step task creation ────────────────────────────────────────────────
function startStepTask() {
  taskFlow = { active:true, mode:'step', step:0, data:{} };
  voiceState = 'task_creation';
  const q = buildStepQuestion(0);
  startListening(q);
}

function buildStepQuestion(stepIdx) {
  if (stepIdx === 3) {
    // Dynamic category question with current cats
    return 'Qual categoria? ' + state.cats.map(c=>c.label).join(', ') + '. Ou diga pular.';
  }
  return TASK_STEPS[stepIdx].question;
}

function handleTaskFlowInput(text, alts) {
  if (taskFlow.mode === 'step') {
    handleStepInput(text);
  } else {
    handleOneShotConfirm(text);
  }
}

function handleStepInput(text) {
  const skip = /\b(pular|próxima|skip|não sei|tanto faz)\b/i.test(text);
  const step = TASK_STEPS[taskFlow.step];

  if (!skip) {
    taskFlow.data[step.field] = parseFieldValue(step.field, text);
  }

  taskFlow.step++;

  if (taskFlow.step >= TASK_STEPS.length) {
    finishTaskCreation();
    return;
  }

  const nextQ = buildStepQuestion(taskFlow.step);
  startListening(nextQ);
}

// ── One-shot task creation ────────────────────────────────────────────────────
function startOneShotTask(text) {
  taskFlow = { active:true, mode:'oneshot', step:0, data:{} };
  voiceState = 'task_creation';
  const parsed = parseOneShotTask(text);
  taskFlow.data = parsed;

  const summary = buildTaskSummary(parsed);
  speak(`Entendi: ${summary}. Confirma? Diga sim ou não.`, () => {
    startListening(null);
  });
}

function handleOneShotConfirm(text) {
  if (/\b(sim|confirmar|confirma|ok|pode|isso|salvar)\b/i.test(text)) {
    finishTaskCreation();
  } else if (/\b(não|nao|cancela|cancelar|errado)\b/i.test(text)) {
    taskFlow = { active:false, mode:null, step:0, data:{} };
    voiceState = 'idle';
    setVoiceUI('idle');
    speak('Tarefa cancelada. O que mais posso fazer?');
  } else {
    speak('Não entendi. Diga sim para confirmar ou não para cancelar.', () => startListening(null));
  }
}

function finishTaskCreation() {
  const d = taskFlow.data;
  if (!d.title) {
    speak('Título não informado. Tarefa cancelada.');
    taskFlow = { active:false, mode:null, step:0, data:{} };
    voiceState = 'idle'; setVoiceUI('idle'); return;
  }
  const defaultCat = state.cats[0]?.id || 'personal';
  state.tasks.push({
    id: state.nextId++,
    title: d.title,
    desc: d.desc || '',
    status: d.status || 'todo',
    priority: d.priority || 'medium',
    due: d.due || '',
    cat: d.cat || defaultCat,
    deps: [], subs: [], comments: [],
    tags: d.tags || [],
    recurrence: '',
    timeEst: 0,
    note: '',
    created: now()
  });
  persist();
  taskFlow = { active:false, mode:null, step:0, data:{} };
  voiceState = 'idle'; setVoiceUI('idle');
  renderFull();
  speak(`Tarefa "${d.title}" criada com sucesso!`);
  toast(`✓ Tarefa criada: ${d.title}`);
}

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseFieldValue(field, text) {
  switch(field) {
    case 'priority': return parsePriority(text);
    case 'due':      return parseDue(text);
    case 'cat':      return parseCat(text);
    case 'status':   return parseStatus(text);
    default:         return text;
  }
}

function parsePriority(text) {
  if (/urgente/i.test(text))          return 'urgent';
  if (/\balta\b/i.test(text))         return 'high';
  if (/\bbaixa\b/i.test(text))        return 'low';
  return 'medium';
}

function parseDue(text) {
  const td = today();
  if (/\bhoje\b/i.test(text))         return td;
  if (/\bamanh[aã]\b/i.test(text))    return addDays(td,1);
  if (/\bsegunda/i.test(text))        return nextWeekday(1);
  if (/\bter[cç]a/i.test(text))       return nextWeekday(2);
  if (/\bquarta/i.test(text))         return nextWeekday(3);
  if (/\bquinta/i.test(text))         return nextWeekday(4);
  if (/\bsexta/i.test(text))          return nextWeekday(5);
  if (/\bsábado/i.test(text))         return nextWeekday(6);
  if (/\bdomingo/i.test(text))        return nextWeekday(0);
  if (/\b(\d{1,2})\/(\d{1,2})\b/.test(text)) {
    const [,d,m] = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    const y = new Date().getFullYear();
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return '';
}

function nextWeekday(target) {
  const dt = new Date();
  const diff = (target - dt.getDay() + 7) % 7 || 7;
  return addDays(today(), diff);
}

function parseCat(text) {
  const found = state.cats.find(c => text.toLowerCase().includes(c.label.toLowerCase()));
  return found ? found.id : (state.cats[0]?.id || '');
}

function parseStatus(text) {
  if (/\bem andamento|andamento|fazendo/i.test(text)) return 'doing';
  if (/\brevis[aã]o/i.test(text))                    return 'review';
  if (/\bbloqueada/i.test(text))                      return 'blocked';
  if (/\bconclu[ií]/i.test(text))                     return 'done';
  return 'todo';
}

function parseOneShotTask(text) {
  const data = {};
  // Title: everything before priority/date/cat keywords
  let title = text;

  // Extract priority
  const prioMatch = text.match(/\b(urgente|prioridade alta|alta|baixa|média|media)\b/i);
  if (prioMatch) {
    data.priority = parsePriority(prioMatch[0]);
    title = title.replace(prioMatch[0],'').trim();
  }

  // Extract due
  const dueKeywords = /(hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|sábado|domingo|\d{1,2}\/\d{1,2})/i;
  const dueMatch = text.match(dueKeywords);
  if (dueMatch) {
    data.due = parseDue(dueMatch[0]);
    title = title.replace(dueMatch[0],'').trim();
  }

  // Extract category
  for (const cat of state.cats) {
    if (text.toLowerCase().includes(cat.label.toLowerCase())) {
      data.cat = cat.id;
      title = title.replace(new RegExp(cat.label,'i'),'').trim();
      break;
    }
  }

  // Extract status
  const statusMatch = text.match(/\b(em andamento|andamento|revisão|revisao|bloqueada)\b/i);
  if (statusMatch) {
    data.status = parseStatus(statusMatch[0]);
    title = title.replace(statusMatch[0],'').trim();
  }

  // Clean up title
  title = title.replace(/\s+/g,' ').replace(/^\s+|\s+$/g,'').trim();
  data.title = title.charAt(0).toUpperCase() + title.slice(1);

  return data;
}

function buildTaskSummary(d) {
  const prio  = PRIO_LABEL[d.priority||'medium'];
  const due   = d.due ? `prazo ${fmtDate(d.due)}` : 'sem prazo';
  const cat   = d.cat ? getCat(d.cat).label : 'categoria padrão';
  return `${d.title}, prioridade ${prio}, ${due}, categoria ${cat}`;
}

// ── UI state ──────────────────────────────────────────────────────────────────
function setVoiceUI(state) {
  voiceState = state;
  const listening = state === 'listening';
  const processing = state === 'processing';
  document.querySelectorAll('.voice-btn').forEach(btn => {
    btn.classList.toggle('voice-listening', listening);
    btn.classList.toggle('voice-processing', processing);
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = processing ? 'ti ti-loader' : 'ti ti-microphone';
    }
    btn.title = listening ? 'Ouvindo... (clique para parar)' :
                processing ? 'Processando...' : 'Comando por voz (V)';
  });
  // Show/hide voice indicator overlay
  const ind = document.getElementById('voice-indicator');
  if (ind) {
    ind.className = 'voice-indicator' + (listening?' listening':processing?' processing':'');
    ind.style.display = (listening||processing) ? 'flex' : 'none';
    ind.querySelector('.vi-text').textContent =
      processing ? 'Processando...' :
      taskFlow.active && taskFlow.mode==='step' ? `Passo ${taskFlow.step+1} de ${TASK_STEPS.length}` :
      'Ouvindo...';
  }
}

// ── Keyboard shortcut V ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName.toLowerCase();
  const typing = ['input','textarea','select'].includes(tag);
  if (!typing && (e.key==='v'||e.key==='V')) { e.preventDefault(); toggleVoice(); }
});

// ── Expose voice functions ────────────────────────────────────────────────────
Object.assign(window.App, { toggleVoice, stopListening });

// ── Mobile nav & patches ──────────────────────────────────────────────────────
function openMobileNav() {
  $("mobile-nav-panel").classList.add("open");
  $("mobile-nav-backdrop").classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeMobileNav() {
  $("mobile-nav-panel").classList.remove("open");
  $("mobile-nav-backdrop").classList.remove("visible");
  document.body.style.overflow = "";
}
function setViewMobile(el, v) {
  setView(el, v);
  document.querySelectorAll(".sb-nav .nav-item").forEach(x => {
    x.classList.toggle("active", x.dataset.v === v);
  });
  closeMobileNav();
}
function tabTasks() {
  selId = null;
  $("detail-panel").classList.add("hidden");
  $("sheet-backdrop").classList.remove("visible");
  render();
}
function focusSearch() {
  $("search").focus();
  $("search").scrollIntoView({ behavior: "smooth" });
}
function closeDetail() {
  selId = null;
  $("detail-panel").classList.add("hidden");
  $("sheet-backdrop").classList.remove("visible");
  render();
}

const _origSelTask = selTask;
window._patchedSelTask = function(id) {
  _origSelTask(id);
  if (window.innerWidth <= 768 && selId !== null) {
    $("sheet-backdrop").classList.add("visible");
  } else {
    $("sheet-backdrop").classList.remove("visible");
  }
};

const _origUpdateStats = updateStats;
function updateStatsFull() {
  _origUpdateStats();
  const ids = ["all","today","week","doing","urgent","blocked","overdue","recurring"];
  ids.forEach(id => {
    const desktop = $("b-"+id);
    const mobile  = $("mb-"+id);
    if (desktop && mobile) mobile.textContent = desktop.textContent;
  });
  ["stat-total","stat-doing","stat-overdue"].forEach(id => {
    const d = $(id); const m = $("m-"+id);
    if (d && m) m.textContent = d.textContent;
  });
  const mpb = $("m-prog-bar"), mpl = $("m-prog-label");
  const dpb = $("prog-bar"),   dpl = $("prog-label");
  if (mpb && dpb) mpb.style.width = dpb.style.width;
  if (mpl && dpl) mpl.textContent = dpl.textContent;
  const ob = $("b-overdue");
  const tb = $("tab-badge-overdue");
  if (ob && tb) {
    const n = parseInt(ob.textContent)||0;
    tb.textContent = n > 9 ? "9+" : n;
    tb.style.display = n > 0 ? "flex" : "none";
  }
  const mcn = $("mobile-cat-nav");
  if (mcn) {
    mcn.innerHTML = state.cats.map(c => `
      <div class="nav-item cat-nav-item${view==="cat:"+c.id?" active":""}" onclick="App.setViewMobile(this,'cat:${c.id}')">
        <span class="cat-dot" style="background:${c.color}"></span>
        <span style="flex:1">${esc(c.label)}</span>
        <span class="nav-badge">${state.tasks.filter(t=>t.cat===c.id&&t.status!=="done").length}</span>
        <span class="cat-actions">
          <button class="cat-action-btn" onclick="event.stopPropagation();App.openCatModal('${c.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="cat-action-btn danger" onclick="event.stopPropagation();App.confirmDeleteCat('${c.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </span>
      </div>`).join("");
  }
  const mur = $("mobile-user-row");
  const dur = $("user-row");
  if (mur && dur) mur.innerHTML = dur.innerHTML;
}

const _origRender = render;
function renderFull() {
  _origRender();
  updateStatsFull();
}

Object.assign(window.App, {
  openMobileNav, closeMobileNav,
  setViewMobile, tabTasks, focusSearch, closeDetail,
  selTask: window._patchedSelTask,
  render: renderFull
});

renderFull();   
