const MEMO_DISPLAY_KEY = "__memoDisplayEnabled";
const RECENT_HISTORY_KEY = "__recentMemoHistory";
const MAIN_MEMO_HIDE_MS = 3000;

let popupBox = null;
let timeContainer = null;
let mainMemoElement = null;
let mainMemoHideTimer = null;
let shownBase = false;
let lastBaseMemoText = null;
let baseMemoDismissed = false;
let activeTimes = {};
let closedByUser = false;
let displayEnabled = true;
let lastMouse = { x: 20, y: 20 };
let controlButton = null;
let coachMark = null;

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? Math.floor(seconds) : 0);
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getVideoId() {
  const watchId = new URLSearchParams(location.search).get("v");
  if (watchId) return watchId;

  const shortsMatch = location.pathname.match(/^\/shorts\/([^/?]+)/);
  return shortsMatch ? shortsMatch[1] : null;
}

function removeExistingMemo() {
  clearMainMemoHideTimer();
  const existing = document.getElementById("yt-memo-box");
  if (existing) existing.remove();
  popupBox = null;
  timeContainer = null;
  mainMemoElement = null;
}

function closeCoachMark() {
  if (!coachMark) return;
  coachMark.remove();
  coachMark = null;
}

function ensureCoachMarkStyle() {
  if (document.getElementById("yt-memo-coach-style")) return;

  const style = document.createElement("style");
  style.id = "yt-memo-coach-style";
  style.textContent = `
    .yt-memo-coach {
      position: fixed;
      z-index: 2147483647;
      width: 260px;
      background: rgba(28, 28, 28, 0.96);
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 10px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.38);
      color: #fff;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: Roboto, Arial, sans-serif;
    }

    .yt-memo-coach__title {
      font-size: 12px;
      font-weight: 600;
      color: rgba(255,255,255,0.9);
    }

    .yt-memo-coach__time {
      font-size: 12px;
      color: #8ab4f8;
    }

     .yt-memo-coach__input {
      min-height: 64px;
      resize: none;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      color: #fff;
      padding: 8px;
      font-size: 12px;
      outline: none;
    }

    .yt-memo-coach__actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .yt-memo-coach__btn {
      border: 0;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .yt-memo-coach__btn--cancel {
      color: rgba(255,255,255,0.85);
      background: rgba(255,255,255,0.12);
    }

    .yt-memo-coach__btn--save {
      color: #111;
      background: #8ab4f8;
    }

    .yt-memo-player-btn {
      width: 48px;
      height: 48px;
      border-radius: 28px;
      background-color: rgba(0, 0, 0, 0.3);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
    }

    .yt-memo-player-btn__icon {
      font-size: 18px;
      line-height: 1;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function getCurrentVideoMeta(videoId) {
  const title = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() || videoId;
  const channel = document.querySelector("#channel-name a")?.textContent?.trim() || "Unknown Channel";
  return {
    title,
    channel,
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  };
}

function saveTimeMemoFromCoach(time, memoText) {
  const videoId = getVideoId();
  if (!videoId || !memoText.trim()) return;

  chrome.storage.local.get([videoId], (result) => {
    const raw = result[videoId];
    const currentMemos = Array.isArray(raw?.memos)
      ? raw.memos.filter((memo) => memo && typeof memo.text === "string")
      : getNormalizedMemos(raw);
    const timeMemos = currentMemos.filter((memo) => Number(memo.time) > 0);
    const baseMemo = currentMemos.find((memo) => Number(memo.time) === 0);
    const meta = getCurrentVideoMeta(videoId);

    const nextData = {
      title: raw?.title || meta.title,
      channel: raw?.channel || meta.channel,
      thumbnail: raw?.thumbnail || meta.thumbnail,
      memos: [
        ...(baseMemo ? [{
          time: Number.isFinite(baseMemo.time) ? Math.max(0, Math.floor(baseMemo.time)) : 0,
          text: baseMemo.text,
          createdAt: Number.isFinite(baseMemo.createdAt) ? baseMemo.createdAt : Date.now() - 1
        }] : []),
        ...timeMemos.map((memo) => ({
          time: Number.isFinite(memo.time) ? Math.max(0, Math.floor(memo.time)) : 0,
          text: memo.text,
          createdAt: Number.isFinite(memo.createdAt) ? memo.createdAt : Date.now() - 1
        })),
        { time, text: memoText.trim(), createdAt: Date.now() }
      ]
    };

    chrome.storage.local.get([RECENT_HISTORY_KEY], (historyResult) => {
      const history = Array.isArray(historyResult[RECENT_HISTORY_KEY]) ? historyResult[RECENT_HISTORY_KEY] : [];
      history.unshift({
        videoId,
        title: nextData.title,
        thumbnail: nextData.thumbnail,
        time,
        text: memoText.trim(),
        createdAt: Date.now()
      });

      chrome.storage.local.set({
        [videoId]: nextData,
        [RECENT_HISTORY_KEY]: history.slice(0, 50)
      }, () => {
        checkMemos();
        showTimeInsidePopup(`⏱ ${memoText.trim()}`);
      });
    });
  });
}

function openCoachMark(button, time) {
  ensureCoachMarkStyle();
  closeCoachMark();

  const wrapper = document.createElement("div");
  wrapper.className = "yt-memo-coach";

  const title = document.createElement("div");
  title.className = "yt-memo-coach__title";
  title.innerText = "시간 메모";

  const timeLabel = document.createElement("div");
  timeLabel.className = "yt-memo-coach__time";
  timeLabel.innerText = `기록 시간: ${formatTime(time)}`;

  const input = document.createElement("textarea");
  input.className = "yt-memo-coach__input";
  input.placeholder = "메모를 입력하세요";
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      saveTimeMemoFromCoach(time, input.value);
      closeCoachMark();
    }
  });

  const actions = document.createElement("div");
  actions.className = "yt-memo-coach__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "yt-memo-coach__btn yt-memo-coach__btn--cancel";
  cancelBtn.innerText = "닫기";
  cancelBtn.addEventListener("click", closeCoachMark);

  const saveBtn = document.createElement("button");
  saveBtn.className = "yt-memo-coach__btn yt-memo-coach__btn--save";
  saveBtn.innerText = "저장(shift+enter)";
  saveBtn.addEventListener("click", () => {
    saveTimeMemoFromCoach(time, input.value);
    closeCoachMark();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  wrapper.appendChild(title);
  wrapper.appendChild(timeLabel);
  wrapper.appendChild(input);
  wrapper.appendChild(actions);

  document.body.appendChild(wrapper);
  coachMark = wrapper;

  const rect = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - wrapper.offsetWidth, window.innerWidth - wrapper.offsetWidth - 8));
  const top = Math.max(8, rect.top - wrapper.offsetHeight - 10);
  wrapper.style.left = `${left}px`;
  wrapper.style.top = `${top}px`;
  input.focus();
}

function ensureTimeMemoControlButton() {
  if (!/youtube\.com$/.test(location.hostname)) return;

  const controls = document.querySelector(".ytp-left-controls");
  const timeDisplay = controls?.querySelector(".ytp-time-display");
  if (!controls || !timeDisplay) return;

  if (controlButton && controlButton.isConnected) return;

  const button = document.createElement("button");
  button.className = "ytp-button yt-memo-player-btn";
  button.type = "button";
  button.setAttribute("aria-label", "시간 메모 추가");
  button.setAttribute("title", "시간 메모 추가");
  button.innerHTML = '<span class="yt-memo-player-btn__icon">📝</span>';

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const video = document.querySelector("video");
    if (!video) return;
    const currentTime = Math.floor(video.currentTime || 0);
    openCoachMark(button, currentTime);
  });

  timeDisplay.insertAdjacentElement("afterend", button);
  controlButton = button;
}

function isFullscreenMode() {
  return Boolean(document.fullscreenElement);
}

function isNearViewportEdge() {
  return (
    lastMouse.x <= 4 ||
    lastMouse.y <= 4 ||
    lastMouse.x >= window.innerWidth - 4 ||
    lastMouse.y >= window.innerHeight - 4
  );
}

function syncPopupPosition() {
  if (!popupBox) return;
  popupBox.style.left = `${lastMouse.x + 4}px`;
  popupBox.style.top = `${lastMouse.y + 4}px`;
}

function syncPopupVisibilityState() {
  if (!popupBox) return;
  const shouldHide = isFullscreenMode() || !displayEnabled || isNearViewportEdge() || closedByUser;
  popupBox.style.opacity = shouldHide ? "0" : "1";
}

function clearMainMemoHideTimer() {
  if (!mainMemoHideTimer) return;
  clearTimeout(mainMemoHideTimer);
  mainMemoHideTimer = null;
}

function hideMainMemoElement(markDismissed = false) {
  if (!mainMemoElement) return;

  const target = mainMemoElement;
  target.style.opacity = "0";
  mainMemoElement = null;
  if (markDismissed) baseMemoDismissed = true;

  setTimeout(() => {
    target.remove();
    if (timeContainer && timeContainer.childElementCount === 0) {
      popupBox?.remove();
      popupBox = null;
      timeContainer = null;
    }
  }, 220);
}

function scheduleMainMemoHide() {
  clearMainMemoHideTimer();
  if (!mainMemoElement) return;

  mainMemoHideTimer = setTimeout(() => {
    hideMainMemoElement(true);
    mainMemoHideTimer = null;
  }, MAIN_MEMO_HIDE_MS);
}

function upsertMainMemoElement(baseText, { autoHideMain = false } = {}) {
  if (!popupBox || !baseText) return;

  if (!mainMemoElement) {
    const mainText = document.createElement("div");
    Object.assign(mainText.style, {
      color: "#fff",
      background: "rgba(0,0,0,0.72)",
      padding: "6px 10px",
      borderRadius: "4px",
      width: "fit-content",
      maxWidth: "260px",
      marginBottom: "4px",
      opacity: "1",
      transition: "opacity 0.2s ease"
    });
    mainText.innerText = baseText;
    mainMemoElement = mainText;
    popupBox.insertBefore(mainText, timeContainer || null);
  } else {
    mainMemoElement.innerText = baseText;
    mainMemoElement.style.opacity = "1";
  }

  if (autoHideMain) scheduleMainMemoHide();
}

function createBasePopup(baseText, { autoHideMain = false } = {}) {
  removeExistingMemo();

  popupBox = document.createElement("div");
  popupBox.id = "yt-memo-box";

  Object.assign(popupBox.style, {
    position: "fixed",
    zIndex: "99999",
    fontSize: "13px",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 0.2s ease"
  });

  timeContainer = document.createElement("div");
  timeContainer.id = "yt-time-container";
  popupBox.appendChild(timeContainer);

  if (baseText) {
    upsertMainMemoElement(baseText, { autoHideMain });
  }

  document.body.appendChild(popupBox);
  syncPopupPosition();
  syncPopupVisibilityState();
}

function showTimeInsidePopup(text) {
  if (!timeContainer) return;

  const item = document.createElement("div");
  Object.assign(item.style, {
    color: "rgba(255,255,255,0.8)",
    background: "rgba(0,0,0,0.72)",
    padding: "6px 10px",
    borderRadius: "4px",
    width: "fit-content",
    maxWidth: "260px",
    marginTop: "4px",
    opacity: "0",
    transition: "opacity 0.2s ease"
  });
  item.innerText = text;

  timeContainer.appendChild(item);
  requestAnimationFrame(() => {
    item.style.opacity = "1";
  });

  setTimeout(() => {
    item.style.opacity = "0";
    setTimeout(() => item.remove(), 200);
  }, 3000);
}

function getNormalizedMemos(data) {
  if (!data) return [];

  if (Array.isArray(data.memos)) {
    return data.memos
      .filter((memo) => memo && typeof memo.text === "string")
      .map((memo) => ({
        time: Number.isFinite(memo.time) ? Math.max(0, Math.floor(memo.time)) : 0,
        text: memo.text
      }));
  }

  if (typeof data === "string" && data.trim()) {
    return [{ time: 0, text: data.trim() }];
  }

  return [];
}

function ensurePopupForMemos(memos, { autoHideMain = false } = {}) {
  const base = memos.find(m => m.time === 0);
  if (!base) return;

  if (!popupBox) {
    createBasePopup(base.text, { autoHideMain });
  } else {
    upsertMainMemoElement(base.text, { autoHideMain });
  }

  shownBase = true;
  lastBaseMemoText = base.text;
  if (autoHideMain) baseMemoDismissed = false;
}

function forceShowMemoPopup(videoId, { autoHideMain = false } = {}) {
  chrome.storage.local.get([videoId], (result) => {
    const memos = getNormalizedMemos(result[videoId]);
    if (!memos.length) return;

    closedByUser = false;
    if (autoHideMain) baseMemoDismissed = false;
    ensurePopupForMemos(memos, { autoHideMain });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TIME") {
    const video = document.querySelector("video");
    sendResponse({ time: video ? video.currentTime : 0 });
    return;
  }

  if (request.type === "SHOW_MEMO_POPUP") {
    const currentId = getVideoId();
    const targetId = request.videoId || currentId;
    if (currentId && targetId && currentId === targetId) {
      forceShowMemoPopup(targetId, { autoHideMain: true });
    }
    return;
  }

  if (request.type === "SEEK_TO") {
    const video = document.querySelector("video");
    if (!video) {
      sendResponse({ ok: false });
      return;
    }

    const nextTime = Number.isFinite(request.time) ? Math.max(0, request.time) : 0;
    video.currentTime = nextTime;
    video.play().catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (request.type === "MEMO_VISIBILITY_CHANGED") {
    displayEnabled = Boolean(request.enabled);
    if (displayEnabled) {
      if (mainMemoElement) scheduleMainMemoHide();
      const currentId = getVideoId();
      if (currentId) forceShowMemoPopup(currentId);
    } else {
      clearMainMemoHideTimer();
    }
    syncPopupVisibilityState();
  }
});

function checkMemos() {
  ensureTimeMemoControlButton();

  const video = document.querySelector("video");
  if (!video) {
    shownBase = false;
    lastBaseMemoText = null;
    baseMemoDismissed = false;
    removeExistingMemo();
    return;
  }

  const videoId = getVideoId();
  if (!videoId) {
    shownBase = false;
    lastBaseMemoText = null;
    baseMemoDismissed = false;
    removeExistingMemo();
    return;
  }

  chrome.storage.local.get([videoId, MEMO_DISPLAY_KEY], (result) => {
    displayEnabled = result[MEMO_DISPLAY_KEY] !== false;
    const memos = getNormalizedMemos(result[videoId]);

    if (!memos.length) {
      shownBase = false;
      lastBaseMemoText = null;
      baseMemoDismissed = false;
      activeTimes = {};
      removeExistingMemo();
      return;
    }

    const baseMemo = memos.find((memo) => memo.time === 0);
    const baseMemoChanged = Boolean(baseMemo) && baseMemo.text !== lastBaseMemoText;

    if (baseMemo && !closedByUser) {
      if ((!shownBase || baseMemoChanged) && (!baseMemoDismissed || baseMemoChanged)) {
        if (!popupBox) {
          createBasePopup(baseMemo.text, { autoHideMain: true });
        } else {
          upsertMainMemoElement(baseMemo.text, { autoHideMain: true });
        }
        shownBase = true;
      }

      lastBaseMemoText = baseMemo.text;
    }

    if (!baseMemo) {
      lastBaseMemoText = null;
      baseMemoDismissed = false;
      if (mainMemoElement) hideMainMemoElement(false);
      shownBase = false;
    }

    const currentTime = Math.floor(video.currentTime);
    const matchedTimeMemos = memos
      .map((memo, index) => ({ ...memo, index }))
      .filter((memo) => memo.time > 0 && Math.abs(memo.time - currentTime) <= 1);

    if (!popupBox && !closedByUser && matchedTimeMemos.length > 0) {
      const shouldShowBaseWithTimeMemo = Boolean(baseMemo && (!shownBase || baseMemoChanged));
      createBasePopup(shouldShowBaseWithTimeMemo ? baseMemo.text : "", {
        autoHideMain: shouldShowBaseWithTimeMemo
      });
      if (shouldShowBaseWithTimeMemo) {
        shownBase = true;
        lastBaseMemoText = baseMemo.text;
      }
    }

    memos.forEach((memo, index) => {
      if (memo.time <= 0) return;

      const memoKey = `${memo.time}-${index}`;
      const isMatched = Math.abs(memo.time - currentTime) <= 1;

      if (isMatched) {
        if (!activeTimes[memoKey]) {
          activeTimes[memoKey] = true;
          showTimeInsidePopup(`⏱ ${memo.text}`);
        }
      } else {
        activeTimes[memoKey] = false;
      }
    });

    syncPopupVisibilityState();
  });
}

setInterval(checkMemos, 1000);

let lastUrl = location.href;

new MutationObserver(() => {
  if (location.href === lastUrl) return;

  lastUrl = location.href;
  shownBase = false;
  lastBaseMemoText = null;
  baseMemoDismissed = false;
  activeTimes = {};
  closedByUser = false;
  removeExistingMemo();

  setTimeout(() => {
    closeCoachMark();
    checkMemos();
    const currentId = getVideoId();
    if (currentId && displayEnabled) {
      forceShowMemoPopup(currentId, { autoHideMain: true });
    }
  }, 500);
}).observe(document, { subtree: true, childList: true });

document.addEventListener("mousemove", (event) => {
  lastMouse = { x: event.clientX, y: event.clientY };
  syncPopupPosition();
  syncPopupVisibilityState();
});

document.addEventListener("fullscreenchange", () => {
  syncPopupVisibilityState();
  if (isFullscreenMode()) closeCoachMark();
});

document.addEventListener("click", (event) => {
  if (!coachMark) return;
  if (coachMark.contains(event.target) || controlButton?.contains(event.target)) return;
  closeCoachMark();
});

window.addEventListener("resize", () => {
  if (!coachMark || !controlButton) return;
  const rect = controlButton.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right - coachMark.offsetWidth, window.innerWidth - coachMark.offsetWidth - 8));
  const top = Math.max(8, rect.top - coachMark.offsetHeight - 10);
  coachMark.style.left = `${left}px`;
  coachMark.style.top = `${top}px`;
});
