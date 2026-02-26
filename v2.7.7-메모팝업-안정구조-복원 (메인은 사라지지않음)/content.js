const MEMO_DISPLAY_KEY = "__memoDisplayEnabled";
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
});
