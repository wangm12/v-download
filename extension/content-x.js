(function () {
  "use strict";

  const PL = globalThis.VDownloadOverlayPlacement || null;
  const BTN_SIZE = PL ? PL.DEFAULT_BTN_SIZE : 32;
  const BTN_INSET = PL ? PL.DEFAULT_INSET : 10;
  const BTN_ATTR = "data-vdl-x";
  const ID_ATTR = "data-vdl-x-status-id";
  const URL_ATTR = "data-vdl-x-url";
  const ROOT_ATTR = "data-vdl-x-overlay-root";
  const INSTANCE_KEY = "__vdlXContentInstance";
  const SVG_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  if (globalThis[INSTANCE_KEY]?.teardown) globalThis[INSTANCE_KEY].teardown();
  const registry = new Map();
  let scanFrame = 0;
  let safetyTimer = 0;
  let stopped = false;
  let beforeUnloadHandler = null;

  function statusId(url) {
    const m = url?.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }
  function getTweetUrl(article) {
    for (const link of article?.querySelectorAll('a[href*="/status/"]') || []) {
      try {
        const u = new URL(link.href);
        const id = statusId(u.pathname);
        if (id)
          return `https://${u.hostname}/${u.pathname.split("/")[1]}/status/${id}`;
      } catch {}
    }
    return null;
  }
  function isStatusPage() {
    return PL
      ? PL.isXStatusPage()
      : /\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(location.href);
  }
  function getPageType() {
    return isStatusPage() ? "statusDetail" : "timeline";
  }
  function getMediaRect(article) {
    const comp = article.querySelector('[data-testid="videoComponent"]');
    if (!comp) return null;
    const r = (comp.querySelector("video") || comp).getBoundingClientRect();
    return r.width >= 10 && r.height >= 10 ? r : null;
  }
  function flashButton(btn, cls) {
    btn.classList.remove("vdl-x-sending", "vdl-x-sent");
    if (cls) {
      btn.classList.add(cls);
      if (cls === "vdl-x-sent")
        setTimeout(() => btn.classList.remove(cls), 2000);
    }
  }
  function triggerDownload(record, btn) {
    const url = record.url;
    if (!url || !record.article.isConnected) return;
    flashButton(btn, "vdl-x-sending");
    chrome.runtime.sendMessage(
      { type: "DOWNLOAD_VIDEO", url, surfacedWake: true },
      (resp) => {
        if (chrome.runtime.lastError) return flashButton(btn, null);
        flashButton(btn, resp && !resp.error ? "vdl-x-sent" : null);
      },
    );
  }
  function position(record) {
    if (!record.overlay || !record.article.isConnected) return;
    const r = getMediaRect(record.article);
    if (!r) {
      record.overlay.classList.remove("vdl-x-video-visible");
      record.overlay.classList.add("vdl-x-video-hidden");
      return;
    }
    const strategy = PL
      ? PL.getPlacementStrategy({ site: "x", pageType: getPageType() })
      : "topRight";
    const p = PL
      ? PL.computeButtonPosition(r, strategy, BTN_SIZE, BTN_INSET)
      : { top: r.top + BTN_INSET, left: r.right - BTN_INSET - BTN_SIZE };
    if (p) {
      record.overlay.style.top = `${p.top}px`;
      record.overlay.style.left = `${p.left}px`;
      record.overlay.classList.add("vdl-x-video-visible");
      record.overlay.classList.remove("vdl-x-video-hidden");
    }
  }
  function makeButton(kind, record) {
    const b = document.createElement("button");
    b.className = kind === "action" ? "vdl-x-btn" : "vdl-x-video-btn";
    b.title = "Download with V-Download";
    b.innerHTML = SVG_DOWNLOAD;
    b.setAttribute(BTN_ATTR, kind);
    b.setAttribute(ID_ATTR, record.id);
    b.setAttribute(URL_ATTR, record.url);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      triggerDownload(record, b);
    });
    return b;
  }
  function removeExtra(article, kind, keep) {
    for (const n of article.querySelectorAll(`[${BTN_ATTR}="${kind}"]`))
      if (n !== keep) n.closest(".vdl-x-btn-wrap")?.remove() || n.remove();
  }
  function ensureAction(record) {
    const group = record.article.querySelector('[role="group"]');
    if (!group) return;
    let b = record.action;
    if (
      !b?.isConnected ||
      b.closest('article[data-testid="tweet"]') !== record.article ||
      !group.contains(b)
    )
      b = record.article.querySelector(`[${BTN_ATTR}="action"]`);
    if (
      b &&
      (!b.isConnected ||
        b.closest('article[data-testid="tweet"]') !== record.article ||
        !group.contains(b))
    )
      b = null;
    if (!b) {
      const w = document.createElement("div");
      w.className = "vdl-x-btn-wrap";
      w.style.cssText = group.children[0]?.style?.cssText || "";
      b = makeButton("action", record);
      w.appendChild(b);
      const share = group.children[group.children.length - 1];
      share ? group.insertBefore(w, share) : group.appendChild(w);
    }
    b.setAttribute(ID_ATTR, record.id);
    b.setAttribute(URL_ATTR, record.url);
    record.action = b;
    removeExtra(record.article, "action", b);
  }
  function ensureOverlay(record) {
    const root = document.querySelector(`[${ROOT_ATTR}]`);
    let b = record.overlay;
    if (
      !b?.isConnected ||
      !root?.contains(b) ||
      b.getAttribute(ID_ATTR) !== record.id
    )
      b = root?.querySelector(
        `[${BTN_ATTR}="video"][${ID_ATTR}="${record.id}"]`,
      );
    if (b && (!b.isConnected || !root?.contains(b))) b = null;
    if (!b) {
      let root = document.querySelector(`[${ROOT_ATTR}]`);
      if (!root) {
        root = document.createElement("div");
        root.setAttribute(ROOT_ATTR, "");
        document.documentElement.appendChild(root);
      }
      b = makeButton("video", record);
      b.classList.add("vdl-x-video-hidden");
      root.appendChild(b);
    }
    b.setAttribute(URL_ATTR, record.url);
    record.overlay = b;
    position(record);
  }
  function cleanup() {
    for (const [id, r] of registry)
      if (
        !r.article.isConnected ||
        !r.article.querySelector('video, [data-testid="videoComponent"]') ||
        (getPageType() === "statusDetail" && id !== statusId(location.pathname))
      ) {
        r.overlay?.remove();
        r.action?.closest(".vdl-x-btn-wrap")?.remove();
        registry.delete(id);
      }
    const root = document.querySelector(`[${ROOT_ATTR}]`);
    if (getPageType() !== "statusDetail" || !registry.size) root?.remove();
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const id = statusId(getTweetUrl(a));
      if (!id || !registry.has(id)) {
        a.querySelectorAll(`[${BTN_ATTR}="action"]`).forEach(
          (n) => n.closest(".vdl-x-btn-wrap")?.remove() || n.remove(),
        );
      }
    }
  }
  function reconcile() {
    scanFrame = 0;
    if (stopped) return;
    cleanup();
    const candidates = [
      ...document.querySelectorAll('article[data-testid="tweet"]'),
    ].filter((a) => a.querySelector('video, [data-testid="videoComponent"]'));
    const page = getPageType();
    const currentId = statusId(location.pathname);
    const chosen =
      page === "statusDetail" && currentId
        ? candidates.find((a) => statusId(getTweetUrl(a)) === currentId)
        : null;
    const seen = new Set();
    for (const a of page === "statusDetail"
      ? chosen
        ? [chosen]
        : []
      : candidates) {
      const url = getTweetUrl(a),
        id = statusId(url);
      if (!url || !id || seen.has(id)) {
        a.querySelectorAll(`[${BTN_ATTR}="action"]`).forEach(
          (n) => n.closest(".vdl-x-btn-wrap")?.remove() || n.remove(),
        );
        continue;
      }
      seen.add(id);
      const existing = registry.get(id);
      if (existing && existing.article !== a) {
        existing.article
          .querySelectorAll(`[${BTN_ATTR}="action"]`)
          .forEach((n) => n.closest(".vdl-x-btn-wrap")?.remove() || n.remove());
        continue;
      }
      const r = existing || { id, article: a, url };
      r.article = a;
      r.url = url;
      registry.set(id, r);
      if (page === "timeline") ensureAction(r);
      else ensureOverlay(r);
    }
    for (const r of registry.values()) {
      r.action?.setAttribute(URL_ATTR, r.url);
      if (r.overlay) position(r);
    }
  }
  function schedule() {
    if (!scanFrame) scanFrame = requestAnimationFrame(reconcile);
  }
  function init() {
    const observer = new MutationObserver(schedule);
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    const onScroll = () => {
      for (const r of registry.values()) position(r);
      schedule();
    };
    const onResize = onScroll;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("popstate", schedule);
    const oldPush = history.pushState,
      oldReplace = history.replaceState;
    history.pushState = function (...args) {
      const x = oldPush.apply(this, args);
      schedule();
      return x;
    };
    history.replaceState = function (...args) {
      const x = oldReplace.apply(this, args);
      schedule();
      return x;
    };
    safetyTimer = setTimeout(function tick() {
      schedule();
      if (!stopped) safetyTimer = setTimeout(tick, 3000);
    }, 3000);
    schedule();
    const teardown = () => {
      stopped = true;
      observer.disconnect();
      cancelAnimationFrame(scanFrame);
      clearTimeout(safetyTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("beforeunload", beforeUnloadHandler);
      history.pushState = oldPush;
      history.replaceState = oldReplace;
      for (const r of registry.values()) {
        r.overlay?.remove();
        r.action?.closest(".vdl-x-btn-wrap")?.remove();
      }
      registry.clear();
      document.querySelector(`[${ROOT_ATTR}]`)?.remove();
      if (globalThis[INSTANCE_KEY]?.teardown === teardown)
        delete globalThis[INSTANCE_KEY];
    };
    beforeUnloadHandler = teardown;
    globalThis[INSTANCE_KEY] = { teardown };
    window.addEventListener("beforeunload", beforeUnloadHandler, {
      once: true,
    });
  }
  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init, { once: true });
})();
