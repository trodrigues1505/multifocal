// ── ui.js ─────────────────────────────────────────────────────────────────────
// Toda renderização de DOM: lista de tarefas, painel de detalhe, stats, dashboard.

import {
  PRIO_ORDER, PRIO_LABEL, PRIO_CLS,
  STATUS_LABEL, STATUS_CLS,
  RECUR_LABEL, DAYS_PT,
} from "./constants.js";
import { appState }  from "./state.js";
import { $, esc, today, weekEnd, addDays, fmtDate, fmtDT } from "./utils.js";

// ── Helpers locais ────────────────────────────────────────────────────────────
const getCat = id => appState.cats.find(c => c.id === id) || { label: id || "", color: "#888" };

// ── Stats + nav badges ────────────────────────────────────────────────────────
export function updateStats() {
  const all = appState.tasks;
  const td  = today();
  const we  = weekEnd();
  const done = all.filter(t => t.status === "done");
  const pct  = all.length ? Math.round(done.length / all.length * 100) : 0;

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const stl = (id, w)   => { const el = $(id); if (el) el.style.width  = w; };

  set("stat-total",   all.length);
  set("stat-doing",   all.filter(t => t.status === "doing").length);
  set("stat-overdue", all.filter(t => t.status !== "done" && t.due && t.due < td).length);
  set("prog-label",   `${pct}% concluído`);
  stl("prog-bar",     `${pct}%`);

  set("b-all",       all.length);
  set("b-today",     all.filter(t => t.due === td && t.status !== "done").length);
  set("b-week",      all.filter(t => t.due && t.due >= td && t.due <= we && t.status !== "done").length);
  set("b-doing",     all.filter(t => t.status === "doing").length);
  set("b-urgent",    all.filter(t => t.priority === "urgent" && t.status !== "done").length);
  set("b-blocked",   all.filter(t => t.status === "blocked").length);
  set("b-overdue",   all.filter(t => t.status !== "done" && t.due && t.due < td).length);
  set("b-recurring", all.filter(t => t.recurrence).length);
}

// ── Categorias na sidebar ─────────────────────────────────────────────────────
export function renderCats() {
  const html = appState.cats.map(c => `
    <div class="nav-item cat-nav-item${appState.view === "cat:" + c.id ? " active" : ""}"
         onclick="App.setView(this,'cat:${c.id}')">
      <span class="cat-dot" style="background:${c.color}"></span>
      <span style="flex:1">${esc(c.label)}</span>
      <span class="nav-badge">${appState.tasks.filter(t => t.cat === c.id && t.status !== "done").length}</span>
      <span class="cat-actions">
        <button class="cat-action-btn"
          onclick="event.stopPropagation();App.openCatModal('${c.id}')" title="Editar">
          <i class="ti ti-pencil"></i>
        </button>
        <button class="cat-action-btn danger"
          onclick="event.stopPropagation();App.confirmDeleteCat('${c.id}')" title="Excluir">
          <i class="ti ti-trash"></i>
        </button>
      </span>
    </div>`).join("");
  const el = $("cat-nav");
  if (el) el.innerHTML = html;
}

// ── Filtro de tarefas ─────────────────────────────────────────────────────────
export function getFiltered() {
  const q    = ($("search")?.value || "").toLowerCase();
  const sort = $("sort-sel")?.value || "created";
  const td   = today();
  const we   = weekEnd();
  const { view, sf } = appState;

  let arr = appState.tasks.filter(t => {
    if (q) {
      const hay = [t.title, t.desc || "", ...(t.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (sf !== "all" && t.status !== sf) return false;
    if (view === "today"     && (t.due !== td || t.status === "done"))               return false;
    if (view === "week"      && (!t.due || t.due > we || t.due < td || t.status === "done")) return false;
    if (view === "doing"     && t.status !== "doing")                                return false;
    if (view === "urgent"    && (t.priority !== "urgent" || t.status === "done"))    return false;
    if (view === "blocked"   && t.status !== "blocked")                              return false;
    if (view === "overdue"   && (t.status === "done" || !t.due || t.due >= td))      return false;
    if (view === "recurring" && !t.recurrence)                                       return false;
    if (view.startsWith("cat:") && t.cat !== view.slice(4))                          return false;
    return true;
  });

  arr.sort((a, b) => {
    if (sort === "due") {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    }
    if (sort === "priority")
      return (PRIO_ORDER[a.priority || "medium"] || 2) - (PRIO_ORDER[b.priority || "medium"] || 2);
    if (sort === "title") return a.title.localeCompare(b.title);
    return (b.created || 0) - (a.created || 0);
  });

  return arr;
}

// ── Lista de tarefas ──────────────────────────────────────────────────────────
export function render() {
  updateStats();
  renderCats();

  const items = getFiltered();
  const list  = $("task-list");
  const td    = today();

  if (!items.length) {
    const isSearch = ($("search")?.value || "").length > 0;
    list.innerHTML = `<div class="empty">
      <i class="ti ti-checklist"></i>
      <p>${isSearch ? "Nenhuma tarefa encontrada." : "Nenhuma tarefa aqui ainda."}</p>
      ${!isSearch ? `<button onclick="App.openModal()">
        <i class="ti ti-plus" style="margin-right:4px"></i>Criar tarefa
      </button>` : ""}
    </div>`;
    return;
  }

  list.innerHTML = items.map(t => {
    const done    = t.status === "done";
    const prio    = t.priority || "medium";
    const subs    = t.subs || [];
    const subDone = subs.filter(s => s.done).length;
    const tags    = (t.tags || []).slice(0, 3);
    const cat     = getCat(t.cat);
    let dueCls    = "due";
    if (t.due && !done) {
      if (t.due < td)               dueCls = "due over";
      else if (t.due <= addDays(td, 2)) dueCls = "due soon";
    }
    return `<div class="task-card${done ? " done" : ""}${appState.selId === t.id ? " selected" : ""} p-${prio}"
              onclick="App.selTask(${t.id})">
      <div class="task-row1">
        <div class="task-check${done ? " done" : ""}"
             onclick="event.stopPropagation();App.toggleDone(${t.id})"
             title="${done ? "Reabrir" : "Concluir"}">
          <i class="ti ti-check"></i>
        </div>
        <span class="task-title${done ? " done" : ""}">${esc(t.title)}</span>
      </div>
      <div class="task-meta">
        <span class="badge ${STATUS_CLS[t.status] || "b-todo"}">${STATUS_LABEL[t.status] || t.status}</span>
        <span class="p-label ${PRIO_CLS[prio]}">${PRIO_LABEL[prio]}</span>
        <span class="cat-dot" style="background:${cat.color}" title="${esc(cat.label)}"></span>
        <span class="meta-icon" style="font-size:11px;color:var(--text3)">${esc(cat.label)}</span>
        ${t.due ? `<span class="${dueCls}">
          <i class="ti ti-calendar" style="font-size:11px"></i>${fmtDate(t.due)}
        </span>` : ""}
        ${t.recurrence ? `<span class="recur-badge">
          <i class="ti ti-refresh" style="font-size:10px"></i>${RECUR_LABEL[t.recurrence] || ""}
        </span>` : ""}
        ${subs.length ? `<span class="meta-icon"><i class="ti ti-check"></i>${subDone}/${subs.length}</span>` : ""}
        ${(t.deps || []).length ? `<span class="meta-icon"><i class="ti ti-git-branch"></i>${t.deps.length}</span>` : ""}
        ${(t.comments || []).length ? `<span class="meta-icon"><i class="ti ti-message"></i>${t.comments.length}</span>` : ""}
        ${tags.map(tag => `<span class="meta-tag">${esc(tag)}</span>`).join("")}
      </div>
    </div>`;
  }).join("");
}

// ── Painel de detalhe ─────────────────────────────────────────────────────────
export function renderDetail(id) {
  const t = appState.tasks.find(x => x.id === id);
  if (!t) { $("detail-panel").classList.add("hidden"); return; }

  const subs     = t.subs     || [];
  const deps     = t.deps     || [];
  const comments = t.comments || [];
  const subDone  = subs.filter(s => s.done).length;
  const subPct   = subs.length ? Math.round(subDone / subs.length * 100) : 0;

  const depOpts = appState.tasks
    .filter(x => x.id !== id)
    .map(x => `<option value="${x.id}">${esc(x.title.slice(0, 28))}</option>`)
    .join("");

  const subItems = subs.map(s => `
    <div class="sub-item">
      <div class="sub-check${s.done ? " done" : ""}" onclick="App.toggleSub(${id},'${s.id}')">
        <i class="ti ti-check"></i>
      </div>
      <div class="sub-item-main">
        <span class="sub-item-title${s.done ? " done" : ""}">${esc(s.title)}</span>
        <span class="sub-item-date">
          ${s.done && s.completedAt ? "✓ " + fmtDT(s.completedAt) : "Adicionada " + fmtDT(s.createdAt)}
        </span>
      </div>
      <button class="sub-del" onclick="App.delSub(${id},'${s.id}')"><i class="ti ti-x"></i></button>
    </div>`).join("");

  const depItems = deps.map(d => {
    const f = appState.tasks.find(x => x.id === d);
    if (!f) return "";
    return `<div class="dep-item">
      <i class="ti ti-git-branch" style="font-size:12px;color:var(--text3)"></i>
      <span style="flex:1">${esc(f.title.slice(0, 24))}…</span>
      <button onclick="App.removeDep(${id},${d})"><i class="ti ti-x"></i></button>
    </div>`;
  }).join("");

  const commentItems = comments.map(c => `
    <div class="comment-item">
      <button class="comment-del" onclick="App.delComment(${id},'${c.id}')">
        <i class="ti ti-x"></i>
      </button>
      ${esc(c.text)}
      <div class="comment-meta">${fmtDT(c.createdAt)}</div>
    </div>`).join("");

  $("detail-panel").innerHTML = `
    <div class="dp-head">
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input type="text" class="dp-title-input"
          value="${esc(t.title)}"
          onchange="App.upd(${id},'title',this.value)"
          onblur="App.upd(${id},'title',this.value)"
          placeholder="Título da tarefa">
        <span style="font-size:10px;color:var(--text3)">
          <i class="ti ti-device-floppy" style="font-size:10px"></i> Salvo automaticamente
        </span>
      </div>
      <button class="icon-btn" onclick="App.selTask(${id})"><i class="ti ti-x"></i></button>
    </div>
    <div class="dp-body">
      <div class="dp-field"><label>Status</label>
        <select onchange="App.upd(${id},'status',this.value)">
          ${Object.entries(STATUS_LABEL).map(([v, l]) =>
            `<option value="${v}"${t.status === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Prioridade</label>
        <select onchange="App.upd(${id},'priority',this.value)">
          ${Object.entries(PRIO_LABEL).map(([v, l]) =>
            `<option value="${v}"${(t.priority || "medium") === v ? " selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Prazo</label>
        <input type="date" value="${t.due || ""}" onchange="App.upd(${id},'due',this.value)">
      </div>
      <div class="dp-field"><label>Categoria</label>
        <select onchange="App.upd(${id},'cat',this.value)">
          ${appState.cats.map(c =>
            `<option value="${c.id}"${t.cat === c.id ? " selected" : ""}>${esc(c.label)}</option>`).join("")}
        </select>
      </div>
      <div class="dp-field"><label>Tags</label>
        <input type="text" value="${esc((t.tags || []).join(" "))}"
          placeholder="#tag1 #tag2" onchange="App.updTags(${id},this.value)">
      </div>
      <div class="dp-field"><label>Recorrência</label>
        <select onchange="App.upd(${id},'recurrence',this.value)">
          <option value=""${!t.recurrence ? " selected" : ""}>Sem recorrência</option>
          <option value="daily"${t.recurrence === "daily" ? " selected" : ""}>Diária</option>
          <option value="weekly"${t.recurrence === "weekly" ? " selected" : ""}>Semanal</option>
          <option value="monthly"${t.recurrence === "monthly" ? " selected" : ""}>Mensal</option>
        </select>
      </div>
      <div class="dp-field"><label>Tempo estimado (h)</label>
        <input type="number" value="${t.timeEst || 0}" min="0" step="0.5"
          onchange="App.upd(${id},'timeEst',parseFloat(this.value)||0)">
      </div>
      <div class="dp-field"><label>Descrição</label>
        <textarea placeholder="Descrição..."
          onchange="App.upd(${id},'desc',this.value)"
          onblur="App.upd(${id},'desc',this.value)">${esc(t.desc || "")}</textarea>
      </div>
      <div class="dp-field"><label>Notas</label>
        <textarea placeholder="Anotações livres..."
          onchange="App.updNote(${id},this.value)">${esc(t.note || "")}</textarea>
      </div>
      <div>
        <div class="dp-section-label">
          Subtarefas / Histórico${subs.length
            ? ` <span style="font-weight:400;color:var(--text3);margin-left:4px">${subDone}/${subs.length}</span>`
            : ""}
        </div>
        ${subs.length ? `<div class="sub-prog-wrap">
          <div class="sub-prog-row"><span>${subPct}% concluído</span></div>
          <div class="sub-prog-track"><div class="sub-prog-fill" style="width:${subPct}%"></div></div>
        </div>` : ""}
        <div class="sub-list">${subItems || `<p style="font-size:11px;color:var(--text3)">Nenhuma ação ainda.</p>`}</div>
        <div class="sub-add-row">
          <input type="text" id="ns-${id}" placeholder="Registrar ação..."
            onkeydown="if(event.key==='Enter')App.addSub(${id})">
          <button onclick="App.addSub(${id})"><i class="ti ti-plus"></i> Adicionar</button>
        </div>
      </div>
      <div>
        <div class="dp-section-label">Comentários (${comments.length})</div>
        <div class="comment-list">${commentItems || `<p style="font-size:11px;color:var(--text3)">Nenhum comentário.</p>`}</div>
        <div class="comment-add" style="margin-top:6px">
          <textarea id="nc-${id}" placeholder="Adicionar comentário..."></textarea>
          <button onclick="App.addComment(${id})"><i class="ti ti-message"></i> Comentar</button>
        </div>
      </div>
      <div>
        <div class="dp-section-label">Dependências</div>
        <div>${depItems || `<p style="font-size:11px;color:var(--text3);margin-bottom:4px">Nenhuma dependência.</p>`}</div>
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

// ── Navegação ─────────────────────────────────────────────────────────────────
export function setView(el, v) {
  appState.view = v;
  document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
  el.classList.add("active");
  render();
}

export function setSt(el, s) {
  appState.sf = s;
  document.querySelectorAll(".chip").forEach(x => x.classList.remove("active"));
  el.classList.add("active");
  render();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function openDashboard() {
  $("btn-dashboard")?.classList.add("active");
  $("dashboard-overlay").classList.remove("hidden");
  renderDashboard();
}

export function closeDashboard(e) {
  if (e && e.target !== $("dashboard-overlay")) return;
  $("btn-dashboard")?.classList.remove("active");
  $("dashboard-overlay").classList.add("hidden");
}

function renderDashboard() {
  const all    = appState.tasks;
  const td     = today();
  const done   = all.filter(t => t.status === "done");
  const active = all.filter(t => t.status !== "done");
  const pct    = all.length ? Math.round(done.length / all.length * 100) : 0;
  const overdue    = all.filter(t => t.status !== "done" && t.due && t.due < td);
  const totalEst   = all.reduce((s, t) => s + (t.timeEst || 0), 0);
  const doneEst    = done.reduce((s, t) => s + (t.timeEst || 0), 0);

  const catDist = appState.cats
    .map(c => ({
      label: c.label, color: c.color,
      total: all.filter(t => t.cat === c.id).length,
      done:  done.filter(t => t.cat === c.id).length,
    }))
    .filter(c => c.total > 0);
  const maxCat = Math.max(...catDist.map(c => c.total), 1);

  const statusDist = [
    { label:"A fazer",   color:"#3B82F6", count: all.filter(t => t.status === "todo").length },
    { label:"Andamento", color:"#F59500", count: all.filter(t => t.status === "doing").length },
    { label:"Revisão",   color:"#7C5CBF", count: all.filter(t => t.status === "review").length },
    { label:"Bloqueada", color:"#E53935", count: all.filter(t => t.status === "blocked").length },
    { label:"Concluída", color:"#4CAF8A", count: done.length },
  ].filter(s => s.count > 0);
  const stTotal = all.length || 1;

  const prioDist = [
    { label:"Urgente", color:"#E53935", count: active.filter(t => t.priority === "urgent").length },
    { label:"Alta",    color:"#F59500", count: active.filter(t => t.priority === "high").length },
    { label:"Média",   color:"#3B82F6", count: active.filter(t => t.priority === "medium").length },
    { label:"Baixa",   color:"#B0B3C8", count: active.filter(t => t.priority === "low").length },
  ];
  const maxPrio = Math.max(...prioDist.map(p => p.count), 1);

  const weekData = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(td, i - 6);
    return {
      day: DAYS_PT[new Date(d + "T12:00:00").getDay()],
      isToday: d === td,
      count: done.filter(t => t.due === d).length,
    };
  });
  const maxWeek = Math.max(...weekData.map(d => d.count), 1);

  let cum = 0;
  const CIRC = 2 * Math.PI * 30;
  const donutSlices = statusDist.map(s => {
    const frac = s.count / stTotal;
    const dash = frac * CIRC;
    const offset = cum * CIRC;
    cum += frac;
    return `<circle cx="40" cy="40" r="30" fill="none" stroke="${s.color}" stroke-width="10"
      stroke-dasharray="${dash.toFixed(2)} ${(CIRC - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" />`;
  }).join("");

  $("dashboard-panel").innerHTML = `
    <div class="dash-header">
      <h2>Dashboard</h2>
      <button class="icon-btn"
        onclick="App.closeDashboard({target:document.getElementById('dashboard-overlay')})"
        title="Fechar"><i class="ti ti-x" style="font-size:18px"></i></button>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dc-num">${all.length}</div><div class="dc-label">Total de tarefas</div></div>
      <div class="dash-card green"><div class="dc-num">${pct}%</div><div class="dc-label">Taxa de conclusão</div><div class="dc-sub">${done.length} de ${all.length}</div></div>
      <div class="dash-card red"><div class="dc-num">${overdue.length}</div><div class="dc-label">Atrasadas</div></div>
      <div class="dash-card amber"><div class="dc-num">${totalEst.toFixed(1)}h</div><div class="dc-label">Horas estimadas</div><div class="dc-sub">${doneEst.toFixed(1)}h concluídas</div></div>
    </div>
    <div class="dash-chart-row">
      <div class="dash-chart-box"><h4>Por categoria</h4>
        <div class="bar-chart">${catDist.map(c => `
          <div class="bar-row">
            <span class="bar-label">${esc(c.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(c.total/maxCat*100)}%;background:${c.color}"></div></div>
            <span class="bar-val">${c.total}</span>
          </div>`).join("") || `<p style="font-size:12px;color:var(--text3)">Sem dados</p>`}
        </div>
      </div>
      <div class="dash-chart-box"><h4>Por status</h4>
        <div class="donut-wrap">
          <div class="donut"><svg viewBox="0 0 80 80" width="80" height="80">${donutSlices}</svg></div>
          <div class="donut-legend">${statusDist.map(s => `
            <div class="donut-leg-item">
              <span class="donut-leg-dot" style="background:${s.color}"></span>
              <span>${s.label} <strong>${s.count}</strong></span>
            </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
    <div class="dash-chart-row">
      <div class="dash-chart-box"><h4>Por prioridade (ativas)</h4>
        <div class="bar-chart">${prioDist.map(p => `
          <div class="bar-row">
            <span class="bar-label">${p.label}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(p.count/maxPrio*100)}%;background:${p.color}"></div></div>
            <span class="bar-val">${p.count}</span>
          </div>`).join("")}
        </div>
      </div>
      <div class="dash-chart-box"><h4>Conclusões — últimos 7 dias</h4>
        <div class="week-bars">${weekData.map(d => `
          <div class="week-bar-wrap">
            <div class="week-bar-track">
              <div class="week-bar${d.isToday ? " today" : ""}" style="height:${Math.round(d.count/maxWeek*100)}%"></div>
            </div>
            <span class="week-day">${d.day}${d.isToday ? "*" : ""}</span>
          </div>`).join("")}
        </div>
      </div>
    </div>
    ${overdue.length ? `
    <div class="dash-section">
      <h3>Atrasadas (${overdue.length})</h3>
      <div class="overdue-list">${overdue.slice(0, 8).map(t => `
        <div class="overdue-item">
          <span class="overdue-title">${esc(t.title)}</span>
          <span class="overdue-date">${fmtDate(t.due)}</span>
          <span class="badge ${STATUS_CLS[t.status] || "b-todo"}" style="font-size:10px">
            ${STATUS_LABEL[t.status] || ""}
          </span>
        </div>`).join("")}
      </div>
    </div>` : ""}`;
}

// ── Auth UI ───────────────────────────────────────────────────────────────────
export function showLogin() {
  $("screen-login").classList.remove("hidden");
  $("screen-app").classList.add("hidden");
}

export function showApp(user) {
  $("screen-login").classList.add("hidden");
  $("screen-app").classList.remove("hidden");
  renderUserRow(user);
}

function renderUserRow(user) {
  const initials = (user.displayName || user.email || "?")
    .split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const el = $("user-row");
  if (el) el.innerHTML = `
    <div class="user-avatar">
      ${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : initials}
    </div>
    <span class="user-name">${esc(user.displayName || user.email || "")}</span>`;
}

// ── Shortcuts modal ───────────────────────────────────────────────────────────
export function openShortcuts() {
  $("shortcuts-overlay").classList.remove("hidden");
}
