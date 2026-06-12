/*
 * Valor — grid view toggle
 *
 * Lets visitors switch the collection / search product grid between
 * a default layout (the cols_desktop / cols_mobile section settings)
 * and an alternate layout:
 *
 *   desktop: "compact"  — CSS picks a denser auto-fill grid
 *   mobile:  "single"   — CSS collapses to one product per row
 *
 * The chosen view is written as two attributes on every
 * .valor-collection__grid element on the page:
 *
 *   data-grid-view-desktop="default" | "compact"
 *   data-grid-view-mobile="default"  | "single"
 *
 * CSS rules in collection.css react to those attributes inside the
 * matching media queries, so default and alternate values stay
 * isolated to the right viewport.
 *
 * State persists across page loads via localStorage and survives
 * collection/search AJAX refreshes by re-applying on the
 * `valor:collection:refreshed` event that collection.js dispatches
 * after replacing the section markup.
 */

(function () {
  'use strict';

  if (window.ValorGridViewInitialized) return;
  window.ValorGridViewInitialized = true;

  var STORAGE_KEYS = {
    desktop: 'valor:grid-view:desktop',
    mobile: 'valor:grid-view:mobile'
  };

  var DEFAULTS = {
    desktop: 'default',
    mobile: 'default'
  };

  /* Whitelist of valid stored values per viewport. localStorage is
     shared territory — extensions, dev consoles, cross-device sync
     and old theme versions can all leave behind unexpected strings.
     Anything not in this list falls back to the default so the
     toggle UI never ends up in a "no button active" state. */
  var ALLOWED = {
    desktop: ['default', 'compact'],
    mobile: ['default', 'single']
  };

  function readStored(viewport) {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEYS[viewport]);
      if (raw && ALLOWED[viewport].indexOf(raw) !== -1) {
        return raw;
      }
      return DEFAULTS[viewport];
    } catch (err) {
      return DEFAULTS[viewport];
    }
  }

  function writeStored(viewport, value) {
    try {
      window.localStorage.setItem(STORAGE_KEYS[viewport], value);
    } catch (err) {
      /* Private mode or quota exceeded — fall back to in-memory only. */
    }
  }

  function applyViews() {
    var desktopView = readStored('desktop');
    var mobileView = readStored('mobile');

    var grids = document.querySelectorAll('.valor-collection__grid');
    for (var i = 0; i < grids.length; i++) {
      grids[i].setAttribute('data-grid-view-desktop', desktopView);
      grids[i].setAttribute('data-grid-view-mobile', mobileView);
    }

    var buttons = document.querySelectorAll('[data-grid-view-toggle]');
    for (var j = 0; j < buttons.length; j++) {
      var btn = buttons[j];
      var view = btn.getAttribute('data-grid-view-toggle');
      var viewport = btn.getAttribute('data-grid-view-viewport');
      var current = viewport === 'mobile' ? mobileView : desktopView;
      btn.setAttribute('aria-pressed', current === view ? 'true' : 'false');
    }
  }

  function handleClick(event) {
    var btn = event.target.closest && event.target.closest('[data-grid-view-toggle]');
    if (!btn) return;
    event.preventDefault();

    var view = btn.getAttribute('data-grid-view-toggle');
    var viewport = btn.getAttribute('data-grid-view-viewport') || 'desktop';

    writeStored(viewport, view);
    applyViews();
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('valor:collection:refreshed', applyViews);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyViews);
  } else {
    applyViews();
  }
})();
