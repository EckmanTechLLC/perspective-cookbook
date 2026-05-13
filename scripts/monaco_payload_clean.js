(function () {
  var VIEW_PATH = 'cookbook/Monaco_Demo';
  var CDN_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

  function getView() {
    var views = Array.from(window.__client.page.views.values());
    return views.find(function (x) { return x.resourcePath === VIEW_PATH; }) || views[0];
  }

  // jinja2 has no native Monaco language — twig is the closest ({{ }} template engine)
  function monacoLangFor(lang) {
    if (lang === 'jinja2') { return 'twig'; }
    return lang;
  }

  function initEditor() {
    var v = getView();
    if (!v || v.__monacoEditorInited) { return; }
    v.__monacoEditorInited = true;

    var container = document.getElementById('monaco-container');
    if (!container) { return; }

    var initialCode = v.custom.read('code') || '';
    var initialLang = v.params.read('language') || 'sql';
    var initialTheme = v.params.read('theme') || 'vs-dark';
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
        }
      });
      monaco.editor.setModelMarkers(model, 'monaco-demo-linter', markers);
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
      v.custom.write('code', editor.getValue());
      runLinter();
    });

    // Perspective -> Editor: react to external writes to custom.code
    v.custom.subscribe(function () {
      var ext = v.custom.read('code');
      if (typeof ext === 'string' && editor.getValue() !== ext) {
        editor.setValue(ext);
      }
    });

    // Perspective -> Editor: react to params.language / params.theme changes
    v.params.subscribe(function () {
      var lang = v.params.read('language') || 'sql';
      var theme = v.params.read('theme') || 'vs-dark';
      var model = editor.getModel();
      if (model && lang !== currentLang) {
        currentLang = lang;
        monaco.editor.setModelLanguage(model, monacoLangFor(lang));
        runLinter();
      }
      if (theme !== currentTheme) {
        currentTheme = theme;
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
        v.params.write('language', lang);
        var model = editor.getModel();
        if (model) { monaco.editor.setModelLanguage(model, monacoLangFor(lang)); }
        currentLang = lang;
        runLinter();
      };
    }
    var ts = document.getElementById('monaco-theme-select');
    if (ts) {
      ts.value = initialTheme;
      ts.onchange = function () {
        var theme = ts.value;
        v.params.write('theme', theme);
        monaco.editor.setTheme(theme);
        currentTheme = theme;
      };
    }

    window.__monacoEditor = editor;
    runLinter();
  }

  // Monaco already loaded from a prior render cycle — skip CDN fetch
  if (typeof monaco !== 'undefined') {
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
  }

  // Inject Monaco loader.js once per page; poll if already injecting
  if (document.getElementById('monaco-loader')) {
    var waitId = setInterval(function () {
      if (typeof monaco !== 'undefined') {
        clearInterval(waitId);
        initEditor();
      }
    }, 80);
    return;
  }
  var script = document.createElement('script');
  script.id = 'monaco-loader';
  script.src = CDN_BASE + '/loader.js';
  script.onload = function () {
    require.config({ paths: { vs: CDN_BASE } });
    require(['vs/editor/editor.main'], initEditor);
  };
  script.onerror = function () {
    var el = document.getElementById('monaco-container');
    if (el) {
      el.innerHTML = '<p style="color:#f88;padding:20px;font-family:monospace;font-size:13px">'
        + '⚠ Monaco CDN load failed — check network/firewall.<br>'
        + 'CDN: ' + CDN_BASE + '</p>';
    }
  };
  document.head.appendChild(script);
})();
