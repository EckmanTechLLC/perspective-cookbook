// Gateway RPC Library -- window.__gw  v1.1
// Path B: tag read/write and named queries via WebDev wrapper endpoints.
// See docs/recipes/gateway-rpc.md for usage and deployment instructions.
// See docs/protocol/perspective-ws.md for the WS protocol reference.
//
// Transport (Path B -- verified working on stock Ignition 8.3):
//   readTag       -> GET  /system/webdev/cookbook/tag_read?path=<encoded>
//   writeTag      -> POST /system/webdev/cookbook/tag_write          {path, value}
//   runNamedQuery -> POST /system/webdev/cookbook/named_query_run    {path, params}
//
// Research helpers (Path A -- WS protocol research, see Probe 3b backlog):
//   hookWS / captures / onCapture / clearCaptures / sendRaw / getWS
//
// Usage:
//   window.__gw.readTag('[default]cookbook/test_value').then(console.log)
//   window.__gw.writeTag('[default]cookbook/test_value', 42).then(console.log)
//   window.__gw.runNamedQuery('cookbook/test_query', {}).then(console.log)
//   window.__gw.hookWS()                // install WS capture hooks
//   window.__gw.captures                // array of {dir, frame, ts} objects
//   window.__gw.onCapture(fn)           // subscribe to new captures
//   window.__gw.sendRaw('type:{...}')   // send a raw WS frame
//   window.__gw.clearCaptures()         // empty the capture array

(function () {
  'use strict';
  if (window.__gw) { return; }

  var captures = [];
  var _pendingListeners = [];
  var _onCaptureCallbacks = [];

  // ---------------------------------------------------------------------------
  // WS ACCESS (research helper -- not used by Path B operations)
  // ---------------------------------------------------------------------------

  function getWS() {
    try { return window.__client.connection.webSocket; }
    catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // WS HOOKS -- patches ws.send and listens for incoming messages
  // Used by the capture panel in the demo view and by sendRaw.
  // ---------------------------------------------------------------------------

  function hookWS() {
    var ws = getWS();
    if (!ws || ws._gwHooked) { return ws; }
    ws._gwHooked = true;

    var origSend = ws.send.bind(ws);
    ws.send = function (data) {
      var s = String(data);
      captures.push({ dir: 'out', frame: s, ts: Date.now() });
      _fireCaptureCallbacks('out', s);
      return origSend(s);
    };

    ws.addEventListener('message', function (evt) {
      if (typeof evt.data === 'string') {
        var s = evt.data;
        captures.push({ dir: 'in', frame: s, ts: Date.now() });
        _fireCaptureCallbacks('in', s);
        _dispatchIncoming(s);
      }
    });

    console.log('[gw] WS hooked. Capturing outgoing + incoming frames.');
    return ws;
  }

  function _fireCaptureCallbacks(dir, frame) {
    _onCaptureCallbacks.forEach(function (fn) {
      try { fn(dir, frame); } catch (e) {}
    });
  }

  // Parse incoming frames and resolve any pending _sendAndWait listeners
  function _dispatchIncoming(raw) {
    var colon = raw.indexOf(':');
    if (colon === -1) { return; }
    var type = raw.slice(0, colon);
    var payload = null;
    try { payload = JSON.parse(raw.slice(colon + 1)); } catch (e) {}

    _pendingListeners = _pendingListeners.filter(function (l) {
      try {
        if (l.match(type, payload, raw)) {
          clearTimeout(l.timer);
          l.resolve({ type: type, payload: payload, raw: raw });
          return false;
        }
      } catch (e) {}
      return true;
    });
  }

  // Send a WS frame and wait for a response matching matchFn.
  // Used by Probe 3b WS-protocol research; not used by Path B operations.
  function _sendAndWait(frame, matchFn, timeoutMs) {
    return new Promise(function (resolve, reject) {
      hookWS();
      var ws = getWS();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return reject(new Error(
          '[gw] WebSocket not open (readyState=' + (ws ? ws.readyState : 'null') + ')'
        ));
      }
      var timer = setTimeout(function () {
        _pendingListeners = _pendingListeners.filter(function (l) {
          return l.resolve !== resolve;
        });
        reject(new Error(
          '[gw] 10 s timeout -- no matching response from gateway.\n' +
          'Frame sent: ' + frame + '\n' +
          'Check window.__gw.captures for all WS traffic.'
        ));
      }, timeoutMs || 10000);
      _pendingListeners.push({ match: matchFn, resolve: resolve, reject: reject, timer: timer });
      ws.send(frame);
    });
  }

  // ---------------------------------------------------------------------------
  // TAG READ (WebDev wrapper)
  // GET /system/webdev/cookbook/tag_read?path=<encoded>
  // Calls system.tag.readBlocking on the gateway side.
  // ---------------------------------------------------------------------------

  function readTag(tagPath) {
    var url = '/system/webdev/cookbook/tag_read?path=' + encodeURIComponent(tagPath);
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          throw new Error('[gw] readTag: ' + data.error);
        }
        return {
          value: data.value,
          quality: data.quality,
          timestamp: data.timestamp,
          _raw: data
        };
      });
  }

  // ---------------------------------------------------------------------------
  // TAG WRITE (WebDev wrapper)
  // POST /system/webdev/cookbook/tag_write  body: {"path":"...","value":...}
  // Calls system.tag.writeBlocking on the gateway side.
  // ---------------------------------------------------------------------------

  function writeTag(tagPath, value) {
    return fetch('/system/webdev/cookbook/tag_write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tagPath, value: value })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          throw new Error('[gw] writeTag: ' + data.error);
        }
        return data;
      });
  }

  // ---------------------------------------------------------------------------
  // NAMED QUERY (WebDev wrapper)
  // POST /system/webdev/cookbook/named_query_run  body: {"path":"...","params":{...}}
  // Calls system.db.runNamedQuery on the gateway side.
  // path: query path within the cookbook project (e.g. "test_query" or "cookbook/test_query")
  // Returns: {ok:true, columns:[...], data:[{col:val,...},...], rowCount:N}
  // ---------------------------------------------------------------------------

  function runNamedQuery(queryPath, params) {
    return fetch('/system/webdev/cookbook/named_query_run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: queryPath, params: params || {} })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          throw new Error('[gw] runNamedQuery: ' + data.error);
        }
        return data;
      });
  }

  // ---------------------------------------------------------------------------
  // SEND RAW -- send an arbitrary pre-formatted WS frame
  // ---------------------------------------------------------------------------

  function sendRaw(frame) {
    hookWS();
    var ws = getWS();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('[gw] sendRaw: WebSocket not open');
    }
    ws.send(frame);
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  window.__gw = {
    // Core operations (Path B -- WebDev endpoints)
    readTag: readTag,
    writeTag: writeTag,
    runNamedQuery: runNamedQuery,

    // WS research helpers (Path A -- Probe 3b)
    sendRaw: sendRaw,
    hookWS: hookWS,
    getWS: getWS,
    onCapture: function (fn) { _onCaptureCallbacks.push(fn); },
    captures: captures,
    clearCaptures: function () { captures.length = 0; },

    version: '1.1'
  };

  hookWS();
  console.log(
    '[gw] v1.1 -- window.__gw ready.\n' +
    '  readTag           : GET  /system/webdev/cookbook/tag_read\n' +
    '  writeTag          : POST /system/webdev/cookbook/tag_write\n' +
    '  runNamedQuery     : POST /system/webdev/cookbook/named_query_run\n' +
    '  hookWS / captures : WS frame capture (research helper)'
  );
})();
