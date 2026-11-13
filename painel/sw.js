// Service worker do painel: só recebe notificações push de prazo. Não guarda páginas nem dados em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: 'Aviso do painel', corpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Aviso do painel', {
    body: d.corpo || '', icon: '/assets/logo-escudo.png', badge: '/assets/logo-escudo.png', tag: d.tag || 'painel', renotify: true, data: { url: d.url || '/painel' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/painel', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const aberta = cs.find((c) => c.url.startsWith(self.location.origin + '/painel'));
    // janela já aberta: foca e leva ao caso do aviso (só muda o #, sem recarregar)
    return aberta ? aberta.focus().then((c) => (c && c.navigate ? c.navigate(url) : c)).catch(() => self.clients.openWindow(url)) : self.clients.openWindow(url);
  }));
});
