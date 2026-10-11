self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* 네트워크 그대로 사용 */ });

try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp({"apiKey":"AIzaSyB_smBQaQRNR6-nwqRFZibTak0tG_STAJ8","authDomain":"kawid-smartwork.firebaseapp.com","projectId":"kawid-smartwork","storageBucket":"kawid-smartwork.firebasestorage.app","messagingSenderId":"357229008050","appId":"1:357229008050:web:518d17cb66a89fe053a5ab"});
  var messaging = firebase.messaging();
  // 종류별 알림 모양(진동 패턴, 버튼 이름). 제목의 아이콘 글자와 사진은 서버가 정해서 보낸다.
  var LOOK = {
    notice: { vibrate: [200, 100, 200], action: '공지 보기' },
    training: { vibrate: [100, 100, 100, 100, 300], action: '교육 보기' },
    gallery: { vibrate: [300], action: '사진 보기' },
    news: { vibrate: [150, 80, 150], action: '뉴스 보기' },
    msg: { vibrate: [400, 150, 400], action: '쪽지 확인' }
  };
  messaging.onBackgroundMessage(function (payload) {
    var d = (payload && payload.data) || {};
    var look = LOOK[d.type] || LOOK.notice;
    var opts = {
      body: d.body || '',
      icon: '../icons/icon-192.png',
      badge: '../icons/badge-96.png',
      tag: d.tag || d.type || 'smartwork',
      renotify: true,
      vibrate: look.vibrate,
      data: { url: d.url || '' },
      actions: [{ action: 'open', title: look.action }]
    };
    if (d.image) opts.image = d.image;
    return self.registration.showNotification(d.title || '스마트워크 알림', opts);
  });
} catch (e) { /* 알림 모듈을 못 불러와도 앱 설치 기능은 그대로 동작 */ }

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
        return c.focus().then(function (w) { return w.navigate ? w.navigate(url) : w; });
      }
    }
    return self.clients.openWindow(url);
  }));
});
