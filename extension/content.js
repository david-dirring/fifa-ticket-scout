// Content script — bridges page context (injected.js) and extension (background.js)
// injected.js runs in MAIN world via manifest, no manual injection needed.

// Listen for messages from injected code
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data?.type === "FIFA_TICKET_SCOUT") {
    chrome.runtime.sendMessage({
      type: "API_RESPONSE",
      url: event.data.url,
      body: event.data.body,
    });
  }

  if (event.data?.type === "FIFA_TICKET_SCOUT_SCAN_PROGRESS") {
    chrome.runtime.sendMessage({
      type: "SCAN_PROGRESS",
      completed: event.data.completed,
      total: event.data.total,
      status: event.data.status,
      eta: event.data.eta,
    });
  }
});

// Listen for scan commands from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SCAN") {
    window.postMessage({
      type: "FIFA_TICKET_SCOUT_SCAN",
      productId: message.productId,
      performanceId: message.performanceId,
    }, "*");
  }
});
