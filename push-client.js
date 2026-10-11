/**
 * 알림(푸시) 설정 모듈 - GitHub 화면 전용 (GAS 화면에는 포함되지 않음)
 * - 로그인한 회원/관리자에게만 헤더에 🔔 버튼을 보여 주고, 눌러서 알림 받기를 켜고 끄며 받을 종류를 고른다.
 * - 페이지가 window.PUSH_CONFIG = { firebase:{...}, vapidKey, region } 를 먼저 지정해야 한다.
 * - Firebase SDK는 처음 켤 때만 불러온다(첫 화면 속도에 영향 없음).
 */
(function () {
  var CFG = window.PUSH_CONFIG;
  if (!CFG) return;

  var SDK_VER = '10.14.1';
  var TYPES = [
    { key: 'notice', icon: '📢', label: '공지사항' },
    { key: 'training', icon: '🎓', label: '교육 접수' },
    { key: 'gallery', icon: '📷', label: '새 활동사진' },
    { key: 'news', icon: '📰', label: '뉴스 브리핑' },
    { key: 'msg', icon: '✉️', label: '중앙협회 쪽지', adminOnly: true }
  ];
  var LS_TOKEN = 'kawid_push_token_' + CFG.region;
  var LS_PREFS = 'kawid_push_prefs_' + CFG.region;

  var supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var state = { loggedIn: false, isMember: true, canMsg: false, token: '', prefs: null, messaging: null, btn: null };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function toast(m) { try { if (typeof showToast === 'function') showToast(m); else alert(m); } catch (e) { } }
  function authToken() { try { return typeof authToken_ === 'function' ? authToken_() : ''; } catch (e) { return ''; } }
  function call(fn, args) {
    return new Promise(function (resolve, reject) {
      var r = window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      r[fn].apply(r, args);
    });
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('알림 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }
  function ensureMessaging() {
    if (state.messaging) return Promise.resolve(state.messaging);
    var base = 'https://www.gstatic.com/firebasejs/' + SDK_VER + '/';
    return loadScript(base + 'firebase-app-compat.js')
      .then(function () { return loadScript(base + 'firebase-messaging-compat.js'); })
      .then(function () {
        if (!window.firebase.apps.length) window.firebase.initializeApp(CFG.firebase);
        state.messaging = window.firebase.messaging();
        // 앱이 열려 있는 동안 도착한 알림은 화면 안 안내로 보여 준다
        state.messaging.onMessage(function (p) {
          var d = (p && p.data) || {};
          toast((d.title || '알림') + (d.body ? ' - ' + d.body : ''));
        });
        return state.messaging;
      });
  }

  // ---------------- 버튼과 설정 창 ----------------
  function ensureButton() {
    if (state.btn) return state.btn;
    var anchor = document.getElementById('btnSfxToggle');
    if (!anchor || !anchor.parentNode) return null;
    var b = document.createElement('button');
    b.id = 'btnPushSettings';
    b.type = 'button';
    b.title = '알림 설정';
    b.setAttribute('aria-label', '알림 설정');
    b.className = 'hidden relative w-9 h-9 flex items-center justify-center rounded-none bg-secondary/10 hover:bg-secondary/20 text-secondary transition-colors';
    b.innerHTML = '<span class="material-symbols-outlined text-[18px]" id="pushBellIcon">notifications</span>';
    b.onclick = openPanel;
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
    state.btn = b;
    return b;
  }
  function refreshBellIcon() {
    var icon = document.getElementById('pushBellIcon');
    if (!icon) return;
    var on = !!ls(LS_TOKEN) && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    icon.textContent = on ? 'notifications_active' : 'notifications_off';
  }

  function closePanel() {
    var m = document.getElementById('pushPanel');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function openPanel() {
    closePanel();
    var token = ls(LS_TOKEN);
    var subscribed = !!token && Notification.permission === 'granted';
    var prefs = state.prefs || { notice: true, training: true, gallery: true, news: true, msg: true };
    var blocked = Notification.permission === 'denied';
    var needHome = isIOS && !standalone;

    var rows = TYPES.filter(function (t) { return !t.adminOnly || state.canMsg; }).map(function (t) {
      return '<label class="flex items-center gap-3 py-2.5 border-b border-slate-100 cursor-pointer">' +
        '<input type="checkbox" data-pk="' + t.key + '" ' + (prefs[t.key] !== false ? 'checked' : '') + ' class="w-4 h-4" />' +
        '<span class="text-lg leading-none">' + t.icon + '</span><span class="text-sm font-semibold text-slate-700">' + esc(t.label) + '</span></label>';
    }).join('');

    var note = blocked ? '<p class="text-xs text-red-600 mt-3">이 사이트의 알림이 브라우저에서 차단되어 있습니다. 주소창 왼쪽 자물쇠 → 알림 허용으로 바꿔 주세요.</p>' :
      needHome ? '<p class="text-xs text-amber-700 mt-3">아이폰은 앱을 <b>홈 화면에 추가</b>한 뒤 그 앱에서 열어야 알림을 받을 수 있습니다. (Safari 공유 버튼 → 홈 화면에 추가)</p>' : '';

    var wrap = document.createElement('div');
    wrap.id = 'pushPanel';
    wrap.className = 'fixed inset-0 z-[9998] flex items-end sm:items-center justify-center bg-black/50';
    wrap.innerHTML = '<div class="bg-white w-full sm:max-w-sm p-5 pb-6 max-h-[90vh] overflow-y-auto">' +
      '<div class="flex items-center justify-between mb-1"><h3 class="font-bold text-lg text-primary">🔔 알림 설정</h3>' +
      '<button type="button" id="pushClose" class="w-8 h-8 text-slate-400 text-xl leading-none" aria-label="닫기">✕</button></div>' +
      '<p class="text-xs text-slate-500 mb-3">이 기기로 받을 알림을 고르세요.' + (subscribed ? ' <b class="text-green-600">현재 켜져 있습니다.</b>' : '') + '</p>' +
      rows + note +
      '<div class="flex gap-2 mt-4">' +
      '<button type="button" id="pushSave" class="flex-1 h-11 bg-secondary text-white font-bold text-sm">' + (subscribed ? '설정 저장' : '알림 켜기') + '</button>' +
      (subscribed ? '<button type="button" id="pushOff" class="h-11 px-4 bg-slate-100 text-slate-600 font-bold text-sm">끄기</button>' : '') +
      '</div></div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closePanel(); });
    document.body.appendChild(wrap);
    document.getElementById('pushClose').onclick = closePanel;
    document.getElementById('pushSave').onclick = function () { save(wrap); };
    var off = document.getElementById('pushOff');
    if (off) off.onclick = function () { turnOff(); };

    // 서버에 저장된 설정을 불러와 반영(켜져 있을 때)
    if (subscribed) {
      call('pushGetPrefs', [CFG.region, token, authToken()]).then(function (r) {
        if (r && r.success && r.subscribed) {
          state.prefs = r.prefs; state.canMsg = !!r.canMsg;
          Array.prototype.forEach.call(wrap.querySelectorAll('input[data-pk]'), function (c) { c.checked = r.prefs[c.getAttribute('data-pk')] !== false; });
        }
      }).catch(function () { });
    }
  }

  function readChecks(wrap) {
    var p = {};
    Array.prototype.forEach.call(wrap.querySelectorAll('input[data-pk]'), function (c) { p[c.getAttribute('data-pk')] = c.checked; });
    return p;
  }

  function save(wrap) {
    var btn = document.getElementById('pushSave');
    var prefs = readChecks(wrap);
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    var fail = function (e) {
      if (btn) { btn.disabled = false; btn.textContent = '다시 시도'; }
      toast('알림 설정에 실패했습니다: ' + (e && e.message ? e.message : e));
    };
    if (isIOS && !standalone) { fail(new Error('아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다.')); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.');
      return Promise.all([ensureMessaging(), navigator.serviceWorker.ready]);
    }).then(function (arr) {
      return arr[0].getToken({ vapidKey: CFG.vapidKey, serviceWorkerRegistration: arr[1] });
    }).then(function (tk) {
      if (!tk) throw new Error('알림 주소를 받지 못했습니다.');
      state.token = tk;
      return call('pushRegister', [CFG.region, tk, prefs, authToken()]).then(function (r) {
        if (!r || !r.success) throw new Error((r && r.error) || '서버 저장 실패');
        ls(LS_TOKEN, tk); ls(LS_PREFS, JSON.stringify(r.prefs));
        state.prefs = r.prefs; state.canMsg = !!r.canMsg;
        refreshBellIcon(); closePanel();
        toast('🔔 알림이 설정되었습니다.');
      });
    }).catch(fail);
  }

  function turnOff() {
    var token = ls(LS_TOKEN);
    call('pushUnregister', [CFG.region, token || '', authToken()]).catch(function () { }).then(function () {
      var done = function () { ls(LS_TOKEN, null); ls(LS_PREFS, null); state.prefs = null; refreshBellIcon(); closePanel(); toast('알림을 껐습니다.'); };
      if (state.messaging && state.messaging.deleteToken) state.messaging.deleteToken().then(done, done); else done();
    });
  }

  // 로그인 직후: 이미 켜 둔 기기는 서버 구독 정보를 조용히 갱신(로그인 계정과 구독을 다시 연결)
  function silentRefresh() {
    var token = ls(LS_TOKEN);
    if (!token || Notification.permission !== 'granted') return;
    var saved = null;
    try { saved = JSON.parse(ls(LS_PREFS) || 'null'); } catch (e) { }
    call('pushRegister', [CFG.region, token, saved || {}, authToken()]).then(function (r) {
      if (r && r.success) { state.prefs = r.prefs; state.canMsg = !!r.canMsg; }
    }).catch(function () { });
  }

  window.PushUI = {
    onLogin: function (isMember) {
      if (!supported) return;
      state.loggedIn = true; state.isMember = !!isMember;
      var b = ensureButton();
      if (!b) return;
      b.classList.remove('hidden');
      refreshBellIcon();
      silentRefresh();
    },
    onLogout: function () {
      state.loggedIn = false;
      if (state.btn) state.btn.classList.add('hidden');
      closePanel();
    }
  };
})();
