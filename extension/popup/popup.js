// popup/popup.js - Popup UI logic for Chess AI Bot
// No storage persistence - matches userscript behavior

let currentSettings = {};
let engineStatus = "not_installed";

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setupEventListeners();
  requestEngineStatus();
  startStatusPolling();
});

// Load settings from memory (no persistence)
async function loadSettings() {
  const defaults = {
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
    engineModel: "sf18_05"
  };

  currentSettings = { ...defaults };
  applySettingsToUI();
}

// Apply settings to UI elements
function applySettingsToUI() {
  const map = {
    autoRun: "chkAutoRun",
    autoMove: "chkAutoMove",
    autoQueue: "chkAutoQueue",
    showEvalBar: "chkEvalBar",
    showMoveHighlights: "chkHighlights",
    showPVArrows: "chkPVArrows",
    depth: "inpDepth",
    minDelay: "inpMinDelay",
    maxDelay: "inpMaxDelay",
    visualType: "visType",
    highlightColor: "inpColor",
    threatDetection: "chkThreat",
    openingBookEnabled: "chkOpeningBook",
    timeManagement: "chkTimeMgmt",
    humanizer: "chkHumanizer",
    humanizeRate: "inpHumanizeRate",
    bulletMode: "chkBullet"
  };

  for (const [key, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) {
      if (el.type === "checkbox") el.checked = currentSettings[key];
      else el.value = currentSettings[key];
    }
  }

  updateDelayDisplay("inpMinDelay", "minDelayVal");
  updateDelayDisplay("inpMaxDelay", "maxDelayVal");
  document.getElementById("humanizeRateRow").style.display = currentSettings.humanizer ? "flex" : "none";
  document.getElementById("modelSelect").value = currentSettings.engineModel;
}

// Update delay value display
function updateDelayDisplay(rangeId, valId) {
  const range = document.getElementById(rangeId);
  const val = document.getElementById(valId);
  if (range && val) {
    const v = parseInt(range.value);
    val.textContent = v === 0 ? "Auto" : v + "ms";
  }
}

// Setup event listeners
function setupEventListeners() {
  const checkboxes = [
    "chkAutoRun", "chkAutoMove", "chkAutoQueue", "chkEvalBar",
    "chkHighlights", "chkPVArrows", "chkThreat", "chkOpeningBook",
    "chkTimeMgmt", "chkHumanizer", "chkBullet"
  ];
  checkboxes.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => saveSetting(id.replace("chk", "").toLowerCase(), el.checked));
  });

  ["inpDepth", "inpMinDelay", "inpMaxDelay", "inpHumanizeRate"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => saveSetting(id.replace("inp", "").toLowerCase(), parseInt(el.value) || 0));
  });

  ["visType", "modelSelect"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => saveSetting(id.replace("inp", "").replace("Select", "").toLowerCase(), el.value));
  });

  const colorEl = document.getElementById("inpColor");
  if (colorEl) colorEl.addEventListener("change", () => saveSetting("highlightcolor", colorEl.value));

  ["inpMinDelay", "inpMaxDelay"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => updateDelayDisplay(id, id.replace("inp", "").toLowerCase() + "Val"));
  });

  document.getElementById("chkHumanizer").addEventListener("change", (e) => {
    document.getElementById("humanizeRateRow").style.display = e.target.checked ? "flex" : "none";
    saveSetting("humanizer", e.target.checked);
  });

  document.getElementById("btnAnalyze").addEventListener("click", analyzeNow);
  document.getElementById("btnStop").addEventListener("click", stopAnalysis);
  document.getElementById("btnRestart").addEventListener("click", restartEngine);
  document.getElementById("btnReinstall").addEventListener("click", reinstallEngine);
  document.getElementById("btnReset").addEventListener("click", resetDefaults);
}

// Save setting to memory and notify background/content
function saveSetting(key, value) {
  const normalizedKey = normalizeKey(key);
  currentSettings[normalizedKey] = value;

  // Notify background and content scripts
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", settings: { [normalizedKey]: value } }).catch(() => {});
  
  if (normalizedKey === "enginemodel") {
    chrome.runtime.sendMessage({ type: "ENGINE_SET_MODEL", model: value, settings: currentSettings }).catch(() => {});
    document.getElementById("btnRestart").disabled = false;
  }
  if (normalizedKey === "bulletmode") {
    // Bullet mode overrides delays
  }
}

// Normalize key to match settings object
function normalizeKey(key) {
  const map = {
    "autorun": "autoRun",
    "automove": "autoMove",
    "autoqueue": "autoQueue",
    "evalbar": "showEvalBar",
    "highlights": "showMoveHighlights",
    "pvarrows": "showPVArrows",
    "threat": "threatDetection",
    "openingbook": "openingBookEnabled",
    "timemgmt": "timeManagement",
    "humanizer": "humanizer",
    "humanizerate": "humanizeRate",
    "bullet": "bulletMode",
    "highlightcolor": "highlightColor",
    "enginemodel": "engineModel"
  };
  return map[key.toLowerCase()] || key;
}

// Request engine status from background
function requestEngineStatus() {
  chrome.runtime.sendMessage({ type: "ENGINE_GET_STATUS" }, (response) => {
    if (response) updateEngineStatus(response);
  });
}

// Update engine status display
function updateEngineStatus(status) {
  engineStatus = status.status;
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const restartBtn = document.getElementById("btnRestart");

  if (dot && text) {
    dot.className = "status-dot";
    if (status.ready) { dot.classList.add("ready"); text.textContent = "Ready"; }
    else if (status.status === "loading") { dot.classList.add("loading"); text.textContent = "Loading engine..."; }
    else if (status.status === "error") { dot.classList.add("error"); text.textContent = "Error"; }
    else { text.textContent = status.status; }
  }

  if (restartBtn) restartBtn.disabled = status.ready ? false : true;
}

// Poll engine status
function startStatusPolling() {
  setInterval(requestEngineStatus, 2000);
}

// Analyze current position
function analyzeNow() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "TRIGGER_ANALYZE" }).catch(() => {
        console.log("Could not trigger analyze - content script may not be ready");
      });
    }
  });
}

// Stop analysis
function stopAnalysis() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "STOP_ANALYSIS" }).catch(() => {});
  });
}

// Restart engine
function restartEngine() {
  const btn = document.getElementById("btnRestart");
  if (btn) { btn.disabled = true; btn.textContent = "Restarting..."; }
  chrome.runtime.sendMessage({ type: "ENGINE_RESTART" }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = "Restart Engine"; }
    if (response?.error) alert("Restart failed: " + response.error);
  });
}

// Reinstall engine (clear cache)
function reinstallEngine() {
  if (!confirm("Clear engine cache and reinstall? This will re-download ~113MB.")) return;
  const btn = document.getElementById("btnReinstall");
  if (btn) { btn.disabled = true; btn.textContent = "Reinstalling..."; }
  restartEngine();
  if (btn) { btn.disabled = false; btn.textContent = "Reinstall / Clear Cache"; }
}

// Reset all settings to defaults
function resetDefaults() {
  if (!confirm("Reset all settings to defaults?")) return;
  const defaults = {
    autoRun: true, autoMove: false, autoQueue: false, showEvalBar: true,
    showMoveHighlights: true, showPVArrows: false, depth: 18,
    minDelay: 0, maxDelay: 0, visualType: "outline",
    highlightColor: "#00eeff", threatDetection: true,
    openingBookEnabled: true, timeManagement: true,
    humanizer: false, humanizeRate: 15, bulletMode: false
  };
  currentSettings = defaults;
  applySettingsToUI();
  chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", settings: defaults }).catch(() => {});
}