// Estos nombres reúnen la configuración de la base y evitan repetir valores distintos.
const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// Esta función abre IndexedDB y crea el almacén solo cuando la base se crea por primera vez.
function abrirDB() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(DB_NAME, DB_VERSION);

    solicitud.onupgradeneeded = () => {
      const base = solicitud.result;
      if (!base.objectStoreNames.contains(STORE_NAME)) {
        base.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
  });
}

// Esta función agrega un reporte y espera el fin de la transacción para devolver su identificador.
function guardarRegistro(datos) {
  return abrirDB().then((base) => {
    return new Promise((resolve, reject) => {
      const transaccion = base.transaction(STORE_NAME, 'readwrite');
      const almacen = transaccion.objectStore(STORE_NAME);
      const solicitud = almacen.add(datos);
      let idGuardado;

      solicitud.onsuccess = () => {
        idGuardado = solicitud.result;
      };
      solicitud.onerror = () => reject(solicitud.error);
      transaccion.oncomplete = () => resolve(idGuardado);
      transaccion.onerror = () => reject(transaccion.error);
    });
  });
}

// Esta función lee todos los reportes para que la página y el Service Worker compartan la misma cola.
function obtenerTodosLosRegistros() {
  return abrirDB().then((base) => {
    return new Promise((resolve, reject) => {
      const transaccion = base.transaction(STORE_NAME, 'readonly');
      const solicitud = transaccion.objectStore(STORE_NAME).getAll();
      let registros = [];

      solicitud.onsuccess = () => {
        registros = solicitud.result;
      };
      solicitud.onerror = () => reject(solicitud.error);
      transaccion.oncomplete = () => resolve(registros);
      transaccion.onerror = () => reject(transaccion.error);
    });
  });
}

// Esta función elimina un reporte y confirma la eliminación cuando termina la transacción.
function eliminarRegistro(id) {
  return abrirDB().then((base) => {
    return new Promise((resolve, reject) => {
      const transaccion = base.transaction(STORE_NAME, 'readwrite');
      transaccion.objectStore(STORE_NAME).delete(id);
      transaccion.oncomplete = () => resolve();
      transaccion.onerror = () => reject(transaccion.error);
    });
  });
}

// Esta función cambia el estado dentro de una sola transacción para no separar lectura y escritura.
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((base) => {
    return new Promise((resolve, reject) => {
      const transaccion = base.transaction(STORE_NAME, 'readwrite');
      const almacen = transaccion.objectStore(STORE_NAME);
      const solicitud = almacen.get(id);
      let registroNoEncontrado = false;

      solicitud.onsuccess = () => {
        const registro = solicitud.result;
        if (!registro) {
          registroNoEncontrado = true;
          reject(new Error('No existe el reporte con id ' + id));
          return;
        }

        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        almacen.put(registro);
      };

      solicitud.onerror = () => reject(solicitud.error);
      transaccion.oncomplete = () => {
        if (!registroNoEncontrado) {
          resolve();
        }
      };
      transaccion.onerror = () => reject(transaccion.error);
    });
  });
}
