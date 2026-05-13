(function () {
  var VIEW_PATH = 'cookbook/Pyodide_Demo';
  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';

  var LOG = '[pyodide-debug]';

  function getView() {
    var views = Array.from(window.__client.page.views.values());
    console.log(LOG, 'views count:', views.length,
      views.map(function (v) { return v.resourcePath + '@' + v.mountPath; }));
    return views.find(function (x) { return x.resourcePath === VIEW_PATH; }) || views[0];
  }

  function setStatus(msg, color) {
    console.log(LOG, 'status:', msg);
    var el = document.getElementById('pyodide-status');
    if (el) { el.textContent = msg; el.style.color = color || '#9a9a9a'; }
  }

  function setOutput(text, isError) {
    console.log(LOG, 'output (isError=' + isError + '):', text.substring(0, 200));
    var el = document.getElementById('pyodide-output');
    if (el) { el.textContent = text; el.style.color = isError ? '#f48771' : '#d4d4d4'; }
  }

  function renderChart(data) {
    console.log(LOG, 'renderChart rows:', data ? data.length : 0,
      data && data.length ? 'keys=' + Object.keys(data[0]).join(',') : '');
    var container = document.getElementById('pyodide-chart');
    if (!container || !data || !Array.isArray(data) || !data.length) {
      console.log(LOG, 'renderChart: missing container or empty data');
      return;
    }
    container.innerHTML = '';
    var W = container.clientWidth || 580;
    var H = 180;
    var pad = { top: 16, right: 16, bottom: 28, left: 46 };
    var w = W - pad.left - pad.right;
    var h = H - pad.top - pad.bottom;
    var keys = Object.keys(data[0]).filter(function (k) { return typeof data[0][k] === 'number'; });
    console.log(LOG, 'renderChart: numeric keys', keys);
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
    var pts = data.map(function (d) { return scX(+d[xKey]) + ',' + scY(+d[yKey]); }).join(' ');
    var pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', pts); pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#4db6ac'); pl.setAttribute('stroke-width', '2');
    svg.appendChild(pl);
    if (data[0].rolling !== undefined) {
      console.log(LOG, 'renderChart: drawing rolling avg series');
      var pts2 = data.map(function (d) { return scX(+d[xKey]) + ',' + scY(+d.rolling); }).join(' ');
      var pl2 = document.createElementNS(ns, 'polyline');
      pl2.setAttribute('points', pts2); pl2.setAttribute('fill', 'none');
      pl2.setAttribute('stroke', '#ff8a65'); pl2.setAttribute('stroke-width', '1.5');
      pl2.setAttribute('stroke-dasharray', '5,3');
      svg.appendChild(pl2);
    }
    data.forEach(function (d) {
      var c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', scX(+d[xKey])); c.setAttribute('cy', scY(+d[yKey]));
      c.setAttribute('r', '3'); c.setAttribute('fill', '#26c6da');
      c.setAttribute('stroke', '#152030'); c.setAttribute('stroke-width', '1');
      svg.appendChild(c);
    });
    var xStep = Math.max(1, Math.floor(data.length / 6));
    for (var xi = 0; xi < data.length; xi += xStep) {
      var xt = document.createElementNS(ns, 'text');
      xt.setAttribute('x', scX(+data[xi][xKey])); xt.setAttribute('y', pad.top + h + 16);
      xt.setAttribute('text-anchor', 'middle'); xt.setAttribute('fill', '#6a7a8a');
      xt.setAttribute('font-size', '9'); xt.textContent = data[xi][xKey];
      svg.appendChild(xt);
    }
    var xa = document.createElementNS(ns, 'line');
    xa.setAttribute('x1', pad.left); xa.setAttribute('x2', pad.left + w);
    xa.setAttribute('y1', pad.top + h); xa.setAttribute('y2', pad.top + h);
    xa.setAttribute('stroke', '#445566'); svg.appendChild(xa);
    var ya = document.createElementNS(ns, 'line');
    ya.setAttribute('x1', pad.left); ya.setAttribute('x2', pad.left);
    ya.setAttribute('y1', pad.top); ya.setAttribute('y2', pad.top + h);
    ya.setAttribute('stroke', '#445566'); svg.appendChild(ya);
    container.appendChild(svg);
    console.log(LOG, 'renderChart: SVG appended, W=' + W + ' H=' + H);
  }

  window.__pyodideRenderChart = renderChart;

  async function runPython() {
    console.log(LOG, 'runPython called, pyodide ready:', !!window.pyodide);
    if (!window.pyodide) {
      setOutput('Pyodide not ready - wait for status "Ready"', true);
      return;
    }
    var v = getView();
    var codeEl = document.getElementById('pyodide-code');
    var code = codeEl ? codeEl.value : (v.custom.read('code') || '');
    console.log(LOG, 'code length:', code.length, 'first 80:', code.substring(0, 80));
    v.custom.write('code', code);
    var btn = document.getElementById('pyodide-run-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
    setStatus('Running...', '#ffc107');
    setOutput('Running...', false);
    var result;
    try {
      pyodide.runPython(
        'import io as _io, sys as _sys\n' +
        '_old_stdout = _sys.stdout\n' +
        '_sys.stdout = _io.StringIO()'
      );
      console.log(LOG, 'stdout redirected, calling runPythonAsync...');
      result = await pyodide.runPythonAsync(code);
      console.log(LOG, 'runPythonAsync returned, result type:', typeof result,
        result && result.type ? result.type : '');
      var stdout = pyodide.runPython(
        '_out = _sys.stdout.getvalue()\n' +
        '_sys.stdout = _old_stdout\n' +
        '_out'
      );
      console.log(LOG, 'stdout captured:', stdout ? stdout.substring(0, 200) : '(empty)');
      var output = stdout || '';
      if (result !== undefined && result !== null) {
        var jsResult;
        try {
          jsResult = result && result.toJs
            ? result.toJs({ dict_converter: Object.fromEntries })
            : result;
          if (result && result.destroy) { result.destroy(); }
          console.log(LOG, 'jsResult type:', Array.isArray(jsResult) ? 'array[' + jsResult.length + ']' : typeof jsResult);
        } catch (e2) {
          console.warn(LOG, 'toJs error:', e2.message);
          jsResult = String(result);
        }
        if (Array.isArray(jsResult) && jsResult.length > 0 &&
            jsResult[0] !== null && typeof jsResult[0] === 'object') {
          console.log(LOG, 'result is array-of-objects, writing chartData');
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
      console.error(LOG, 'runPython error:', e.message || e);
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
    console.log(LOG, 'doInit: calling loadPyodide()...');
    setStatus('Loading Pyodide runtime (10-30 MB, first time only)...', '#ffc107');
    try {
      window.pyodide = await loadPyodide();
      console.log(LOG, 'loadPyodide() done, loading packages...');
      setStatus('Installing numpy + pandas...', '#ffc107');
      await pyodide.loadPackage(['numpy', 'pandas']);
      console.log(LOG, 'packages loaded, pyodide ready');
      v.custom.write('pyodideReady', true);
      setStatus('Ready', '#4caf50');
      var btn = document.getElementById('pyodide-run-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    } catch (e) {
      console.error(LOG, 'doInit error:', e.message || e);
      setStatus('Init error: ' + (e.message || e), '#f48771');
      v.custom.write('pyodideReady', false);
      window.__pyodideLoading = false;
    }
  }

  function initPyodide() {
    console.log(LOG, 'initPyodide called, pyodide already loaded:', !!window.pyodide,
      '__pyodideLoading:', !!window.__pyodideLoading);
    var v = getView();
    var codeEl = document.getElementById('pyodide-code');
    if (codeEl) {
      codeEl.value = v.custom.read('code') || '';
      console.log(LOG, 'textarea populated, code length:', codeEl.value.length);
    } else {
      console.warn(LOG, 'pyodide-code textarea not found in DOM');
    }
    if (!v.__pyodideSubInited) {
      v.__pyodideSubInited = true;
      console.log(LOG, 'subscribing to view.custom changes');
      v.custom.subscribe(function () {
        var code = v.custom.read('code') || '';
        var el = document.getElementById('pyodide-code');
        if (el && el.value !== code) {
          console.log(LOG, 'custom.code changed externally, syncing textarea');
          el.value = code;
        }
        var cd = v.custom.read('chartData');
        if (cd && Array.isArray(cd)) {
          console.log(LOG, 'custom.chartData changed, re-rendering chart');
          renderChart(cd);
        }
      });
    }
    if (window.pyodide) {
      console.log(LOG, 'pyodide already loaded, setting ready state');
      v.custom.write('pyodideReady', true);
      setStatus('Ready', '#4caf50');
      var btn = document.getElementById('pyodide-run-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
      return;
    }
    if (window.__pyodideLoading) {
      console.log(LOG, 'CDN script already in-flight, showing loading status');
      setStatus('Loading Pyodide...', '#ffc107');
      return;
    }
    window.__pyodideLoading = true;
    v.custom.write('pyodideReady', false);
    if (typeof loadPyodide !== 'undefined') {
      console.log(LOG, 'loadPyodide already defined, skipping CDN inject');
      doInit(v);
      return;
    }
    console.log(LOG, 'injecting Pyodide CDN script:', PYODIDE_CDN);
    var s = document.createElement('script');
    s.id = 'pyodide-loader';
    s.src = PYODIDE_CDN;
    s.onload = function () {
      console.log(LOG, 'Pyodide CDN script loaded, calling doInit');
      doInit(v);
    };
    s.onerror = function () {
      console.error(LOG, 'Pyodide CDN load FAILED:', PYODIDE_CDN);
      setStatus('Pyodide CDN load failed - check network/firewall', '#f48771');
      window.__pyodideLoading = false;
    };
    document.head.appendChild(s);
    console.log(LOG, 'Pyodide CDN script injected into <head>');
  }

  initPyodide();
})();
