// ── constants.js ─────────────────────────────────────────────────────────────
// Mapas de label, classes CSS e chaves de storage.
// Nenhuma dependência de outros módulos.

export const PRIO_ORDER   = { urgent:0, high:1, medium:2, low:3 };
export const PRIO_LABEL   = { urgent:"Urgente", high:"Alta", medium:"Média", low:"Baixa" };
export const PRIO_CLS     = { urgent:"urgent", high:"high", medium:"medium", low:"low" };

export const STATUS_LABEL = {
  todo:"A fazer", doing:"Em andamento",
  review:"Revisão", blocked:"Bloqueada", done:"Concluída"
};
export const STATUS_CLS = {
  todo:"b-todo", doing:"b-doing",
  review:"b-review", blocked:"b-blocked", done:"b-done"
};

export const RECUR_LABEL = { daily:"Diária", weekly:"Semanal", monthly:"Mensal" };
export const DAYS_PT     = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

export const CAT_COLORS  = [
  "#3B82F6","#4CAF8A","#7C5CBF","#F59500",
  "#E53935","#0EA5E9","#D946EF","#EC4899","#14B8A6","#F97316"
];

export const LS_KEY  = "jarvis_v1";
export const LS_LGPD = "jarvis_lgpd";
