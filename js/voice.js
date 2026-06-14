// ── voice.js ─────────────────────────────────────────────────────────────────
// Sistema de voz do Jarvis v2: wake word + comandos + criação de tarefas por voz.

import { PRIO_LABEL }  from "./constants.js";
import { appState }    from "./state.js";
import { $, today, addDays, fmtDate, now, toast } from "./utils.js";
import { persist }     from "./sync.js";

// Injetadas pelo app.js
let _render = () => {};
export function setVoiceRenderFn(fn) { _render = fn; }

// getCat helper local
const getCat = id => appState.cats.find(c => c.id === id) || { label: id || "", color: "#888" };

// ── Text-to-Speech ────────────────────────────────────────────────────────────
let ttsQueue = [];
let ttsSpeaking = false;

function speak(text, onEnd) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  ttsQueue.push({ text, onEnd });
  if (!ttsSpeaking) flushTTS();
}

function flushTTS() {
  if (!ttsQueue.length) { ttsSpeaking = false; return; }
  ttsSpeaking = true;
  window.speechSynthesis.cancel();
  const { text, onEnd } = ttsQueue.shift();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'pt-BR';
  utt.rate = 1.08;
  utt.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang.startsWith('pt-BR')) ||
                  voices.find(v => v.lang.startsWith('pt')) || null;
  if (ptVoice) utt.voice = ptVoice;
  utt.onend = () => {
    ttsSpeaking = false;
    onEnd?.();
    flushTTS();
  };
  utt.onerror = () => {
    ttsSpeaking = false;
    onEnd?.();
    flushTTS();
  };
  window.speechSynthesis.speak(utt);
}

// ── State ─────────────────────────────────────────────────────────────────────
let VS = 'standby'; // voice state
let wakeRec = null;
let cmdRec  = null;
let cmdTimeout = null;

// Task flow — completely separate from VS so it survives state transitions
let TF = {
  active: false,
  mode: null,    // 'step' | 'oneshot'
  step: 0,
  data: {},
  pendingText: null  // text received, waiting to process after TTS
};

const TASK_STEPS = [
  { field:'title',    q: 'Qual é o título da tarefa?' },
  { field:'priority', q: 'Qual a prioridade? Urgente, alta, média ou baixa? Ou diga pular.' },
  { field:'due',      q: 'Qual o prazo? Hoje, amanhã, dia da semana, ou pular.' },
  { field:'cat',      q: () => 'Qual categoria? ' + appState.cats.map(c=>c.label).join(', ') + '. Ou pular.' },
  { field:'status',   q: 'Qual o status? A fazer, em andamento, revisão, bloqueada. Ou pular.' },
];

// ── Wake word recognizer ──────────────────────────────────────────────────────
function buildWakeRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'pt-BR';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  r.onresult = e => {
    // Scan all results for "jarvis"
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.toLowerCase();
      if (/jarvis/i.test(t)) {
        console.log('[Wake] detectado:', t);
        onWakeWord();
        return;
      }
    }
  };

  r.onend = () => {
    // Always restart wake rec unless we're in command mode or shutting down
    if (VS === 'standby') {
      setTimeout(() => { try { r.start(); } catch(_) {} }, 300);
    }
  };

  r.onerror = e => {
    if (e.error === 'not-allowed') {
      setVS('off');
      updateVoiceUI();
      return;
    }
    // Restart on any other error after short delay
    if (VS === 'standby') {
      setTimeout(() => { try { r.start(); } catch(_) {} }, 1000);
    }
  };

  return r;
}

// ── Command recognizer ────────────────────────────────────────────────────────
function buildCmdRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = 'pt-BR';
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 5;

  r.onresult = e => {
    // CRITICAL: capture result BEFORE onend fires
    const transcripts = Array.from(e.results[0]).map(r => r.transcript.trim().toLowerCase());
    const text = transcripts[0];
    console.log('[Cmd] ouviu:', transcripts);

    // Set state to processing IMMEDIATELY — this must happen before onend
    setVS('processing');
    clearTimeout(cmdTimeout);

    // Process on next tick to ensure state is set
    setTimeout(() => processCommand(text, transcripts), 0);
  };

  r.onend = () => {
    console.log('[Cmd] onend, VS=', VS, 'TF.active=', TF.active);
    // ONLY restart if we're still expecting input (task flow between steps)
    // If VS is 'processing' or 'speaking', onresult already handled it
    if (VS === 'listening') {
      // No result received — timeout or silence
      if (TF.active) {
        // Still in task flow — re-ask the current question
        const q = getStepQ(TF.step);
        speak('Não ouvi. ' + q, startCmdRec);
      } else {
        setVS('standby');
        updateVoiceUI();
        resumeWake();
      }
    }
  };

  r.onerror = e => {
    console.warn('[Cmd error]', e.error);
    if (e.error === 'no-speech') {
      if (TF.active) {
        const q = getStepQ(TF.step);
        speak('Não ouvi. ' + q, startCmdRec);
      } else {
        setVS('standby');
        updateVoiceUI();
        resumeWake();
      }
      return;
    }
    if (e.error !== 'aborted') {
      speak('Erro no microfone.');
    }
    setVS('standby');
    updateVoiceUI();
    resumeWake();
  };

  return r;
}

// ── Start / stop helpers ──────────────────────────────────────────────────────
function startWake() {
  if (!wakeRec) wakeRec = buildWakeRec();
  if (!wakeRec) return;
  try { wakeRec.start(); } catch(_) {}
  setVS('standby');
  updateVoiceUI();
}

function resumeWake() {
  if (!wakeRec) { startWake(); return; }
  setVS('standby');
  updateVoiceUI();
  // wakeRec.onend already handles restarting itself
}

function startCmdRec() {
  if (!cmdRec) cmdRec = buildCmdRec();
  if (!cmdRec) return;

  // Stop wake word detection while command rec is active
  try { wakeRec?.abort(); } catch(_) {}

  try { cmdRec.abort(); } catch(_) {}

  setTimeout(() => {
    try {
      cmdRec.start();
      setVS('listening');
      updateVoiceUI();
      // 12s timeout — re-prompt if in task flow
      clearTimeout(cmdTimeout);
      cmdTimeout = setTimeout(() => {
        try { cmdRec.abort(); } catch(_) {}
      }, 12000);
    } catch(e) {
      console.warn('[startCmdRec]', e);
      setVS('standby');
      updateVoiceUI();
      resumeWake();
    }
  }, 200);
}

export function stopAll() {
  clearTimeout(cmdTimeout);
  ttsQueue = [];
  window.speechSynthesis?.cancel();
  try { wakeRec?.abort(); } catch(_) {}
  try { cmdRec?.abort();  } catch(_) {}
  TF = { active:false, mode:null, step:0, data:{}, pendingText:null };
  setVS('standby');
  updateVoiceUI();
  // Restart wake word after short pause
  setTimeout(resumeWake, 500);
}

// ── Wake word handler ─────────────────────────────────────────────────────────
function onWakeWord() {
  if (VS !== 'standby') return; // already active
  try { wakeRec?.abort(); } catch(_) {}
  speak('Sim?', startCmdRec);
  setVS('speaking');
  updateVoiceUI();
}

// ── Main toggle (button / V key) ──────────────────────────────────────────────
export function toggleVoice() {
  if (VS === 'standby') {
    // Manual activation — skip wake word
    speak('Olá! O que posso fazer por você?', startCmdRec);
    setVS('speaking');
    updateVoiceUI();
  } else {
    // Stop everything, go back to wake standby
    stopAll();
    speak('Ok, até logo.');
  }
}

// ── Command processor ─────────────────────────────────────────────────────────
function processCommand(text, alts) {
  console.log('[Process] text:', text, '| TF.active:', TF.active, '| TF.step:', TF.step);

  if (TF.active) {
    handleTaskFlowInput(text);
    return;
  }
  routeCommand(text);
}

// ── Command router ────────────────────────────────────────────────────────────
function routeCommand(text) {
  // Task creation
  if (/\b(criar|nova|adicionar|registrar)\s+tarefa\b/i.test(text)) {
    const rest = text.replace(/\b(criar|nova|adicionar|registrar)\s+tarefa\b/i,'').trim();
    if (rest.length > 3) startOneShotTask(rest);
    else startStepTask();
    return;
  }

  // Navigation
  const navMap = [
    { re:/\b(todas?|tudo|geral)\b/i,              v:'all',       label:'todas as tarefas' },
    { re:/\bhoje\b/i,                              v:'today',     label:'tarefas de hoje' },
    { re:/\b(semana|essa semana)\b/i,              v:'week',      label:'tarefas da semana' },
    { re:/\b(em andamento|andamento|fazendo)\b/i,  v:'doing',     label:'tarefas em andamento' },
    { re:/\b(urgente|urgentes)\b/i,                v:'urgent',    label:'tarefas urgentes' },
    { re:/\b(bloqueada|bloqueadas)\b/i,            v:'blocked',   label:'tarefas bloqueadas' },
    { re:/\b(atrasad[ao]|atrasadas?)\b/i,          v:'overdue',   label:'tarefas atrasadas' },
    { re:/\b(recorrente|recorrentes?)\b/i,         v:'recurring', label:'tarefas recorrentes' },
  ];
  for (const {re,v,label} of navMap) {
    if (re.test(text)) {
      const el = document.querySelector(`[data-v="${v}"]`);
      if (el) App.setView(el, v);
      speak(label.charAt(0).toUpperCase() + label.slice(1));
      afterCommand(); return;
    }
  }

  // Category navigation
  for (const cat of appState.cats) {
    if (text.includes(cat.label.toLowerCase())) {
      const el = document.querySelector(`[data-v="cat:${cat.id}"]`);
      if (el) App.setView(el, 'cat:'+cat.id);
      speak(`Categoria ${cat.label}`);
      afterCommand(); return;
    }
  }

  // Search
  const searchMatch = text.match(/\b(?:buscar?|pesquisar?|procurar?|achar?|encontrar?)\s+(.+)/i);
  if (searchMatch) {
    const q = searchMatch[1];
    const s = $('search'); s.value = q; App.render();
    speak(`Buscando ${q}`);
    afterCommand(); return;
  }
  if (/\b(limpar busca|limpar pesquisa|limpar filtro)\b/i.test(text)) {
    const s = $('search'); s.value = ''; App.render();
    speak('Busca limpa');
    afterCommand(); return;
  }

  // Dashboard
  if (/\b(dashboard|painel|gráfico|estatísticas|relatório)\b/i.test(text)) {
    App.openDashboard(); speak('Abrindo dashboard');
    afterCommand(); return;
  }

  // Help
  if (/\b(ajuda|atalhos|help|comandos)\b/i.test(text)) {
    App.openShortcuts(); speak('Abrindo ajuda');
    afterCommand(); return;
  }

  // Export
  if (/\b(exportar|backup)\b/i.test(text)) {
    App.exportJSON(); speak('Exportando');
    afterCommand(); return;
  }

  // Close
  if (/\b(fechar|voltar|cancelar|sair)\b/i.test(text)) {
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    speak('Fechando');
    afterCommand(); return;
  }

  // Fallback: search
  const s = $('search'); s.value = text; App.render();
  speak(`Buscando por ${text}`);
  afterCommand();
}

// After a one-shot command, go back to standby (wake word mode)
function afterCommand() {
  setVS('speaking'); // TTS is running
  updateVoiceUI();
  // wakeRec restarts itself after TTS via speak()'s onEnd chain
  // We just need to ensure state goes to standby after TTS
  const origFlush = flushTTS;
  // Use a simpler approach: schedule standby after current TTS
  const checkDone = setInterval(() => {
    if (!ttsSpeaking && !ttsQueue.length) {
      clearInterval(checkDone);
      setVS('standby');
      updateVoiceUI();
      resumeWake();
    }
  }, 100);
}

// ── Task flow ─────────────────────────────────────────────────────────────────
function startStepTask() {
  TF = { active:true, mode:'step', step:0, data:{}, pendingText:null };
  const q = getStepQ(0);
  speak(q, startCmdRec);
  setVS('speaking');
  updateVoiceUI();
}

function getStepQ(stepIdx) {
  const s = TASK_STEPS[stepIdx];
  return typeof s.q === 'function' ? s.q() : s.q;
}

function handleTaskFlowInput(text) {
  console.log('[TaskFlow] step:', TF.step, '| mode:', TF.mode, '| text:', text);

  if (TF.mode === 'step') {
    processStepInput(text);
  } else if (TF.mode === 'oneshot') {
    processOneShotConfirm(text);
  }
}

function processStepInput(text) {
  // Cancel check
  if (/\b(cancelar|cancela|sair|parar|abort)\b/i.test(text)) {
    TF = { active:false, mode:null, step:0, data:{}, pendingText:null };
    speak('Tarefa cancelada.');
    afterCommand();
    return;
  }

  const skip = /\b(pular|próxima|próximo|skip|não sei|tanto faz|sem)\b/i.test(text);
  const stepDef = TASK_STEPS[TF.step];

  if (!skip) {
    const val = parseFieldValue(stepDef.field, text);
    TF.data[stepDef.field] = val;
    console.log(`[TaskFlow] ${stepDef.field} =`, val);
  }

  TF.step++;

  if (TF.step >= TASK_STEPS.length) {
    finishTaskCreation();
    return;
  }

  // Ask next question — MUST set state before starting cmdRec
  const nextQ = getStepQ(TF.step);
  setVS('speaking');
  updateVoiceUI();
  speak(nextQ, () => {
    // Only start cmdRec if task flow is still active (wasn't cancelled mid-speak)
    if (TF.active) startCmdRec();
  });
}

function startOneShotTask(text) {
  TF = { active:true, mode:'oneshot', step:0, data:{}, pendingText:null };
  const parsed = parseOneShotTask(text);
  TF.data = parsed;
  const summary = buildTaskSummary(parsed);
  setVS('speaking');
  updateVoiceUI();
  speak(`Entendi: ${summary}. Confirma? Diga sim ou não.`, startCmdRec);
}

function processOneShotConfirm(text) {
  if (/\b(sim|confirmar?|ok|pode|isso|salvar|criar)\b/i.test(text)) {
    finishTaskCreation();
  } else if (/\b(não|nao|cancela|cancelar|errado|muda|corrigir)\b/i.test(text)) {
    TF = { active:false, mode:null, step:0, data:{}, pendingText:null };
    speak('Tarefa cancelada. Posso criar novamente com passo a passo?', () => {
      setVS('standby'); updateVoiceUI(); resumeWake();
    });
    setVS('speaking'); updateVoiceUI();
  } else {
    speak('Não entendi. Diga sim para confirmar ou não para cancelar.', startCmdRec);
    setVS('speaking'); updateVoiceUI();
  }
}

function finishTaskCreation() {
  const d = TF.data;
  if (!d.title) {
    TF = { active:false, mode:null, step:0, data:{}, pendingText:null };
    speak('Título não informado. Tarefa cancelada.');
    afterCommand();
    return;
  }
  const defaultCat = appState.cats[0]?.id || 'personal';
  appState.tasks.push({
    id: appState.nextId++,
    title: d.title.charAt(0).toUpperCase() + d.title.slice(1),
    desc: '',
    status: d.status || 'todo',
    priority: d.priority || 'medium',
    due: d.due || '',
    cat: d.cat || defaultCat,
    deps:[], subs:[], comments:[],
    tags:[], recurrence:'', timeEst:0, note:'',
    created: now()
  });
  persist();
  const title = d.title;
  TF = { active:false, mode:null, step:0, data:{}, pendingText:null };
  _render();
  toast(`✓ Tarefa criada: ${title}`);
  speak(`Perfeito! Tarefa "${title}" criada.`);
  afterCommand();
}

// ── Field parsers ─────────────────────────────────────────────────────────────
function parseFieldValue(field, text) {
  switch(field) {
    case 'priority': return parsePriority(text);
    case 'due':      return parseDue(text);
    case 'cat':      return parseCat(text);
    case 'status':   return parseStatus(text);
    default:         return text.trim();
  }
}

function parsePriority(text) {
  if (/urgente/i.test(text))    return 'urgent';
  if (/\balta\b/i.test(text))   return 'high';
  if (/\bbaixa\b/i.test(text))  return 'low';
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
  if (/\bs[aá]bado/i.test(text))      return nextWeekday(6);
  if (/\bdomingo/i.test(text))        return nextWeekday(0);
  const dm = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (dm) {
    const y = new Date().getFullYear();
    return `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`;
  }
  return '';
}

function nextWeekday(target) {
  const diff = (target - new Date().getDay() + 7) % 7 || 7;
  return addDays(today(), diff);
}

function parseCat(text) {
  const found = appState.cats.find(c => text.toLowerCase().includes(c.label.toLowerCase()));
  return found ? found.id : (appState.cats[0]?.id || '');
}

function parseStatus(text) {
  if (/\bem andamento|andamento|fazendo\b/i.test(text)) return 'doing';
  if (/\brevis[aã]o\b/i.test(text))                    return 'review';
  if (/\bbloqueada\b/i.test(text))                      return 'blocked';
  if (/\bconclu[ií]/i.test(text))                       return 'done';
  return 'todo';
}

function parseOneShotTask(text) {
  const data = {};
  let title = text;

  const prioMatch = text.match(/\b(urgente|prioridade alta|alta prioridade|prioridade baixa|baixa|alta|média|media)\b/i);
  if (prioMatch) { data.priority = parsePriority(prioMatch[0]); title = title.replace(prioMatch[0],''); }

  const dueMatch = text.match(/\b(hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d{1,2}\/\d{1,2})\b/i);
  if (dueMatch) { data.due = parseDue(dueMatch[0]); title = title.replace(dueMatch[0],''); }

  for (const cat of appState.cats) {
    if (text.toLowerCase().includes(cat.label.toLowerCase())) {
      data.cat = cat.id;
      title = title.replace(new RegExp(cat.label,'gi'),'');
      break;
    }
  }

  const statusMatch = text.match(/\b(em andamento|andamento|revisão|revisao|bloqueada)\b/i);
  if (statusMatch) { data.status = parseStatus(statusMatch[0]); title = title.replace(statusMatch[0],''); }

  title = title.replace(/\s+/g,' ').trim();
  data.title = title;
  return data;
}

function buildTaskSummary(d) {
  const prio = PRIO_LABEL[d.priority||'medium'];
  const due  = d.due ? `prazo ${fmtDate(d.due)}` : 'sem prazo';
  const cat  = d.cat ? getCat(d.cat).label : 'categoria padrão';
  return `${d.title}, prioridade ${prio}, ${due}, categoria ${cat}`;
}

// ── UI ────────────────────────────────────────────────────────────────────────
function setVS(state) { VS = state; }

function updateVoiceUI() {
  const listening   = VS === 'listening';
  const speaking    = VS === 'speaking';
  const processing  = VS === 'processing';
  const standby     = VS === 'standby';
  const active      = listening || speaking || processing;

  document.querySelectorAll('.voice-btn').forEach(btn => {
    btn.classList.toggle('voice-listening',  listening);
    btn.classList.toggle('voice-processing', processing || speaking);
    btn.classList.toggle('voice-standby',    standby);
    const icon = btn.querySelector('i');
    if (icon) icon.className = (processing||speaking) ? 'ti ti-loader' : 'ti ti-microphone';
    btn.title = listening   ? 'Ouvindo... (clique para cancelar)' :
                speaking    ? 'Falando...' :
                processing  ? 'Processando...' :
                standby     ? 'Jarvis ativo — diga "Jarvis" (V para ativar)' :
                              'Ativar Jarvis';
  });

  const ind = document.getElementById('voice-indicator');
  if (!ind) return;
  if (!active && !TF.active) { ind.style.display = 'none'; return; }
  ind.style.display = 'flex';

  let label = '';
  if (TF.active && TF.mode === 'step') {
    label = `Criando tarefa — passo ${TF.step + 1} de ${TASK_STEPS.length}`;
  } else if (TF.active && TF.mode === 'oneshot') {
    label = 'Aguardando confirmação...';
  } else if (listening) {
    label = 'Ouvindo...';
  } else if (speaking) {
    label = 'Falando...';
  } else if (processing) {
    label = 'Processando...';
  }

  ind.querySelector('.vi-text').textContent = label;
  ind.className = 'voice-indicator ' + (listening ? 'listening' : speaking ? 'speaking' : 'processing');
}

// ── Init on load ──────────────────────────────────────────────────────────────
export function initJarvis() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn('[Jarvis] SpeechRecognition não disponível');
    document.querySelectorAll('.voice-btn').forEach(b => {
      b.title = 'Voz não suportada neste navegador';
      b.style.opacity = '0.4';
    });
    return;
  }
  // Pre-load voices (async in some browsers)
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
  startWake();
  console.log('[Jarvis] Wake word ativo — diga "Jarvis"');
}

// ── Keyboard shortcut V ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName.toLowerCase();
  if (['input','textarea','select'].includes(tag)) return;
  if (e.key === 'v' || e.key === 'V') { e.preventDefault(); toggleVoice(); }
});

// ── Expose ────────────────────────────────────────────────────────────────────
