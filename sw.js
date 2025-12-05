// Service Worker for Metube App
const CACHE_NAME = 'metube-v1';
const OFFLINE_CACHE = 'metube-offline-v1';

// कैश करने के लिए रिसोर्सेज
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-192x192.png',
  '/assets/default-thumbnail.jpg',
  '/assets/default-avatar.jpg',
  '/assets/logo.png'
];

// इंस्टॉल इवेंट
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Install completed');
        return self.skipWaiting();
      })
  );
});

// एक्टिवेट इवेंट
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  
  // पुराने कैशेज क्लीन करें
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== OFFLINE_CACHE) {
            console.log('Service Worker: Clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('Service Worker: Activation completed');
      return self.clients.claim();
    })
  );
});

// फेच इवेंट
self.addEventListener('fetch', event => {
  const request = event.request;
  
  // नेटवर्क फर्स्ट स्ट्रेटेजी
  event.respondWith(
    fetch(request)
      .then(response => {
        // सक्सेसफुल रिस्पॉन्स को कैश करें
        if (request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        // ऑफलाइन होने पर कैश से सर्व करें
        console.log('Service Worker: Offline mode, serving from cache');
        
        // विडियो रिक्वेस्ट के लिए अलग हैंडलिंग
        if (request.url.includes('.mp4') || request.url.includes('video')) {
          return caches.match('/assets/demo-video1.mp4')
            .then(videoResponse => {
              return videoResponse || new Response('Offline - Video not available', {
                status: 404,
                headers: { 'Content-Type': 'text/plain' }
              });
            });
        }
        
        // नॉर्मल रिक्वेस्ट्स
        return caches.match(request)
          .then(response => {
            return response || caches.match('/index.html');
          });
      })
  );
});

// सिंक इवेंट (बैकग्राउंड सिंक)
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync', event.tag);
  
  if (event.tag === 'sync-videos') {
    event.waitUntil(syncOfflineVideos());
  }
});

// ऑफलाइन वीडियो सिंक (डेमो)
function syncOfflineVideos() {
  console.log('Service Worker: Syncing offline videos');
  // फेज 2 में इम्प्लीमेंट करेंगे
  return Promise.resolve();
}

// पुश नोटिफिकेशन
self.addEventListener('push', event => {
  console.log('Service Worker: Push notification received');
  
  const options = {
    body: 'Metube: नए वीडियो अपलोड हुए हैं!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: 'https://metube.com'
    },
    actions: [
      {
        action: 'watch',
        title: 'देखें'
      },
      {
        action: 'close',
        title: 'बंद करें'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Metube चाइना', options)
  );
});

// नोटिफिकेशन क्लिक
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notification clicked');
  
  event.notification.close();
  
  if (event.action === 'watch') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
