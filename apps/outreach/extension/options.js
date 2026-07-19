const urlInput = document.getElementById("app-url");
const tokenInput = document.getElementById("api-token");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

const DEFAULT_APP_URL = "https://builder-li.netlify.app/outreach";

// Load saved values on open
chrome.storage.local.get(["appUrl", "apiToken"], (result) => {
  urlInput.value = result.appUrl || DEFAULT_APP_URL;
  if (result.apiToken) tokenInput.value = result.apiToken;
});

saveBtn.addEventListener("click", () => {
  const url = urlInput.value.trim().replace(/\/$/, "");
  const token = tokenInput.value.trim();

  if (!url) {
    statusEl.textContent = "Please enter the app URL.";
    statusEl.style.color = "#c0392b";
    return;
  }

  chrome.storage.local.set({ appUrl: url, apiToken: token }, () => {
    statusEl.textContent = "Saved!";
    statusEl.style.color = "#1e7e34";
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  });
});
