<p align="center">
  <img src="Exscriptor.png" alt="Exscriptor" width="128" height="128">
</p>

# Exscriptor

A tiny Chrome extension (Manifest V3, vanilla JS, no dependencies): press **Ctrl+C / Cmd+C with nothing selected** on a page with a video, and the video's link is copied to your clipboard.

When text *is* selected, copy works exactly as usual.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `Exscriptor` folder.

Pin the extension from the puzzle-piece menu to reach the settings popup.

## How it works

On every `copy` event (in every frame, including iframes and `about:blank` frames):

1. **Leave copy alone** if there is a text selection, including text selected inside `<input>`/`<textarea>` (detected via `selectionStart`/`selectionEnd`), or if focus is in an input, textarea or contenteditable element.
2. **Pick a video**: all `<video>` elements, including those inside open shadow roots, are collected. A playing video wins (the largest visible one if several are playing); otherwise the largest video visible in the viewport. With no candidate, nothing happens and the normal copy goes through.
3. **Build the link** from `video.currentSrc || video.src`:
   - A direct `http(s)` media URL (`.mp4`, `.webm`, `.m3u8`, …) is copied as-is.
   - A `blob:` / MediaSource / empty source (YouTube, Udemy, …) falls back to the page URL (`location.href`). YouTube embeds (`/embed/ID`) are turned into a normal `watch?v=ID` link.
4. **Copy** with `clipboardData.setData('text/plain', …)` + `preventDefault()`, falling back to `navigator.clipboard.writeText`.
5. Optionally show a short "Video link copied" toast (rendered in a shadow DOM so page styles can't affect it).

## Settings

Stored in `chrome.storage.sync`, so they follow your Chrome profile:

| Setting | Default | Effect |
| --- | --- | --- |
| Enabled | on | Master switch. |
| Include timestamp | off | Appends the current time: `?t=123s` on YouTube, `#t=123` elsewhere. On a page URL that already uses its hash for routing (e.g. `#/lesson/3`), the timestamp is skipped so the link keeps working. |
| Show toast | on | Shows the ~1.5 s confirmation toast. |

## Permissions

Only `storage`. The content script matches `<all_urls>` so it can work on any site with a video; it reads nothing and sends nothing anywhere.

## Limitations

- Each frame handles its own copy. If the video is in a cross-origin iframe, click into the player first so that frame has focus when you press Ctrl+C.
- Videos inside *closed* shadow roots can't be seen by extensions.
- Some sites (like Udemy) give you the page URL, not a direct file, because the video is streamed through a `blob:` URL.

## Files

```
Exscriptor/
  manifest.json   Extension manifest (MV3)
  content.js      Copy handling, video picking, link building, toast
  popup.html      Settings popup
  popup.js        Popup ↔ chrome.storage.sync binding
  popup.css       Popup styles (light and dark)
  Exscriptor.png  App icon (used by the manifest, popup and this README)
  Exscriptor.ico  Windows icon, for shortcuts and branding only (not used by Chrome)
```
