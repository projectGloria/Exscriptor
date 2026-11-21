Build a Chrome extension (Manifest V3, vanilla JS, no dependencies) called "Exscriptor".

Behavior:
- On Ctrl+C / Cmd+C (listen to the `copy` event), if the user has text selected, do nothing and let the normal copy happen.
- If nothing is selected and a video is on the page, copy the video's source link to the clipboard instead.

Selection check (must be correct):
- Treat text selected inside <input>/<textarea> as a selection (use selectionStart/selectionEnd, since window.getSelection() misses these).
- If focus is in an input, textarea, or contenteditable with no selection, do nothing.

Video picking:
- Find all <video> elements (including inside open shadow roots). Prefer the one that is playing (!paused). Otherwise pick the largest visible one in the viewport. Otherwise do nothing.

Link logic:
- Use video.currentSrc || video.src.
- If it's a direct URL (.mp4, .webm, .m3u8, etc.), copy it.
- If it's a blob: URL (YouTube, Udemy, etc.), fall back to the page URL (location.href).
- Options toggle "Include timestamp": appends current time (?t= for YouTube, #t= otherwise).

Technical requirements:
- Content script with "all_frames": true and "match_about_blank": true so videos inside iframes work. Each frame handles its own copy event; no messaging unless needed.
- Use e.clipboardData.setData('text/plain', url) + e.preventDefault(). Fall back to navigator.clipboard.writeText if needed.
- Small non-intrusive toast ("Video link copied") for ~1.5s, injected via shadow DOM. Toggleable.
- Settings in chrome.storage.sync: enabled, includeTimestamp, showToast.
- Popup with the three toggles, branded "Exscriptor" with the icon in the header.
- Minimal permissions: "storage" only. Content script matches: <all_urls>.

Icons / branding (files already provided by me, in the project root):
- /Exscriptor.png  (square app icon)
- /Exscriptor.ico  (Windows icon)
- Do NOT generate, redraw, or replace these files. Just reference them.
- In manifest.json, set "icons" and "action.default_icon" to "Exscriptor.png" for sizes 16, 48, and 128 (Chrome scales it). Do NOT reference the .ico in the manifest (Chrome doesn't support it).
- Use Exscriptor.png in the popup header and at the top of the README.
- Keep Exscriptor.ico in the root untouched; mention in the README that it's for shortcuts/branding only.

Project structure (everything in the root folder):
Exscriptor/
  manifest.json
  content.js
  popup.html
  popup.js
  popup.css
  Exscriptor.png
  Exscriptor.ico
  README.md

Deliverables:
- All files above except the two icons (I supply those). Clean, commented code. No placeholder logic.
- README with install steps (chrome://extensions → Developer mode → Load unpacked → select the Exscriptor folder).

Edge cases:
- Multiple videos on the page.
- <source> children (currentSrc covers this).
- Shadow DOM videos.
- Must not break copy on pages without video.