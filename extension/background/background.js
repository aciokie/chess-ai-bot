// background/background.js - Minimal service worker for Chess AI Bot (MV3)
// Handles coordination only - engine runs in content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward messages between popup and content script
  if (message.type && message.type.startsWith("ENGINE_") || message.type === "SETTINGS_UPDATE") {
    chrome.tabs.query({ url: "https://www.chess.com/*" }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      });
    });
    sendResponse({ forwarded: true });
    return true;
  }
  
  if (message.type === "ENGINE_GET_STATUS") {
    // Status is managed in content script
    chrome.tabs.query({ url: "https://www.chess.com/*", active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "ENGINE_GET_STATUS" }, (response) => {
          sendResponse(response || { status: "not_installed", ready: false });
        });
      } else {
        sendResponse({ status: "not_installed", ready: false });
      }
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Chess AI Bot] Extension installed/updated");
});