/* ===== BUZZメーカー - app.js ===== */

// ── DOM Elements ──
const userInput = document.getElementById("userInput");
const charCount = document.getElementById("charCount");
const generateBtn = document.getElementById("generateBtn");
const loading = document.getElementById("loading");
const resultsSection = document.getElementById("results");
const resultCards = document.getElementById("resultCards");
const historySection = document.getElementById("historySection");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const toast = document.getElementById("toast");
const errorBanner = document.getElementById("errorBanner");

// ── Constants ──
const STORAGE_KEY = "buzz_maker_history";
const MAX_HISTORY = 50;

// ── State ──
let isGenerating = false;

// ── Global Error Handler ──
window.onerror = (msg, src, line, col) => {
  showError(`${msg} (${src}:${line}:${col})`);
};
window.onunhandledrejection = (e) => {
  showError(`Unhandled: ${e.reason}`);
};

// ── Init ──
function init() {
  // Input events
  userInput.addEventListener("input", onInputChange);
  generateBtn.addEventListener("click", onGenerate);
  clearHistoryBtn.addEventListener("click", onClearHistory);

  // Allow Ctrl+Enter / Cmd+Enter to generate
  userInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !generateBtn.disabled) {
      onGenerate();
    }
  });

  renderHistory();
}

// ── Input Handling ──
function onInputChange() {
  const len = userInput.value.length;
  charCount.textContent = `${len} / 500`;
  generateBtn.disabled = len === 0 || isGenerating;
}

// ── Generate ──
async function onGenerate() {
  const input = userInput.value.trim();
  if (!input || isGenerating) return;

  isGenerating = true;
  generateBtn.disabled = true;
  loading.hidden = false;
  resultsSection.hidden = true;
  resultCards.innerHTML = "";

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      const detail = data.detail ? `\n[詳細] ${data.detail}` : "";
      throw new Error((data.error || `API Error (${res.status})`) + detail);
    }

    displayResults(data.posts);
    saveHistory(input, data.posts);
  } catch (err) {
    showError(err.message);
    showToast("生成に失敗しました。もう一度お試しください。");
  } finally {
    isGenerating = false;
    generateBtn.disabled = userInput.value.length === 0;
    loading.hidden = true;
  }
}

// ── Display Results ──
function displayResults(posts) {
  resultCards.innerHTML = "";

  const typeIcons = {
    "共感型": "🤝",
    "意外性型": "💡",
    "ストーリー型": "📖",
  };

  posts.forEach((post, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-card-header">
        <span class="result-type">${typeIcons[post.type] || "✨"} ${escapeHtml(post.type)}</span>
        <button class="btn-copy" data-index="${i}">
          <span>📋</span> コピー
        </button>
      </div>
      <div class="result-text">${escapeHtml(post.text)}</div>
      <div class="result-tip">
        <span class="result-tip-icon">💡</span>
        <span>${escapeHtml(post.tip)}</span>
      </div>
    `;
    resultCards.appendChild(card);
  });

  // Copy button events
  resultCards.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      copyToClipboard(posts[idx].text, btn);
    });
  });

  resultsSection.hidden = false;

  // Scroll to results
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Copy to Clipboard ──
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.innerHTML = '<span>✅</span> コピー済み';
    btn.classList.add("copied");
    showToast("コピーしました！");

    setTimeout(() => {
      btn.innerHTML = '<span>📋</span> コピー';
      btn.classList.remove("copied");
    }, 2000);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);

    btn.innerHTML = '<span>✅</span> コピー済み';
    btn.classList.add("copied");
    showToast("コピーしました！");

    setTimeout(() => {
      btn.innerHTML = '<span>📋</span> コピー';
      btn.classList.remove("copied");
    }, 2000);
  }
}

// ── History ──
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(input, posts) {
  const history = getHistory();
  history.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    input,
    posts,
  });

  // Limit history
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();

  if (history.length === 0) {
    historySection.hidden = true;
    return;
  }

  historySection.hidden = false;
  historyList.innerHTML = "";

  history.forEach((item) => {
    const dateStr = formatDate(item.date);
    const el = document.createElement("div");
    el.className = "history-item";
    el.innerHTML = `
      <div class="history-item-date">${dateStr}</div>
      <div class="history-item-input">${escapeHtml(item.input)}</div>
      <div class="history-item-actions">
        <button class="btn-history-action btn-history-view" data-id="${item.id}">結果を見る</button>
        <button class="btn-history-action btn-history-delete" data-id="${item.id}">削除</button>
      </div>
    `;
    historyList.appendChild(el);
  });

  // Event listeners
  historyList.querySelectorAll(".btn-history-view").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = history.find((h) => h.id === id);
      if (item) {
        displayResults(item.posts);
        userInput.value = item.input;
        onInputChange();
      }
    });
  });

  historyList.querySelectorAll(".btn-history-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      deleteHistoryItem(id);
    });
  });
}

function deleteHistoryItem(id) {
  const history = getHistory().filter((h) => h.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  renderHistory();
  showToast("履歴を削除しました");
}

function onClearHistory() {
  if (!confirm("すべての生成履歴を削除しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
  resultsSection.hidden = true;
  showToast("全履歴を削除しました");
}

// ── Toast ──
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  // Force reflow
  toast.offsetHeight;
  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.hidden = true; }, 300);
  }, 2000);
}

// ── Error ──
function showError(msg) {
  console.error("BUZZメーカー Error:", msg);
  errorBanner.textContent = `⚠️ ${msg}`;
  errorBanner.hidden = false;

  setTimeout(() => { errorBanner.hidden = true; }, 8000);
}

// ── Utilities ──
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

// ── Start ──
init();
