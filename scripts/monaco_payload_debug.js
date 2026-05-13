(function () {
  var TAG = '[MonacoDemo]';
  var VIEW_PATH = 'cookbook/Monaco_Demo';
  var CDN_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';
  console.log(TAG, 'onload fired', new Date().toISOString());

  function getView() {
    var views = Array.from(window.__client.page.views.values());
    console.log(TAG, 'views count:', views.length);
    views.forEach(function (x) {
      console.log(TAG, '  resourcePath:', x.resourcePath, '| mountPath:', x.mountPath);
    });
    var v = views.find(function (x) { return x.resourcePath === VIEW_PATH; }) || views[0];
    if (v) { console.log(TAG, 'using view:', v.resourcePath); }
    else { console.warn(TAG, 'no view found — page.views may not be populated yet'); }
    return v;
  }

  // jinja2 has no native Monaco language — twig is the closest ({{ }} template engine)
  function monacoLangFor(lang) {
    if (lang === 'jinja2') {
      console.log(TAG, 'mapping jinja2 -> twig (nearest Monaco equivalent)');
      return 'twig';
    }
    return lang;
  }

  function initEditor() {
    var v = getView();
    if (!v) { console.error(TAG, 'initEditor: no view — aborting'); return; }
    if (v.__monacoEditorInited) {
      console.log(TAG, 'initEditor: already inited on this view store — skipping');
      return;
    }
    v.__monacoEditorInited = true;
    console.log(TAG, 'initEditor: starting');

    var container = document.getElementById('monaco-container');
    if (!container) { console.error(TAG, 'no #monaco-container element'); return; }

    var initialCode = v.custom.read('code') || '';
    var initialLang = v.params.read('language') || 'sql';
    var initialTheme = v.params.read('theme') || 'vs-dark';
    console.log(TAG, 'initialCode length:', initialCode.length, '| lang:', initialLang, '| theme:', initialTheme);

    var currentLang = initialLang;
    var currentTheme = initialTheme;

    container.innerHTML = '';
    var editor = monaco.editor.create(container, {
      value: initialCode,
      language: monacoLangFor(initialLang),
      theme: initialTheme,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on'
    });
    console.log(TAG, 'monaco.editor.create() complete');

    // Custom SQL linter: flag SELECT * as a warning (demonstrates setModelMarkers API).
    // JSON validation is automatic when language='json'.
    function lintSQL(model) {
      var markers = [];
      model.getValue().split('\n').forEach(function (line, i) {
        if (/SELECT\s+\*/i.test(line)) {
          var col = line.search(/\*/i) + 1;
          markers.push({
            severity: monaco.MarkerSeverity.Warning,
            message: 'Avoid SELECT * — list column names explicitly',
            startLineNumber: i + 1, startColumn: col,
            endLineNumber: i + 1, endColumn: col + 1
          });
          console.log(TAG, 'lintSQL: SELECT * found at line', i + 1);
        }
      });
      monaco.editor.setModelMarkers(model, 'monaco-demo-linter', markers);
      console.log(TAG, 'lintSQL: markers set:', markers.length);
    }

    function runLinter() {
      var model = editor.getModel();
      if (!model) { return; }
      var lang = v.params.read('language') || 'sql';
      if (lang === 'sql') { lintSQL(model); }
      else { monaco.editor.setModelMarkers(model, 'monaco-demo-linter', []); }
    }

    // Editor -> Perspective: write editor content to view.custom.code on every change
    editor.onDidChangeModelContent(function () {
      var val = editor.getValue();
      console.log(TAG, 'onDidChangeModelContent: writing', val.length, 'chars to custom.code');
      v.custom.write('code', val);
      runLinter();
    });

    // Perspective -> Editor: react to external writes to custom.code
    v.custom.subscribe(function () {
      var ext = v.custom.read('code');
      if (typeof ext === 'string' && editor.getValue() !== ext) {
        console.log(TAG, 'custom.subscribe: external code change detected, calling setValue');
        editor.setValue(ext);
      }
    });

    // Perspective -> Editor: react to params.language / params.theme changes
    v.params.subscribe(function () {
      var lang = v.params.read('language') || 'sql';
      var theme = v.params.read('theme') || 'vs-dark';
      console.log(TAG, 'params.subscribe: lang=', lang, 'theme=', theme);
      var model = editor.getModel();
      if (model && lang !== currentLang) {
        currentLang = lang;
        var mLang = monacoLangFor(lang);
        console.log(TAG, 'setModelLanguage ->', mLang);
        monaco.editor.setModelLanguage(model, mLang);
        runLinter();
      }
      if (theme !== currentTheme) {
        currentTheme = theme;
        console.log(TAG, 'setTheme ->', theme);
        monaco.editor.setTheme(theme);
      }
      // Keep HTML selects in sync with Perspective params
      var ls = document.getElementById('monaco-lang-select');
      if (ls && ls.value !== lang) { ls.value = lang; }
      var ts = document.getElementById('monaco-theme-select');
      if (ts && ts.value !== theme) { ts.value = theme; }
    });

    // HTML select -> Perspective params (bidirectional bridge)
    var ls = document.getElementById('monaco-lang-select');
    if (ls) {
      ls.value = initialLang;
      ls.onchange = function () {
        var lang = ls.value;
        console.log(TAG, 'lang select changed ->', lang);
        v.params.write('language', lang);
        var model = editor.getModel();
        if (model) { monaco.editor.setModelLanguage(model, monacoLangFor(lang)); }
        currentLang = lang;
        runLinter();
      };
    } else { console.warn(TAG, '#monaco-lang-select not found'); }

    var ts = document.getElementById('monaco-theme-select');
    if (ts) {
      ts.value = initialTheme;
      ts.onchange = function () {
        var theme = ts.value;
        console.log(TAG, 'theme select changed ->', theme);
        v.params.write('theme', theme);
        monaco.editor.setTheme(theme);
        currentTheme = theme;
      };
    } else { console.warn(TAG, '#monaco-theme-select not found'); }

    window.__monacoEditor = editor;
    console.log(TAG, 'initEditor: done — editor at window.__monacoEditor');
    runLinter();
  }

  // Monaco already loaded from a prior render cycle — skip CDN fetch
  if (typeof monaco !== 'undefined') {
    console.log(TAG, 'monaco already loaded (re-render) — calling initEditor directly');
    initEditor();
    return;
  }

  // Inject Monaco CSS once per page
  if (!document.getElementById('monaco-css')) {
    var link = document.createElement('link');
    link.id = 'monaco-css';
    link.rel = 'stylesheet';
    link.href = CDN_BASE + '/editor/editor.main.css';
    document.head.appendChild(link);
    console.log(TAG, 'injected monaco CSS');
  }

  // Inject Monaco loader.js once per page; poll if already injecting
  if (document.getElementById('monaco-loader')) {
    console.log(TAG, 'loader already in DOM — polling for monaco global');
    var waitId = setInterval(function () {
      if (typeof monaco !== 'undefined') {
        clearInterval(waitId);
        console.log(TAG, 'poll: monaco ready');
        initEditor();
      }
    }, 80);
    return;
  }

  console.log(TAG, 'injecting monaco loader.js from CDN:', CDN_BASE);
  var script = document.createElement('script');
  script.id = 'monaco-loader';
  script.src = CDN_BASE + '/loader.js';
  script.onload = function () {
    console.log(TAG, 'loader.js loaded — calling require');
    require.config({ paths: { vs: CDN_BASE } });
    require(['vs/editor/editor.main'], function () {
      console.log(TAG, 'vs/editor/editor.main loaded — calling initEditor');
      initEditor();
    });
  };
  script.onerror = function () {
    console.error(TAG, 'Monaco CDN load FAILED');
    var el = document.getElementById('monaco-container');
    if (el) {
      el.innerHTML = '<p style="color:#f88;padding:20px;font-family:monospace;font-size:13px">'
        + '⚠ Monaco CDN load failed — check network/firewall.<br>'
        + 'CDN: ' + CDN_BASE + '</p>';
    }
  };
  document.head.appendChild(script);
})();
