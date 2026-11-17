// Este bloque registra el Service Worker para habilitar recursos sin conexión y sincronización.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('Service Worker registrado:', registro.scope);
    })
    .catch((error) => {
      console.log('No se pudo registrar el Service Worker:', error);
    });
}

// Este bloque escucha avisos del Service Worker para volver a mostrar el estado actualizado de la cola.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('El Service Worker sincronizó la bandeja de salida.');
      renderizarColaOutbox();
    }
  });
}

// Esta función refleja el estado de conexión del navegador en el indicador visible.
function actualizarIndicadorRed() {
  const indicador = document.querySelector('#badge-red');
  const estaEnLinea = navigator.onLine;

  indicador.textContent = estaEnLinea ? 'En Línea' : 'Sin Conexión';
  indicador.classList.toggle('online', estaEnLinea);
  indicador.classList.toggle('offline', !estaEnLinea);
}

// Esta función intenta enviar un reporte y conserva una copia sincronizada o pendiente en IndexedDB.
function procesarEnvioReporte(datosFormulario) {
  const direccion = 'https://jsonplaceholder.typicode.com/posts';
  const opciones = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  };

  return fetch(direccion, opciones)
    .then((respuesta) => {
      if (!respuesta.ok) {
        throw new Error('El servidor rechazó el reporte: ' + respuesta.status);
      }
    })
    .then(() => guardarRegistro({
      titulo: datosFormulario.titulo,
      descripcion: datosFormulario.descripcion,
      estado: 'sincronizado',
      fechaCreacion: Date.now()
    }), (error) => {
      console.warn('El reporte queda pendiente porque no se pudo enviar:', error);
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      }).then(() => {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          return navigator.serviceWorker.ready.then((registro) => {
            return registro.sync.register('sync-reportes');
          });
        }
      });
    })
    .then(() => renderizarColaOutbox());
}

// Esta función reconstruye la lista desde IndexedDB y usa textContent para tratar los datos como texto.
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros().then((registros) => {
    const lista = document.querySelector('#lista-outbox');
    lista.textContent = '';

    registros.forEach((registro) => {
      const elemento = document.createElement('li');
      const detalle = document.createElement('div');
      const titulo = document.createElement('strong');
      const descripcion = document.createElement('p');
      const hora = document.createElement('small');
      const estado = document.createElement('span');
      const estaSincronizado = registro.estado === 'sincronizado';

      elemento.className = estaSincronizado
        ? 'elemento-outbox sincronizado'
        : 'elemento-outbox';
      detalle.className = 'detalle-incidencia';
      titulo.textContent = registro.titulo;
      descripcion.textContent = registro.descripcion;
      hora.textContent = new Date(registro.fechaCreacion).toLocaleTimeString();
      estado.className = estaSincronizado
        ? 'estado-registro sincronizado'
        : 'estado-registro pendiente';
      estado.textContent = registro.estado;

      detalle.append(titulo, descripcion, hora);
      elemento.append(detalle, estado);
      lista.append(elemento);
    });
  }).catch((error) => {
    console.error('No se pudo mostrar la bandeja de salida:', error);
  });
}

// Esta función reintenta los reportes pendientes cuando no existe Background Sync en el navegador.
function sincronizarPendientesFallback() {
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
          if (respuesta.ok) {
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          }
        });
      });

      return Promise.all(envios).then(() => renderizarColaOutbox());
    })
    .catch((error) => {
      console.error('No se pudieron sincronizar los reportes pendientes:', error);
    });
}

// Al volver la conexión se actualiza el indicador; este control evita POST duplicados en Chrome,
// donde Background Sync ya se encarga de enviar la cola mediante el Service Worker.
window.addEventListener('online', () => {
  actualizarIndicadorRed();
  if (!('SyncManager' in window)) {
    console.log('Background Sync no está disponible; se usa la sincronización de respaldo.');
    sincronizarPendientesFallback();
  }
});

// Al perder la conexión solo se actualiza la etiqueta, porque los reportes se guardan al enviarlos.
window.addEventListener('offline', () => {
  actualizarIndicadorRed();
});

// Este bloque recoge los campos, inicia el envío y limpia el formulario para el siguiente reporte.
document.querySelector('#form-incidencia').addEventListener('submit', (evento) => {
  evento.preventDefault();

  const titulo = document.querySelector('#titulo').value.trim();
  const descripcion = document.querySelector('#descripcion').value.trim();
  procesarEnvioReporte({ titulo, descripcion });
  evento.currentTarget.reset();
});

// Este bloque elimina solo los reportes ya sincronizados y conserva los que aún deben enviarse.
document.querySelector('#btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((registro) => registro.estado === 'sincronizado');
      return Promise.all(sincronizados.map((registro) => eliminarRegistro(registro.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('No se pudieron purgar los reportes sincronizados:', error);
    });
});

// Estas llamadas iniciales muestran conexión y registros existentes, incluso si la app abre sin red.
actualizarIndicadorRed();
renderizarColaOutbox();
