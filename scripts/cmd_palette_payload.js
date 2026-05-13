(function () {
  // Guard: register once per page load (docked view may re-render, listener must not stack)
  if (window.__cmdPaletteInited) { return; }
  window.__cmdPaletteInited = true;

  var OVERLAY_ID = 'cmd-palette-overlay';

  // ===== UTILITIES =====

  function getClient() { return window.__client; }

  function getViews() {
    try {
      return Array.from(getClient().page.views.values());
    } catch (e) {
      try { return Object.values(getClient().page.views._data || {}); }
      catch (e2) { return []; }
    }
  }

  function navigateTo(resourcePath) {
    var proj = getClient().projectName || 'cookbook';
    // resourcePath may include project prefix (e.g. 'cookbook/MyView') -- strip it
    // so we never double up the project segment in the URL.
    var view = resourcePath;
    var pfx = proj + '/';
    if (view.indexOf(pfx) === 0) { view = view.slice(pfx.length); }
    // Use window.location.origin for a reliable absolute URL.
    // history.push is avoided: Perspective's router treats it as relative to its
    // basename (/data/perspective/client/<proj>), which doubled the path.
    window.location.href =
      window.location.origin + '/data/perspective/client/' + proj + '/' + view;
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
      'background:#333;color:#fff;padding:8px 16px;border-radius:4px;' +
      'z-index:10001;font-size:13px;font-family:monospace;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;white-space:nowrap';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }, 3000);
  }

  // ===== COMMAND REGISTRY =====
  // Add custom commands via: window.__cmdPalette.addCommand({id, label, description, action})

  var REGISTRY = [
    {
      id: 'dump-views',
      label: 'Dump page.views to Console',
      description: 'Print all open view stores (mountPath + resourcePath) to browser console',
      action: function () {
        var views = getViews();
        console.group('[CmdPalette] page.views (' + views.length + ' view(s))');
        views.forEach(function (v, i) {
          console.log('[' + i + ']', 'mountPath=' + v.mountPath,
            ' resourcePath=' + v.resourcePath);
        });
        console.groupEnd();
        showToast('Dumped ' + views.length + ' view(s) -- see console');
      }
    },
    {
      id: 'toggle-theme',
      label: 'Toggle Theme (Dark / Light)',
      description: 'Switch the Perspective session theme between dark and light',
      action: function () {
        var applied = false;
        try {
          var sp = getClient().page.sessionProps;
          if (sp && typeof sp.read === 'function') {
            var cur = sp.read('theme');
            var nxt = (cur === 'dark') ? 'light' : 'dark';
            sp.write('theme', nxt);
            showToast('Theme: ' + nxt);
            applied = true;
          }
        } catch (e) {}
        if (!applied) {
          // Fallback: toggle CSS classes on body
          var body = document.body;
          var wasDark = body.classList.contains('dark') ||
                        body.classList.contains('dark-theme') ||
                        body.classList.contains('ia-dark');
          if (wasDark) {
            body.classList.remove('dark', 'dark-theme', 'ia-dark');
            body.classList.add('light', 'light-theme', 'ia-light');
            showToast('Theme: light (CSS fallback)');
          } else {
            body.classList.remove('light', 'light-theme', 'ia-light');
            body.classList.add('dark', 'dark-theme', 'ia-dark');
            showToast('Theme: dark (CSS fallback)');
          }
        }
      }
    },
    {
      id: 'logout',
      label: 'Log Out',
      description: 'End the current Perspective session',
      action: function () {
        try {
          var auth = getClient().auth;
          if (auth && typeof auth.logout === 'function') { auth.logout(); return; }
        } catch (e) {}
        var proj = getClient().projectName || 'cookbook';
        window.location.href = '/data/perspective/logout/' + proj;
      }
    },
    {
      id: 'reload',
      label: 'Reload Session',
      description: 'Hard-reload the current browser page',
      action: function () { window.location.reload(); }
    },
    {
      id: 'read-tag',
      label: 'Read Tag...  [stub - task-11]',
      description: 'Read a gateway tag value -- gateway RPC library (task-11) required',
      action: function () {
        console.warn('[CmdPalette] Read Tag: task-11 gateway RPC not yet available');
        showToast('Read Tag: task-11 RPC library needed');
      }
    },
    {
      id: 'write-tag',
      label: 'Set Tag...   [stub - task-11]',
      description: 'Write a value to a gateway tag -- gateway RPC library (task-11) required',
      action: function () {
        console.warn('[CmdPalette] Set Tag: task-11 gateway RPC not yet available');
        showToast('Set Tag: task-11 RPC library needed');
      }
    },
    {
      id: 'run-query',
      label: 'Run Named Query...  [stub - task-11]',
      description: 'Execute a gateway named query -- gateway RPC library (task-11) required',
      action: function () {
        console.warn('[CmdPalette] Run Named Query: task-11 gateway RPC not yet available');
        showToast('Run Named Query: task-11 RPC library needed');
      }
    }
  ];

  // Build full command list: static registry + one dynamic entry per open view
  function buildCommands() {
    var cmds = REGISTRY.slice();
    getViews().forEach(function (view) {
      var rp = view.resourcePath;
      if (!rp) { return; }
      cmds.push({
        id: 'goto-' + rp,
        label: 'Go to view: ' + rp,
        description: 'Navigate to ' + rp + ' (current session)',
        action: (function (path) {
          return function () { navigateTo(path); };
        })(rp)
      });
    });
    return cmds;
  }

  // ===== FUZZY FILTER =====
  // Scores by first-occurrence index in label (lower = better match start),
  // falls back to description match (offset by 10000 so label matches always win).
  function fuzzyFilter(query, commands) {
    if (!query || !query.trim()) { return commands; }
    var q = query.trim().toLowerCase();
    var scored = [];
    commands.forEach(function (cmd) {
      var li = cmd.label.toLowerCase().indexOf(q);
      var di = cmd.description.toLowerCase().indexOf(q);
      if (li !== -1) {
        scored.push({ cmd: cmd, score: li });
      } else if (di !== -1) {
        scored.push({ cmd: cmd, score: di + 10000 });
      }
    });
    scored.sort(function (a, b) { return a.score - b.score; });
    return scored.map(function (s) { return s.cmd; });
  }

  // ===== THEME DETECTION =====
  function isDark() {
    try {
      var bg = getComputedStyle(document.body).backgroundColor;
      var m = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m) { return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 128; }
    } catch (e) {}
    return !!(window.matchMedia &&
              window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function makeTheme() {
    var d = isDark();
    return {
      bg:     d ? '#1e1e1e' : '#ffffff',
      fg:     d ? '#d4d4d4' : '#333333',
      hdBg:   d ? '#252526' : '#f3f3f3',
      border: d ? '#3d3d3d' : '#d0d0d0',
      selBg:  d ? '#094771' : '#005fb8',
      selFg:  '#ffffff',
      descFg: d ? '#888888' : '#999999',
      shadow: d ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.22)'
    };
  }

  // ===== PALETTE STATE =====
  var palOverlay = null;
  var palSelIdx = 0;
  var palCmds = [];
  var palTh = null;

  // ===== PALETTE DOM =====
  function openPalette() {
    if (document.getElementById(OVERLAY_ID)) { closePalette(); return; }

    palTh = makeTheme();
    var th = palTh;

    // Backdrop
    palOverlay = document.createElement('div');
    palOverlay.id = OVERLAY_ID;
    palOverlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;' +
      'background:rgba(0,0,0,0.45);' +
      'display:flex;align-items:flex-start;justify-content:center;' +
      'padding-top:80px;box-sizing:border-box';

    // Modal card
    var modal = document.createElement('div');
    modal.style.cssText =
      'background:' + th.bg + ';' +
      'border:1px solid ' + th.border + ';' +
      'border-radius:8px;' +
      'width:640px;max-width:92vw;' +
      'overflow:hidden;' +
      'display:flex;flex-direction:column;' +
      'box-shadow:0 8px 32px ' + th.shadow + ';' +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    // Header: icon + search input + ESC hint
    var hdr = document.createElement('div');
    hdr.style.cssText =
      'display:flex;align-items:center;gap:10px;' +
      'padding:12px 16px;' +
      'border-bottom:1px solid ' + th.border + ';' +
      'background:' + th.hdBg;

    var icon = document.createElement('span');
    icon.textContent = '>';
    icon.style.cssText =
      'color:' + th.descFg + ';font-size:14px;font-weight:bold;' +
      'font-family:monospace;flex-shrink:0;user-select:none';

    var input = document.createElement('input');
    input.id = 'cmd-palette-input';
    input.type = 'text';
    input.placeholder = 'Type a command or search...';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.style.cssText =
      'flex:1;background:transparent;border:none;outline:none;' +
      'color:' + th.fg + ';font-size:14px;font-family:inherit;line-height:1.5';

    var escKey = document.createElement('kbd');
    escKey.textContent = 'ESC';
    escKey.style.cssText =
      'font-size:10px;padding:2px 5px;border-radius:3px;flex-shrink:0;' +
      'background:' + th.hdBg + ';color:' + th.descFg + ';font-family:monospace;' +
      'border:1px solid ' + th.descFg + ';cursor:default;user-select:none';

    hdr.appendChild(icon);
    hdr.appendChild(input);
    hdr.appendChild(escKey);

    // Results list
    var list = document.createElement('div');
    list.id = 'cmd-palette-list';
    list.style.cssText = 'overflow-y:auto;max-height:400px;padding:6px 0';

    // Footer: keyboard hints
    var ftr = document.createElement('div');
    ftr.style.cssText =
      'padding:6px 16px;border-top:1px solid ' + th.border + ';' +
      'font-size:11px;color:' + th.descFg + ';' +
      'display:flex;gap:14px;user-select:none;flex-wrap:wrap';
    // HTML entities only -- no non-ASCII bytes in source
    ftr.innerHTML =
      '<span>&#8593;&#8595; navigate</span>' +
      '<span>&#9166; select</span>' +
      '<span>Ctrl+K  toggle</span>';

    modal.appendChild(hdr);
    modal.appendChild(list);
    modal.appendChild(ftr);
    palOverlay.appendChild(modal);
    document.body.appendChild(palOverlay);

    palCmds = buildCommands();
    palSelIdx = 0;
    renderList(list);

    // Filter on typing (input event only -- keydown handled at document level)
    input.addEventListener('input', function () {
      palCmds = fuzzyFilter(input.value, buildCommands());
      palSelIdx = 0;
      renderList(list);
    });

    // Click backdrop to close
    palOverlay.addEventListener('click', function (e) {
      if (e.target === palOverlay) { closePalette(); }
    });

    // Autofocus the search input; retry once in case Perspective fights us
    requestAnimationFrame(function () {
      input.focus();
      setTimeout(function () { input.focus(); }, 80);
    });
  }

  function renderList(list) {
    var th = palTh;
    list.innerHTML = '';
    if (!palCmds.length) {
      var empty = document.createElement('div');
      empty.textContent = 'No commands match.';
      empty.style.cssText =
        'padding:20px;text-align:center;color:' + th.descFg + ';font-size:13px';
      list.appendChild(empty);
      return;
    }
    palCmds.forEach(function (cmd, i) {
      var row = document.createElement('div');
      row.setAttribute('data-idx', String(i));
      var sel = (i === palSelIdx);
      row.style.cssText =
        'padding:8px 20px;cursor:pointer;border-radius:4px;margin:1px 6px;' +
        'display:flex;flex-direction:column;gap:2px;' +
        'background:' + (sel ? th.selBg : 'transparent');

      var lbl = document.createElement('div');
      lbl.textContent = cmd.label;
      // pointer-events:none so the ROW (not lbl/dsc) is always the click target
      lbl.style.cssText =
        'font-size:13px;font-weight:500;pointer-events:none;color:' +
        (sel ? th.selFg : th.fg);

      var dsc = document.createElement('div');
      dsc.textContent = cmd.description;
      dsc.style.cssText =
        'font-size:11px;pointer-events:none;color:' +
        (sel ? 'rgba(255,255,255,0.72)' : th.descFg);

      row.appendChild(lbl);
      row.appendChild(dsc);

      // FIX: do NOT call renderList() from mouseover -- it destroys the DOM
      // nodes mid click-sequence (mousedown fires on old node, mouseup on new
      // node, browser drops the click).  Update styles in-place instead.
      row.addEventListener('mouseover', function () {
        if (palSelIdx === i) { return; }
        var prev = list.querySelector('[data-idx="' + palSelIdx + '"]');
        if (prev) {
          prev.style.background = 'transparent';
          var pk = prev.children;
          if (pk[0]) { pk[0].style.color = palTh.fg; }
          if (pk[1]) { pk[1].style.color = palTh.descFg; }
        }
        palSelIdx = i;
        row.style.background = palTh.selBg;
        var rk = row.children;
        if (rk[0]) { rk[0].style.color = palTh.selFg; }
        if (rk[1]) { rk[1].style.color = 'rgba(255,255,255,0.72)'; }
      });

      row.addEventListener('click', function () { runCmd(cmd); });

      list.appendChild(row);
    });
  }

  function scrollToSel(list) {
    var el = list.querySelector('[data-idx="' + palSelIdx + '"]');
    if (el) { el.scrollIntoView({ block: 'nearest' }); }
  }

  function runCmd(cmd) {
    closePalette();
    setTimeout(function () {
      try { cmd.action(); }
      catch (e) {
        console.error('[CmdPalette] Command error:', e);
        showToast('Error: ' + e.message);
      }
    }, 60);
  }

  function closePalette() {
    var el = document.getElementById(OVERLAY_ID);
    if (el && el.parentNode) { el.parentNode.removeChild(el); }
    palOverlay = null;
  }

  // ===== GLOBAL KEYBOARD LISTENER =====
  // Capture phase (true): fires before Perspective's own handlers and before
  // the focused element's handlers, so palette nav works even if the search
  // input loses focus (e.g. Perspective stealing it back).
  document.addEventListener('keydown', function (e) {
    // --- Open / toggle ---
    if (e.ctrlKey && !e.altKey) {
      var k = e.key;
      if (k === 'k' || k === 'K' ||
          (e.shiftKey && (k === 'p' || k === 'P'))) {
        e.preventDefault();
        e.stopPropagation();
        openPalette();
        return;
      }
    }

    // --- Palette navigation (only when palette is open) ---
    if (!document.getElementById(OVERLAY_ID)) { return; }
    var listEl = document.getElementById('cmd-palette-list');

    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closePalette();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (palCmds[palSelIdx]) { runCmd(palCmds[palSelIdx]); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      palSelIdx = Math.min(palSelIdx + 1, palCmds.length - 1);
      if (listEl) { renderList(listEl); scrollToSel(listEl); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      palSelIdx = Math.max(palSelIdx - 1, 0);
      if (listEl) { renderList(listEl); scrollToSel(listEl); }
    }
  }, true);

  // ===== PUBLIC API =====
  window.__cmdPalette = {
    open:       openPalette,
    close:      closePalette,
    // Append a command at runtime:
    //   window.__cmdPalette.addCommand({id:'x', label:'X', description:'...', action: fn})
    addCommand: function (cmd) { REGISTRY.push(cmd); }
  };

  console.log('[CmdPalette] v1.0 registered -- Ctrl+K or Ctrl+Shift+P to open');
})();
