const tokenInput = document.getElementById("api-token");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

// Load saved token on open
chrome.storage.local.get(["apiToken"], (result) => {
  if (result.apiToken) tokenInput.value = result.apiToken;
});

saveBtn.addEventListener("click", () => {
  const token = tokenInput.value.trim();

  if (!token) {
    statusEl.textContent = "Please paste your API token.";
    statusEl.style.color = "#c0392b";
    return;
  }

  chrome.storage.local.set({ apiToken: token }, () => {
    statusEl.textContent = "Saved!";
    statusEl.style.color = "#1e7e34";
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  });
});
