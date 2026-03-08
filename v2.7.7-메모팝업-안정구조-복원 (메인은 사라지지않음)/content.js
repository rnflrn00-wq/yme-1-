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
let coachMark = null;
let sidePanelRoot = null;
let progressDotLayer = null;
let sidePanelMemoDraft = "";
let lastSecondaryMemoSignature = "";

let checkMemosIntervalId = null;
let urlObserver = null;
let extensionContextInvalidated = false;

function isExtensionContextValid() {
  return Boolean(chrome?.runtime?.id) && !extensionContextInvalidated;
}

function invalidateExtensionContext() {
  if (extensionContextInvalidated) return;
  extensionContextInvalidated = true;

  if (checkMemosIntervalId) {
    clearInterval(checkMemosIntervalId);
    checkMemosIntervalId = null;
  }

  if (urlObserver) {
    urlObserver.disconnect();
    urlObserver = null;
  }

  closeCoachMark();
  removeExistingMemo();
}

function withSafeChromeCall(action) {
  if (!isExtensionContextValid()) return false;

  try {
    action();
    return true;
  } catch (error) {
    if (String(error?.message || "").includes("Extension context invalidated")) {
      invalidateExtensionContext();
      return false;
    }
    throw error;
  }
}


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
`;
  document.head.appendChild(style);
}

function ensureMemoDetailStyle() {
  if (document.getElementById("yt-memo-detail-style")) return;

  const style = document.createElement("style");
  style.id = "yt-memo-detail-style";
  style.textContent = `
    #yt-memo-secondary-panel {
      width: 100%;
      box-sizing: border-box;
      margin: 0 0 12px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(32, 33, 36, 0.95);
      color: #fff;
      font-family: Roboto, Arial, sans-serif;
    }

    .yt-memo-secondary-panel__title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #8ab4f8;
    }

    .yt-memo-secondary-panel__section {
      margin-bottom: 10px;
    }

    .yt-memo-secondary-panel__label {
      font-size: 12px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 6px;
    }

    .yt-memo-secondary-panel__base,
    .yt-memo-secondary-panel__empty {
      font-size: 13px;
      line-height: 1.45;
      color: rgba(255, 255, 255, 0.92);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .yt-memo-secondary-panel__timeline {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: min(34vh, 320px);
      overflow-y: auto;
      padding-right: 2px;
    }

    .yt-memo-secondary-panel__item {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px;
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      padding: 7px 8px;
      text-align: left;
      cursor: pointer;
      color: inherit;
    }

    .yt-memo-secondary-panel__item:hover {
      background: rgba(138, 180, 248, 0.18);
    }

    .yt-memo-secondary-panel__item.is-active {
      background: rgba(138, 180, 248, 0.34);
      border: 1px solid rgba(138, 180, 248, 0.65);
    }

    .yt-memo-secondary-panel__time {
      font-size: 12px;
      font-weight: 700;
      color: #8ab4f8;
      min-width: 40px;
    }

    .yt-memo-secondary-panel__text {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.92);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.35;
    }


    .yt-memo-secondary-panel__composer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.14);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .yt-memo-secondary-panel__composer-time {
      font-size: 12px;
      color: rgba(255,255,255,0.72);
    }

    .yt-memo-secondary-panel__composer-input {
      min-height: 62px;
      resize: vertical;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      color: #fff;
      padding: 8px;
      font-size: 12px;
      outline: none;
    }

    .yt-memo-secondary-panel__composer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .yt-memo-secondary-panel__composer-btn {
      border: 0;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #111;
      background: #8ab4f8;
      cursor: pointer;
    }

    .yt-memo-secondary-panel__composer-btn--base {
      background: rgba(255,255,255,0.75);
    }

    .yt-memo-progress-dot-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 35;
    }

    .yt-memo-progress-dot {
      position: absolute;
      top: 50%;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: #8ab4f8;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
    }

    @media (max-width: 1200px) {
      #yt-memo-secondary-panel {
        margin-bottom: 10px;
        padding: 10px;
      }
    }
  `;

  document.head.appendChild(style);
}

function seekCurrentVideoTo(time) {
  const video = document.querySelector("video");
  if (!video) return;
  video.currentTime = Math.max(0, Number.isFinite(time) ? time : 0);
  video.play().catch(() => {});
}

function getCurrentPlaybackSecond() {
  const video = document.querySelector("video");
  if (!video) return 0;
  return Math.max(0, Math.floor(video.currentTime || 0));
}

function isSidePanelComposerFocused() {
  const active = document.activeElement;
  return Boolean(active && active.classList?.contains("yt-memo-secondary-panel__composer-input"));
}

function blockYoutubeShortcutWhenComposing(event) {
  if (!isSidePanelComposerFocused()) return;
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  event.stopImmediatePropagation();
}

function getSecondaryMemoSignature(memos = []) {
  return memos
    .map((memo) => `${memo.time}:${memo.text}`)
    .join("||");
}

function updateSecondaryComposerTime(currentSecond) {
  if (!sidePanelRoot || !sidePanelRoot.isConnected) return;
  const timeEl = sidePanelRoot.querySelector(".yt-memo-secondary-panel__composer-time");
  if (!timeEl) return;
  timeEl.innerText = `현재 재생 시간: ${formatTime(currentSecond)}`;
}

function updateSecondaryPanelActiveState(currentSecond) {
  if (!sidePanelRoot || !sidePanelRoot.isConnected) return;
  const items = sidePanelRoot.querySelectorAll(".yt-memo-secondary-panel__item[data-time]");
  items.forEach((item) => {
    const itemTime = Number(item.dataset.time);
    const isActive = Number.isFinite(itemTime) && Math.abs(itemTime - currentSecond) <= 1;
    item.classList.toggle("is-active", isActive);
  });
}

function renderSecondaryMemoPanel(memos = [], currentSecond = 0) {
  ensureMemoDetailStyle();

  const secondary = document.querySelector("#secondary");
  if (!secondary) {
    if (sidePanelRoot) {
      sidePanelRoot.remove();
      sidePanelRoot = null;
    }
    return;
  }

  if (!sidePanelRoot || !sidePanelRoot.isConnected) {
    sidePanelRoot = document.createElement("section");
    sidePanelRoot.id = "yt-memo-secondary-panel";
    secondary.insertBefore(sidePanelRoot, secondary.firstChild || null);
  }

  const baseMemo = memos.find((memo) => memo.time === 0)?.text?.trim() || "";
  const timeMemos = memos
    .filter((memo) => memo.time > 0)
    .sort((a, b) => a.time - b.time);

  sidePanelRoot.innerHTML = "";

  const title = document.createElement("div");
  title.className = "yt-memo-secondary-panel__title";
  title.innerText = "노트 상세";

  const baseSection = document.createElement("div");
  baseSection.className = "yt-memo-secondary-panel__section";

  const baseLabel = document.createElement("div");
  baseLabel.className = "yt-memo-secondary-panel__label";
  baseLabel.innerText = "기본 노트";

  const baseContent = document.createElement("div");
  baseContent.className = baseMemo
    ? "yt-memo-secondary-panel__base"
    : "yt-memo-secondary-panel__empty";
  baseContent.innerText = baseMemo || "등록된 기본 노트가 없습니다.";

  baseSection.appendChild(baseLabel);
  baseSection.appendChild(baseContent);

  const timelineSection = document.createElement("div");
  timelineSection.className = "yt-memo-secondary-panel__section";

  const timelineLabel = document.createElement("div");
  timelineLabel.className = "yt-memo-secondary-panel__label";
  timelineLabel.innerText = "타임노트 타임라인";
  timelineSection.appendChild(timelineLabel);

  if (!timeMemos.length) {
    const empty = document.createElement("div");
    empty.className = "yt-memo-secondary-panel__empty";
    empty.innerText = "등록된 시간 메모가 없습니다.";
    timelineSection.appendChild(empty);
  } else {
    const timeline = document.createElement("div");
    timeline.className = "yt-memo-secondary-panel__timeline";

    timeMemos.forEach((memo) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "yt-memo-secondary-panel__item";
      item.dataset.time = String(memo.time);
      const isActive = Math.abs(memo.time - currentSecond) <= 1;
      if (isActive) item.classList.add("is-active");

      const timeText = document.createElement("span");
      timeText.className = "yt-memo-secondary-panel__time";
      timeText.innerText = formatTime(memo.time);

      const memoText = document.createElement("span");
      memoText.className = "yt-memo-secondary-panel__text";
      memoText.innerText = memo.text;

      item.appendChild(timeText);
      item.appendChild(memoText);
      item.addEventListener("click", () => {
        seekCurrentVideoTo(memo.time);
      });

      timeline.appendChild(item);
    });

    timelineSection.appendChild(timeline);
  }

  const composerSection = document.createElement("div");
  composerSection.className = "yt-memo-secondary-panel__composer";

  const composerLabel = document.createElement("div");
  composerLabel.className = "yt-memo-secondary-panel__label";
  composerLabel.innerText = "기본/타임노트 빠른 등록";

  const composerTime = document.createElement("div");
  composerTime.className = "yt-memo-secondary-panel__composer-time";
  composerTime.innerText = `현재 재생 시간: ${formatTime(currentSecond)}`;

  const composerInput = document.createElement("textarea");
  composerInput.className = "yt-memo-secondary-panel__composer-input";
  composerInput.placeholder = "현재 시점의 메모를 입력하세요";
  composerInput.value = sidePanelMemoDraft;
  composerInput.addEventListener("input", () => {
    sidePanelMemoDraft = composerInput.value;
  });

  const saveBaseBtn = document.createElement("button");
  saveBaseBtn.type = "button";
  saveBaseBtn.className = "yt-memo-secondary-panel__composer-btn yt-memo-secondary-panel__composer-btn--base";
  saveBaseBtn.innerText = "기본 노트 저장";
  saveBaseBtn.addEventListener("click", () => {
    const nextText = composerInput.value.trim();
    if (!nextText) return;
    saveMemoFromInlineComposer(0, nextText, { replaceBase: true });
    sidePanelMemoDraft = "";
    composerInput.value = "";
    composerInput.blur();
  });

  const saveTimeBtn = document.createElement("button");
  saveTimeBtn.type = "button";
  saveTimeBtn.className = "yt-memo-secondary-panel__composer-btn";
  saveTimeBtn.innerText = "현재 시간 저장";
  saveTimeBtn.addEventListener("click", () => {
    const nextText = composerInput.value.trim();
    if (!nextText) return;
    const liveSecond = getCurrentPlaybackSecond();
    saveMemoFromInlineComposer(liveSecond, nextText);
    sidePanelMemoDraft = "";
    composerInput.value = "";
    composerInput.blur();
  });

  composerInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      saveTimeBtn.click();
    }
  });

  composerInput.addEventListener("keyup", (event) => {
    event.stopPropagation();
  });

  const composerActionRow = document.createElement("div");
  composerActionRow.className = "yt-memo-secondary-panel__composer-actions";
  composerActionRow.appendChild(saveBaseBtn);
  composerActionRow.appendChild(saveTimeBtn);

  composerSection.appendChild(composerLabel);
  composerSection.appendChild(composerTime);
  composerSection.appendChild(composerInput);
  composerSection.appendChild(composerActionRow);

  sidePanelRoot.appendChild(title);
  sidePanelRoot.appendChild(baseSection);
  sidePanelRoot.appendChild(timelineSection);
  sidePanelRoot.appendChild(composerSection);
}

function renderProgressMemoDots(memos = []) {
  ensureMemoDetailStyle();

  const progressContainer = document.querySelector(".ytp-progress-bar-container");
  const video = document.querySelector("video");
  const duration = Number.isFinite(video?.duration) ? video.duration : 0;

  if (!progressContainer || !duration) {
    if (progressDotLayer) {
      progressDotLayer.remove();
      progressDotLayer = null;
    }
    return;
  }

  const timeMemos = memos
    .filter((memo) => memo.time > 0)
    .sort((a, b) => a.time - b.time);

  if (!timeMemos.length) {
    if (progressDotLayer) {
      progressDotLayer.remove();
      progressDotLayer = null;
    }
    return;
  }

  const computedPosition = getComputedStyle(progressContainer).position;
  if (computedPosition === "static") {
    progressContainer.style.position = "relative";
  }

  if (!progressDotLayer || !progressDotLayer.isConnected) {
    progressDotLayer = document.createElement("div");
    progressDotLayer.className = "yt-memo-progress-dot-layer";
    progressContainer.appendChild(progressDotLayer);
  }

  progressDotLayer.innerHTML = "";

  const uniqueTimes = [...new Set(timeMemos.map((memo) => memo.time))];
  uniqueTimes.forEach((time) => {
    const percent = Math.max(0, Math.min(100, (time / duration) * 100));
    const dot = document.createElement("span");
    dot.className = "yt-memo-progress-dot";
    dot.style.left = `${percent}%`;
    dot.title = `메모 ${formatTime(time)}`;
    progressDotLayer.appendChild(dot);
  });
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

function saveMemoFromInlineComposer(time, memoText, { replaceBase = false } = {}) {
  const videoId = getVideoId();
  if (!videoId || !memoText.trim()) return;

  const didStartRead = withSafeChromeCall(() => {
    chrome.storage.local.get([videoId], (result) => {
    const raw = result[videoId];
    const currentMemos = Array.isArray(raw?.memos)
      ? raw.memos.filter((memo) => memo && typeof memo.text === "string")
      : getNormalizedMemos(raw);
    const timeMemos = currentMemos.filter((memo) => Number(memo.time) > 0);
    const baseMemo = currentMemos.find((memo) => Number(memo.time) === 0);
    const meta = getCurrentVideoMeta(videoId);
    const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const nextBaseMemo = replaceBase
      ? { time: 0, text: memoText.trim(), createdAt: Date.now() }
      : (baseMemo ? {
        time: Number.isFinite(baseMemo.time) ? Math.max(0, Math.floor(baseMemo.time)) : 0,
        text: baseMemo.text,
        createdAt: Number.isFinite(baseMemo.createdAt) ? baseMemo.createdAt : Date.now() - 1
      } : null);

    const nextData = {
      title: raw?.title || meta.title,
      channel: raw?.channel || meta.channel,
      thumbnail: raw?.thumbnail || meta.thumbnail,
      memos: [
        ...(nextBaseMemo ? [nextBaseMemo] : []),
        ...timeMemos.map((memo) => ({
          time: Number.isFinite(memo.time) ? Math.max(0, Math.floor(memo.time)) : 0,
          text: memo.text,
          createdAt: Number.isFinite(memo.createdAt) ? memo.createdAt : Date.now() - 1
        })),
        ...(replaceBase ? [] : [{ time: safeTime, text: memoText.trim(), createdAt: Date.now() }])
      ]
    };

    chrome.storage.local.get([RECENT_HISTORY_KEY], (historyResult) => {
      const history = Array.isArray(historyResult[RECENT_HISTORY_KEY]) ? historyResult[RECENT_HISTORY_KEY] : [];
      history.unshift({
        videoId,
        title: nextData.title,
        thumbnail: nextData.thumbnail,
        time: safeTime,
        text: memoText.trim(),
        createdAt: Date.now()
      });

      chrome.storage.local.set({
        [videoId]: nextData,
        [RECENT_HISTORY_KEY]: history.slice(0, 50)
      }, () => {
        checkMemos();
        showTimeInsidePopup(replaceBase ? `📝 ${memoText.trim()}` : `⏱ ${memoText.trim()}`);
      });
    });
    });
  });

  if (!didStartRead) return;
}

function saveTimeMemoFromCoach(time, memoText) {
  saveMemoFromInlineComposer(time, memoText);
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
  const didStartRead = withSafeChromeCall(() => {
    chrome.storage.local.get([videoId], (result) => {
    const memos = getNormalizedMemos(result[videoId]);
    if (!memos.length) return;

    closedByUser = false;
    if (autoHideMain) baseMemoDismissed = false;
    ensurePopupForMemos(memos, { autoHideMain });
    });
  });

  if (!didStartRead) return;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isExtensionContextValid()) return;
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
  if (!isExtensionContextValid()) {
    invalidateExtensionContext();
    return;
  }

  const video = document.querySelector("video");
  if (!video) {
    shownBase = false;
    lastBaseMemoText = null;
    baseMemoDismissed = false;
    removeExistingMemo();
    lastSecondaryMemoSignature = "";
    renderSecondaryMemoPanel([]);
    renderProgressMemoDots([]);
    return;
  }

  const videoId = getVideoId();
  if (!videoId) {
    shownBase = false;
    lastBaseMemoText = null;
    baseMemoDismissed = false;
    removeExistingMemo();
    lastSecondaryMemoSignature = "";
    renderSecondaryMemoPanel([]);
    renderProgressMemoDots([]);
    return;
  }

  const didStartRead = withSafeChromeCall(() => {
    chrome.storage.local.get([videoId, MEMO_DISPLAY_KEY], (result) => {
    displayEnabled = result[MEMO_DISPLAY_KEY] !== false;
    const memos = getNormalizedMemos(result[videoId]);

    if (!memos.length) {
      shownBase = false;
      lastBaseMemoText = null;
      baseMemoDismissed = false;
      activeTimes = {};
      removeExistingMemo();
      lastSecondaryMemoSignature = "";
      renderSecondaryMemoPanel([]);
      renderProgressMemoDots([]);
      return;
    }

    const currentTime = Math.floor(video.currentTime);
    const nextSecondaryMemoSignature = getSecondaryMemoSignature(memos);
    if (nextSecondaryMemoSignature !== lastSecondaryMemoSignature) {
      renderSecondaryMemoPanel(memos, currentTime);
      lastSecondaryMemoSignature = nextSecondaryMemoSignature;
    } else {
      updateSecondaryPanelActiveState(currentTime);
      updateSecondaryComposerTime(currentTime);
    }

    renderProgressMemoDots(memos);

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
  });

  if (!didStartRead) return;
}

checkMemosIntervalId = setInterval(checkMemos, 1000);

let lastUrl = location.href;

urlObserver = new MutationObserver(() => {
  if (location.href === lastUrl) return;

  lastUrl = location.href;
  shownBase = false;
  lastBaseMemoText = null;
  baseMemoDismissed = false;
  activeTimes = {};
  closedByUser = false;
  sidePanelMemoDraft = "";
  lastSecondaryMemoSignature = "";
  removeExistingMemo();

  setTimeout(() => {
    closeCoachMark();
    checkMemos();
    const currentId = getVideoId();
    if (currentId && displayEnabled) {
      forceShowMemoPopup(currentId, { autoHideMain: true });
    }
  }, 500);
});

urlObserver.observe(document, { subtree: true, childList: true });

document.addEventListener("mousemove", (event) => {
  if (!isExtensionContextValid()) return;
  lastMouse = { x: event.clientX, y: event.clientY };
  syncPopupPosition();
  syncPopupVisibilityState();
});

document.addEventListener("fullscreenchange", () => {
  if (!isExtensionContextValid()) return;
  syncPopupVisibilityState();
  if (isFullscreenMode()) closeCoachMark();
});

document.addEventListener("click", (event) => {
  if (!isExtensionContextValid()) return;
  if (!coachMark) return;
  if (coachMark.contains(event.target)) return;
  closeCoachMark();
});

document.addEventListener("keydown", blockYoutubeShortcutWhenComposing, true);
document.addEventListener("keyup", blockYoutubeShortcutWhenComposing, true);
document.addEventListener("keypress", blockYoutubeShortcutWhenComposing, true);

window.addEventListener("resize", () => {
  if (!isExtensionContextValid()) return;
  checkMemos();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (!isExtensionContextValid() || areaName !== "local") return;
  const currentVideoId = getVideoId();
  if (!currentVideoId) return;
  if (!changes[currentVideoId]) return;
  checkMemos();
});
