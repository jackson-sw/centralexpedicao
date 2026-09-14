const CACHE_NAME = 'expedicao-shell-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Chamadas de API: sempre tenta a rede primeiro (dados dinâmicos).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ erro: 'Sem conexão com o servidor.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Página principal (index.html / navegação): tenta a rede primeiro.
  // Motivo: esta é a página que carrega TODO o código do app (é um
  // arquivo único, sem JS/CSS separados) — se ela ficar presa no
  // cache-first, uma correção feita e publicada no servidor pode não
  // aparecer no celular por dias, mesmo depois de reabrir o app,
  // porque o service worker segue servindo a versão antiga em cache
  // enquanto ela responder rápido o bastante. Isso já causou mais de
  // um "a correção não funcionou" que na real era só cache velho. Cai
  // pro cache somente se a rede falhar (uso offline).
  const ehPaginaPrincipal = event.request.mode === 'navigate'
    || url.pathname === '/' || url.pathname.endsWith('/index.html');

  if (ehPaginaPrincipal) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Demais arquivos (ícones, manifest): cache-first, com atualização em
  // segundo plano — mudam raramente, então não há motivo pra esperar a
  // rede toda vez.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
