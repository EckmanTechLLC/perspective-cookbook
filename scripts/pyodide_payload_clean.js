(function () {
  var VIEW_PATH = 'cookbook/Pyodide_Demo';
  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';

  function getView() {
    var views = Array.from(window.__client.page.views.values());
    return views.find(function (x) { return x.resourcePath === VIEW_PATH; }) || views[0];
  }

  function setStatus(msg, color) {
    var el = document.getElementById('pyodide-status');
    if (el) { el.textContent = msg; el.style.color = color || '#9a9a9a'; }
  }

  function setOutput(text, isError) {
    var el = document.getElementById('pyodide-output');
    if (el) { el.textContent = text; el.style.color = isError ? '#f48771' : '#d4d4d4'; }
  }

  // Pure-SVG chart renderer (no D3 dependency).
  // Renders the first two numeric columns of data as x/y.
  // If a 'rolling' key is present it draws a second dashed series.
  function renderChart(data) {
    var container = document.getElementById('pyodide-chart');
    if (!container || !data || !Array.isArray(data) || !data.length) { return; }
    container.innerHTML = '';
    var W = container.clientWidth || 580;
    var H = 180;
    var pad = { top: 16, right: 16, bottom: 28, left: 46 };
    var w = W - pad.left - pad.right;
    var h = H - pad.top - pad.bottom;
    var keys = Object.keys(data[0]).filter(function (k) { return typeof data[0][k] === 'number'; });
    if (!keys.length) {
      container.innerHTML = '<p style="color:#6a7a8a;padding:12px;font-size:11px">No numeric columns in result.</p>';
      return;
    }
    var xKey = keys[0], yKey = keys.length > 1 ? keys[1] : keys[0];
    var xVals = data.map(function (d) { return +d[xKey]; });
    var yVals = data.map(function (d) { return +d[yKey]; });
    var xMin = Math.min.apply(null, xVals), xMax = Math.max.apply(null, xVals);
    var yMin = Math.min.apply(null, yVals), yMax = Math.max.apply(null, yVals);
    var yp = Math.max((yMax - yMin) * 0.12, 1);
    yMin -= yp; yMax += yp;
    function scX(x) { return pad.left + (xMax === xMin ? w / 2 : (x - xMin) / (xMax - xMin) * w); }
    function scY(y) { return pad.top + h - (yMax === yMin ? h / 2 : (y - yMin) / (yMax - yMin) * h); }
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    // Horizontal grid lines + y-axis labels
    for (var gi = 0; gi <= 4; gi++) {
      var gv = yMin + (yMax - yMin) * gi / 4;
      var gl = document.createElementNS(ns, 'line');
      gl.setAttribute('x1', pad.left); gl.setAttribute('x2', pad.left + w);
      gl.setAttribute('y1', scY(gv)); gl.setAttribute('y2', scY(gv));
      gl.setAttribute('stroke', '#2a3a4a'); gl.setAttribute('stroke-dasharray', '3,3');
      svg.appendChild(gl);
      var gt = document.createElementNS(ns, 'text');
      gt.setAttribute('x', pad.left - 4); gt.setAttribute('y', scY(gv) + 3);
      gt.setAttribute('text-anchor', 'end'); gt.setAttribute('fill', '#6a7a8a');
      gt.setAttribute('font-size', '9'); gt.textContent = gv.toFixed(1);
      svg.appendChild(gt);
    }
    // Primary y series (teal polyline)
    var pts = data.map(function (d) { return scX(+d[xKey]) + ',' + scY(+d[yKey]); }).join(' ');
    var pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', pts); pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#4db6ac'); pl.setAttribute('stroke-width', '2');
    svg.appendChild(pl);
    // Optional rolling-average series (orange dashed)
    if (data[0].rolling !== undefined) {
      var pts2 = data.map(function (d) { return scX(+d[xKey]) + ',' + scY(+d.rolling); }).join(' ');
      var pl2 = document.createElementNS(ns, 'polyline');
      pl2.setAttribute('points', pts2); pl2.setAttribute('fill', 'none');
      pl2.setAttribute('stroke', '#ff8a65'); pl2.setAttribute('stroke-width', '1.5');
      pl2.setAttribute('stroke-dasharray', '5,3');
      svg.appendChild(pl2);
    }
    // Dots on primary series
    data.forEach(function (d) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', scX(+d[xKey])); c.setAttribute('cy', scY(+d[yKey]));
      c.setAttribute('r', '3'); c.setAttribute('fill', '#26c6da');
      c.setAttribute('stroke', '#152030'); c.setAttribute('stroke-width', '1');
      svg.appendChild(c);
    });
    // X-axis tick labels (max 6)
    var xStep = Math.max(1, Math.floor(data.length / 6));
    for (var xi = 0; xi < data.length; xi += xStep) {
      var xt = document.createElementNS(ns, 'text');
      xt.setAttribute('x', scX(+data[xi][xKey])); xt.setAttribute('y', pad.top + h + 16);
      xt.setAttribute('text-anchor', 'middle'); xt.setAttribute('fill', '#6a7a8a');
      xt.setAttribute('font-size', '9'); xt.textContent = data[xi][xKey];
      svg.appendChild(xt);
    }
    // Axis lines
    var xa = document.createElementNS(ns, 'line');
    xa.setAttribute('x1', pad.left); xa.setAttribute('x2', pad.left + w);
    xa.setAttribute('y1', pad.top + h); xa.setAttribute('y2', pad.top + h);
    xa.setAttribute('stroke', '#445566'); svg.appendChild(xa);
    var ya = document.createElementNS(ns, 'line');
    ya.setAttribute('x1', pad.left); ya.setAttribute('x2', pad.left);
    ya.setAttribute('y1', pad.top); ya.setAttribute('y2', pad.top + h);
    ya.setAttribute('stroke', '#445566'); svg.appendChild(ya);
    container.appendChild(svg);
  }

  // Exposed globally so onclick handlers survive Perspective re-renders.
  window.__pyodideRenderChart = renderChart;

  async function runPython() {
    if (!window.pyodide) {
      setOutput('Pyodide not ready - wait for status "Ready"', true);
      return;
    }
    var v = getView();
    var codeEl = document.getElementById('pyodide-code');
    var code = codeEl ? codeEl.value : (v.custom.read('code') || '');
    v.custom.write('code', code);
    var btn = document.getElementById('pyodide-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
    setStatus('Running...', '#ffc107');
    setOutput('Running...', false);
    var result;
    try {
      // Redirect stdout to a StringIO buffer to capture print() calls
      pyodide.runPython(
        'import io as _io, sys as _sys\n' +
        '_old_stdout = _sys.stdout\n' +
        '_sys.stdout = _io.StringIO()'
      );
      result = await pyodide.runPythonAsync(code);
      var stdout = pyodide.runPython(
        '_out = _sys.stdout.getvalue()\n' +
        '_sys.stdout = _old_stdout\n' +
        '_out'
      );
      var output = stdout || '';
      // Convert Pyodide proxy -> JS value
      if (result !== undefined && result !== null) {
        var jsResult;
        try {
          jsResult = result && result.toJs
            ? result.toJs({ dict_converter: Object.fromEntries })
            : result;
          if (result && result.destroy) { result.destroy(); }
        } catch (e2) { jsResult = String(result); }
        // Array-of-objects -> chart data
        if (Array.isArray(jsResult) && jsResult.length > 0 &&
            jsResult[0] !== null && typeof jsResult[0] === 'object') {
          v.custom.write('chartData', jsResult);
          renderChart(jsResult);
          output += (output ? '\n' : '') +
            '-> ' + jsResult.length + ' rows returned (chart updated)';
        } else {
          v.custom.write('result', jsResult !== undefined ? jsResult : null);
          try {
            output += (output ? '\n' : '') + '-> ' + JSON.stringify(jsResult);
          } catch (_) { output += '-> [object - not JSON-serializable]'; }
        }
      }
      v.custom.write('output', output || '(no output)');
      setOutput(output || '(no output)', false);
      setStatus('Ready', '#4caf50');
    } catch (e) {
      try { pyodide.runPython('_sys.stdout = _old_stdout'); } catch (_) {}
      if (result && result.destroy) { try { result.destroy(); } catch (_) {} }
      var errMsg = 'Error: ' + (e.message || String(e));
      setOutput(errMsg, true);
      v.custom.write('output', errMsg);
      setStatus('Ready (error in code)', '#f48771');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Run Python'; }
    }
  }

  window.__pyodideRun = runPython;

  async function doInit(v) {
    setStatus('Loading Pyodide runtime (10-30 MB, first time only)...', '#ffc107');
    try {
      window.pyodide = await loadPyodide();
      setStatus('Installing numpy + pandas...', '#ffc107');
      await pyodide.loadPackage(['numpy', 'pandas']);
      v.custom.write('pyodideReady', true);
      setStatus('Ready', '#4caf50');
      var btn = document.getElementById('pyodide-run-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    } catch (e) {
      setStatus('Init error: ' + (e.message || e), '#f48771');
      v.custom.write('pyodideReady', false);
      window.__pyodideLoading = false; // allow retry on next render
    }
  }

  function initPyodide() {
    var v = getView();
    // Populate textarea from view.custom.code on every (re-)render
    var codeEl = document.getElementById('pyodide-code');
    if (codeEl) { codeEl.value = v.custom.read('code') || ''; }
    // Subscribe once per view-store lifetime to sync code + chart
    if (!v.__pyodideSubInited) {
      v.__pyodideSubInited = true;
      v.custom.subscribe(function () {
        var code = v.custom.read('code') || '';
        var el = document.getElementById('pyodide-code');
        if (el && el.value !== code) { el.value = code; }
        var cd = v.custom.read('chartData');
        if (cd && Array.isArray(cd)) { renderChart(cd); }
      });
    }
    // Pyodide already loaded (view re-entered after navigate-away)
    if (window.pyodide) {
      v.custom.write('pyodideReady', true);
      setStatus('Ready', '#4caf50');
      var btn = document.getElementById('pyodide-run-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
      return;
    }
    // CDN <script> already in-flight from a prior render cycle
    if (window.__pyodideLoading) {
      setStatus('Loading Pyodide...', '#ffc107');
      return;
    }
    window.__pyodideLoading = true;
    v.custom.write('pyodideReady', false);
    // loadPyodide already defined (e.g. browser cached the CDN script)
    if (typeof loadPyodide !== 'undefined') { doInit(v); return; }
    var s = document.createElement('script');
    s.id = 'pyodide-loader';
    s.src = PYODIDE_CDN;
    s.onload = function () { doInit(v); };
    s.onerror = function () {
      setStatus('Pyodide CDN load failed - check network/firewall', '#f48771');
      window.__pyodideLoading = false;
    };
    document.head.appendChild(s);
  }

  initPyodide();
})();
