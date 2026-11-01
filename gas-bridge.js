/**
 * GAS google.script.run 호환 어댑터 (GitHub Pages 프론트용)
 * - Index.html 안의 google.script.run.withSuccessHandler(..).withFailureHandler(..).함수명(인자..) 호출을
 *   수정 없이 GAS 웹앱 doPost 로 fetch(POST, text/plain) 전송한다. (text/plain 이라 CORS 사전요청이 없다)
 * - 서버 주소는 페이지가 window.GAS_API_URL 로 지정한다.
 * - google.script.url.getLocation 도 일반 URL 파라미터 읽기로 대체한다.
 */
(function () {
  var TIMEOUT_MS = 120000;

  // ── 읽기 호출 묶기 ──
  // 화면이 처음 열릴 때처럼 같은 순간에 몰리는 "읽기 전용" 호출은 서버 실행 1번(서버 batchCall)으로 묶어 보낸다.
  // 호출마다 서버 실행이 따로 생기면 Apps Script 동시 실행 한도(30)에 쉽게 닿기 때문이다. 이 목록은 서버 BATCHABLE_FUNCS_ 와 같아야 한다.
  // 서버가 batchCall 을 모르거나 묶음 요청이 실패하면 호출마다 개별 요청으로 자동 복귀한다(기능은 그대로).
  var BATCHABLE = { getApplicationStatus: 1, getBasicInfo: 1, getConsentTexts: 1, getCurrentUserGreeting: 1, getGalleryData: 1, getGalleryPermission: 1,
    getLatestNews: 1, getNoticeData: 1, getRegionDataVersion: 1, getRegionSwitchList: 1, getSheetData: 1, getTodayNewsBriefing: 1, validateMemberSession: 1 };
  var BATCH_WINDOW_MS = 40;   // 이 시간 안에 들어온 호출을 한 묶음으로 본다
  var BATCH_MAX = 15;         // 서버 BATCH_MAX_CALLS_ 와 같다
  var queue = [], flushTimer = null, batchSupported = true;
  var stats = window.__gasBridgeStats = { batches: 0, batched: 0, singles: 0, fallbacks: 0 }; // 점검용(개발자도구에서 확인)

  function deliverOk(item, result) {
    if (item.onOk) { try { item.onOk(result, item.userObj); } catch (x) { console.error(x); } }
  }
  function deliverFail(item, err) {
    var e = err instanceof Error ? err : new Error(String(err));
    if (item.onFail) { try { item.onFail(e, item.userObj); } catch (x) { console.error(x); } }
    else console.error('[gas-bridge] ' + item.fn + ' 실패:', e);
  }

  // 서버에 요청 1건을 보낸다(공통). onOk(result) / onFail(Error). label 은 개발자도구 Network 목록에 보이는 이름 뒤에 붙는 설명
  function rpc(fn, args, onOk, onFail, label) {
    var url = window.GAS_API_URL;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var done = false;

    function fail(err) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer);
      onFail(err instanceof Error ? err : new Error(String(err)));
    }
    function ok(result) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer);
      onOk(result);
    }

    if (!url) { fail(new Error('서버 주소가 설정되지 않았습니다.')); return; }

    // 주소 뒤에 함수 이름을 붙인다(서버는 무시). 개발자도구 Network 목록에서 어떤 호출인지 바로 구분하기 위한 용도
    var target = url + (url.indexOf('?') === -1 ? '?' : '&') + 'fn=' + encodeURIComponent(fn) + (label ? '&calls=' + encodeURIComponent(label) : '');
    fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('서버 응답을 해석할 수 없습니다.'); }
      if (!data || data.ok !== true) throw new Error((data && data.error) || '서버 오류');
      ok(data.result);
    }).catch(function (err) {
      fail(err && err.name === 'AbortError' ? new Error('서버 응답 시간이 초과되었습니다.') : err);
    });
  }

  function sendSingle(item) {
    stats.singles++;
    rpc(item.fn, item.args, function (r) { deliverOk(item, r); }, function (e) { deliverFail(item, e); });
  }

  function sendBatch(items) {
    stats.batches++; stats.batched += items.length;
    var names = items.map(function (it) { return it.fn; }).join(',');
    rpc('batchCall', [items.map(function (it) { return { fn: it.fn, args: it.args }; })], function (results) {
      for (var i = 0; i < items.length; i++) {
        var r = results && results[i];
        if (r && r.ok === true) deliverOk(items[i], r.result);
        else deliverFail(items[i], new Error((r && r.error) || '서버 오류'));
      }
    }, function (err) {
      // 묶음 요청 자체가 실패: 서버가 batchCall 을 모르면 이후로는 묶지 않고, 어떤 경우든 호출을 개별 요청으로 다시 보낸다
      if (String(err && err.message).indexOf('허용되지 않은 요청') !== -1) batchSupported = false;
      stats.fallbacks++;
      items.forEach(sendSingle);
    }, names);
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    while (queue.length) {
      var items = queue.splice(0, BATCH_MAX);
      if (items.length === 1) sendSingle(items[0]); else sendBatch(items);
    }
  }

  function callServer(fn, args, onOk, onFail, userObj) {
    var item = { fn: fn, args: args, onOk: onOk, onFail: onFail, userObj: userObj };
    if (batchSupported && BATCHABLE[fn] === 1 && window.GAS_API_URL) {
      queue.push(item);
      if (queue.length >= BATCH_MAX) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
      return;
    }
    sendSingle(item);
  }

  function makeRunner(onOk, onFail, userObj) {
    return new Proxy({}, {
      get: function (_, name) {
        if (typeof name !== 'string') return undefined;
        if (name === 'withSuccessHandler') return function (f) { return makeRunner(f, onFail, userObj); };
        if (name === 'withFailureHandler') return function (f) { return makeRunner(onOk, f, userObj); };
        if (name === 'withUserObject') return function (o) { return makeRunner(onOk, onFail, o); };
        return function () { callServer(name, Array.prototype.slice.call(arguments), onOk, onFail, userObj); };
      }
    });
  }

  function getLocation(cb) {
    var parameter = {}, parameters = {};
    new URLSearchParams(location.search).forEach(function (v, k) {
      parameter[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    cb({ hash: location.hash ? location.hash.slice(1) : '', parameter: parameter, parameters: parameters });
  }

  window.google = window.google || {};
  window.google.script = {
    run: makeRunner(null, null, undefined),
    url: { getLocation: getLocation }
  };
})();
