// ==UserScript==
// @name         Bilibili 多P课程学习进度
// @namespace    https://ji.local/tools
// @version      1.1.1
// @description  按多P总时长、当前P播放进度统计 Bilibili 课程学习进度，并支持导出 CSV。
// @author       Codex
// @license      MIT
// @homepageURL  https://github.com/jii001/bilibili-course-progress
// @supportURL   https://github.com/jii001/bilibili-course-progress/issues
// @downloadURL  https://raw.githubusercontent.com/jii001/bilibili-course-progress/main/bilibili-course-progress.user.js
// @updateURL    https://raw.githubusercontent.com/jii001/bilibili-course-progress/main/bilibili-course-progress.user.js
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @connect      api.bilibili.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "ji-bili-course-progress-panel";
  const STYLE_ID = "ji-bili-course-progress-style";
  const STORAGE_HOURS_KEY = "ji-bili-course-progress-daily-hours";
  const STORAGE_TODAY_WATCH_KEY = "ji-bili-course-progress-today-watch";

  function secToHMS(sec, compact = false) {
    const value = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    if (compact) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if (h > 0) return `${h}小时${m}分${s}秒`;
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  }

  function getBvidFromLocation(locationLike) {
    const href = locationLike?.href || "";
    const pathname = locationLike?.pathname || "";
    const search = locationLike?.search || "";
    return (
      pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] ||
      href.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] ||
      new URLSearchParams(search).get("bvid") ||
      null
    );
  }

  function getCurrentP(locationLike) {
    const search = locationLike?.search || "";
    const p = Number(new URLSearchParams(search).get("p") || 1);
    return Number.isFinite(p) && p > 0 ? Math.floor(p) : 1;
  }

  function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseTodayWatchedSeconds(raw, dateKey = getLocalDateKey()) {
    try {
      const record = JSON.parse(raw || "{}");
      if (record.dateKey !== dateKey) return 0;
      return Math.max(0, Number(record.seconds) || 0);
    } catch {
      return 0;
    }
  }

  function normalizeWatchDelta(previousTime, currentTime, maxDelta = 5) {
    const delta = (Number(currentTime) || 0) - (Number(previousTime) || 0);
    return delta > 0 && delta <= maxDelta ? delta : 0;
  }

  function computeProgress(pages, currentP, currentTime) {
    const normalizedPages = Array.isArray(pages) ? pages : [];
    const total = normalizedPages.reduce((sum, page) => sum + (Number(page.duration) || 0), 0);
    const boundedCurrentP = Math.min(Math.max(Number(currentP) || 1, 1), normalizedPages.length || 1);
    const finishedBeforeCurrent = normalizedPages
      .filter((page) => Number(page.page) < boundedCurrentP)
      .reduce((sum, page) => sum + (Number(page.duration) || 0), 0);
    const currentPage = normalizedPages.find((page) => Number(page.page) === boundedCurrentP);
    const currentDuration = Number(currentPage?.duration) || 0;
    const boundedCurrentTime = Math.min(Math.max(Number(currentTime) || 0, 0), currentDuration || Number(currentTime) || 0);
    const watched = Math.min(total, finishedBeforeCurrent + boundedCurrentTime);
    const remaining = Math.max(0, total - watched);
    const percent = total > 0 ? (watched / total) * 100 : 0;

    return {
      total,
      currentP: boundedCurrentP,
      currentDuration,
      currentTime: boundedCurrentTime,
      finishedBeforeCurrent,
      watched,
      remaining,
      percent,
      pageCount: normalizedPages.length
    };
  }

  function buildRows(pages) {
    const normalizedPages = Array.isArray(pages) ? pages : [];
    const total = normalizedPages.reduce((sum, page) => sum + (Number(page.duration) || 0), 0);
    let cumulative = 0;
    return normalizedPages.map((page) => {
      cumulative += Number(page.duration) || 0;
      return {
        page: page.page,
        title: page.part || page.title || "",
        duration: Number(page.duration) || 0,
        cumulative,
        percent: total > 0 ? (cumulative / total) * 100 : 0
      };
    });
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function buildCsv(pages) {
    const rows = [["P", "标题", "本P时长", "累计时长", "累计进度"]];
    for (const row of buildRows(pages)) {
      rows.push([
        row.page,
        row.title,
        secToHMS(row.duration, true),
        secToHMS(row.cumulative, true),
        `${row.percent.toFixed(2)}%`
      ]);
    }
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  function sanitizeFilename(name) {
    return String(name || "bilibili-course-progress")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "bilibili-course-progress";
  }

  const core = {
    secToHMS,
    getBvidFromLocation,
    getCurrentP,
    getLocalDateKey,
    parseTodayWatchedSeconds,
    normalizeWatchDelta,
    computeProgress,
    buildRows,
    buildCsv,
    sanitizeFilename
  };

  if (typeof window !== "undefined") {
    window.__BiliCourseProgressCore = core;
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  let state = {
    bvid: null,
    title: "",
    pages: [],
    error: "",
    loading: true,
    lastUrl: location.href
  };

  let watchTracker = {
    video: null,
    lastTime: 0,
    dateKey: getLocalDateKey()
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 96px;
        right: 18px;
        width: 292px;
        z-index: 2147483647;
        color: #18191c;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 8px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden;
        backdrop-filter: blur(10px);
      }
      #${PANEL_ID}.is-collapsed { width: auto; }
      #${PANEL_ID}.is-collapsed .jibcp-body { display: none; }
      #${PANEL_ID} .jibcp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        background: #00aeec;
        color: #fff;
      }
      #${PANEL_ID} .jibcp-title {
        min-width: 0;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .jibcp-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      #${PANEL_ID} button {
        border: 0;
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }
      #${PANEL_ID} .jibcp-icon {
        width: 24px;
        height: 24px;
        color: #fff;
        background: rgba(255, 255, 255, 0.18);
      }
      #${PANEL_ID} .jibcp-body { padding: 12px; }
      #${PANEL_ID} .jibcp-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      }
      #${PANEL_ID} .jibcp-row:last-child { border-bottom: 0; }
      #${PANEL_ID} .jibcp-label { color: #61666d; flex: 0 0 auto; }
      #${PANEL_ID} .jibcp-value {
        min-width: 0;
        text-align: right;
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      #${PANEL_ID} .jibcp-progress {
        height: 8px;
        border-radius: 999px;
        background: #e3e5e7;
        overflow: hidden;
        margin: 10px 0 8px;
      }
      #${PANEL_ID} .jibcp-bar {
        height: 100%;
        width: 0;
        background: #00aeec;
        transition: width 180ms ease;
      }
      #${PANEL_ID} .jibcp-control {
        display: grid;
        grid-template-columns: 1fr 78px;
        gap: 8px;
        align-items: center;
        margin: 10px 0;
      }
      #${PANEL_ID} input {
        box-sizing: border-box;
        width: 100%;
        height: 30px;
        border: 1px solid #c9ccd0;
        border-radius: 6px;
        padding: 0 8px;
        font: inherit;
      }
      #${PANEL_ID} .jibcp-export {
        width: 100%;
        height: 32px;
        margin-top: 6px;
        color: #fff;
        background: #00aeec;
        font-weight: 700;
      }
      #${PANEL_ID} .jibcp-error {
        color: #c0392b;
        background: #fff3f1;
        border-radius: 6px;
        padding: 8px;
        margin-top: 8px;
        overflow-wrap: anywhere;
      }
      @media (max-width: 760px) {
        #${PANEL_ID} {
          top: auto;
          right: 10px;
          bottom: 12px;
          left: 10px;
          width: auto;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function getVideoCurrentTime() {
    const video = document.querySelector("video");
    return Number(video?.currentTime) || 0;
  }

  function getTodayWatchedSeconds() {
    return parseTodayWatchedSeconds(localStorage.getItem(STORAGE_TODAY_WATCH_KEY), getLocalDateKey());
  }

  function saveTodayWatchedSeconds(seconds) {
    localStorage.setItem(
      STORAGE_TODAY_WATCH_KEY,
      JSON.stringify({
        dateKey: getLocalDateKey(),
        seconds: Math.max(0, Number(seconds) || 0)
      })
    );
  }

  function resetWatchTracker(video) {
    watchTracker = {
      video,
      lastTime: Number(video?.currentTime) || 0,
      dateKey: getLocalDateKey()
    };
  }

  function trackTodayWatchTime() {
    const video = document.querySelector("video");
    if (!video) {
      resetWatchTracker(null);
      return;
    }

    const dateKey = getLocalDateKey();
    if (watchTracker.video !== video || watchTracker.dateKey !== dateKey) {
      resetWatchTracker(video);
      return;
    }

    const currentTime = Number(video.currentTime) || 0;
    if (!video.paused && !video.seeking && !video.ended) {
      const delta = normalizeWatchDelta(watchTracker.lastTime, currentTime);
      if (delta > 0) {
        saveTodayWatchedSeconds(getTodayWatchedSeconds() + delta);
      }
    }

    watchTracker.lastTime = currentTime;
  }

  function createPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) return existing;

    injectStyle();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="jibcp-head">
        <div class="jibcp-title" title="课程进度">课程进度</div>
        <div class="jibcp-actions">
          <button class="jibcp-icon" type="button" data-action="refresh" title="刷新">↻</button>
          <button class="jibcp-icon" type="button" data-action="collapse" title="收起">−</button>
        </div>
      </div>
      <div class="jibcp-body">
        <div data-role="content"></div>
        <button class="jibcp-export" type="button" data-action="export">导出CSV</button>
      </div>
    `;
    panel.addEventListener("click", (event) => {
      const action = event.target?.getAttribute?.("data-action");
      if (action === "refresh") {
        loadPages(true);
      } else if (action === "collapse") {
        panel.classList.toggle("is-collapsed");
        event.target.textContent = panel.classList.contains("is-collapsed") ? "+" : "−";
        event.target.title = panel.classList.contains("is-collapsed") ? "展开" : "收起";
      } else if (action === "export") {
        exportCsv();
      }
    });
    document.body.appendChild(panel);
    return panel;
  }

  function setText(parent, selector, value) {
    const node = parent.querySelector(selector);
    if (node) node.textContent = value;
  }

  function render() {
    const panel = createPanel();
    const content = panel.querySelector('[data-role="content"]');
    if (!content) return;

    if (state.loading) {
      content.innerHTML = `<div class="jibcp-row"><span class="jibcp-label">状态</span><span class="jibcp-value" data-field="status"></span></div>`;
      setText(content, '[data-field="status"]', "读取分P信息中");
      return;
    }

    if (state.error) {
      content.innerHTML = `<div class="jibcp-error" data-field="error"></div>`;
      setText(content, '[data-field="error"]', state.error);
      return;
    }

    const progress = computeProgress(state.pages, getCurrentP(location), getVideoCurrentTime());
    const todayWatched = getTodayWatchedSeconds();
    const dailyHours = Math.max(0, Number(localStorage.getItem(STORAGE_HOURS_KEY) || 2) || 2);
    const etaDays = dailyHours > 0 ? progress.remaining / (dailyHours * 3600) : 0;
    const finishDate = dailyHours > 0 ? new Date(Date.now() + Math.ceil(etaDays) * 86400000) : null;
    const finishText = finishDate ? `${Math.ceil(etaDays)}天（约${finishDate.toLocaleDateString()}）` : "未设置";

    content.innerHTML = `
      <div class="jibcp-row"><span class="jibcp-label">课程</span><span class="jibcp-value" data-field="title"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">当前分P</span><span class="jibcp-value" data-field="current"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">总时长</span><span class="jibcp-value" data-field="total"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">已看时长</span><span class="jibcp-value" data-field="watched"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">今日已观看</span><span class="jibcp-value" data-field="today-watched"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">剩余时长</span><span class="jibcp-value" data-field="remaining"></span></div>
      <div class="jibcp-row"><span class="jibcp-label">当前P播放</span><span class="jibcp-value" data-field="current-time"></span></div>
      <div class="jibcp-progress" title="时间进度"><div class="jibcp-bar" data-field="bar"></div></div>
      <div class="jibcp-row"><span class="jibcp-label">时间进度</span><span class="jibcp-value" data-field="percent"></span></div>
      <label class="jibcp-control">
        <span class="jibcp-label">每天学习小时</span>
        <input type="number" min="0.1" step="0.1" data-role="daily-hours">
      </label>
      <div class="jibcp-row"><span class="jibcp-label">预计还需</span><span class="jibcp-value" data-field="eta"></span></div>
    `;

    setText(content, '[data-field="title"]', state.title || state.bvid || "未知");
    setText(content, '[data-field="current"]', `P${progress.currentP} / P${progress.pageCount}`);
    setText(content, '[data-field="total"]', secToHMS(progress.total));
    setText(content, '[data-field="watched"]', secToHMS(progress.watched));
    setText(content, '[data-field="today-watched"]', secToHMS(todayWatched));
    setText(content, '[data-field="remaining"]', secToHMS(progress.remaining));
    setText(content, '[data-field="current-time"]', `${secToHMS(progress.currentTime)} / ${secToHMS(progress.currentDuration)}`);
    setText(content, '[data-field="percent"]', `${progress.percent.toFixed(2)}%`);
    setText(content, '[data-field="eta"]', finishText);
    const bar = content.querySelector('[data-field="bar"]');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, progress.percent)).toFixed(2)}%`;

    const input = content.querySelector('[data-role="daily-hours"]');
    if (input) {
      input.value = String(dailyHours);
      input.addEventListener("input", () => {
        const value = Math.max(0, Number(input.value) || 0);
        localStorage.setItem(STORAGE_HOURS_KEY, String(value));
        render();
      }, { once: true });
    }
  }

  async function fetchVideoInfo(bvid) {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json.code !== 0) {
      throw new Error(json.message || `接口返回 code=${json.code}`);
    }
    if (!Array.isArray(json.data?.pages) || json.data.pages.length === 0) {
      throw new Error("接口没有返回分P列表");
    }
    return json.data;
  }

  async function loadPages(force = false) {
    const bvid = getBvidFromLocation(location);
    if (!bvid) {
      state = { ...state, bvid: null, pages: [], title: "", error: "没有识别到 BV 号，请确认当前页面是 B 站视频页。", loading: false };
      render();
      return;
    }
    if (!force && state.bvid === bvid && state.pages.length > 0) {
      render();
      return;
    }

    state = { ...state, bvid, pages: [], title: "", error: "", loading: true };
    render();
    try {
      const data = await fetchVideoInfo(bvid);
      state = {
        ...state,
        bvid,
        title: data.title || bvid,
        pages: data.pages,
        error: "",
        loading: false
      };
    } catch (error) {
      state = {
        ...state,
        pages: [],
        title: bvid,
        error: `读取分P信息失败：${error.message || error}`,
        loading: false
      };
    }
    render();
  }

  function exportCsv() {
    if (!state.pages.length) {
      state = { ...state, error: "暂无可导出的分P信息，请先刷新。" };
      render();
      return;
    }
    const csv = buildCsv(state.pages);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeFilename(state.title || state.bvid)}_学习进度表.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function start() {
    createPanel();
    loadPages();
    setInterval(() => {
      trackTodayWatchTime();
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        loadPages();
      } else {
        render();
      }
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
