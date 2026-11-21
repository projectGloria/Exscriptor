/*
 * Exscriptor — content script.
 *
 * Runs in every frame (all_frames + match_about_blank). Each frame listens for
 * its own `copy` event: when the user presses Ctrl+C / Cmd+C with nothing
 * selected and a video is present in that frame, the video's link is placed on
 * the clipboard instead of the (empty) selection.
 */
(() => {
  'use strict';

  // Guard against double injection (e.g. extension reload into an open tab).
  if (window.__exscriptorLoaded) return;
  window.__exscriptorLoaded = true;

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  const DEFAULTS = Object.freeze({
    enabled: true,
    includeTimestamp: false,
    showToast: true,
  });

  // The copy handler must call preventDefault() synchronously, so settings are
  // cached here and kept fresh via storage.onChanged.
  const settings = { ...DEFAULTS };

  try {
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      if (!chrome.runtime.lastError && stored) Object.assign(settings, stored);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(DEFAULTS)) {
        if (key in changes) settings[key] = changes[key].newValue ?? DEFAULTS[key];
      }
    });
  } catch {
    // Extension context invalidated (extension reloaded/removed); keep defaults.
  }

  /* ------------------------------------------------------------------ */
  /* Selection check                                                     */
  /* ------------------------------------------------------------------ */

  /** Returns the truly focused element, descending into open shadow roots. */
  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  /**
   * Returns true when Exscriptor must stay out of the way: there is a text
   * selection anywhere, or focus is in an editable field (even with no
   * selection — the user may be about to rely on native editor behavior).
   */
  function shouldLeaveCopyAlone() {
    const el = getDeepActiveElement();

    if (el) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        // window.getSelection() doesn't see text selected inside these, so
        // read selectionStart/selectionEnd. Some input types (number, email…)
        // don't support them and return null or throw.
        let start = null;
        let end = null;
        try {
          start = el.selectionStart;
          end = el.selectionEnd;
        } catch {
          /* unsupported input type */
        }
        if (start !== null && end !== null && start !== end) return true; // real selection
        // Focused field with no (detectable) selection: also leave it alone.
        return true;
      }
      if (el.isContentEditable) return true;
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return true;

    // A selection might live inside a shadow root that getSelection() at the
    // document level doesn't report; check the focused element's root too.
    const root = el && el.getRootNode && el.getRootNode();
    if (root && root !== document && typeof root.getSelection === 'function') {
      const shadowSel = root.getSelection();
      if (shadowSel && !shadowSel.isCollapsed) return true;
    }

    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Video discovery                                                     */
  /* ------------------------------------------------------------------ */

  /** Collects every <video> in `root`, recursing into open shadow roots. */
  function collectVideos(root, out = []) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node instanceof HTMLVideoElement) out.push(node);
      if (node.shadowRoot) collectVideos(node.shadowRoot, out);
      node = walker.nextNode();
    }
    return out;
  }

  /** Area (px²) of the video that is inside the viewport and rendered. */
  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 0;

    const style = getComputedStyle(video);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) {
      return 0;
    }

    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const w = Math.min(rect.right, vw) - Math.max(rect.left, 0);
    const h = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** Returns the element with the largest visible area, or null if none. */
  function largestVisible(videos) {
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const area = visibleArea(v);
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  /**
   * Picks the video to copy:
   * 1. A playing video (largest visible among several; else the first one).
   * 2. Otherwise the largest visible video in the viewport.
   * 3. Otherwise null.
   */
  function pickVideo() {
    const videos = collectVideos(document);
    if (videos.length === 0) return null;

    const playing = videos.filter((v) => !v.paused);
    if (playing.length > 0) return largestVisible(playing) || playing[0];

    return largestVisible(videos);
  }

  /* ------------------------------------------------------------------ */
  /* Link building                                                       */
  /* ------------------------------------------------------------------ */

  function isYouTubeHost(hostname) {
    return /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(hostname);
  }

  /**
   * An embedded YouTube player (/embed/ID) is turned into a regular watch URL,
   * which is what people actually want to share.
   */
  function normalizeYouTube(url) {
    const m = url.pathname.match(/^\/embed\/([\w-]{6,})/);
    if (m) return new URL(`https://www.youtube.com/watch?v=${m[1]}`);
    return url;
  }

  /** Adds a timestamp to `url` (a URL object); returns the resulting string. */
  function withTimestamp(url, seconds, isMediaFile) {
    if (isYouTubeHost(url.hostname)) {
      url.searchParams.set('t', `${seconds}s`);
      return url.href;
    }

    // Direct media files understand the Media Fragments `#t=` syntax.
    // For page URLs, only use the hash if it is free (or already a `t=`),
    // so hash-based app routes like `#/lesson/3` are never broken.
    if (isMediaFile || !url.hash || /^#t=/.test(url.hash)) {
      url.hash = `t=${seconds}`;
    }
    return url.href;
  }

  /** Builds the link to copy for `video`, or null if none can be produced. */
  function buildLink(video) {
    const src = video.currentSrc || video.src || '';

    // Direct, shareable media URL vs. blob:/mediasource:/data:/empty, which
    // only exist inside this page (YouTube, Udemy, etc.) → use the page URL.
    const isMediaFile = /^https?:/i.test(src);

    let url;
    try {
      url = new URL(isMediaFile ? src : location.href);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null; // e.g. about:blank frame

    if (!isMediaFile && isYouTubeHost(url.hostname)) url = normalizeYouTube(url);

    const seconds = Math.floor(video.currentTime || 0);
    if (settings.includeTimestamp && seconds > 0 && Number.isFinite(seconds)) {
      return withTimestamp(url, seconds, isMediaFile);
    }
    return url.href;
  }

  /* ------------------------------------------------------------------ */
  /* Toast (isolated in a closed shadow root)                            */
  /* ------------------------------------------------------------------ */

  let toastHost = null;
  let toastEl = null;
  let toastTimer = 0;

  function showToast(message) {
    if (!toastHost) {
      toastHost = document.createElement('exscriptor-toast');
      const shadow = toastHost.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .toast {
            position: fixed;
            left: 50%;
            bottom: 24px;
            transform: translate(-50%, 8px);
            z-index: 2147483647;
            padding: 8px 14px;
            border-radius: 8px;
            background: rgba(24, 24, 27, 0.92);
            color: #fafafa;
            font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
            pointer-events: none;
            opacity: 0;
            transition: opacity 150ms ease, transform 150ms ease;
          }
          .toast.visible { opacity: 1; transform: translate(-50%, 0); }
        </style>
        <div class="toast" role="status" aria-live="polite"></div>`;
      toastEl = shadow.querySelector('.toast');
    }

    // In fullscreen only the fullscreen element's subtree is painted.
    const parent = document.fullscreenElement || document.documentElement;
    if (toastHost.parentNode !== parent) parent.appendChild(toastHost);

    toastEl.textContent = message;
    // Force a reflow so the fade-in transition runs on repeated copies.
    toastEl.classList.remove('visible');
    void toastEl.offsetWidth;
    toastEl.classList.add('visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Copy handler                                                        */
  /* ------------------------------------------------------------------ */

  /** The link to copy right now, or null if the normal copy should run. */
  function resolveLink() {
    if (!settings.enabled) return null;
    if (shouldLeaveCopyAlone()) return null;
    const video = pickVideo();
    return video ? buildLink(video) : null;
  }

  function notifyCopied() {
    if (settings.showToast) showToast('Video link copied');
  }

  /*
   * Chrome treats the Copy command as disabled when the selection is empty,
   * so Ctrl+C never fires `copy` at all — unless a `beforecopy` listener
   * cancels that event, which tells the browser the page will supply
   * the data itself. We cancel it only when we actually have a link.
   */
  function onBeforeCopy(e) {
    if (resolveLink()) e.preventDefault();
  }

  // Set when our copy handler ran for the current keystroke (see onKeyDown).
  let copyHandled = false;

  function onCopy(e) {
    const link = resolveLink();
    if (!link || !e.clipboardData) return; // no clipboardData → keydown fallback

    e.clipboardData.setData('text/plain', link);
    e.preventDefault();
    copyHandled = true;
    notifyCopied();
  }

  /*
   * Fallback: if the browser still didn't dispatch `copy` for this Ctrl+C /
   * Cmd+C (or gave us no clipboardData), write the link via the async
   * Clipboard API. The keypress counts as the user activation it needs.
   */
  function onKeyDown(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.isComposing || e.repeat) return;

    const link = resolveLink();
    if (!link) return;

    copyHandled = false;
    // `copy` fires synchronously as the keydown's default action, so by the
    // time this task runs we know whether it was handled.
    setTimeout(() => {
      if (copyHandled) return;
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(link).then(notifyCopied, () => {});
    }, 0);
  }

  // Capture phase so page scripts can't swallow the events before we see them.
  window.addEventListener('beforecopy', onBeforeCopy, true);
  window.addEventListener('copy', onCopy, true);
  window.addEventListener('keydown', onKeyDown, true);
})();
