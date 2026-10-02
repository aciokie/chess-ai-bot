// content/content.js - Chess.com content script for Chess AI Bot
// Handles Stockfish engine (Web Worker), board detection, move execution, UI overlay
// No storage persistence - matches userscript behavior (in-memory only)

console.log("[Chess AI Bot] Content script loaded");

let board = null;
let isAnalyzing = false;
let currentFEN = "";
let lastMoveResult = "Waiting...";
let evalData = null;
let pvMoves = [];
let settings = {
  autoRun: true,
  autoMove: false,
  autoQueue: false,
  showEvalBar: true,
  showMoveHighlights: true,
  showPVArrows: false,
  depth: 18,
  minDelay: 0,
  maxDelay: 0,
  visualType: "outline",
  highlightColor: "#00eeff",
  threatDetection: true,
  openingBookEnabled: true,
  timeManagement: true,
  humanizer: false,
  humanizeRate: 15,
  bulletMode: false,
  engineMode: "local"
};

let engineWorker = null;
let isEngineReady = false;
let engineStatus = "not_installed";

// ============ ENGINE (Web Worker) ============
const ENGINE_MODELS = {
  sf18_05: {
    id: "sf18_05",
    label: "Stockfish 18.0.5",
    maxDepth: 25,
    hasNNUE: true, hasWDL: true, hasContempt: true, hasSkillLevel: true,
    hasHash: true, hasMoveOverhead: true, hasSlowMover: false, hasMinThink: false, hasRepetition: true,
    defaults: { hashMB: 64, moveOverhead: 100, skillLevel: 20, limitStrength: false, elo: 3190, showWDL: false, minThinkTime: 20 }
  }
};

let engineSettings = {};
let pendingCommands = [];
let messageId = 0;
const pendingMessages = new Map();

// Initialize Stockfish engine in content script (Web Workers work here!)
async function initEngine() {
  if (engineWorker && isEngineReady) return;
  engineStatus = "loading";
  updateUI();

  const model = ENGINE_MODELS.sf18_05;
  if (!model) throw new Error("Unknown model");

  try {
    engineWorker = await createEngineWorker();
    engineWorker.onmessage = handleEngineMessage;
    engineWorker.onerror = handleEngineError;
    await waitForEngineReady(30000);
    applyEngineSettings();
    engineStatus = "ready";
    isEngineReady = true;
    updateUI();
    processPendingCommands();
  } catch (error) {
    engineStatus = "error";
    updateUI();
    throw error;
  }
}

async function createEngineWorker() {
  const wasmUrl = chrome.runtime.getURL("lib/stockfish-18-single.wasm");
  const jsUrl = chrome.runtime.getURL("lib/stockfish-18-single.js");

  const response = await fetch(jsUrl);
  const jsCode = await response.text();

  const workerCode = `
    self.window = self;
    self.document = { createElement: () => ({}), getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {} };
    self.navigator = { userAgent: navigator.userAgent };
    self.importScripts = function() { throw new Error("importScripts not supported"); };
    self.setTimeout = setTimeout;
    self.clearTimeout = clearTimeout;
    self.console = console;
    
    const _wasmUrl = "${wasmUrl}";
    const _originalFetch = self.fetch;
    self.fetch = async function(url, options) {
      if (typeof url === 'string' && (url.includes('.wasm') || url.includes('stockfish') || url === "${wasmUrl}")) {
        return _originalFetch("${wasmUrl}", options);
      }
      return _originalFetch.apply(this, arguments);
    };

    let stockfishInstance = null;
    let messageCallback = null;

    (async function() {
      try {
        ${jsCode}
        
        let StockfishModule = null;
        if (typeof createStockfish === 'function') {
          StockfishModule = createStockfish;
        } else if (typeof Stockfish !== 'undefined') {
          StockfishModule = Stockfish;
        } else if (typeof Module !== 'undefined') {
          StockfishModule = Module;
        }
        
        if (!StockfishModule) {
          throw new Error('Stockfish module not found after loading');
        }
        
        let stockfishInstance = null;
        
        if (typeof createStockfish === 'function') {
          const instance = await createStockfish();
          stockfishInstance = instance;
        } else if (typeof Stockfish !== 'undefined') {
          stockfishInstance = Stockfish();
        }
        
        if (!stockfishInstance) {
          throw new Error('Failed to create Stockfish instance');
        }
        
        stockfishInstance.onmessage = function(event) {
          if (typeof messageCallback === 'function') {
            messageCallback({ type: 'uci_output', output: event.data });
          }
        };
        
        self.postMessage({ type: 'worker_ready' });
        
        self.onmessage = function(e) {
          if (e.data && e.data.type === 'uci_command' && stockfishInstance) {
            stockfishInstance.postMessage(e.data.command);
          }
        };
        
      })().catch(err => {
        self.postMessage({ type: 'error', error: err.message || String(err) });
      });
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

function handleEngineMessage(event) {
  const data = event.data;
  if (data.type === "error") { engineStatus = "error"; isEngineReady = false; updateUI(); return; }
  if (data.type === "worker_ready") {
    engineWorker.postMessage({ type: 'uci_command', command: 'uci' });
    return;
  }
  if (data.type === "uci_output") {
    const msg = data.output;
    if (msg === "uciok") {
      isEngineReady = true; engineStatus = "ready"; updateUI(); processPendingCommands(); return;
    }
    if (msg === "readyok") {
      const p = pendingMessages.get("isready");
      if (p) { p.resolve({ type: "readyok" }); pendingMessages.delete("isready"); }
      return;
    }
    if (msg.startsWith("bestmove")) {
      const move = msg.split(" ")[1];
      const p = pendingMessages.get("go");
      if (p) { p.resolve({ type: "bestmove", move }); pendingMessages.delete("go"); }
      broadcastToBackground({ type: "BESTMOVE", move });
      return;
    }
    if (msg.startsWith("info")) {
      const depthMatch = msg.match(/depth (\d+)/);
      const scoreMatch = msg.match(/score (cp|mate) (-?\d+)/);
      const pvMatch = msg.match(/ pv (.+)/);
      if (depthMatch && scoreMatch) {
        const evalData = {
          depth: parseInt(depthMatch[1]),
          scoreType: scoreMatch[1],
          scoreValue: parseInt(scoreMatch[2]),
          pv: pvMatch ? pvMatch[1].split(" ") : []
        };
        if (pvMatch) pvMoves = evalData.pv;
        broadcastToBackground({ type: "EVAL_UPDATE", eval: evalData });
      }
      return;
    }
    for (const [key, pending] of pendingMessages) {
      if (msg.startsWith(key) || key === "any") {
        pending.resolve({ raw: msg });
        pendingMessages.delete(key);
        break;
      }
    }
    return;
  }
  if (data.type === "error") { engineStatus = "error"; isEngineReady = false; updateUI(); }
}

function sendToEngine(command) {
  return new Promise((resolve, reject) => {
    if (!engineWorker || !isEngineReady) {
      pendingCommands.push({ command, resolve, reject });
      if (!engineWorker) initEngine();
      return;
    }
    const key = command.split(" ")[0];
    pendingMessages.set(key, { resolve, reject });
    engineWorker.postMessage({ type: 'uci_command', command });
    setTimeout(() => {
      if (pendingMessages.has(key)) {
        pendingMessages.delete(key);
        reject(new Error("Engine command timeout: " + command));
      }
    }, 10000);
  });
}

async function analyzePosition(fen, depth) {
  if (isAnalyzing) return;
  isAnalyzing = true;
  lastMoveResult = "Analyzing...";
  updateUI();
  try {
    const response = await chrome.runtime.sendMessage({ type: "ENGINE_ANALYZE", fen, depth });
    if (response.error) throw new Error(response.error);
  } catch (e) { console.error("[Chess AI Bot] Analyze error:", e); lastMoveResult = "Error: " + e.message; isAnalyzing = false; updateUI(); }
}

function handleBestMove(move) {
  isAnalyzing = false;
  lastMoveResult = "Best: " + move;
  updateUI();
  if (settings.showMoveHighlights) showMoveHighlight(move);
  if (settings.showPVArrows && pvMoves.length) showPVArrows(pvMoves);
  if (settings.autoMove) setTimeout(() => playMove(move), calculateDelay());
}

function calculateDelay() {
  if (settings.bulletMode) return 0;
  const minMs = settings.minDelay * 1000;
  const maxMs = settings.maxDelay * 1000 || Math.max(600, minMs + 400);
  return Math.random() * (maxMs - minMs) + minMs;
}

function playMove(move) {
  if (!board?.game) return;
  try {
    const turn = board.game.getTurn();
    const playingAs = board.game.getPlayingAs();
    const isOurTurn = (turn === 1 || turn === "w" || turn === "white") === (playingAs === 1 || playingAs === "w" || playingAs === "white");
    if (!isOurTurn) { console.warn("[Chess AI Bot] Not our turn"); return; }
    const from = move.substring(0, 2), to = move.substring(2, 4), promo = move.length > 4 ? move[4] : "q";
    const legalMoves = board.game.getLegalMoves();
    const moveObj = legalMoves.find(m => m.from === from && m.to === to);
    if (!moveObj) { console.warn("[Chess AI Bot] Move not legal:", move); return; }
    board.game.move({ ...moveObj, promotion: promo, animate: true, userGenerated: true });
    console.log("[Chess AI Bot] Played:", move);
  } catch (e) { console.error("[Chess AI Bot] Play move error:", e); }
}

function showMoveHighlight(move) {
  if (!board) return;
  clearHighlights();
  const from = move.substring(0, 2), to = move.substring(2, 4), color = settings.highlightColor;
  [from, to].forEach(sq => {
    const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1]) - 1;
    const el = board.querySelector(`.square-${file + 1}${rank + 1}, [data-square="${sq}"]`);
    if (el) { el.style.boxShadow = `inset 0 0 0 4px ${color}`; el.style.transition = "box-shadow 0.2s"; el.dataset.botHighlight = "true"; }
  });
}

function showPVArrows(moves) {
  pvMoves = moves;
  if (!board) return;
  clearPVArrows();
  if (!moves || moves.length === 0) return;
  
  const root = board.shadowRoot || board;
  if (!root) return;
  
  const isFlipped = board.classList.contains("flipped") || 
    (board.game && board.game.getPlayingAs && board.game.getPlayingAs() === "b");
  
  moves.forEach((move, i) => {
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    const id = `pv-arrow-${i}`;
    
    const existing = root.querySelector(`.${id}`);
    if (existing) existing.remove();
    
    drawPVArrow(move, id, i === 0 ? "#81b64c" : "#4fc3f7", i + 1, isFlipped);
  });
}

function clearPVArrows() {
  if (!board) return;
  const root = board.shadowRoot || board;
  if (!root) return;
  root.querySelectorAll('.pv-arrow').forEach(el => el.remove());
}

function drawPVArrow(move, id, color, index, isFlipped) {
  if (!board) return;
  const from = move.substring(0, 2), to = move.substring(2, 4);
  const getCoords = (sq) => {
    const file = sq.charCodeAt(0) - 97, rank = parseInt(sq[1]) - 1;
    return isFlipped ? { x: (7-file)*12.5+6.25, y: rank*12.5+6.25 } : { x: file*12.5+6.25, y: (7-rank)*12.5+6.25 };
  };
  const start = getCoords(from), end = getCoords(to);
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len === 0) return;
  const scale = 15 / 15, headLen = 4*scale, headWidth = 3*scale, lineWidth = 1.0*scale;
  const ux = dx/len, uy = dy/len;
  const endLineX = end.x - ux*headLen, endLineY = end.y - uy*headLen;
  const px = -uy, py = ux;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", `pv-arrow ${id}`);
  svg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:900;";
  svg.setAttribute("viewBox", "0 0 100 100");
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", start.x); line.setAttribute("y1", start.y);
  line.setAttribute("x2", endLineX); line.setAttribute("y2", endLineY);
  line.setAttribute("stroke", color); line.setAttribute("stroke-width", lineWidth);
  line.setAttribute("stroke-opacity", "0.8");
  line.setAttribute("stroke-linecap", "round");
  const poly = document.createElementNS(ns, "polygon");
  poly.setAttribute("points", `${end.x},${end.y} ${endLineX+px*(headWidth/2)},${endLineY+py*(headWidth/2)} ${endLineX-px*(headWidth/2)},${endLineY-py*(headWidth/2)}`);
  poly.setAttribute("fill", color); poly.setAttribute("fill-opacity", "0.8");
  svg.appendChild(line); svg.appendChild(poly);
  if (index <= 3) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", (start.x+end.x)/2); text.setAttribute("y", (start.y+end.y)/2);
    text.setAttribute("dy", "0.3em"); text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#fff"); text.setAttribute("font-size", "2.5");
    text.setAttribute("font-weight", "bold"); text.setAttribute("stroke", "#000");
    text.setAttribute("stroke-width", "0.1"); text.textContent = index;
    svg.appendChild(text);
  }
  const root = board.shadowRoot || board;
  if (root) root.appendChild(svg);
}

function clearPVArrows() {
  if (!board) return;
  const root = board.shadowRoot || board;
  if (!root) return;
  root.querySelectorAll('.pv-arrow').forEach(el => el.remove());
}

function clearHighlights() {
  if (!board) return;
  board.querySelectorAll('[data-bot-highlight]').forEach(el => { el.style.boxShadow = ""; delete el.dataset.botHighlight; });
}

function updateEvalDisplay() {
  if (!settings.showEvalBar || !evalData) return;
  const statusEl = document.getElementById("statusBox");
  if (!statusEl) return;
  
  let scoreText = "";
  let color = "#81b64c";
  
  if (evalData !== null && evalData !== undefined) {
    if (typeof evalData === 'object' && evalData.scoreType) {
      if (evalData.scoreType === "mate") {
        const m = evalData.scoreValue;
        scoreText = m > 0 ? `M${m}` : `-M${Math.abs(m)}`;
        color = m > 0 ? "#81b64c" : "#e74c3c";
      } else {
        const cp = evalData.scoreValue;
        scoreText = cp > 0 ? `+${(cp/100).toFixed(2)}` : (cp/100).toFixed(2);
        color = cp > 0 ? "#81b64c" : (cp < 0 ? "#e74c3c" : "#888");
      }
    }
  if (!statusEl) return;
  
  statusEl.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; font-weight:bold;">
      <div style="display:flex; align-items:center; gap: 8px;">
        <span style="color:${color}; font-size:1.1em;">${scoreText}</span>
      </div>
      <span style="font-size:0.7em; color:#aaa;">D${evalData.depth || ''}</span>
    </div>`;
  }
}

function updateUI() {
  const statusEl = document.getElementById("statusBox");
  if (statusEl) statusEl.textContent = isEngineReady ? "✅ Ready" : engineStatus === "loading" ? "⏳ Loading..." : "❌ " + engineStatus;
  
  const depthEl = document.getElementById("inpDepth");
  if (depthEl && depthEl !== document.activeElement) depthEl.value = settings.depth;
}

// ============ UI PANEL ============
function createPanel() {
  if (document.getElementById("chess-bot-panel")) return;
  const panel = document.createElement("div");
  panel.id = "chess-bot-panel";
  panel.className = "bot-hidden";
  panel.innerHTML = getPanelHTML();
  document.body.appendChild(panel);
  initPanelEvents();
}

function getPanelHTML() {
  return `
    <div id="panelHeader">
      <div class="header-left"><span>SF Engine</span><span id="minBtn">×</span></div>
      <button id="btnReset">Reset Defaults</button>
    </div>
    <div id="panelContent">
      <div id="statusBox">Waiting for analysis...</div>
      <div id="moveResult">N/A</div>
      <div class="sect"><div class="sect-title">Engine</div>
        <div class="row"><label>Model</label><select id="selMode" style="width:200px;"><option value="cloud">SF 18.0.0 — Cloud (fast)</option><option value="sfonline">SF 17.1.0 — Cloud (variable)</option><option value="local" selected>SF — Local (offline)</option></select></div>
        <div class="row"><label>Depth <span style="color:#666;">(max <span id="lblMaxDepth">18</span>)</span></label><div style="display:flex; align-items:center; gap:6px;"><input type="number" id="inpDepth" min="1" max="18" value="18"><span id="lblActualDepth" style="font-size:0.75em; color:#4fc3f7; display:none;" title="Anti-draw depth boost active"></span></div></div>
      </div>
      <div class="sect"><div class="pv-header"><div class="sect-title" style="margin:0;">PV Arrows</div><input type="checkbox" id="chkPV"></div>
        <div id="pvSettings" style="display:none; display:flex; flex-direction:column; gap:7px;">
          <div class="row"><label>Depth (1–45)</label><div class="slider-group"><input type="range" id="inpPVDepth" min="1" max="45" step="1" value="5"><input type="number" id="inpPVDepthNum" min="1" max="45" value="5"></div></div>
          <div class="row"><label>Show Numbers</label><input type="checkbox" id="chkPVNums"></div>
          <div class="row"><label>Custom Gradient</label><input type="checkbox" id="chkPVGrad"></div>
          <div id="pvGradSettings" style="display:none; padding-left:10px; border-left:2px solid #333; margin-top:3px; flex-direction:column; gap:6px;"><div class="row"><label>Start Color</label><input type="color" id="inpPVStart" value="#FFFF00"></div><div class="row"><label>End Color</label><input type="color" id="inpPVEnd" value="#FF0000"></div></div>
        </div>
      </div>
      <div class="sect"><div class="sect-title">Automation</div>
        <div class="auto-checks"><label><input type="checkbox" id="chkRun" checked> Auto-Analyze</label><label><input type="checkbox" id="chkMove"> Auto-Move</label><label><input type="checkbox" id="chkQueue"> Auto-Queue</label></div>
        <div class="auto-checks" style="margin-top:4px;"><label><input type="checkbox" id="chkThreatDet" checked> Threat Detection</label><label><input type="checkbox" id="chkOpeningBook" checked> Opening Book</label><label><input type="checkbox" id="chkTimeMgmt" checked> Time Management</label></div>
        <div class="auto-checks" style="margin-top:4px;"><label><input type="checkbox" id="chkHumanizer"> Humanizer</label></div>
        <div class="row" style="margin-top:4px;"><label>Humanize Rate (%)</label><input type="number" id="inpHumanizeRate" min="5" max="80" value="15" style="width:60px;"></div>
        <div class="auto-checks" style="margin-top:4px;"><label><input type="checkbox" id="chkRematch"> Auto-Rematch</label></div>
      </div>
      <div class="sect"><div class="sect-title">Display</div>
        <div class="row"><label>Eval Bar</label><input type="checkbox" id="chkEvalBar" checked></div>
        <div class="row"><label>Move Highlights</label><input type="checkbox" id="chkMoveHighlights" checked></div>
      </div>
      <div class="sect"><div class="sect-title">Bullet Mode</div><button id="btnBullet">⚡ BULLET: OFF</button><div id="bulletStatus" style="display:none;">⚡ BULLET MODE ON<br>Delays: None | MultiPV: 3 | Hash: 256<br>Obeying depth from main panel<br>Keyboard: Alt+B</div></div>
      <div class="btn-row"><button id="btnAnalyze">▶ Analyze</button><button id="btnRematch" style="background:#c0392b !important; color:white !important;">🔄 Rematch</button><button id="custBtn">🎨 Visuals & Theme</button><button id="localBtn">⚙ Local Engine Settings</button></div>
      <div class="sect"><div class="row"><label style="cursor:pointer; display:flex; align-items:center; gap:5px;"><input type="checkbox" id="chkDebug"> Debug Logs</label></div><div id="debugArea" style="display:none; flex-direction:column; gap:5px;"><div class="log-box" id="sentCommandOutput"></div><div class="log-box" id="receivedMessageOutput"></div></div></div>
    </div>`;
}

function initPanelEvents() {
  const panel = document.getElementById("chess-bot-panel");
  const minBtnEl = document.getElementById("minBtn");
  const btnResetPanel = document.getElementById("btnReset");
  const btnBullet = document.getElementById("btnBullet");
  const btnAnalyze = document.getElementById("btnAnalyze");
  const btnRematch = document.getElementById("btnRematch");
  const chkPV = document.getElementById("chkPV");
  const chkBullet = document.getElementById("chkBullet");
  const chkDebug = document.getElementById("chkDebug");

  function hidePanel() { if (panel) panel.classList.add("bot-hidden"); }

  if (minBtnEl) { minBtnEl.onclick = (e) => { e.stopPropagation(); hidePanel(); }; minBtnEl.innerHTML = "×"; }

  if (panel) {
    panel.onmousedown = (e) => {
      if (e.target.id === "minBtn" || e.target.id === "btnReset") return;
      e.preventDefault();
      const startX = e.clientX - panel.offsetLeft, startY = e.clientY - panel.offsetTop;
      const onMove = (mv) => {
        let x = mv.clientX - startX, y = mv.clientY - startY;
        x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
        y = Math.max(0, Math.min(y, window.innerHeight - panel.offsetHeight));
        panel.style.left = x + "px"; panel.style.top = y + "px";
        panel.style.right = "auto"; panel.style.bottom = "auto";
      };
      document.addEventListener("mousemove", onMove);
      document.onmouseup = () => document.removeEventListener("mousemove", onMove);
    }
  }

  if (minBtnEl) { minBtnEl.onclick = (e) => { e.stopPropagation(); hidePanel(); }; minBtnEl.innerHTML = "×"; }
  if (btnResetPanel) btnResetPanel.onclick = resetSettings;
  if (btnBullet) btnBullet.onclick = toggleBullet;
  if (btnAnalyze) btnAnalyze.onclick = analyze;
  if (btnRematch) btnRematch.onclick = () => {
    const allBtns = document.querySelectorAll("button");
    for (let b of allBtns) {
      const txt = b.innerText.toLowerCase().trim();
      if ((txt === "rematch" || txt === "new game" || txt === "play again" || txt === "new opponent" || txt === "find new opponent") && isElVisible(b) && !b.disabled) { b.click(); return; }
    }
  };

  if (chkBullet) chkBullet.onchange = (e) => { settings.bulletMode = e.target.checked; chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", settings: { bulletMode: e.target.checked } }).catch(() => {}); updateBulletUI(); };
  if (chkDebug) chkDebug.onchange = (e) => { settings.debugLogs = e.target.checked; updateUI(); };
  if (chkPV) chkPV.onchange = (e) => { settings.showPVArrows = e.target.checked; if (document.getElementById("pvSettings")) document.getElementById("pvSettings").style.display = e.target.checked ? "flex" : "none"; };
}

function isElVisible(el) { if (!el || typeof el !== "object") return false; if (el.offsetParent !== null) return true; if (typeof getComputedStyle === "undefined") return true; let node = el; while (node && node.nodeType === 1) { try { const cs = getComputedStyle(node); if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false; } catch (e) { return false; } node = node.parentElement; } return true; }

function updateUI() {
  const statusEl = document.getElementById("statusBox");
  if (statusEl) statusEl.textContent = isEngineReady ? "✅ Ready" : engineStatus === "loading" ? "⏳ Loading..." : "❌ " + engineStatus;
  
  const depthEl = document.getElementById("inpDepth");
  if (depthEl && depthEl !== document.activeElement) depthEl.value = settings.depth;
}

function toggleBullet() {
  settings.bulletMode = !settings.bulletMode;
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", settings: { bulletMode: settings.bulletMode } }).catch(() => {});
  updateBulletUI();
}

function resetSettings() {
  const defaults = {
    autoRun: true, autoMove: false, autoQueue: false, showEvalBar: true,
    showMoveHighlights: true, showPVArrows: false, depth: 18,
    minDelay: 0, maxDelay: 0, visualType: "outline",
    highlightColor: "#00eeff", threatDetection: true,
    openingBookEnabled: true, timeManagement: true,
    humanizer: false, humanizeRate: 15, bulletMode: false
  };
  settings = { ...defaults };
  engineSettings = {};
  applySettingsToUI();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", settings: defaults }).catch(() => {});
  updateUI();
}

function analyze() {
  const raw = getBoardFEN();
  if (raw) { const clean = sanitizeFEN(raw); if (clean) analyzePosition(clean, settings.depth); }
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (engineWorker) {
    engineWorker.terminate();
    engineWorker = null;
  }
  const panel = document.getElementById("chess-bot-panel");
  if (panel) panel.remove();
});

// Start
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();