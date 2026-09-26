const CACHE_NAME = 'rasp-cache-v1';
const ASSETS = ['/', '/index.html'];

// Сохраняем единственную страницу в кэш при установке
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Удаляем старый кэш, если ты обновишь версию
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

// Логика: пытаемся загрузить свежее из сети. Если интернета нет — мгновенно отдаем из кэша
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
