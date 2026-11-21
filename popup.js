/*
 * Exscriptor — popup.
 * Binds the three toggles to chrome.storage.sync. The content scripts pick up
 * changes live through storage.onChanged, so no messaging is needed.
 */
'use strict';

// Must match DEFAULTS in content.js.
const DEFAULTS = Object.freeze({
  enabled: true,
  includeTimestamp: false,
  showToast: true,
});

const inputs = Object.fromEntries(
  Object.keys(DEFAULTS).map((key) => [key, document.getElementById(key)])
);

/** Dims the secondary options while the extension is disabled. */
function syncDisabledState() {
  document.body.classList.toggle('is-disabled', !inputs.enabled.checked);
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  for (const [key, input] of Object.entries(inputs)) {
    input.checked = Boolean(stored[key]);
    input.addEventListener('change', () => {
      chrome.storage.sync.set({ [key]: input.checked });
      if (key === 'enabled') syncDisabledState();
    });
  }
  syncDisabledState();
});
