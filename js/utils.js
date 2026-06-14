// ── utils.js ──────────────────────────────────────────────────────────────────
// Funções utilitárias puras. Sem dependências de outros módulos do projeto.

// ── DOM ───────────────────────────────────────────────────────────────────────
export const $ = id => document.getElementById(id);

// ── Strings ───────────────────────────────────────────────────────────────────
export const esc = s =>
  (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
         .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// ── Datas ─────────────────────────────────────────────────────────────────────
export const now     = () => Date.now();
export const today   = () => new Date().toISOString().split("T")[0];
export const weekEnd = () => {
  const dt = new Date();
  dt.setDate(dt.getDate() + (6 - dt.getDay()));
  return dt.toISOString().split("T")[0];
};
export const addDays = (d, n) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
};
export const fmtDate = d => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
export const fmtDT = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" })
    + " " + d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
};

// ── Toast ─────────────────────────────────────────────────────────────────────
export function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
