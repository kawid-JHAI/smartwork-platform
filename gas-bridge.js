/**
 * GAS google.script.run 호환 어댑터 (GitHub Pages 프론트용)
 * - Index.html 안의 google.script.run.withSuccessHandler(..).withFailureHandler(..).함수명(인자..) 호출을
 *   수정 없이 GAS 웹앱 doPost 로 fetch(POST, text/plain) 전송한다. (text/plain 이라 CORS 사전요청이 없다)
 * - 서버 주소는 페이지가 window.GAS_API_URL 로 지정한다.
 * - google.script.url.getLocation 도 일반 URL 파라미터 읽기로 대체한다.
 */
(function () {
  var TIMEOUT_MS = 120000;

  function callServer(fn, args, onOk, onFail, userObj) {
    var url = window.GAS_API_URL;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var done = false;

    function fail(err) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer);
      var e = err instanceof Error ? err : new Error(String(err));
      if (onFail) { try { onFail(e, userObj); } catch (x) { console.error(x); } }
      else console.error('[gas-bridge] ' + fn + ' 실패:', e);
    }
    function ok(result) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer);
      if (onOk) { try { onOk(result, userObj); } catch (x) { console.error(x); } }
    }

    if (!url) { fail(new Error('서버 주소가 설정되지 않았습니다.')); return; }

    fetch(url, {
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
