(function () {
  var LOG = '[D3Demo]';
  function log() {
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, [LOG].concat(args));
    var el = document.getElementById('d3-debug');
    if (el) {
      var line = document.createElement('div');
      line.textContent = new Date().toISOString().slice(11, 23) + ' ' + args.join(' ');
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  }

  log('onload fired — starting D3 Demo init');

  function run() {
    log('run() — d3 available:', typeof d3 !== 'undefined');
    var views = Array.from(window.__client.page.views.values());
    log('views count:', views.length);
    views.forEach(function (vv, i) {
      log('  view[' + i + '] mountPath=' + vv.mountPath + ' resourcePath=' + vv.resourcePath);
    });
    var v = views.find(function (x) { return x.resourcePath === 'cookbook/D3_Demo'; }) || views[0];
    if (!v) { log('ERROR: no view found'); return; }

    var data = v.custom.read('chartData');
    log('chartData:', typeof data, Array.isArray(data) ? 'length=' + data.length : '(not array)');

    renderChart(data, v);

    if (!v.__d3SubInited) {
      v.__d3SubInited = true;
      log('subscribing to custom changes');
      v.custom.subscribe(function () {
        var newData = v.custom.read('chartData');
        log('custom changed — re-rendering, length:', newData ? newData.length : 'null');
        renderChart(newData, v);
      });
    } else {
      log('subscribe already set — skipping duplicate');
    }
  }

  if (typeof d3 !== 'undefined') {
    log('D3 already loaded (version:', d3.version + ')');
    run();
  } else {
    log('D3 not loaded — injecting script tag');
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/d3@7';
    s.onload = function () { log('D3 loaded (version:', d3.version + ')'); run(); };
    s.onerror = function () {
      log('ERROR: D3 script load failed');
      var el = document.getElementById('d3-chart');
      if (el) { el.innerHTML = '<p style="color:#f88;padding:16px;font-family:monospace">D3 load failed — check CDN/network</p>'; }
    };
    document.head.appendChild(s);
  }

  function renderChart(data, v) {
    log('renderChart() — data length:', data ? data.length : 'null');
    var container = document.getElementById('d3-chart');
    if (!container) { log('ERROR: #d3-chart not found'); return; }
    container.innerHTML = '';
    if (!data || !Array.isArray(data) || !data.length) {
      container.innerHTML = '<p style="color:#aaa;padding:16px;font-family:monospace">No chart data.</p>';
      return;
    }
    var margin = { top: 20, right: 30, bottom: 55, left: 60 };
    var W = container.clientWidth || 600;
    var H = container.clientHeight || 360;
    var w = W - margin.left - margin.right;
    var h = H - margin.top - margin.bottom;
    log('svg dims W=' + W + ' H=' + H + ' w=' + w + ' h=' + h);

    var svg = d3.select(container).append('svg')
      .attr('width', W).attr('height', H)
      .append('g')
      .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var x = d3.scaleTime()
      .domain(d3.extent(data, function (d) { return new Date(d.ts); }))
      .range([0, w]);

    var yMin = d3.min(data, function (d) { return d.value; });
    var yMax = d3.max(data, function (d) { return d.value; });
    var pad = Math.max((yMax - yMin) * 0.1, 1);
    var y = d3.scaleLinear().domain([yMin - pad, yMax + pad]).range([h, 0]);

    log('y domain: [' + (yMin - pad).toFixed(2) + ', ' + (yMax + pad).toFixed(2) + ']');

    svg.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).tickSize(-w).tickFormat(''))
      .call(function (g) {
        g.selectAll('.tick line').attr('stroke', '#334').attr('stroke-dasharray', '3,3');
        g.select('.domain').remove();
      });

    svg.append('path').datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#4db6ac')
      .attr('stroke-width', 1.5)
      .attr('d', d3.line()
        .x(function (d) { return x(new Date(d.ts)); })
        .y(function (d) { return y(d.value); }));

    var selUid = v.params.read('selectedRunUid') || '';
    log('selectedRunUid on render:', selUid || '(none)');

    svg.selectAll('.dot').data(data).enter().append('circle')
      .attr('class', 'dot')
      .attr('cx', function (d) { return x(new Date(d.ts)); })
      .attr('cy', function (d) { return y(d.value); })
      .attr('r', 5)
      .attr('fill', function (d) { return d.uid === selUid ? '#ff7043' : '#26c6da'; })
      .attr('stroke', '#1a1a2e').attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseover', function () { d3.select(this).attr('r', 8); })
      .on('mouseout', function () { d3.select(this).attr('r', 5); })
      .on('click', function (event, d) {
        log('click uid=' + d.uid + ' value=' + d.value);
        v.params.write('selectedRunUid', d.uid);
        d3.selectAll('.dot').attr('fill', '#26c6da');
        d3.select(this).attr('fill', '#ff7043');
        var lbl = document.getElementById('d3-selected');
        if (lbl) { lbl.textContent = 'Selected: ' + d.uid + '  —  ts=' + new Date(d.ts).toISOString() + '  value=' + d.value.toFixed(2); }
      });

    svg.append('g')
      .attr('transform', 'translate(0,' + h + ')')
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%m/%d %H:%M')))
      .call(function (g) {
        g.selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end').attr('fill', '#99aabb');
        g.selectAll('.tick line').attr('stroke', '#445566');
        g.select('.domain').attr('stroke', '#445566');
      });

    svg.append('g').call(d3.axisLeft(y).ticks(6))
      .call(function (g) {
        g.selectAll('text').attr('fill', '#99aabb');
        g.selectAll('.tick line').attr('stroke', '#445566');
        g.select('.domain').attr('stroke', '#445566');
      });

    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -(h / 2)).attr('y', -45)
      .attr('text-anchor', 'middle')
      .attr('fill', '#99aabb').style('font-size', '11px')
      .text('Value');

    log('renderChart() complete');
  }
})();
