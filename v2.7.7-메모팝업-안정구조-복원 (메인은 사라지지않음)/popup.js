const MEMO_DISPLAY_KEY = "__memoDisplayEnabled";
const RECENT_HISTORY_KEY = "__recentMemoHistory";

let currentVideoId = null;
let allData = {};
let recentHistory = [];
let currentFilterText = "";
let currentFilterRaw = "";
let floatingTimeMenu = null;
let isCurrentPageShorts = false;
let isCurrentPageWatch = false;
let currentActiveTabId = null;
let currentVideoTitleText = "";
let playbackTimer = null;
let floatingMenuOwnerKey = null;
let currentPlaybackSecond = null;
let openedTimeMemoSheetVideoId = null;

function getVideoIdFromUrl(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const watchId = parsedUrl.searchParams.get("v");
    if (watchId) return watchId;

    const shortsMatch = parsedUrl.pathname.match(/^\/shorts\/([^/?]+)/);
    return shortsMatch ? shortsMatch[1] : null;
  } catch (error) {
    const watchMatch = String(url).match(/[?&]v=([^&]+)/);
    if (watchMatch) return watchMatch[1];

    const shortsMatch = String(url).match(/\/shorts\/([^/?&]+)/);
    return shortsMatch ? shortsMatch[1] : null;
  }
}

function findYoutubeTabByVideoId(tabs, videoId) {
  return tabs.find((tab) => getVideoIdFromUrl(tab.url || "") === videoId);
}

function getYoutubePageType(url) {
  if (!url) return { isWatch: false, isShorts: false };

  try {
    const parsedUrl = new URL(url);
    return {
      isWatch: parsedUrl.pathname === "/watch" && Boolean(parsedUrl.searchParams.get("v")),
      isShorts: /^\/shorts\/[^/?]+/.test(parsedUrl.pathname)
    };
  } catch (error) {
    return {
      isWatch: /[?&]v=/.test(String(url)),
      isShorts: /\/shorts\//.test(String(url))
    };
  }
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? Math.floor(seconds) : 0);
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function normalizeMemoData(videoId, rawData) {
  if (rawData && typeof rawData === "object" && Array.isArray(rawData.memos)) {
    return {
      title: typeof rawData.title === "string" ? rawData.title : videoId,
      channel: typeof rawData.channel === "string" ? rawData.channel : "Unknown Channel",
      thumbnail: typeof rawData.thumbnail === "string"
        ? rawData.thumbnail
        : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      memos: rawData.memos
        .filter((m) => m && typeof m.text === "string")
        .map((m) => ({
          time: Number.isFinite(m.time) ? Math.max(0, Math.floor(m.time)) : 0,
          text: m.text,
          createdAt: Number.isFinite(m.createdAt) ? m.createdAt : 0
        }))
    };
  }

  if (typeof rawData === "string" && rawData.trim()) {
    return {
      title: videoId,
      channel: "Unknown Channel",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      memos: [{ time: 0, text: rawData.trim(), createdAt: 0 }]
    };
  }

  return null;
}

function sendShowPopupMessage(tabId, videoId) {
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { type: "SHOW_MEMO_POPUP", videoId }, () => {
    if (!chrome.runtime.lastError) return;

    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
      if (chrome.runtime.lastError) return;
      chrome.tabs.sendMessage(tabId, { type: "SHOW_MEMO_POPUP", videoId }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

function refreshMemoPopupForVideo(videoId) {
  if (!videoId) return;

  chrome.tabs.query({}, (tabs) => {
    tabs
      .filter((tab) => tab.id && getVideoIdFromUrl(tab.url || "") === videoId)
      .forEach((tab) => sendShowPopupMessage(tab.id, videoId));
  });
}

function seekVideoInTab(tabId, time, fallbackUrl) {
  if (!tabId) return;

  const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
  const sendSeek = () => {
    chrome.tabs.sendMessage(tabId, { type: "SEEK_TO", time: safeTime }, (response) => {
      if (!chrome.runtime.lastError && response && response.ok) return;
      chrome.tabs.update(tabId, { url: fallbackUrl, active: true });
    });
  };

  chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
    if (chrome.runtime.lastError) {
      chrome.tabs.update(tabId, { url: fallbackUrl, active: true });
      return;
    }
    sendSeek();
  });
}

function smartOpenVideo(videoId, { showPopup = false } = {}) {
  chrome.tabs.query({}, (tabs) => {
    const existingTab = findYoutubeTabByVideoId(tabs, videoId);

    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true }, () => {
        if (showPopup) sendShowPopupMessage(existingTab.id, videoId);
      });
      return;
    }

    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` }, (createdTab) => {
      if (showPopup) sendShowPopupMessage(createdTab?.id, videoId);
    });
  });
}

function openVideoInNewTab(videoId, { showPopup = false } = {}) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  chrome.tabs.create({ url }, (createdTab) => {
    if (showPopup) sendShowPopupMessage(createdTab?.id, videoId);
  });
}


function smartOpenVideoAtTime(videoId, time) {
  chrome.tabs.query({}, (tabs) => {
    const existingTab = findYoutubeTabByVideoId(tabs, videoId);
    const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}&t=${safeTime}s`;

    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true }, () => {
        seekVideoInTab(existingTab.id, safeTime, targetUrl);
      });
      return;
    }

    chrome.tabs.create({ url: targetUrl });
  });
}

function notifyActiveTabMemoVisibility(enabled) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const tabId = activeTab?.id;
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, { type: "MEMO_VISIBILITY_CHANGED", enabled }, () => {
      void chrome.runtime.lastError;
      if (!enabled) return;

      const activeVideoId = getVideoIdFromUrl(activeTab?.url || "");
      if (!activeVideoId) return;
      sendShowPopupMessage(tabId, activeVideoId);
    });
  });
}

function initCustomModal() {
  const modal = document.getElementById("customModal");
  document.getElementById("customModalCancelBtn")?.addEventListener("click", () => {
    modal.classList.remove("open");
  });
}

function showCustomModal({ message, mode = "alert", defaultValue = "" }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("customModal");
    const messageEl = document.getElementById("customModalMessage");
    const inputEl = document.getElementById("customModalInput");
    const cancelBtn = document.getElementById("customModalCancelBtn");
    const confirmBtn = document.getElementById("customModalConfirmBtn");

    messageEl.innerText = message;
    inputEl.value = defaultValue;
    inputEl.classList.toggle("visible", mode === "prompt");
    cancelBtn.style.display = mode === "alert" ? "none" : "inline-block";

    const close = (result) => {
      modal.classList.remove("open");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(result);
    };

    confirmBtn.onclick = () => close(mode === "prompt" ? inputEl.value : true);
    cancelBtn.onclick = () => close(mode === "prompt" ? null : false);

    modal.classList.add("open");
    if (mode === "prompt") inputEl.focus();
  });
}

const showAlertModal = (message) => showCustomModal({ message, mode: "alert" });
const showConfirmModal = (message) => showCustomModal({ message, mode: "confirm" });
const showPromptModal = (message, defaultValue = "") => showCustomModal({
  message,
  mode: "prompt",
  defaultValue
});

function appendRecentHistoryEntry(entry) {
  if (!entry) return;

  chrome.storage.local.get([RECENT_HISTORY_KEY], (result) => {
    const history = Array.isArray(result[RECENT_HISTORY_KEY]) ? result[RECENT_HISTORY_KEY] : [];
    history.unshift(entry);
    chrome.storage.local.set({ [RECENT_HISTORY_KEY]: history.slice(0, 50) }, loadMemoList);
  });
}

function clearRecentHistory() {
  chrome.storage.local.remove(RECENT_HISTORY_KEY, loadMemoList);
}

function initMemoVisibilityToggle() {
  const toggle = document.getElementById("memoVisibleToggle");
  if (!toggle) return;

  chrome.storage.local.get([MEMO_DISPLAY_KEY], (result) => {
    toggle.checked = result[MEMO_DISPLAY_KEY] !== false;
  });

  toggle.addEventListener("change", (event) => {
    const enabled = Boolean(event.target.checked);
    chrome.storage.local.set({ [MEMO_DISPLAY_KEY]: enabled }, () => {
      notifyActiveTabMemoVisibility(enabled);
    });
  });
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === pageId);
  });

  const settingsBtn = document.getElementById("goPage3Btn");
  settingsBtn?.classList.toggle("hidden", pageId === "page-settings");
  document.body.classList.toggle("list-page-open", pageId === "page-list");
}

function initPageNavigation() {
  document.getElementById("goPage2Btn")?.addEventListener("click", () => showPage("page-list"));
  document.getElementById("goPage3Btn")?.addEventListener("click", () => showPage("page-settings"));
  document.getElementById("backFromListBtn")?.addEventListener("click", () => showPage("page-main"));
  document.getElementById("backFromSettingsBtn")?.addEventListener("click", () => showPage("page-main"));
}

async function fetchVideoMeta(videoId) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    const data = await response.json();

    return {
      title: data.title,
      author: data.author_name,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  } catch (error) {
    return {
      title: videoId,
      author: "Unknown Channel",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  }
}

function saveMemo(videoId, memoText, time) {
  chrome.storage.local.get([videoId], async (result) => {
    let existing = normalizeMemoData(videoId, result[videoId]);

    if (!existing) {
      const meta = await fetchVideoMeta(videoId);
      existing = { title: meta.title, channel: meta.author, thumbnail: meta.thumbnail, memos: [] };
    }

    const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const nextMemo = { time: safeTime, text: memoText, createdAt: Date.now() };

    if (safeTime === 0) {
      const baseMemoIndex = existing.memos.findIndex((m) => m.time === 0);
      if (baseMemoIndex >= 0) {
        const ok = await showConfirmModal(`메인 메모가 "${memoText}"로 교체됩니다`);
        if (!ok) return;
        existing.memos[baseMemoIndex] = nextMemo;
      } else {
        existing.memos.push(nextMemo);
      }
    } else {
      existing.memos.push(nextMemo);
    }

    chrome.storage.local.set({ [videoId]: existing }, () => {
      document.getElementById("memoInput").value = "";
      refreshMemoPopupForVideo(videoId);
      appendRecentHistoryEntry({
        videoId,
        title: existing.title,
        thumbnail: existing.thumbnail,
        time: safeTime,
        text: memoText,
        createdAt: Date.now()
      });
    });
  });
}

function withActiveYoutubeTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      callback(null);
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: "GET_TIME" }, (response) => {
      if (!chrome.runtime.lastError && response && response.time !== undefined) {
        callback(Math.max(0, Math.floor(response.time)));
        return;
      }

      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
        if (chrome.runtime.lastError) {
          callback(null);
          return;
        }

        chrome.tabs.sendMessage(tabId, { type: "GET_TIME" }, (retryResponse) => {
          if (chrome.runtime.lastError || !retryResponse || retryResponse.time === undefined) {
            callback(null);
            return;
          }

          callback(Math.max(0, Math.floor(retryResponse.time)));
        });
      });
    });
  });
}

function createActionButton({ label, className = "", onClick, title = "" }) {
  const btn = document.createElement("button");
  btn.className = `ds-btn ds-btn--xs ds-btn--ghost ${className}`.trim();
  btn.innerText = label;
  if (title) btn.title = title;
  btn.onclick = onClick;
  return btn;
}

function updateMemo(videoId, memoIndex, nextText) {
  chrome.storage.local.get([videoId], (result) => {
    const existing = normalizeMemoData(videoId, result[videoId]);
    if (!existing || !existing.memos[memoIndex]) return;

    existing.memos[memoIndex].text = nextText;
    chrome.storage.local.set({ [videoId]: existing }, () => {
      refreshMemoPopupForVideo(videoId);
      loadMemoList();
    });
  });
}

function deleteMemo(videoId, memoIndex) {
  chrome.storage.local.get([videoId], (result) => {
    const existing = normalizeMemoData(videoId, result[videoId]);
    if (!existing || !existing.memos[memoIndex]) return;

    existing.memos.splice(memoIndex, 1);

    if (!existing.memos.length) {
      chrome.storage.local.remove(videoId, () => {
        refreshMemoPopupForVideo(videoId);
        loadMemoList();
      });
      return;
    }

    chrome.storage.local.set({ [videoId]: existing }, () => {
      refreshMemoPopupForVideo(videoId);
      loadMemoList();
    });
  });
}

function groupedByChannel() {
  const grouped = {};

  Object.keys(allData).forEach((videoId) => {
    if (videoId.startsWith("__")) return;

    const normalized = normalizeMemoData(videoId, allData[videoId]);
    if (!normalized) return;

    const key = normalized.channel || "Unknown Channel";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ videoId, ...normalized });
  });

  return grouped;
}

function getMemoCreatedAt(memo, index) {
  if (Number.isFinite(memo.createdAt) && memo.createdAt > 0) return memo.createdAt;
  return index;
}

function getVideoLatestTimestamp(memos) {
  if (!Array.isArray(memos) || memos.length === 0) return 0;
  return memos.reduce((latest, memo, index) => Math.max(latest, getMemoCreatedAt(memo, index)), 0);
}

function updateSearchClearButton() {
  const btn = document.getElementById("clearSearchBtn");
  const input = document.getElementById("searchInput");
  if (!btn || !input) return;
  btn.classList.toggle("visible", Boolean(input.value.trim()));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightText(text, query) {
  const safeText = escapeHtml(text || "");
  if (!query) return safeText;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "ig");
  return safeText.replace(regex, '<span class="text-highlight">$1</span>');
}

function closeFloatingTimeMenu() {
  if (!floatingTimeMenu) return;
  floatingTimeMenu.remove();
  floatingTimeMenu = null;
  floatingMenuOwnerKey = null;
}

function openFloatingTimeMenu({ anchorRect, videoId, memoIndex, memoText, ownerKey }) {
  if (floatingTimeMenu && floatingMenuOwnerKey === ownerKey) {
    closeFloatingTimeMenu();
    return;
  }

  closeFloatingTimeMenu();

  const menu = document.createElement("div");
  menu.className = "floating-time-menu";

  const editBtn = createActionButton({
    label: "수정",
    className: "menu-item",
    onClick: async (event) => {
      event.stopPropagation();
      const nextText = await showPromptModal("메모 수정", memoText);
      closeFloatingTimeMenu();
      if (!nextText || !nextText.trim()) return;
      updateMemo(videoId, memoIndex, nextText.trim());
    }
  });

  const deleteBtn = createActionButton({
    label: "삭제",
    className: "menu-item ds-btn--danger",
    onClick: async (event) => {
      event.stopPropagation();
      const ok = await showConfirmModal("이 시간 메모를 삭제하시겠습니까?");
      closeFloatingTimeMenu();
      if (!ok) return;
      deleteMemo(videoId, memoIndex);
    }
  });

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);
  floatingTimeMenu = menu;
  floatingMenuOwnerKey = ownerKey;

  const maxLeft = window.innerWidth - menu.offsetWidth - 8;
  const maxTop = window.innerHeight - menu.offsetHeight - 8;
  menu.style.left = `${Math.max(8, Math.min(anchorRect.right - menu.offsetWidth, maxLeft))}px`;
  menu.style.top = `${Math.max(8, Math.min(anchorRect.bottom + 6, maxTop))}px`;
}

function createTimeMemoMenuButton(videoId, memoIndex, memoText) {
  return createActionButton({
    label: "⋯",
    className: "menu-btn",
    title: "메뉴",
    onClick: (event) => {
      event.stopPropagation();
      const anchorRect = event.currentTarget.getBoundingClientRect();
      openFloatingTimeMenu({ anchorRect, videoId, memoIndex, memoText, ownerKey: `${videoId}-${memoIndex}` });
    }
  });
}

function closeTimeMemoSheet() {
  document.getElementById("timeMemoSheet")?.classList.remove("open");
  const list = document.getElementById("timeMemoSheetList");
  if (list) list.innerHTML = "";
  openedTimeMemoSheetVideoId = null;
}

function buildTimeMemoRow(videoId, memo, { isActiveTimeMemo = false } = {}) {
  const timeMemo = document.createElement("div");
  timeMemo.className = `time-memo${isActiveTimeMemo ? " is-active-time" : ""}`;

  const timeContent = document.createElement("div");
  timeContent.className = "time-content memo-link";
  timeContent.onclick = (event) => {
    event.stopPropagation();
    smartOpenVideoAtTime(videoId, memo.time);
  };

  const timeTextArea = document.createElement("div");
  timeTextArea.className = "memo-text-area-2";

  const timeLabel = document.createElement("span");
  timeLabel.className = "time-label";
  timeLabel.innerText = formatTime(memo.time);

  const timeText = document.createElement("span");
  timeText.className = "memo-title-2";
  timeText.innerHTML = highlightText(memo.text, currentFilterText);

  timeTextArea.appendChild(timeLabel);
  timeTextArea.appendChild(timeText);
  timeContent.appendChild(timeTextArea);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.appendChild(createTimeMemoMenuButton(videoId, memo.index, memo.text));

  timeMemo.appendChild(timeContent);
  timeMemo.appendChild(actions);
  return timeMemo;
}

function openTimeMemoSheet({ videoId, title, displayedTimeMemos, isPlayingVideo = false, playingSecond = null }) {
  const sheet = document.getElementById("timeMemoSheet");
  const titleEl = document.getElementById("timeMemoSheetTitle");
  const countEl = document.getElementById("timeMemoSheetCount");
  const listEl = document.getElementById("timeMemoSheetList");
  if (!sheet || !titleEl || !countEl || !listEl) return;

  titleEl.innerText = title;
  countEl.innerText = `Time memo ${displayedTimeMemos.length}`;
  listEl.innerHTML = "";

  displayedTimeMemos.forEach((memo) => {
    const isActiveTimeMemo = isPlayingVideo && Number.isFinite(playingSecond) && Math.abs(memo.time - playingSecond) <= 1;
    listEl.appendChild(buildTimeMemoRow(videoId, memo, { isActiveTimeMemo }));
  });

  openedTimeMemoSheetVideoId = videoId;
  sheet.classList.add("open");
}

function refreshOpenedTimeMemoSheet() {
  if (!openedTimeMemoSheetVideoId) return;

  const normalized = normalizeMemoData(openedTimeMemoSheetVideoId, allData[openedTimeMemoSheetVideoId]);
  if (!normalized) {
    closeTimeMemoSheet();
    return;
  }

  const displayedTimeMemos = normalized.memos
    .map((memo, index) => ({ ...memo, index }))
    .filter((memo) => memo.time > 0)
    .filter((memo) => !currentFilterText || memo.text.toLowerCase().includes(currentFilterText))
    .sort((a, b) => a.time - b.time);

  openTimeMemoSheet({
    videoId: openedTimeMemoSheetVideoId,
    title: normalized.title,
    displayedTimeMemos,
    isPlayingVideo: openedTimeMemoSheetVideoId === currentVideoId,
    playingSecond: openedTimeMemoSheetVideoId === currentVideoId ? currentPlaybackSecond : null
  });
}

function buildMemoItem({ videoId, title, thumbnail, baseMemo, displayedTimeMemos, isPlayingVideo = false, playingSecond = null }) {
  const memoItem = document.createElement("div");
  memoItem.className = `memo-item${isPlayingVideo ? " playing-video" : ""}`;

  const mainMemo = document.createElement("div");
  mainMemo.className = "main-memo click-target";
  mainMemo.onclick = () => openVideoInNewTab(videoId, { showPopup: true });

  const thumb = document.createElement("img");
  thumb.className = "thumbnail";
  thumb.src = thumbnail;
  thumb.alt = `${title} thumbnail`;

  const memoContainer = document.createElement("div");
  memoContainer.className = "memo-container";

  const memoTextArea = document.createElement("div");
  memoTextArea.className = "memo-text-area";

  const titleEl = document.createElement("div");
  titleEl.className = "memo-title";
  titleEl.innerHTML = highlightText(title, currentFilterText);

  const baseTextEl = document.createElement("div");
  baseTextEl.className = "memo-description";
  baseTextEl.innerHTML = baseMemo ? highlightText(baseMemo.text, currentFilterText) : "";

  memoTextArea.appendChild(titleEl);
  memoTextArea.appendChild(baseTextEl);

  const mainActions = document.createElement("div");
  mainActions.className = "main-actions";

  const deleteBtn = createActionButton({
    label: "삭제",
    className: "delete-btn ds-btn--danger",
    onClick: async (event) => {
      event.stopPropagation();
      const ok = await showConfirmModal("모든 메모가 삭제됩니다. 삭제할까요?");
      if (!ok) return;

      chrome.storage.local.remove(videoId, () => {
        refreshMemoPopupForVideo(videoId);
        loadMemoList();
      });
    }
  });
  mainActions.appendChild(deleteBtn);

  memoContainer.appendChild(memoTextArea);
  memoContainer.appendChild(mainActions);
  mainMemo.appendChild(thumb);
  mainMemo.appendChild(memoContainer);
  memoItem.appendChild(mainMemo);

  const timeHeader = document.createElement("div");
  timeHeader.className = "time-memo-header click-target";
  timeHeader.innerText = `Time memo ${displayedTimeMemos.length} · 클릭해서 보기`;
  memoItem.appendChild(timeHeader);

  timeHeader.onclick = (event) => {
    event.stopPropagation();
    openTimeMemoSheet({ videoId, title, displayedTimeMemos, isPlayingVideo, playingSecond });
  };

  return memoItem;
}

function renderRecentMemos() {
  const container = document.getElementById("recentMemoList");
  if (!container) return;
  container.innerHTML = "";

  recentHistory.slice(0, 5).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "memo-item recent-item";

    const main = document.createElement("div");
    main.className = "main-memo click-target";
    main.onclick = () => {
      if (entry.time > 0) {
        smartOpenVideoAtTime(entry.videoId, entry.time);
      } else {
        smartOpenVideo(entry.videoId, { showPopup: true });
      }
    };

    const memoContainer = document.createElement("div");
    memoContainer.className = "memo-container";

    const memoTextArea = document.createElement("div");
    memoTextArea.className = "memo-text-area";

    const title = document.createElement("div");
    title.className = "memo-title";
    title.innerText = entry.title;

    const desc = document.createElement("div");
    desc.className = "memo-description";
    desc.innerText = entry.time > 0 ? `${formatTime(entry.time)} ${entry.text}` : `메인 메모: ${entry.text}`;

    memoTextArea.appendChild(title);
    memoTextArea.appendChild(desc);
    memoContainer.appendChild(memoTextArea);
    main.appendChild(memoContainer);
    row.appendChild(main);
    container.appendChild(row);
  });
}

function loadMemoList() {
  chrome.storage.local.get(null, (data) => {
    allData = data;
    recentHistory = Array.isArray(data[RECENT_HISTORY_KEY]) ? data[RECENT_HISTORY_KEY] : [];
    renderList(currentFilterText);
    renderRecentMemos();
    updateSearchClearButton();
  });
}

function renderList(filterText) {
  const list = document.getElementById("memoList");
  list.innerHTML = "";

  const grouped = groupedByChannel();

  const sortedChannels = Object.entries(grouped)
    .map(([channelName, videos]) => {
      const sortedVideos = videos
        .slice()
        .sort((a, b) => {
          const aPlaying = a.videoId === currentVideoId ? 1 : 0;
          const bPlaying = b.videoId === currentVideoId ? 1 : 0;
          if (aPlaying !== bPlaying) return bPlaying - aPlaying;
          return getVideoLatestTimestamp(b.memos) - getVideoLatestTimestamp(a.memos);
        });

      return {
        channelName,
        videos: sortedVideos,
        latestChannelTimestamp: sortedVideos.length ? getVideoLatestTimestamp(sortedVideos[0].memos) : 0,
        isPlayingChannel: sortedVideos.some((video) => video.videoId === currentVideoId)
      };
    })
    .sort((a, b) => {
      if (a.isPlayingChannel !== b.isPlayingChannel) return a.isPlayingChannel ? -1 : 1;
      return b.latestChannelTimestamp - a.latestChannelTimestamp;
    });

  let renderedCount = 0;

  sortedChannels.forEach(({ channelName, videos, isPlayingChannel }) => {
    const videoRenderData = videos
      .map(({ videoId, title, thumbnail, memos }) => {
        const lowerTitle = title.toLowerCase();
        const lowerChannel = channelName.toLowerCase();
        const baseMemo = memos.map((m, index) => ({ ...m, index })).find((m) => m.time === 0);
        const timeMemos = memos
          .map((m, index) => ({ ...m, index }))
          .filter((m) => m.time > 0)
          .sort((a, b) => a.time - b.time);

        if (!filterText) {
          return { videoId, title, thumbnail, baseMemo, displayedTimeMemos: timeMemos };
        }

        const titleMatched = lowerTitle.includes(filterText);
        const channelMatched = lowerChannel.includes(filterText);
        const baseMatched = Boolean(baseMemo && baseMemo.text.toLowerCase().includes(filterText));
        const matchedTimeMemos = timeMemos.filter((m) => m.text.toLowerCase().includes(filterText));

        if (!(titleMatched || channelMatched || baseMatched || matchedTimeMemos.length > 0)) return null;

        return {
          videoId,
          title,
          thumbnail,
          baseMemo,
          displayedTimeMemos: titleMatched || channelMatched ? timeMemos : matchedTimeMemos
        };
      })
      .filter(Boolean);

    if (!videoRenderData.length) return;

    const channelGroup = document.createElement("section");
    channelGroup.className = `channel-group${isPlayingChannel ? " is-playing-channel" : ""}`;

    const category = document.createElement("div");
    category.className = "channel-category";
    category.innerHTML = highlightText(channelName, filterText);
    channelGroup.appendChild(category);

    videoRenderData.forEach((data) => {
      const isPlayingVideo = data.videoId === currentVideoId;
      channelGroup.appendChild(buildMemoItem({
        ...data,
        isPlayingVideo,
        playingSecond: isPlayingVideo ? currentPlaybackSecond : null
      }));
      renderedCount += 1;
    });

    list.appendChild(channelGroup);
  });

  if (filterText && renderedCount === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-result";
    empty.innerText = `"${currentFilterRaw}"로 등록한 메모가 없어요`;
    list.appendChild(empty);
  }

  refreshOpenedTimeMemoSheet();
}

function bindEvents() {
  document.getElementById("saveBaseMemoBtn")?.addEventListener("click", () => {
    const memoText = document.getElementById("memoInput").value.trim();
    if (!currentVideoId || !memoText) return;
    saveMemo(currentVideoId, memoText, 0);
  });

  const saveCurrentTimeMemo = () => {
    const memoText = document.getElementById("memoInput").value.trim();
    if (!currentVideoId || !memoText) return;

    withActiveYoutubeTab((time) => {
      if (!Number.isFinite(time)) {
        showAlertModal("현재 재생 시간을 가져오지 못했습니다. 영상 재생 후 다시 시도해 주세요.");
        return;
      }
      saveMemo(currentVideoId, memoText, time);
    });
  };

  document.getElementById("saveTimeBtn")?.addEventListener("click", saveCurrentTimeMemo);

  document.getElementById("memoInput")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.shiftKey) return;
    event.preventDefault();
    saveCurrentTimeMemo();
  });

  document.getElementById("searchInput")?.addEventListener("input", (event) => {
    currentFilterRaw = event.target.value.trim();
    currentFilterText = currentFilterRaw.toLowerCase();
    updateSearchClearButton();
    renderList(currentFilterText);
  });

  document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
    const input = document.getElementById("searchInput");
    input.value = "";
    currentFilterRaw = "";
    currentFilterText = "";
    updateSearchClearButton();
    renderList("");
    input.focus();
  });

  document.getElementById("clearRecentHistoryBtn")?.addEventListener("click", async () => {
    const ok = await showConfirmModal("최근 등록 기록을 모두 삭제할까요?");
    if (!ok) return;
    clearRecentHistory();
  });

  document.getElementById("clearAllDataBtn")?.addEventListener("click", async () => {
    const ok = await showConfirmModal("저장된 메모/설정 데이터를 모두 삭제할까요?");
    if (!ok) return;

    chrome.storage.local.clear(() => {
      recentHistory = [];
      allData = {};
      renderRecentMemos();
      renderList("");
      showAlertModal("모든 데이터가 삭제되었습니다.");
    });
  });

  document.getElementById("backupBtn")?.addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `youtube-memo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  });

  document.getElementById("restoreInput")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sanitized = {};

        Object.keys(parsed).forEach((videoId) => {
          const normalized = normalizeMemoData(videoId, parsed[videoId]);
          if (normalized) sanitized[videoId] = normalized;
        });

        chrome.storage.local.set(sanitized, loadMemoList);
      } catch (error) {
        showAlertModal("백업 파일 형식이 올바르지 않습니다.");
      } finally {
        event.target.value = "";
      }
    };

    reader.readAsText(file);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".menu-btn") || event.target.closest(".floating-time-menu")) return;
    closeFloatingTimeMenu();
  });

  document.getElementById("timeMemoSheetBackdrop")?.addEventListener("click", closeTimeMemoSheet);
  document.getElementById("timeMemoSheetCloseBtn")?.addEventListener("click", closeTimeMemoSheet);

  window.addEventListener("scroll", closeFloatingTimeMenu, true);
  window.addEventListener("resize", closeFloatingTimeMenu);
}


function setCurrentVideoMeta({ title, timeText }) {
  const titleEl = document.getElementById("currentVideoTitle");
  const timeEl = document.getElementById("currentVideoTime");
  if (titleEl) titleEl.innerText = title || "유튜브 영상 페이지가 아닙니다.";
  if (timeEl) timeEl.innerText = timeText || "00:00";
}

function updateCurrentPlaybackTime() {
  const syncPlayingHighlight = (second) => {
    const safeSecond = Number.isFinite(second) ? Math.max(0, Math.floor(second)) : null;
    if (safeSecond === currentPlaybackSecond) return;
    currentPlaybackSecond = safeSecond;
    if (document.getElementById("page-list")?.classList.contains("active")) {
      renderList(currentFilterText);
    }
  };

  if (!currentActiveTabId || !currentVideoId || !isCurrentPageWatch) {
    setCurrentVideoMeta({ title: currentVideoTitleText || "유튜브 영상 페이지가 아닙니다.", timeText: "00:00" });
    syncPlayingHighlight(null);
    return;
  }

  chrome.tabs.sendMessage(currentActiveTabId, { type: "GET_TIME" }, (response) => {
    if (!chrome.runtime.lastError && response && response.time !== undefined) {
      setCurrentVideoMeta({ title: currentVideoTitleText, timeText: formatTime(response.time) });
      syncPlayingHighlight(response.time);
      return;
    }

    chrome.scripting.executeScript({ target: { tabId: currentActiveTabId }, files: ["content.js"] }, () => {
      if (chrome.runtime.lastError) {
        syncPlayingHighlight(null);
        return;
      }
      chrome.tabs.sendMessage(currentActiveTabId, { type: "GET_TIME" }, (retryResponse) => {
        if (chrome.runtime.lastError || !retryResponse || retryResponse.time === undefined) {
          syncPlayingHighlight(null);
          return;
        }
        setCurrentVideoMeta({ title: currentVideoTitleText, timeText: formatTime(retryResponse.time) });
        syncPlayingHighlight(retryResponse.time);
      });
    });
  });
}

function startPlaybackTimePolling() {
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = setInterval(updateCurrentPlaybackTime, 1000);
  updateCurrentPlaybackTime();
}

function updateMemoActionButtons() {
  const baseBtn = document.getElementById("saveBaseMemoBtn");
  const timeBtn = document.getElementById("saveTimeBtn");

  if (!baseBtn || !timeBtn) return;

  const hasVideo = Boolean(currentVideoId);
  const canSaveBase = hasVideo;
  const canSaveTime = hasVideo && isCurrentPageWatch && !isCurrentPageShorts;

  baseBtn.disabled = !canSaveBase;
  timeBtn.disabled = !canSaveTime;
}

function initCurrentTabVideo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const url = activeTab?.url || "";
    currentActiveTabId = activeTab?.id || null;
    currentVideoId = getVideoIdFromUrl(url);

    const pageType = getYoutubePageType(url);
    isCurrentPageWatch = pageType.isWatch;
    isCurrentPageShorts = pageType.isShorts;

    currentVideoTitleText = currentVideoId
      ? (activeTab?.title || "영상 제목 없음")
      : "유튜브 영상 페이지가 아닙니다.";

    setCurrentVideoMeta({ title: currentVideoTitleText, timeText: "00:00" });
    startPlaybackTimePolling();
    updateMemoActionButtons();
  });
}

initPageNavigation();
initCustomModal();
initMemoVisibilityToggle();
bindEvents();
initCurrentTabVideo();
loadMemoList();
