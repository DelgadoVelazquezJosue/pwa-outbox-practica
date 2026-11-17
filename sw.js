importScripts('./db-helper.js');

// Este nombre identifica la versión de los archivos estáticos que el Service Worker guarda en caché.
const CACHE_STATIC_NAME = 'static-outbox-v2';

// Estas rutas relativas permiten cargar la aplicación desde la raíz o un subdirectorio de Pages.
const STATIC_FILES = ['./', './index.html', './styles.css', './db-helper.js', './app.js', './manifest.json'];

// Durante la instalación se guardan los archivos de la interfaz y el Service Worker toma control pronto.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_STATIC_NAME).then((cache) => cache.addAll(STATIC_FILES)));
  self.skipWaiting();
});

// Al activar esta versión se quitan cachés antiguas y se toma control de las páginas abiertas.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombres) => {
        const cachésAntiguas = nombres
          .filter((nombre) => nombre !== CACHE_STATIC_NAME)
          .map((nombre) => caches.delete(nombre));
        return Promise.all(cachésAntiguas);
      })
      .then(() => self.clients.claim())
  );
});

// Las lecturas GET usan primero la caché; las peticiones POST se dejan pasar sin interceptarlas.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((respuestaCacheada) => {
      return respuestaCacheada || fetch(event.request);
    })
  );
});

// Esta función avisa a las ventanas abiertas para que vuelvan a dibujar los reportes sincronizados.
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// Esta función envía la cola pendiente y retorna la cadena para que Background Sync pueda reintentar.
function sincronizarPendientesSW() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((registro) => registro.estado === 'pendiente');
      if (pendientes.length === 0) {
        return;
      }

      const envios = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        }).then((respuesta) => {
          if (!respuesta.ok) {
            throw new Error('Falló el envío del reporte con id ' + item.id);
          }
          return actualizarEstadoRegistro(item.id, 'sincronizado');
        });
      });

      return Promise.all(envios);
    })
    .then(() => notificarClientesActualizacion());
}

// Este evento procesa la etiqueta registrada por la página y propaga el error si falla el envío.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW().catch((error) => {
        console.error('Falló la sincronización en segundo plano:', error);
        // El throw informa el fallo al navegador para que programe un reintento automático.
        throw error;
      })
    );
  }
});
