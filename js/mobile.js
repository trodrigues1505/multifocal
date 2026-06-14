// ── mobile.js ─────────────────────────────────────────────────────────────────
// Tab bar, painel de nav mobile, sheet backdrop e espelhamento de stats.

import { appState } from "./state.js";
import { $, esc }   from "./utils.js";

let _render       = () => {};
let _renderDetail = () => {};
let _setView      = () => {};

export function setMobileRenderFns(renderFn, renderDetailFn, setViewFn) {
  _render       = renderFn;
  _renderDetail = renderDetailFn;
  _setView      = setViewFn;
}

// ── Mobile nav panel ──────────────────────────────────────────────────────────
export function openMobileNav() {
  $("mobile-nav-panel").classList.add("open");
  $("mobile-nav-backdrop").classList.add("visible");
  document.body.style.overflow = "hidden";
}

export function closeMobileNav() {
  $("mobile-nav-panel").classList.remove("open");
  $("mobile-nav-backdrop").classList.remove("visible");
  document.body.style.overflow = "";
}

export function setViewMobile(el, v) {
  _setView(el, v);
  document.querySelectorAll(".sb-nav .nav-item").forEach(x => {
    x.classList.toggle("active", x.dataset.v === v);
  });
  closeMobileNav();
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
export function tabTasks() {
  appState.selId = null;
  $("detail-panel").classList.add("hidden");
  $("sheet-backdrop").classList.remove("visible");
  _render();
}

export function focusSearch() {
  const s = $("search");
  s.focus();
  s.scrollIntoView({ behavior: "smooth" });
}

// ── Detail sheet ──────────────────────────────────────────────────────────────
export function closeDetail() {
  appState.selId = null;
  $("detail-panel").classList.add("hidden");
  $("sheet-backdrop").classList.remove("visible");
  _render();
}

export function showDetailSheet(id) {
  if (window.innerWidth <= 768 && appState.selId !== null) {
    $("sheet-backdrop").classList.add("visible");
  } else {
    $("sheet-backdrop").classList.remove("visible");
  }
}

// ── Mirror desktop stats → mobile ─────────────────────────────────────────────
export function syncMobileStats() {
  // Nav badges
  ["all","today","week","doing","urgent","blocked","overdue","recurring"].forEach(id => {
    const d = $("b-" + id);
    const m = $("mb-" + id);
    if (d && m) m.textContent = d.textContent;
  });

  // Stat pills
  ["stat-total","stat-doing","stat-overdue"].forEach(id => {
    const d = $(id);
    const m = $("m-" + id);
    if (d && m) m.textContent = d.textContent;
  });

  // Progress bar
  const dpb = $("prog-bar"),   mpb = $("m-prog-bar");
  const dpl = $("prog-label"), mpl = $("m-prog-label");
  if (dpb && mpb) mpb.style.width   = dpb.style.width;
  if (dpl && mpl) mpl.textContent   = dpl.textContent;

  // Overdue tab badge
  const ob = $("b-overdue");
  const tb = $("tab-badge-overdue");
  if (ob && tb) {
    const n = parseInt(ob.textContent) || 0;
    tb.textContent = n > 9 ? "9+" : n;
    tb.style.display = n > 0 ? "flex" : "none";
  }

  // Mobile category nav
  const mcn = $("mobile-cat-nav");
  if (mcn) {
    mcn.innerHTML = appState.cats.map(c => `
      <div class="nav-item cat-nav-item${appState.view === "cat:" + c.id ? " active" : ""}"
           onclick="App.setViewMobile(this,'cat:${c.id}')">
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
  }

  // Mirror user row
  const dur = $("user-row");
  const mur = $("mobile-user-row");
  if (dur && mur) mur.innerHTML = dur.innerHTML;
}
