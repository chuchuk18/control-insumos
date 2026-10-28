// =====================================================================
//  Control de Insumos — Frontend (JavaScript vanilla)
// =====================================================================

// ---------- Utilidades ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const fmtNum = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 3 });
const fmtPrecio = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneda = (n) => (n == null ? '—' : `$ ${fmtPrecio.format(n)}`);
const fmtDia = (iso) => (iso ? iso.split('-').reverse().join('/') : '');   // 2026-10-27 → 27/10/2026
const hoyISO = () => {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);   // fecha local
};
const fmtFecha = (iso) =>
  new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const leerLocal = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

// ---------- Conexión con Supabase ----------
// Si se llegó desde un correo de invitación o de recuperación, la URL trae "type=invite|recovery".
const tipoEnlace = new URLSearchParams(location.hash.slice(1)).get('type') || '';
const CONFIG = window.CONFIG || {};
const configurado = /^https:\/\/.+/.test(CONFIG.SUPABASE_URL || '') && (CONFIG.SUPABASE_ANON_KEY || '').length > 30;
const sb = configurado && window.supabase
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

// Traduce los errores de la base a mensajes claros.
function traducirError(error) {
  const msg = String(error?.message || error || '');
  if (msg.includes('STOCK_INSUFICIENTE')) return new Error('Stock insuficiente: alguien retiró antes que vos. Revisá el disponible.');
  if (msg.includes('INSUMO_INEXISTENTE')) return new Error('El insumo seleccionado ya no existe.');
  if (msg.includes('EQUIPO_NO_DISPONIBLE')) return new Error('Ese equipo ya no está disponible (alguien lo prestó o está en mantenimiento).');
  if (msg.includes('EQUIPO_INEXISTENTE')) return new Error('El equipo ya no existe.');
  if (msg.includes('FALTA_RESPONSABLE')) return new Error('Indicá quién retira el equipo.');
  if (msg.includes('ESTADO_PRESTADO_MANUAL')) return new Error('El estado "Prestado" se maneja con préstamos y devoluciones.');
  if (msg.includes('PRESTAMO_YA_DEVUELTO')) return new Error('Ese préstamo ya fue devuelto.');
  if (error?.code === '23505' && /activo_utec/.test(msg)) return new Error('Ya hay otro equipo con ese número de activo fijo UTEC.');
  if (error?.code === '23505' && /activo_n/.test(msg)) return new Error('Ya hay otro equipo con ese número de activo fijo N.');
  if (error?.code === '23505') return new Error(/equipo/i.test(msg) ? 'Ya existe un equipo con ese número de serie.' : 'Ya existe un registro con ese nombre o código.');
  if (error?.code === '23514') return new Error('Hay un valor fuera de rango: revisá cantidades y precios.');
  if (error?.code === '42501' || /jwt|token/i.test(msg)) return new Error('Tu sesión venció. Volvé a iniciar sesión.');
  if (/failed to fetch|network/i.test(msg)) return new Error('Sin conexión. Revisá internet e intentá de nuevo.');
  return new Error(msg || 'Ocurrió un error inesperado.');
}

const aNumero = (v) => (v == null ? null : Number(v));
const normalizarInsumo = (i) => ({
  ...i,
  stock_actual: aNumero(i.stock_actual),
  stock_minimo: aNumero(i.stock_minimo),
  ultimo_precio: aNumero(i.ultimo_precio),
  valor_stock: aNumero(i.valor_stock),
});

const datos = {
  async insumos() {
    const { data, error } = await sb.from('v_insumos_estado').select('*').order('categoria').order('nombre');
    if (error) throw traducirError(error);
    return data.map(normalizarInsumo);
  },
  async movimientos(limite = 30) {
    const { data, error } = await sb
      .from('movimientos_insumos')
      .select('*, insumos(nombre, unidad_medida, codigo)')
      .order('fecha_hora', { ascending: false })
      .order('id', { ascending: false })
      .limit(limite);
    if (error) throw traducirError(error);
    return data.map((m) => ({
      ...m,
      cantidad_retirada: aNumero(m.cantidad_retirada),
      insumo_nombre: m.insumos?.nombre ?? '(eliminado)',
      unidad_medida: m.insumos?.unidad_medida ?? '',
    }));
  },
  async guardarInsumo(id, campos) {
    if (id) {
      const { error } = await sb.from('insumos').update(campos).eq('id', id);
      if (error) throw traducirError(error);
      return id;
    }
    const { data, error } = await sb.from('insumos').insert(campos).select('id').single();
    if (error) throw traducirError(error);
    return data.id;
  },
  async registrarConsumo(mov) {
    const { error } = await sb.from('movimientos_insumos').insert(mov);
    if (error) throw traducirError(error);
  },
  async equipos() {
    const { data, error } = await sb.from('v_equipos').select('*').order('categoria').order('nombre');
    if (error) throw traducirError(error);
    return data.map((e) => ({ ...e, valor_compra: aNumero(e.valor_compra) }));
  },
  async guardarEquipo(id, campos) {
    if (id) {
      const { error } = await sb.from('equipos').update(campos).eq('id', id);
      if (error) throw traducirError(error);
      return id;
    }
    const { data, error } = await sb.from('equipos').insert(campos).select('id').single();
    if (error) throw traducirError(error);
    return data.id;
  },
  async prestar(prestamo) {
    const { error } = await sb.from('prestamos').insert(prestamo);
    if (error) throw traducirError(error);
  },
  async actualizarPrestamo(id, campos) {
    const { error } = await sb.from('prestamos').update(campos).eq('id', id);
    if (error) throw traducirError(error);
  },
  async perfiles() {
    const { data, error } = await sb.from('perfiles').select('id, email, nombre, ultimo_acceso').order('nombre');
    if (error) throw traducirError(error);
    return data;
  },
  async historial(limite = 300) {
    const { data, error } = await sb.from('v_historial').select('*').order('fecha', { ascending: false }).limit(limite);
    if (error) throw traducirError(error);
    return data.map((h) => ({ ...h, cantidad: aNumero(h.cantidad) }));
  },
  async actualizarPerfil(id, campos) {
    const { error } = await sb.from('perfiles').update(campos).eq('id', id);
    if (error) throw traducirError(error);
  },
};

// ---------- Fotos (Supabase Storage, bucket privado "fotos") ----------
// Se sube una versión reducida (máx. 1024 px, ~100 KB) y una miniatura (240 px, ~10 KB).
// Las direcciones firmadas duran 7 días y se reutilizan para que el navegador las guarde.
async function reducirFoto(archivo) {
  let fuente;
  try {
    fuente = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    fuente = await new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => mal(new Error('No se pudo leer la imagen. Probá con otra foto (JPG o PNG).'));
      img.src = URL.createObjectURL(archivo);
    });
  }
  const escalar = (max, calidad) => {
    const k = Math.min(1, max / Math.max(fuente.width, fuente.height));
    const c = document.createElement('canvas');
    c.width = Math.round(fuente.width * k);
    c.height = Math.round(fuente.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(fuente, 0, 0, c.width, c.height);
    return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', calidad));
  };
  return { grande: await escalar(1024, 0.8), mini: await escalar(240, 0.72) };
}

const fotos = {
  cache: (() => { try { return JSON.parse(localStorage.getItem('fotos-urls') || '{}'); } catch { return {}; } })(),
  mini: (p) => String(p).replace(/\.jpg$/i, '_mini.jpg'),
  url(p) { const c = p && this.cache[p]; return c && c.vence > Date.now() ? c.url : ''; },
  guardarCache() { try { localStorage.setItem('fotos-urls', JSON.stringify(this.cache)); } catch {} },
  async firmar(paths) {
    const ahora = Date.now();
    const faltan = [...new Set(paths.filter(Boolean))].filter((p) => !this.cache[p] || this.cache[p].vence - ahora < 6 * 3600e3);
    if (!faltan.length) return;
    const dias = 7;
    const { data, error } = await sb.storage.from('fotos').createSignedUrls(faltan, dias * 86400);
    if (error || !data) return;
    for (const d of data) if (d.signedUrl) this.cache[d.path] = { url: d.signedUrl, vence: ahora + dias * 86400e3 - 60e3 };
    for (const [p, c] of Object.entries(this.cache)) if (c.vence < ahora) delete this.cache[p];
    this.guardarCache();
  },
  async subir(tipo, id, archivo) {
    const { grande, mini } = await reducirFoto(archivo);
    const base = `${tipo}/${id}/${Date.now()}`;
    const opciones = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
    const r1 = await sb.storage.from('fotos').upload(`${base}.jpg`, grande, opciones);
    if (r1.error) throw new Error('No se pudo subir la foto: ' + r1.error.message);
    const r2 = await sb.storage.from('fotos').upload(`${base}_mini.jpg`, mini, opciones);
    if (r2.error) throw new Error('No se pudo subir la miniatura: ' + r2.error.message);
    return `${base}.jpg`;
  },
  async borrar(p) {
    if (!p) return;
    await sb.storage.from('fotos').remove([p, this.mini(p)]).catch(() => {});
    delete this.cache[p]; delete this.cache[this.mini(p)]; this.guardarCache();
  },
};

const ICONO_FOTO = '<svg class="h-1/2 w-1/2" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 16l-5-5-8 8"/></svg>';
const ICONO_CAMARA = '<svg class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.5A1.5 1.5 0 014.5 7h2.1l1.2-2h8.4l1.2 2h2.1A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg>';

// Miniatura para listas: botón que amplía la foto, o un recuadro vacío si no tiene.
function miniatura(path, clases = 'h-10 w-10') {
  const url = path ? fotos.url(fotos.mini(path)) : '';
  return url
    ? `<button type="button" data-ver-foto="${esc(path)}" title="Ver foto" class="${clases} shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200"><img src="${esc(url)}" alt="" loading="lazy" class="h-full w-full object-cover" /></button>`
    : `<span class="${clases} grid shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-300">${ICONO_FOTO}</span>`;
}

// Visor ampliado (acepta una ruta de Storage o una URL local de vista previa).
async function verFoto(origen) {
  const visor = $('#modal-foto');
  const img = $('#foto-grande');
  img.removeAttribute('src');
  img.classList.add('hidden');
  $('#foto-cargando').classList.remove('hidden');
  if (!visor.open) visor.showModal();
  let url = origen;
  if (!/^(blob:|https?:)/.test(origen)) {
    await fotos.firmar([origen]).catch(() => {});
    url = fotos.url(origen);
  }
  if (!url) { $('#foto-cargando').textContent = 'No se pudo cargar la foto.'; return; }
  img.onload = () => { $('#foto-cargando').classList.add('hidden'); img.classList.remove('hidden'); };
  img.src = url;
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ver-foto]');
  if (b) { ev.preventDefault(); ev.stopPropagation(); verFoto(b.dataset.verFoto); }
});
{
  const visor = $('#modal-foto');
  $('[data-cerrar]', visor).addEventListener('click', () => visor.close());
  visor.addEventListener('click', (ev) => { if (ev.target === visor || ev.target.id === 'foto-grande') visor.close(); });
  visor.addEventListener('close', () => { $('#foto-cargando').textContent = 'Cargando foto…'; });
}

// Control del campo "Foto" de un formulario (prefijo "i" = insumo, "e" = equipo).
function controlFoto(prefijo) {
  const s = { actual: null, nueva: null, quitar: false, previa: null };
  const input = $(`#${prefijo}-foto`), prev = $(`#${prefijo}-foto-prev`), quitar = $(`#${prefijo}-foto-quitar`), texto = $(`#${prefijo}-foto-texto`);
  const limpiarPrevia = () => { if (s.previa) URL.revokeObjectURL(s.previa); s.previa = null; };
  const pintar = () => {
    const url = s.nueva ? s.previa : (!s.quitar && s.actual ? fotos.url(fotos.mini(s.actual)) : '');
    prev.innerHTML = url ? `<img src="${esc(url)}" alt="" class="h-full w-full object-cover" />` : ICONO_CAMARA;
    const hay = !!(s.nueva || (!s.quitar && s.actual));
    quitar.classList.toggle('hidden', !hay);
    texto.textContent = hay ? 'Cambiar foto' : 'Agregar foto';
  };
  input.addEventListener('change', () => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Elegí un archivo de imagen.');
    if (f.size > 25e6) return toast('La imagen es demasiado grande (máx. 25 MB).');
    limpiarPrevia();
    s.nueva = f; s.previa = URL.createObjectURL(f); s.quitar = false;
    pintar();
  });
  quitar.addEventListener('click', () => { limpiarPrevia(); s.nueva = null; s.quitar = true; pintar(); });
  prev.addEventListener('click', () => {
    if (s.nueva) verFoto(s.previa);
    else if (!s.quitar && s.actual) verFoto(s.actual);
  });
  return {
    cargar(path) { limpiarPrevia(); s.actual = path || null; s.nueva = null; s.quitar = false; pintar(); },
    // Sube/quita la foto y devuelve el cambio a guardar, o null si no hubo cambios.
    async aplicar(tipo, id) {
      if (s.nueva) return { foto_path: await fotos.subir(tipo, id, s.nueva), anterior: s.actual };
      if (s.quitar && s.actual) return { foto_path: null, anterior: s.actual };
      return null;
    },
  };
}

// Guarda la foto de un registro ya guardado. Si falla, el resto de los datos queda guardado igual.
async function guardarFoto(control, tipo, id, guardar) {
  try {
    const cambio = await control.aplicar(tipo, id);
    if (!cambio) return '';
    await guardar(id, { foto_path: cambio.foto_path });
    if (cambio.anterior) fotos.borrar(cambio.anterior);
    return cambio.foto_path ? ' Foto guardada.' : ' Foto quitada.';
  } catch (err) {
    return ` Pero la foto no se guardó: ${err.message}`;
  }
}

// Valida y limpia el formulario de insumo (la base vuelve a validar).
function prepararInsumo(f) {
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  const txt = (v) => String(v ?? '').trim();
  const campos = {
    codigo: txt(f.codigo).toUpperCase() || null,
    nombre: txt(f.nombre),
    categoria: txt(f.categoria) || 'General',
    unidad_medida: txt(f.unidad_medida) || 'unidades',
    stock_actual: num(f.stock_actual),
    stock_minimo: num(f.stock_minimo),
    proveedor: txt(f.proveedor) || null,
    ultimo_precio: txt(f.ultimo_precio) === '' ? null : num(f.ultimo_precio),
    fecha_ultimo_precio: txt(f.fecha_ultimo_precio) || null,
  };
  if (!campos.nombre) throw new Error('El nombre es obligatorio.');
  if (!(campos.stock_actual >= 0)) throw new Error('El stock actual debe ser un número mayor o igual a 0.');
  if (!(campos.stock_minimo >= 0)) throw new Error('El stock mínimo debe ser un número mayor o igual a 0.');
  if (campos.ultimo_precio !== null && !(campos.ultimo_precio >= 0)) throw new Error('El precio debe ser un número mayor o igual a 0.');
  if (campos.ultimo_precio !== null && !campos.fecha_ultimo_precio) campos.fecha_ultimo_precio = hoyISO();
  return campos;
}

let toastTimer;
function toast(mensaje) {
  $('#toast-msg').textContent = mensaje;
  $('#toast').classList.remove('opacity-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('opacity-0'), 2600);
}

function mostrarError(el, mensaje) {
  el.textContent = mensaje || '';
  el.classList.toggle('hidden', !mensaje);
}

// ---------- Estado ----------
const estado = { insumos: [], movimientos: [], equipos: [], perfiles: [], historial: [], conectados: [], usuario: null };

const ESTILO_ESTADO = {
  ok:      { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', barra: 'bg-emerald-500', texto: 'OK' },
  bajo:    { badge: 'bg-amber-50 text-amber-800 ring-amber-200',       barra: 'bg-amber-500',   texto: 'Bajo mínimo' },
  agotado: { badge: 'bg-red-50 text-red-700 ring-red-200',             barra: 'bg-red-500',     texto: 'Agotado' },
};

async function cargarDatos() {
  try {
    const [insumos, movimientos] = await Promise.all([
      datos.insumos(),
      datos.movimientos(30),
    ]);
    estado.insumos = insumos;
    estado.movimientos = movimientos;
    // Historial y usuarios: si fallan (p. ej. falta la migración), el resto sigue funcionando.
    const [perfiles, historial, equipos] = await Promise.all([
      datos.perfiles().catch(() => estado.perfiles),
      datos.historial().catch(() => estado.historial),
      datos.equipos().catch(() => estado.equipos),
    ]);
    estado.perfiles = perfiles;
    estado.historial = historial;
    estado.equipos = equipos;
    await fotos.firmar([...insumos, ...equipos].map((x) => x.foto_path && fotos.mini(x.foto_path))).catch(() => {});
    renderTodo();
    if (vistaActual() === 'reportes') cargarReporte();
  } catch (err) {
    toast(`No se pudieron cargar los datos. ${err.message}`);
  }
}

// ---------- Navegación por pestañas (hash) ----------
const VISTAS = ['panel', 'consumo', 'insumos', 'equipos', 'historial', 'reportes'];

let equipoPendiente = null;   // id que llegó por QR, se abre al tener los datos

function mostrarVista() {
  const qr = location.hash.match(/^#equipo=(\d+)/);
  if (qr) {
    equipoPendiente = Number(qr[1]);
    history.replaceState(null, '', location.pathname + '#equipos');
    abrirEquipoPendiente();
  }
  const actual = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'panel';
  $$('[data-vista]').forEach((s) => s.classList.toggle('hidden', s.dataset.vista !== actual));
  $$('[data-nav]').forEach((a) =>
    a.dataset.nav === actual ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'),
  );
  window.scrollTo({ top: 0 });
  if (actual === 'reportes' && sesionActiva && estado.insumos.length) cargarReporte();
}
window.addEventListener('hashchange', mostrarVista);

// ---------- Render ----------
function renderTodo() {
  renderKpis();
  renderAlertas();
  renderFiltroCategorias();
  renderStock();
  renderMovimientos();
  renderSelectInsumos();
  renderMotivos();
  renderTablaInsumos();
  renderHistorial();
  renderUsuarios();
  renderCuentaEncabezado();
  renderEquipos();
  renderVencidos();
  abrirEquipoPendiente();
}

function renderKpis() {
  const cuenta = (e) => estado.insumos.filter((i) => i.estado_stock === e).length;
  $('#kpi-total').textContent = estado.insumos.length;
  $('#kpi-bajo').textContent = cuenta('bajo');
  $('#kpi-agotado').textContent = cuenta('agotado');

  const conPrecio = estado.insumos.filter((i) => i.valor_stock != null);
  const total = conPrecio.reduce((s, i) => s + i.valor_stock, 0);
  $('#kpi-valor').textContent = conPrecio.length ? `$ ${fmtNum.format(Math.round(total))}` : '—';
  const sinPrecio = estado.insumos.length - conPrecio.length;
  $('#kpi-valor-nota').textContent = sinPrecio ? `${sinPrecio} sin precio cargado` : '';
  $('#kpi-valor-nota').classList.toggle('hidden', !sinPrecio);
}

// Para mostrar precios unitarios: "$ 95,00 /rollo"
const SINGULAR = { unidades: 'unidad', pares: 'par', rollos: 'rollo', metros: 'metro', cajas: 'caja',
  litros: 'litro', paquetes: 'paquete', bolsas: 'bolsa', hojas: 'hoja', bobinas: 'bobina' };
const unidadSingular = (u) => SINGULAR[String(u).toLowerCase()] || u;

// Línea secundaria reutilizable: código · proveedor
const detalle = (i, ...extra) =>
  [i.codigo && `<span class="font-mono">${esc(i.codigo)}</span>`, ...extra, i.proveedor && esc(i.proveedor)]
    .filter(Boolean)
    .join(' · ');

function renderAlertas() {
  const criticos = estado.insumos
    .filter((i) => i.estado_stock !== 'ok')
    .sort((a, b) => (a.estado_stock === 'agotado' ? -1 : 1) - (b.estado_stock === 'agotado' ? -1 : 1));

  $('#alertas').classList.toggle('hidden', criticos.length === 0);
  $('#lista-alertas').innerHTML = criticos
    .map((i) => {
      const e = ESTILO_ESTADO[i.estado_stock];
      const faltante = Math.max(i.stock_minimo - i.stock_actual, 0);
      return `
      <li class="flex items-center gap-3 px-4 py-2.5">
        <span class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${e.badge}">${e.texto}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">${esc(i.nombre)}</span>
          ${detalle(i) ? `<span class="block truncate text-xs text-slate-500">${detalle(i)}</span>` : ''}
        </span>
        <span class="shrink-0 text-right text-xs text-slate-500 tabular-nums">
          ${fmtNum.format(i.stock_actual)} / mín. ${fmtNum.format(i.stock_minimo)} ${esc(i.unidad_medida)}
          ${faltante > 0 ? `<br><span class="text-slate-400">faltan ${fmtNum.format(faltante)}</span>` : ''}
        </span>
      </li>`;
    })
    .join('');
}

function renderFiltroCategorias() {
  const categorias = [...new Set(estado.insumos.map((i) => i.categoria))].sort();
  const select = $('#filtro-categoria');
  const elegido = select.value;
  select.innerHTML =
    '<option value="">Todas</option>' + categorias.map((c) => `<option>${esc(c)}</option>`).join('');
  select.value = categorias.includes(elegido) ? elegido : '';
  $('#lista-categorias').innerHTML = categorias.map((c) => `<option value="${esc(c)}"></option>`).join('');

  const proveedores = [...new Set(estado.insumos.map((i) => i.proveedor).filter(Boolean))].sort();
  $('#lista-proveedores').innerHTML = proveedores.map((p) => `<option value="${esc(p)}"></option>`).join('');
}

const coincide = (i, texto) =>
  !texto || [i.nombre, i.codigo, i.proveedor].some((v) => v && v.toLowerCase().includes(texto));

function renderStock() {
  const texto = $('#filtro-texto').value.trim().toLowerCase();
  const categoria = $('#filtro-categoria').value;
  const lista = estado.insumos.filter(
    (i) => (!categoria || i.categoria === categoria) && coincide(i, texto),
  );

  if (!lista.length) {
    $('#lista-stock').innerHTML = `<li class="px-4 py-8 text-center text-sm text-slate-500">${
      estado.insumos.length ? 'Sin resultados para el filtro.' : 'Todavía no hay insumos. Cargalos desde la pestaña Insumos.'
    }</li>`;
    return;
  }

  $('#lista-stock').innerHTML = lista
    .map((i) => {
      const e = ESTILO_ESTADO[i.estado_stock];
      // La barra toma como referencia el doble del mínimo (= 100%).
      const referencia = Math.max(i.stock_minimo * 2, i.stock_actual, 1);
      const pct = Math.min((i.stock_actual / referencia) * 100, 100);
      return `
      <li class="px-4 py-3">
        <div class="flex items-center gap-3">
          ${miniatura(i.foto_path)}
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">${esc(i.nombre)}</p>
            <p class="truncate text-xs text-slate-500">${detalle(i, esc(i.categoria))}</p>
          </div>
          <p class="shrink-0 text-right tabular-nums">
            <span class="text-base font-semibold">${fmtNum.format(i.stock_actual)}</span>
            <span class="text-xs text-slate-500">${esc(i.unidad_medida)}</span>
          </p>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full ${e.barra}" style="width:${pct}%"></div>
          </div>
          <span class="shrink-0 text-[11px] text-slate-400 tabular-nums">mín. ${fmtNum.format(i.stock_minimo)}</span>
        </div>
      </li>`;
    })
    .join('');
}

function renderMovimientos() {
  const lista = estado.movimientos.slice(0, 12);
  $('#lista-movimientos').innerHTML = lista.length
    ? lista
        .map(
          (m) => `
      <li class="px-4 py-2.5">
        <div class="flex items-baseline justify-between gap-2">
          <p class="min-w-0 truncate text-sm font-medium">${esc(m.insumo_nombre)}</p>
          <p class="shrink-0 text-sm font-semibold text-red-700 tabular-nums">−${fmtNum.format(m.cantidad_retirada)} <span class="text-xs font-normal text-slate-500">${esc(m.unidad_medida)}</span></p>
        </div>
        <p class="truncate text-xs text-slate-500">${esc(m.practica_motivo)} · retiró ${esc(m.responsable)}</p>
        <p class="truncate text-[11px] text-slate-400">${fmtFecha(m.fecha_hora)}${m.usuario_id ? ` · cargó ${esc(nombreDe(m.usuario_id))}` : ''}</p>
      </li>`,
        )
        .join('')
    : '<li class="px-4 py-8 text-center text-sm text-slate-500">Sin consumos registrados.</li>';
}

function renderSelectInsumos() {
  const select = $('#c-insumo');
  const elegido = select.value;
  const porCategoria = {};
  for (const i of estado.insumos) (porCategoria[i.categoria] ||= []).push(i);

  select.innerHTML =
    '<option value="">Seleccioná un insumo…</option>' +
    Object.entries(porCategoria)
      .map(
        ([cat, items]) => `<optgroup label="${esc(cat)}">${items
          .map(
            (i) => `<option value="${i.id}" ${i.stock_actual <= 0 ? 'disabled' : ''}>${i.codigo ? esc(i.codigo) + ' · ' : ''}${esc(i.nombre)} — ${fmtNum.format(
              i.stock_actual,
            )} ${esc(i.unidad_medida)}${i.stock_actual <= 0 ? ' (agotado)' : ''}</option>`,
          )
          .join('')}</optgroup>`,
      )
      .join('');

  const sigueDisponible = estado.insumos.some((i) => String(i.id) === elegido && i.stock_actual > 0);
  select.value = sigueDisponible ? elegido : '';
  actualizarInfoInsumo();
}

function renderMotivos() {
  const motivos = [...new Set(estado.movimientos.map((m) => m.practica_motivo))].slice(0, 10);
  $('#motivos-recientes').innerHTML = motivos.map((m) => `<option value="${esc(m)}"></option>`).join('');
}

function renderTablaInsumos() {
  if (!estado.insumos.length) {
    $('#tabla-insumos').innerHTML =
      '<tr><td colspan="7" class="px-4 py-8 text-center text-sm text-slate-500">No hay insumos cargados.</td></tr>';
    return;
  }
  $('#tabla-insumos').innerHTML = estado.insumos
    .map((i) => {
      const e = ESTILO_ESTADO[i.estado_stock];
      const precio = i.ultimo_precio != null
        ? `${fmtMoneda(i.ultimo_precio)}<span class="text-xs text-slate-500"> /${esc(unidadSingular(i.unidad_medida))}</span>`
        : '<span class="text-slate-400">—</span>';
      return `
      <tr class="flex flex-wrap items-center gap-x-3 px-4 py-3 sm:table-row sm:p-0">
        <td class="min-w-0 flex-1 sm:px-4 sm:py-3">
          <div class="flex items-center gap-3">
            ${miniatura(i.foto_path, 'h-11 w-11')}
            <div class="min-w-0">
              <p class="font-medium">${esc(i.nombre)}</p>
              ${i.codigo ? `<p class="font-mono text-xs text-slate-500">${esc(i.codigo)}</p>` : ''}
              <p class="text-xs text-slate-500 sm:hidden">${[esc(i.categoria), i.proveedor && esc(i.proveedor)].filter(Boolean).join(' · ')}</p>
              ${i.ultimo_precio != null ? `<p class="text-xs text-slate-500 sm:hidden">${precio}${i.fecha_ultimo_precio ? ` · ${fmtDia(i.fecha_ultimo_precio)}` : ''}</p>` : ''}
            </div>
          </div>
        </td>
        <td class="hidden px-4 py-3 text-slate-600 lg:table-cell">${esc(i.categoria)}</td>
        <td class="hidden px-4 py-3 text-slate-600 sm:table-cell">${i.proveedor ? esc(i.proveedor) : '<span class="text-slate-400">—</span>'}</td>
        <td class="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
          ${precio}
          ${i.fecha_ultimo_precio ? `<p class="text-[11px] text-slate-400">${fmtDia(i.fecha_ultimo_precio)}</p>` : ''}
        </td>
        <td class="text-right tabular-nums sm:px-4 sm:py-3">
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full ${e.barra}" title="${e.texto}"></span>
            ${fmtNum.format(i.stock_actual)} <span class="text-xs text-slate-500">${esc(i.unidad_medida)}</span>
          </span>
        </td>
        <td class="hidden px-4 py-3 text-right tabular-nums text-slate-600 lg:table-cell">${fmtNum.format(i.stock_minimo)}</td>
        <td class="text-right sm:px-4 sm:py-3">
          <button type="button" data-editar="${i.id}" class="rounded-lg px-3 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50">Editar</button>
        </td>
      </tr>`;
    })
    .join('');
}

// ---------- Registrar consumo ----------
function insumoSeleccionado() {
  return estado.insumos.find((i) => String(i.id) === $('#c-insumo').value);
}

function actualizarInfoInsumo() {
  const i = insumoSeleccionado();
  $('#c-unidad').textContent = i ? i.unidad_medida : '—';
  $('#c-disponible').textContent = i
    ? `Disponible: ${fmtNum.format(i.stock_actual)} ${i.unidad_medida}` +
      (i.estado_stock === 'bajo' ? ' · ⚠ bajo mínimo' : '')
    : '';
  $('#c-cantidad').max = i ? i.stock_actual : '';
  const conFoto = !!(i?.foto_path && fotos.url(fotos.mini(i.foto_path)));
  $('#c-foto').classList.toggle('hidden', !conFoto);
  $('#c-foto').innerHTML = conFoto ? miniatura(i.foto_path, 'h-16 w-16') : '';
}

$('#c-insumo').addEventListener('change', () => {
  actualizarInfoInsumo();
  mostrarError($('#c-error'), '');
});

$('#form-consumo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  const datos_form = Object.fromEntries(new FormData(form));
  const errorEl = $('#c-error');
  const insumo = insumoSeleccionado();
  const cantidad = Number(datos_form.cantidad_retirada);

  // Validación rápida en el cliente (la base valida igual).
  if (!insumo) return mostrarError(errorEl, 'Seleccioná un insumo.');
  if (!(cantidad > 0)) return mostrarError(errorEl, 'Ingresá una cantidad mayor a 0.');
  if (cantidad > insumo.stock_actual)
    return mostrarError(errorEl, `Solo hay ${fmtNum.format(insumo.stock_actual)} ${insumo.unidad_medida} disponibles.`);
  if (!datos_form.practica_motivo.trim()) return mostrarError(errorEl, 'Indicá la práctica o motivo.');
  if (!datos_form.responsable.trim()) return mostrarError(errorEl, 'Indicá el responsable.');

  const boton = form.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    await datos.registrarConsumo({
      insumo_id: insumo.id,
      cantidad_retirada: cantidad,
      practica_motivo: datos_form.practica_motivo.trim(),
      responsable: datos_form.responsable.trim(),
    });
    guardarLocal('responsable', datos_form.responsable.trim());
    mostrarError(errorEl, '');
    $('#c-cantidad').value = '';
    await cargarDatos();
    const actualizado = estado.insumos.find((i) => i.id === insumo.id) || insumo;
    toast(`Retiro registrado. Quedan ${fmtNum.format(actualizado.stock_actual)} ${actualizado.unidad_medida}.`);
    $('#c-cantidad').focus();
  } catch (err) {
    mostrarError(errorEl, err.message);
    cargarDatos(); // el stock pudo haber cambiado desde otro dispositivo
  } finally {
    boton.disabled = false;
  }
});

// ---------- Alta / edición de insumos ----------
const modal = $('#modal-insumo');
const formInsumo = $('#form-insumo');

function abrirModal(insumo = null) {
  formInsumo.reset();
  mostrarError($('#i-error'), '');
  $('#modal-titulo').textContent = insumo ? 'Editar insumo' : 'Nuevo insumo';
  $('#i-aviso-stock').classList.toggle('hidden', !insumo);
  const campos = formInsumo.elements;
  campos.namedItem('editando_id').value = insumo?.id ?? '';
  campos.namedItem('nombre').value = insumo?.nombre ?? '';
  campos.namedItem('categoria').value = insumo?.categoria ?? '';
  campos.namedItem('unidad_medida').value = insumo?.unidad_medida ?? '';
  campos.namedItem('stock_actual').value = insumo?.stock_actual ?? 0;
  campos.namedItem('stock_minimo').value = insumo?.stock_minimo ?? 0;
  campos.namedItem('codigo').value = insumo?.codigo ?? '';
  campos.namedItem('proveedor').value = insumo?.proveedor ?? '';
  campos.namedItem('ultimo_precio').value = insumo?.ultimo_precio ?? '';
  campos.namedItem('fecha_ultimo_precio').value = insumo?.fecha_ultimo_precio ?? '';
  precioOriginal = insumo?.ultimo_precio ?? null;
  actualizarUnidadPrecio();
  fotoInsumo.cargar(insumo?.foto_path);
  modal.showModal();
  campos.namedItem(insumo ? 'nombre' : 'codigo').focus();
}

const fotoInsumo = controlFoto('i');

// Si cambia el precio y la fecha no se tocó a mano, se pone la fecha de hoy.
let precioOriginal = null;
let fechaEditadaAMano = false;
const campoPrecio = formInsumo.elements.namedItem('ultimo_precio');
const campoFecha = formInsumo.elements.namedItem('fecha_ultimo_precio');
campoFecha.addEventListener('input', () => { fechaEditadaAMano = true; });
campoPrecio.addEventListener('input', () => {
  if (fechaEditadaAMano) return;
  const nuevo = campoPrecio.value === '' ? null : Number(campoPrecio.value);
  if (nuevo !== null && nuevo !== precioOriginal) campoFecha.value = hoyISO();
});
modal.addEventListener('close', () => { fechaEditadaAMano = false; });

function actualizarUnidadPrecio() {
  const u = formInsumo.elements.namedItem('unidad_medida').value.trim();
  $('#i-precio-unidad').textContent = `(por ${unidadSingular(u || 'unidades')})`;
}
formInsumo.elements.namedItem('unidad_medida').addEventListener('input', actualizarUnidadPrecio);

$('#btn-nuevo').addEventListener('click', () => abrirModal());
$('#tabla-insumos').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-editar]');
  if (btn) abrirModal(estado.insumos.find((i) => i.id === Number(btn.dataset.editar)));
});
$$('[data-cerrar]', modal).forEach((b) => b.addEventListener('click', () => modal.close()));
modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.close(); }); // clic fuera

formInsumo.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const { editando_id: id, ...formulario } = Object.fromEntries(new FormData(formInsumo));
  let campos;
  try { campos = prepararInsumo(formulario); } catch (err) { return mostrarError($('#i-error'), err.message); }

  const boton = formInsumo.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    const idGuardado = await datos.guardarInsumo(id ? Number(id) : null, campos);
    const avisoFoto = await guardarFoto(fotoInsumo, 'insumos', idGuardado, (x, c) => datos.guardarInsumo(x, c));
    modal.close();
    toast((id ? 'Insumo actualizado.' : 'Insumo creado.') + avisoFoto);
    await cargarDatos();
  } catch (err) {
    mostrarError($('#i-error'), err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Filtros del panel ----------
$('#filtro-texto').addEventListener('input', renderStock);
$('#filtro-categoria').addEventListener('change', renderStock);

// ---------- Tiempo real (Supabase Realtime) ----------
let canal = null;
let recargaPendiente = null;
const programarRecarga = () => {   // agrupa varios avisos seguidos en una sola recarga
  clearTimeout(recargaPendiente);
  recargaPendiente = setTimeout(cargarDatos, 250);
};

let conexionOk = false;
function pintarConexion(ok = conexionOk) {
  conexionOk = ok;
  const indicador = $('#estado-conexion');
  const n = estado.conectados.length;
  // En celular: punto + cantidad; en pantallas grandes: "En vivo · N conectados".
  indicador.innerHTML = ok
    ? `<span class="h-2 w-2 rounded-full bg-emerald-300"></span><span class="hidden lg:inline">En vivo${n ? ` · ${n} conectado${n === 1 ? '' : 's'}` : ''}</span>` +
      (n ? `<span class="inline-flex items-center gap-0.5 lg:hidden"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path stroke-linecap="round" d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6"/></svg>${n}</span>` : '')
    : '<span class="h-2 w-2 rounded-full bg-amber-700"></span><span class="hidden lg:inline">Reconectando…</span>';
  indicador.title = n ? 'Conectados: ' + estado.conectados.map((c) => c.nombre).join(', ') : 'Usuarios conectados';
  indicador.className = `ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${
    ok ? 'bg-white/15 text-white' : 'bg-amber-400 text-amber-950'
  }`;
}

function conectarEventos() {
  if (canal) sb.removeChannel(canal);
  let yaConectado = false;
  const yo = estado.usuario;
  canal = sb
    .channel('control-insumos', { config: { presence: { key: yo.id } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, programarRecarga)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'movimientos_insumos' }, programarRecarga)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'equipos' }, programarRecarga)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prestamos' }, programarRecarga)
    .on('presence', { event: 'sync' }, () => {
      // Una entrada por usuario aunque tenga la app abierta en varios dispositivos.
      estado.conectados = Object.entries(canal.presenceState()).map(([id, sesiones]) => ({
        id, nombre: sesiones[0]?.nombre || 'Usuario', dispositivos: sesiones.length,
      }));
      pintarConexion();
      renderUsuarios();
    })
    .subscribe(async (status) => {
      const ok = status === 'SUBSCRIBED';
      pintarConexion(ok);
      if (!ok) return;
      await canal.track({ nombre: nombreDe(yo.id), desde: new Date().toISOString() });
      if (yaConectado) cargarDatos();   // al reconectar, ponerse al día
      yaConectado = true;
    });
}

// Al volver a la app (p. ej. desbloquear el celular), refrescar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sesionActiva) cargarDatos();
});

// ---------- Abrir en el celular (QR con la dirección de la app) ----------
const modalCelular = $('#modal-celular');
$$('[data-cerrar]', modalCelular).forEach((b) => b.addEventListener('click', () => modalCelular.close()));
modalCelular.addEventListener('click', (ev) => { if (ev.target === modalCelular) modalCelular.close(); });

$('#btn-celular').addEventListener('click', () => {
  const url = location.origin + location.pathname;
  $('#celular-url').textContent = url;
  const caja = $('#celular-qr');
  if (window.qrcode) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    caja.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    caja.querySelector('svg')?.setAttribute('class', 'h-full w-full');
  } else {
    caja.textContent = 'No se pudo generar el QR. Usá la dirección de abajo.';
  }
  modalCelular.showModal();
});

// ---------- App instalable (PWA) ----------
const enAppInstalada =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
let eventoInstalar = null;

function mostrarAvisoInstalar() {
  const esCelular = window.matchMedia('(max-width: 767px)').matches && 'ontouchstart' in window;
  if (enAppInstalada || !esCelular || leerLocal('aviso-instalar-cerrado')) return;
  $('#aviso-instalar-texto').textContent = eventoInstalar
    ? 'Queda un ícono en tu pantalla de inicio y se abre como una app.'
    : esIOS
      ? 'En Safari tocá Compartir y luego "Agregar a inicio".'
      : 'Abrí el menú ⋮ de Chrome y elegí "Agregar a pantalla principal".';
  $('#btn-instalar').classList.toggle('hidden', !eventoInstalar);
  $('#aviso-instalar').classList.replace('hidden', 'flex');
}

// Chrome solo ofrece este evento en sitios HTTPS: ahí aparece el botón "Instalar".
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  eventoInstalar = ev;
  mostrarAvisoInstalar();
});
$('#btn-instalar').addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $('#aviso-instalar').classList.replace('flex', 'hidden');
});
$('#cerrar-aviso-instalar').addEventListener('click', () => {
  guardarLocal('aviso-instalar-cerrado', '1');
  $('#aviso-instalar').classList.replace('flex', 'hidden');
});

// El service worker requiere HTTPS (GitHub Pages lo tiene).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Equipos: inventario, préstamos y devoluciones ----------
// Códigos de activo fijo del equipo, para mostrar debajo del nombre.
const codigosActivo = (e) => [e.activo_fijo_utec && `AF UTEC ${e.activo_fijo_utec}`, e.activo_fijo_n && `AF N ${e.activo_fijo_n}`].filter(Boolean).join(' · ');
const ESTILO_EQUIPO = {
  'Disponible':       { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', punto: 'bg-emerald-500' },
  'Prestado':         { badge: 'bg-marca-50 text-marca-700 ring-marca-200',       punto: 'bg-marca-500' },
  'En mantenimiento': { badge: 'bg-amber-50 text-amber-800 ring-amber-200',       punto: 'bg-amber-500' },
  'De baja':          { badge: 'bg-slate-100 text-slate-500 ring-slate-200',      punto: 'bg-slate-400' },
};
const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' }) : '');
const sumarDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const urlEquipo = (id) => `${location.origin}${location.pathname}#equipo=${id}`;

function equiposFiltrados() {
  const texto = $('#eq-texto').value.trim().toLowerCase();
  const est = $('#eq-estado').value;
  const cat = $('#eq-categoria').value;
  return estado.equipos.filter((e) =>
    (!est || (est === 'vencido' ? e.vencido : e.estado === est)) &&
    (!cat || e.categoria === cat) &&
    (!texto || [e.nombre, e.codigo_serie, e.activo_fijo_utec, e.activo_fijo_n, e.marca_modelo, e.ubicacion, e.prestado_a].some((v) => v && v.toLowerCase().includes(texto))));
}

function renderEquipos() {
  const eq = estado.equipos;
  const cuenta = (f) => eq.filter(f).length;
  $('#ke-total').textContent = cuenta((e) => e.estado !== 'De baja');
  $('#ke-disponibles').textContent = cuenta((e) => e.estado === 'Disponible');
  $('#ke-prestados').textContent = cuenta((e) => e.estado === 'Prestado');
  $('#ke-vencidos').textContent = cuenta((e) => e.vencido);
  $('#ke-mantenimiento').textContent = cuenta((e) => e.estado === 'En mantenimiento');

  const categorias = [...new Set(eq.map((e) => e.categoria))].sort();
  const sel = $('#eq-categoria'); const elegida = sel.value;
  sel.innerHTML = '<option value="">Todas las categorías</option>' + categorias.map((c) => `<option>${esc(c)}</option>`).join('');
  sel.value = categorias.includes(elegida) ? elegida : '';
  $('#lista-categorias-equipos').innerHTML = categorias.map((c) => `<option value="${esc(c)}"></option>`).join('');
  $('#lista-ubicaciones').innerHTML = [...new Set(eq.map((e) => e.ubicacion).filter(Boolean))].sort().map((u) => `<option value="${esc(u)}"></option>`).join('');

  const lista = equiposFiltrados();
  if (!lista.length) {
    $('#lista-equipos').innerHTML = `<li class="px-4 py-8 text-center text-sm text-slate-500">${
      eq.length ? 'Sin resultados para el filtro.' : 'Todavía no hay equipos. Cargalos con "Nuevo equipo".'}</li>`;
    return;
  }
  $('#lista-equipos').innerHTML = lista.map((e) => {
    const st = ESTILO_EQUIPO[e.estado] || ESTILO_EQUIPO['De baja'];
    const datos2 = [e.categoria, e.marca_modelo, e.ubicacion && `📍 ${e.ubicacion}`].filter(Boolean).map(esc).join(' · ');
    const prestamo = e.estado === 'Prestado' && e.prestamo_id
      ? `<p class="mt-1 text-xs ${e.vencido ? 'font-semibold text-red-700' : 'text-marca-700'}">
           ${e.vencido ? '⚠ Vencido · ' : ''}Prestado a <strong>${esc(e.prestado_a)}</strong> desde ${fechaCorta(e.prestamo_desde)}${e.prestamo_hasta ? ` · devuelve ${fmtDia(e.prestamo_hasta)}` : ''}${e.prestamo_motivo ? ` · ${esc(e.prestamo_motivo)}` : ''}
         </p>` : '';
    const accion = e.estado === 'Disponible'
      ? `<button type="button" data-prestar="${e.id}" class="rounded-lg bg-marca-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-600">Prestar</button>`
      : e.estado === 'Prestado' && e.prestamo_id
        ? `<button type="button" data-devolver="${e.id}" class="rounded-lg border border-marca-500 px-3 py-1.5 text-sm font-semibold text-marca-700 hover:bg-marca-50">Recibir</button>`
        : '';
    return `
      <li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${e.estado === 'De baja' ? 'opacity-60' : ''}">
        ${miniatura(e.foto_path, 'h-12 w-12')}
        <div class="min-w-0 flex-1 basis-48">
          <p class="font-medium"><span class="mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${st.punto}"></span>${esc(e.nombre)}
            <span class="ml-1 font-mono text-xs font-normal text-slate-500">${esc(e.codigo_serie)}</span></p>
          ${codigosActivo(e) ? `<p class="truncate font-mono text-xs text-slate-600">${esc(codigosActivo(e))}</p>` : ''}
          ${datos2 ? `<p class="truncate text-xs text-slate-500">${datos2}</p>` : ''}
          ${prestamo}
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${st.badge}">${esc(e.estado)}</span>
          ${accion}
          <button type="button" data-editar-equipo="${e.id}" class="rounded-lg px-2.5 py-1.5 text-sm font-medium text-marca-700 hover:bg-marca-50">Editar</button>
        </div>
      </li>`;
  }).join('');
}

function renderVencidos() {
  const vencidos = estado.equipos.filter((e) => e.vencido);
  $('#alertas-vencidos').classList.toggle('hidden', !vencidos.length);
  $('#lista-vencidos').innerHTML = vencidos.map((e) => `
    <li class="flex items-center gap-3 px-4 py-2.5">
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">${esc(e.nombre)} <span class="font-mono text-xs font-normal text-slate-500">${esc(e.codigo_serie)}</span></span>
        <span class="block truncate text-xs text-slate-500">${esc(e.prestado_a)}${e.prestamo_contacto ? ` · ${esc(e.prestamo_contacto)}` : ''}</span>
      </span>
      <span class="shrink-0 text-right text-xs font-semibold text-red-700">Debía volver<br>${fmtDia(e.prestamo_hasta)}</span>
    </li>`).join('');
}

['#eq-texto'].forEach((s) => $(s).addEventListener('input', renderEquipos));
['#eq-estado', '#eq-categoria'].forEach((s) => $(s).addEventListener('change', renderEquipos));
$$('[data-filtro-equipo]').forEach((b) => b.addEventListener('click', () => { $('#eq-estado').value = b.dataset.filtroEquipo; renderEquipos(); }));

const modalEquipo = $('#modal-equipo'), formEquipo = $('#form-equipo');
const modalPrestamo = $('#modal-prestamo'), formPrestamo = $('#form-prestamo');
const modalDevolucion = $('#modal-devolucion'), formDevolucion = $('#form-devolucion');
const modalEtiquetas = $('#modal-etiquetas');
[modalEquipo, modalPrestamo, modalDevolucion, modalEtiquetas].forEach((m) => {
  $$('[data-cerrar]', m).forEach((b) => b.addEventListener('click', () => m.close()));
  m.addEventListener('click', (ev) => { if (ev.target === m) m.close(); });
});
const buscarEquipo = (id) => estado.equipos.find((e) => e.id === Number(id));
const tarjetaEquipo = (e) => `<div class="flex items-center gap-3">${e.foto_path ? miniatura(e.foto_path, 'h-14 w-14') : ''}<div class="min-w-0"><p class="font-medium">${esc(e.nombre)}</p><p class="font-mono text-xs text-slate-500">${esc(e.codigo_serie)}${e.ubicacion ? ` · ${esc(e.ubicacion)}` : ''}</p>${codigosActivo(e) ? `<p class="font-mono text-xs text-slate-500">${esc(codigosActivo(e))}</p>` : ''}</div></div>`;
const fotoEquipo = controlFoto('e');

function abrirEquipoForm(e = null) {
  formEquipo.reset();
  mostrarError($('#e-error'), '');
  $('#eq-modal-titulo').textContent = e ? 'Editar equipo' : 'Nuevo equipo';
  const f = formEquipo.elements;
  f.namedItem('editando_id').value = e?.id ?? '';
  for (const c of ['codigo_serie', 'activo_fijo_utec', 'activo_fijo_n', 'nombre', 'categoria', 'marca_modelo', 'ubicacion', 'fecha_adquisicion', 'valor_compra', 'observaciones'])
    f.namedItem(c).value = e?.[c] ?? '';
  const prestado = e?.estado === 'Prestado';
  $('#e-estado').classList.toggle('hidden', prestado);
  $('#e-estado-prestado').classList.toggle('hidden', !prestado);
  $('#e-estado').value = prestado ? 'Disponible' : (e?.estado || 'Disponible');
  fotoEquipo.cargar(e?.foto_path);
  modalEquipo.showModal();
  f.namedItem(e ? 'nombre' : 'codigo_serie').focus();
}

function abrirPrestamo(e) {
  formPrestamo.reset();
  mostrarError($('#pr-error'), '');
  formPrestamo.dataset.equipo = e.id;
  $('#pr-equipo').innerHTML = tarjetaEquipo(e);
  $('#pr-fecha').value = sumarDias(0);
  $('#pr-fecha').min = sumarDias(0);
  modalPrestamo.showModal();
  $('#pr-responsable').focus();
}

function abrirDevolucion(e) {
  formDevolucion.reset();
  mostrarError($('#dv-error'), '');
  formDevolucion.dataset.prestamo = e.prestamo_id;
  $('#dv-resumen').innerHTML = `${tarjetaEquipo(e)}
    <p class="mt-1.5 text-sm">Prestado a <strong>${esc(e.prestado_a)}</strong> el ${fechaCorta(e.prestamo_desde)}${e.prestamo_contacto ? ` · ${esc(e.prestamo_contacto)}` : ''}</p>
    ${e.prestamo_hasta ? `<p class="text-xs ${e.vencido ? 'font-semibold text-red-700' : 'text-slate-500'}">Debía volver el ${fmtDia(e.prestamo_hasta)}${e.vencido ? ' (vencido)' : ''}</p>` : ''}`;
  $('#dv-nueva-fecha').value = sumarDias(1);
  $('#dv-nueva-fecha').min = sumarDias(0);
  modalDevolucion.showModal();
}

// Desde el QR: abre la acción que corresponde según el estado del equipo.
function abrirEquipoPendiente() {
  if (!equipoPendiente || !sesionActiva || !estado.equipos.length) return;
  const e = buscarEquipo(equipoPendiente);
  equipoPendiente = null;
  if (!e) return toast('No se encontró el equipo de esa etiqueta.');
  $('#eq-texto').value = e.codigo_serie;
  renderEquipos();
  if (e.estado === 'Disponible') abrirPrestamo(e);
  else if (e.estado === 'Prestado' && e.prestamo_id) abrirDevolucion(e);
  else abrirEquipoForm(e);
}

$('#btn-nuevo-equipo').addEventListener('click', () => abrirEquipoForm());
$('#lista-equipos').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.prestar) abrirPrestamo(buscarEquipo(b.dataset.prestar));
  if (b.dataset.devolver) abrirDevolucion(buscarEquipo(b.dataset.devolver));
  if (b.dataset.editarEquipo) abrirEquipoForm(buscarEquipo(b.dataset.editarEquipo));
});

async function enviar(form, errorEl, accion) {
  const boton = form.querySelector('[type=submit]');
  boton.disabled = true;
  try { await accion(); } catch (err) { mostrarError(errorEl, err.message); } finally { boton.disabled = false; }
}

formEquipo.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const { editando_id: id, ...f } = Object.fromEntries(new FormData(formEquipo));
  const t = (v) => String(v ?? '').trim();
  const campos = {
    codigo_serie: t(f.codigo_serie).toUpperCase(),
    activo_fijo_utec: t(f.activo_fijo_utec).toUpperCase() || null,
    activo_fijo_n: t(f.activo_fijo_n).toUpperCase() || null,
    nombre: t(f.nombre),
    categoria: t(f.categoria) || 'General',
    marca_modelo: t(f.marca_modelo) || null,
    ubicacion: t(f.ubicacion) || null,
    fecha_adquisicion: t(f.fecha_adquisicion) || null,
    valor_compra: t(f.valor_compra) === '' ? null : Number(f.valor_compra),
    observaciones: t(f.observaciones) || null,
  };
  const actual = id ? buscarEquipo(id) : null;
  if (actual?.estado !== 'Prestado') campos.estado = f.estado || 'Disponible';
  if (!campos.codigo_serie) return mostrarError($('#e-error'), 'El número de serie es obligatorio.');
  if (!campos.nombre) return mostrarError($('#e-error'), 'El nombre es obligatorio.');
  if (campos.valor_compra !== null && !(campos.valor_compra >= 0)) return mostrarError($('#e-error'), 'El valor debe ser un número mayor o igual a 0.');
  enviar(formEquipo, $('#e-error'), async () => {
    const idGuardado = await datos.guardarEquipo(id ? Number(id) : null, campos);
    const avisoFoto = await guardarFoto(fotoEquipo, 'equipos', idGuardado, (x, c) => datos.guardarEquipo(x, c));
    modalEquipo.close();
    toast((id ? 'Equipo actualizado.' : 'Equipo dado de alta.') + avisoFoto);
    await cargarDatos();
  });
});

formPrestamo.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(formPrestamo));
  const prestamo = {
    equipo_id: Number(formPrestamo.dataset.equipo),
    usuario_responsable: f.usuario_responsable.trim(),
    contacto: f.contacto.trim() || null,
    practica_motivo: f.practica_motivo.trim() || null,
    fecha_prevista: f.fecha_prevista || null,
    observaciones_retiro: f.observaciones_retiro.trim() || null,
  };
  if (!prestamo.usuario_responsable) return mostrarError($('#pr-error'), 'Indicá quién retira el equipo.');
  if (!prestamo.fecha_prevista) return mostrarError($('#pr-error'), 'Indicá cuándo lo tiene que devolver.');
  enviar(formPrestamo, $('#pr-error'), async () => {
    await datos.prestar(prestamo);
    modalPrestamo.close();
    toast(`Préstamo registrado: ${prestamo.usuario_responsable}.`);
    await cargarDatos();
  });
});

formDevolucion.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(formDevolucion));
  enviar(formDevolucion, $('#dv-error'), async () => {
    await datos.actualizarPrestamo(Number(formDevolucion.dataset.prestamo), {
      estado: 'Devuelto',
      condicion_devolucion: f.condicion_devolucion || 'Bien',
      observaciones_devolucion: f.observaciones_devolucion.trim() || null,
    });
    modalDevolucion.close();
    toast(f.condicion_devolucion === 'Con daño' ? 'Devolución registrada: el equipo pasó a mantenimiento.' : 'Devolución registrada: el equipo quedó disponible.');
    await cargarDatos();
  });
});

$('#btn-extender').addEventListener('click', async () => {
  const fecha = $('#dv-nueva-fecha').value;
  if (!fecha) return mostrarError($('#dv-error'), 'Elegí la nueva fecha.');
  try {
    await datos.actualizarPrestamo(Number(formDevolucion.dataset.prestamo), { fecha_prevista: fecha });
    modalDevolucion.close();
    toast(`Plazo extendido hasta el ${fmtDia(fecha)}.`);
    await cargarDatos();
  } catch (err) { mostrarError($('#dv-error'), err.message); }
});

// Etiquetas QR: una por equipo filtrado; al escanearla abre "#equipo=ID".
function etiquetaHTML(e, tam) {
  let qrSvg = '';
  if (window.qrcode) {
    const qr = qrcode(0, 'M'); qr.addData(urlEquipo(e.id)); qr.make();
    qrSvg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  return `<div class="etiqueta flex flex-col items-center rounded-lg border border-dashed border-slate-300 p-3 text-center">
    <div class="${tam}">${qrSvg}</div>
    <p class="mt-2 text-sm font-semibold leading-tight">${esc(e.nombre)}</p>
    <p class="font-mono text-xs">${esc(e.codigo_serie)}</p>
    ${e.activo_fijo_utec ? `<p class="font-mono text-[11px]">AF UTEC ${esc(e.activo_fijo_utec)}</p>` : ''}
    ${e.activo_fijo_n ? `<p class="font-mono text-[11px]">AF N ${esc(e.activo_fijo_n)}</p>` : ''}
    <p class="text-[10px] text-slate-500">Laboratorio · Control de Insumos</p>
  </div>`;
}
$('#btn-etiquetas').addEventListener('click', () => {
  const lista = equiposFiltrados().filter((e) => e.estado !== 'De baja');
  $('#vista-etiquetas').innerHTML = lista.length
    ? lista.map((e) => etiquetaHTML(e, 'h-28 w-28')).join('')
    : '<p class="col-span-full py-6 text-center text-sm text-slate-500">No hay equipos en la lista filtrada.</p>';
  $$('#vista-etiquetas svg').forEach((s) => s.setAttribute('class', 'h-full w-full'));
  $('#btn-imprimir-etiquetas').disabled = !lista.length;
  modalEtiquetas.showModal();
});
$('#btn-imprimir-etiquetas').addEventListener('click', () => {
  const lista = equiposFiltrados().filter((e) => e.estado !== 'De baja');
  const hoja = $('#hoja-etiquetas');
  hoja.innerHTML = lista.map((e) => etiquetaHTML(e, 'h-[32mm] w-[32mm]')).join('');
  $$('#hoja-etiquetas svg').forEach((s) => s.setAttribute('class', 'h-full w-full'));
  modalEtiquetas.close();
  document.body.classList.add('imprimiendo-etiquetas');
  setTimeout(() => { window.print(); document.body.classList.remove('imprimiendo-etiquetas'); }, 50);
});

// ---------- Usuarios: nombres, conectados y último acceso ----------
const miPerfil = () => estado.perfiles.find((p) => p.id === estado.usuario?.id);
function nombreDe(id) {
  const p = estado.perfiles.find((x) => x.id === id);
  if (p) return p.nombre || p.email;
  if (id && id === estado.usuario?.id) return estado.usuario.email;
  return 'otro usuario';
}
const iniciales = (texto) =>
  String(texto || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';

function haceCuanto(iso) {
  if (!iso) return 'Nunca ingresó';
  const min = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (min < 1) return 'Hace un momento';
  if (min < 60) return `Hace ${min} min`;
  if (min < 24 * 60) return `Hace ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderCuentaEncabezado() {
  const p = miPerfil();
  const nombre = p?.nombre || estado.usuario?.email || '';
  $('#avatar-iniciales').textContent = iniciales(nombre);
  $('#usuario-nombre').textContent = p?.nombre || estado.usuario?.email || '';
  $('#usuario').title = `Mi cuenta · ${p?.nombre || estado.usuario?.email || ''}`;
}

function renderUsuarios() {
  const conectados = new Set(estado.conectados.map((c) => c.id));
  const lista = [...estado.perfiles].sort((a, b) =>
    (conectados.has(b.id) - conectados.has(a.id)) || String(b.ultimo_acceso || '').localeCompare(String(a.ultimo_acceso || '')));
  $('#cuenta-conectados').textContent = `${conectados.size} conectado${conectados.size === 1 ? '' : 's'}`;
  $('#lista-usuarios').innerHTML = lista.length
    ? lista.map((p) => {
        const enLinea = conectados.has(p.id);
        return `
        <li class="flex items-center gap-3 px-4 py-2.5">
          <span class="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-marca-100 text-xs font-bold text-marca-700">
            ${esc(iniciales(p.nombre || p.email))}
            <span class="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${enLinea ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">${esc(p.nombre || 'Sin nombre')}${p.id === estado.usuario?.id ? ' <span class="text-xs font-normal text-slate-400">(vos)</span>' : ''}</span>
            <span class="block truncate text-xs text-slate-500">${esc(p.email)}</span>
          </span>
          <span class="shrink-0 text-right text-xs ${enLinea ? 'font-medium text-emerald-700' : 'text-slate-400'}">${enLinea ? 'Conectado' : esc(haceCuanto(p.ultimo_acceso))}</span>
        </li>`;
      }).join('')
    : '<li class="px-4 py-6 text-center text-sm text-slate-500">Sin datos de usuarios.</li>';

  // Filtro de usuarios del historial
  const select = $('#h-usuario');
  const elegido = select.value;
  select.innerHTML = '<option value="">Todos los usuarios</option>' +
    estado.perfiles.map((p) => `<option value="${p.id}">${esc(p.nombre || p.email)}</option>`).join('');
  select.value = estado.perfiles.some((p) => p.id === elegido) ? elegido : '';
}

// ---------- Historial ----------
const ETIQUETAS = { codigo: 'Código', nombre: 'Nombre', categoria: 'Categoría', stock_actual: 'Stock',
  stock_minimo: 'Mínimo', unidad_medida: 'Unidad', proveedor: 'Proveedor', ultimo_precio: 'Últ. precio', fecha_ultimo_precio: 'Fecha precio',
  codigo_serie: 'N.º de serie', activo_fijo_utec: 'Activo fijo UTEC', activo_fijo_n: 'Activo fijo N', marca_modelo: 'Marca/modelo', ubicacion: 'Ubicación', estado: 'Estado',
  fecha_adquisicion: 'Fecha compra', valor_compra: 'Valor', observaciones: 'Observaciones' };

function valorLegible(campo, v) {
  if (v == null || v === '') return '—';
  if (campo === 'ultimo_precio' || campo === 'valor_compra') return fmtMoneda(Number(v));
  if (campo === 'stock_actual' || campo === 'stock_minimo') return fmtNum.format(Number(v));
  if (campo === 'fecha_ultimo_precio' || campo === 'fecha_adquisicion') return fmtDia(v);
  return String(v);
}

const esAjusteDeStock = (h) => h.tipo === 'edicion' && h.cambios && 'stock_actual' in h.cambios;

function renderHistorial() {
  const tipo = $('#h-tipo').value;
  const usuario = $('#h-usuario').value;
  const texto = $('#h-texto').value.trim().toLowerCase();
  const lista = estado.historial.filter((h) =>
    (!tipo || (tipo === 'ajuste' ? esAjusteDeStock(h) : h.tipo === tipo)) &&
    (!usuario || h.usuario_id === usuario) &&
    (!texto || [h.item, h.codigo, h.motivo, h.responsable].some((v) => v && v.toLowerCase().includes(texto))));

  const ICONOS = {
    consumo: ['bg-red-50 text-red-600', '<path stroke-linecap="round" d="M5 12h14"/>'],
    alta: ['bg-emerald-50 text-emerald-600', '<path stroke-linecap="round" d="M12 5v14M5 12h14"/>'],
    edicion: ['bg-marca-50 text-marca-600', '<path stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9l-4-4L4 16v4z"/>'],
    prestamo: ['bg-violet-50 text-violet-600', '<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-5-5l5 5-5 5"/>'],
    devolucion: ['bg-teal-50 text-teal-600', '<path stroke-linecap="round" stroke-linejoin="round" d="M19 12H5m5-5l-5 5 5 5"/>'],
  };

  $('#lista-historial').innerHTML = lista.length
    ? lista.slice(0, 200).map((h) => {
        const [color, icono] = ICONOS[h.tipo] || ICONOS.edicion;
        let titulo, detalle = '';
        const esEquipo = h.modulo === 'equipos';
        const etiquetaEquipo = esEquipo ? `<span class="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">Equipo</span>` : '';
        const codigo = h.codigo ? ` <span class="font-mono text-xs text-slate-400">${esc(h.codigo)}</span>` : '';
        if (h.tipo === 'consumo') {
          titulo = `Consumo de <strong>${fmtNum.format(h.cantidad)} ${esc(h.unidad_medida)}</strong> · ${esc(h.item)}`;
          detalle = `${esc(h.motivo)} · retiró ${esc(h.responsable)}`;
        } else if (h.tipo === 'prestamo') {
          titulo = `${etiquetaEquipo}Préstamo de <strong>${esc(h.item)}</strong>${codigo} a <strong>${esc(h.responsable)}</strong>`;
          detalle = [h.motivo && esc(h.motivo), h.detalle && esc(h.detalle)].filter(Boolean).join(' · ');
        } else if (h.tipo === 'devolucion') {
          const conDanio = /daño/i.test(h.detalle || '');
          titulo = `${etiquetaEquipo}Devolución de <strong>${esc(h.item)}</strong>${codigo} por ${esc(h.responsable)}`;
          detalle = `<span class="${conDanio ? 'font-semibold text-amber-700' : ''}">${esc(h.detalle || 'Bien')}</span>`;
        } else if (h.tipo === 'alta') {
          titulo = `${etiquetaEquipo}Alta de <strong>${esc(h.item)}</strong>${codigo}`;
          const inicial = h.cambios?.stock_actual?.[1];
          detalle = !esEquipo && inicial != null ? `Stock inicial: ${fmtNum.format(Number(inicial))} ${esc(h.unidad_medida)}` : '';
        } else {
          titulo = `${etiquetaEquipo}${esAjusteDeStock(h) ? '<span class="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Ajuste de stock</span>' : 'Modificación de '}<strong>${esc(h.item)}</strong>${codigo}`;
          detalle = Object.entries(h.cambios || {})
            .map(([campo, [antes, despues]]) => `${ETIQUETAS[campo] || campo}: ${esc(valorLegible(campo, antes))} → <strong class="font-semibold text-slate-700">${esc(valorLegible(campo, despues))}</strong>`)
            .join(' · ');
        }
        return `
        <li class="flex gap-3 px-4 py-3">
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full ${color}">
            <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">${icono}</svg>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm">${titulo}</p>
            ${detalle ? `<p class="text-xs text-slate-500">${detalle}</p>` : ''}
            <p class="mt-0.5 text-[11px] text-slate-400">${fmtFecha(h.fecha)} · por <span class="font-medium text-slate-500">${esc(h.usuario || 'sistema')}</span></p>
          </div>
        </li>`;
      }).join('')
    : `<li class="px-4 py-8 text-center text-sm text-slate-500">${estado.historial.length ? 'Sin resultados para el filtro.' : 'Todavía no hay movimientos registrados.'}</li>`;

  const pie = $('#historial-pie');
  pie.classList.toggle('hidden', lista.length <= 200);
  pie.textContent = `Mostrando los 200 más recientes de ${lista.length}.`;
}
['#h-tipo', '#h-usuario'].forEach((s) => $(s).addEventListener('change', renderHistorial));
$('#h-texto').addEventListener('input', renderHistorial);

// ---------- Mi cuenta: nombre y contraseña ----------
const modalCuenta = $('#modal-cuenta');
const formCuenta = $('#form-cuenta');
let cuentaObligatoria = '';   // 'invite' | 'recovery' | 'nombre' | ''

function abrirCuenta(motivo = '') {
  cuentaObligatoria = motivo;
  const p = miPerfil();
  formCuenta.reset();
  mostrarError($('#cuenta-error'), '');
  $('#cuenta-email').textContent = estado.usuario?.email || '';
  $('#cu-nombre').value = p?.nombre || '';
  const pideClave = motivo === 'invite' || motivo === 'recovery';
  const avisos = {
    invite: '¡Bienvenido/a! Completá tu nombre y creá tu contraseña para entrar la próxima vez.',
    recovery: 'Creá tu contraseña nueva.',
    nombre: 'Completá tu nombre: así queda registrado quién carga cada cosa.',
  };
  $('#cuenta-aviso').textContent = avisos[motivo] || '';
  $('#cuenta-aviso').classList.toggle('hidden', !avisos[motivo]);
  $('#cuenta-titulo').textContent = pideClave ? 'Crear contraseña' : 'Mi cuenta';
  $('#cuenta-claves-titulo').textContent = pideClave ? 'Contraseña nueva' : 'Cambiar contraseña (opcional)';
  $('[data-cerrar]', modalCuenta).classList.toggle('invisible', !!motivo);
  if (!modalCuenta.open) modalCuenta.showModal();
  (pideClave && p?.nombre ? $('#cu-clave') : $('#cu-nombre')).focus();
}

// Si es obligatorio (invitación, recuperación o falta el nombre), no se puede cerrar sin guardar.
modalCuenta.addEventListener('cancel', (ev) => { if (cuentaObligatoria) ev.preventDefault(); });
$('[data-cerrar]', modalCuenta).addEventListener('click', () => { if (!cuentaObligatoria) modalCuenta.close(); });
modalCuenta.addEventListener('click', (ev) => { if (ev.target === modalCuenta && !cuentaObligatoria) modalCuenta.close(); });
$('#usuario').addEventListener('click', () => abrirCuenta());

formCuenta.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const errorEl = $('#cuenta-error');
  const nombre = $('#cu-nombre').value.trim().replace(/\s+/g, ' ');
  const clave = $('#cu-clave').value;
  const clave2 = $('#cu-clave2').value;
  const pideClave = cuentaObligatoria === 'invite' || cuentaObligatoria === 'recovery';

  if (!nombre) return mostrarError(errorEl, 'Escribí tu nombre y apellido.');
  if (pideClave && !clave) return mostrarError(errorEl, 'Creá una contraseña.');
  if (clave && clave.length < 8) return mostrarError(errorEl, 'La contraseña debe tener al menos 8 caracteres.');
  if (clave && clave !== clave2) return mostrarError(errorEl, 'Las contraseñas no coinciden.');

  const boton = formCuenta.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    if (clave) {
      const { error } = await sb.auth.updateUser({ password: clave });
      if (error) {
        const m = /different from the old/i.test(error.message) ? 'La contraseña nueva tiene que ser distinta de la anterior.'
          : /weak|characters/i.test(error.message) ? 'La contraseña es muy débil: usá al menos 8 caracteres combinando letras y números.'
          : traducirError(error).message;
        throw new Error(m);
      }
    }
    if (nombre !== (miPerfil()?.nombre || '')) await datos.actualizarPerfil(estado.usuario.id, { nombre });
    cuentaObligatoria = '';
    modalCuenta.close();
    toast(clave ? 'Listo: contraseña y datos guardados.' : 'Datos guardados.');
    if (!$('#c-responsable').value) $('#c-responsable').value = nombre;
    await cargarDatos();
    if (canal) canal.track({ nombre, desde: new Date().toISOString() }).catch(() => {});
  } catch (err) {
    mostrarError(errorEl, err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Reportes ----------
// Los datos del período se piden al entrar a la pestaña o al cambiar filtros; los gráficos son SVG/HTML propios.
const TZ_UY = '-03:00';   // Uruguay no usa horario de verano
const COLOR_DATO = '#0090c0', COLOR_DATO_FUERTE = '#005a78', COLOR_OTROS = '#cbd5e1';
const rep = {
  periodo: leerLocal('rep-periodo') || '30',
  medida: leerLocal('rep-medida') === 'retiros' ? 'retiros' : 'costo',
  desde: '', hasta: '', categoria: '',
  consumos: [], anteriores: [], prestamos: [],
  pedido: 0, cargadoEn: 0,
};

const isoDeFecha = (d) => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fechaDeIso = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const masDias = (iso, n) => { const d = fechaDeIso(iso); d.setDate(d.getDate() + n); return isoDeFecha(d); };
const diasEntre = (a, b) => Math.round((fechaDeIso(b) - fechaDeIso(a)) / 864e5) + 1;   // ambos incluidos
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const diaCorto = (iso) => `${Number(iso.slice(8))}/${Number(iso.slice(5, 7))}`;
const fmtEntero = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
const fmtPesos = (n) => `$ ${fmtEntero.format(Math.round(n || 0))}`;
const fmtCompacto = (n) => (n >= 1e6 ? `${fmtNum.format(+(n / 1e6).toFixed(1))} M` : n >= 1e3 ? `${fmtNum.format(+(n / 1e3).toFixed(1))} k` : fmtEntero.format(n));
const plural = (n, uno, varios) => `${fmtNum.format(n)} ${n === 1 ? uno : varios}`;

function rangoPeriodo(p) {
  const hoy = hoyISO(), d = fechaDeIso(hoy);
  switch (p) {
    case '7': return [masDias(hoy, -6), hoy];
    case 'mes': return [`${hoy.slice(0, 8)}01`, hoy];
    case 'mes-ant': return [isoDeFecha(new Date(d.getFullYear(), d.getMonth() - 1, 1)), isoDeFecha(new Date(d.getFullYear(), d.getMonth(), 0))];
    case '90': return [masDias(hoy, -89), hoy];
    case 'anio': return [`${hoy.slice(0, 4)}-01-01`, hoy];
    default: return [masDias(hoy, -29), hoy];
  }
}

// Trae todas las filas aunque pasen el límite de 1000 por consulta.
async function traerTodo(armarConsulta) {
  const filas = [], paso = 1000;
  for (let i = 0; ; i += paso) {
    const { data, error } = await armarConsulta().range(i, i + paso - 1);
    if (error) throw traducirError(error);
    filas.push(...data);
    if (data.length < paso) return filas;
  }
}
const entreFechas = (q, campo, desde, hasta) =>
  q.gte(campo, `${desde}T00:00:00${TZ_UY}`).lt(campo, `${masDias(hasta, 1)}T00:00:00${TZ_UY}`);

datos.consumosEntre = async (desde, hasta) => (await traerTodo(() =>
  entreFechas(sb.from('v_consumos').select('*'), 'fecha_hora', desde, hasta).order('fecha_hora').order('id'),
)).map((c) => ({ ...c, cantidad: aNumero(c.cantidad), precio_unitario: aNumero(c.precio_unitario), costo: aNumero(c.costo) }));
datos.prestamosEntre = async (desde, hasta) => (await traerTodo(() =>
  entreFechas(sb.from('v_prestamos').select('*'), 'fecha_retiro', desde, hasta).order('fecha_retiro').order('id'),
)).map((p) => ({ ...p, dias: aNumero(p.dias) }));

const vistaActual = () => (VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'panel');

function prepararFiltrosReporte() {
  $('#r-periodo').value = rep.periodo;
  if (rep.periodo !== 'custom' || !rep.desde) [rep.desde, rep.hasta] = rangoPeriodo(rep.periodo);
  $('#r-desde').value = rep.desde;
  $('#r-hasta').value = rep.hasta;
  $$('#r-medida [data-medida]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.medida === rep.medida)));
}

async function cargarReporte() {
  if (!sesionActiva) return;
  prepararFiltrosReporte();
  const { desde, hasta } = rep;
  if (!desde || !hasta || desde > hasta) return toast('Revisá las fechas: "Desde" tiene que ser anterior a "Hasta".');
  const largo = diasEntre(desde, hasta);
  const antDesde = masDias(desde, -largo), antHasta = masDias(desde, -1);
  const pedido = ++rep.pedido;
  $('#r-contenido').classList.add('opacity-50');
  try {
    const [consumos, anteriores, prestamos] = await Promise.all([
      datos.consumosEntre(desde, hasta),
      datos.consumosEntre(antDesde, antHasta),
      datos.prestamosEntre(desde, hasta),
    ]);
    if (pedido !== rep.pedido) return;   // llegó una consulta más nueva
    Object.assign(rep, { consumos, anteriores, prestamos, cargadoEn: Date.now() });
    renderReporte();
  } catch (err) {
    if (pedido === rep.pedido) toast(/v_consumos|v_prestamos|does not exist|schema cache/i.test(err.message)
      ? 'Falta preparar la base para reportes (supabase/05-reportes.sql).'
      : `No se pudo cargar el reporte. ${err.message}`);
  } finally {
    if (pedido === rep.pedido) $('#r-contenido').classList.remove('opacity-50');
  }
}

// Suma por clave: costo, cantidad de retiros y cantidad retirada.
function agrupar(filas, clave, extra = () => ({})) {
  const mapa = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (!mapa.has(k)) mapa.set(k, { clave: k, costo: 0, retiros: 0, cantidad: 0, sinPrecio: 0, ...extra(f) });
    const g = mapa.get(k);
    g.retiros += 1;
    g.cantidad += f.cantidad || 0;
    if (f.costo == null) g.sinPrecio += 1; else g.costo += f.costo;
  }
  return [...mapa.values()];
}
const valorDe = (g) => (rep.medida === 'costo' ? g.costo : g.retiros);
const fmtMedida = (v) => (rep.medida === 'costo' ? fmtPesos(v) : plural(v, 'retiro', 'retiros'));

function variacion(actual, anterior) {
  if (!anterior) return actual ? 'sin datos del período anterior' : '';
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return 'igual que el período anterior';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)} % vs. período anterior`;
}

function renderReporte() {
  // Categorías disponibles (se conserva la elegida)
  const cats = [...new Set(estado.insumos.map((i) => i.categoria))].sort((a, b) => a.localeCompare(b, 'es'));
  $('#r-categoria').innerHTML = '<option value="">Todas</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  if (cats.includes(rep.categoria)) $('#r-categoria').value = rep.categoria; else rep.categoria = '';

  const filtro = (c) => !rep.categoria || c.categoria === rep.categoria;
  const consumos = rep.consumos.filter(filtro);
  const anteriores = rep.anteriores.filter(filtro);
  const dias = diasEntre(rep.desde, rep.hasta);
  $('#r-subtitulo').textContent = `${fmtDia(rep.desde)} al ${fmtDia(rep.hasta)} · ${plural(dias, 'día', 'días')}${rep.categoria ? ` · ${rep.categoria}` : ''}`;

  // Indicadores
  const costo = consumos.reduce((s, c) => s + (c.costo || 0), 0);
  const costoAnt = anteriores.reduce((s, c) => s + (c.costo || 0), 0);
  const sinPrecio = consumos.filter((c) => c.costo == null).length;
  $('#rk-costo').textContent = fmtPesos(costo);
  $('#rk-costo-nota').textContent = [variacion(costo, costoAnt), sinPrecio ? `${plural(sinPrecio, 'retiro', 'retiros')} sin precio` : ''].filter(Boolean).join(' · ');
  $('#rk-retiros').textContent = fmtEntero.format(consumos.length);
  $('#rk-retiros-nota').textContent = variacion(consumos.length, anteriores.length);
  const catalogo = estado.insumos.filter(filtro).length;
  $('#rk-insumos').textContent = fmtEntero.format(new Set(consumos.map((c) => c.insumo_id)).size);
  $('#rk-insumos-nota').textContent = `de ${plural(catalogo, 'insumo', 'insumos')} en el catálogo`;
  const pr = rep.prestamos;
  const fuera = pr.filter((p) => p.fuera_de_plazo).length, danio = pr.filter((p) => p.condicion_devolucion === 'Con daño').length;
  $('#rk-prestamos').textContent = fmtEntero.format(pr.length);
  $('#rk-prestamos-nota').textContent = pr.length ? `${fuera} fuera de plazo · ${danio} con daño` : '';

  renderGraficoTiempo(consumos);

  const vacio = '<li class="py-6 text-center text-sm text-slate-400">Sin consumos en este período.</li>';
  const porInsumo = agrupar(consumos, (c) => c.insumo_id, (c) => ({ etiqueta: c.insumo, unidad: c.unidad_medida, codigo: c.codigo }));
  barras($('#r-top-insumos'), porInsumo.map((g) => ({
    etiqueta: g.etiqueta, valor: valorDe(g),
    detalle: `${fmtNum.format(g.cantidad)} ${g.unidad} · ${plural(g.retiros, 'retiro', 'retiros')}`,
    tip: tipGrupo(g, `${fmtNum.format(g.cantidad)} ${g.unidad}`),
  })), fmtMedida, vacio, 8);
  barras($('#r-practicas'), agrupar(consumos, (c) => c.practica_motivo.trim()).map((g) => ({
    etiqueta: g.clave, valor: valorDe(g), detalle: rep.medida === 'costo' ? plural(g.retiros, 'retiro', 'retiros') : fmtPesos(g.costo), tip: tipGrupo(g),
  })), fmtMedida, vacio, 8);
  barras($('#r-categorias'), agrupar(consumos, (c) => c.categoria).map((g) => ({
    etiqueta: g.clave, valor: valorDe(g), detalle: rep.medida === 'costo' ? plural(g.retiros, 'retiro', 'retiros') : fmtPesos(g.costo), tip: tipGrupo(g),
  })), fmtMedida, vacio, 8);
  barras($('#r-responsables'), agrupar(consumos, (c) => c.responsable.trim()).map((g) => ({
    etiqueta: g.clave, valor: valorDe(g), detalle: rep.medida === 'costo' ? plural(g.retiros, 'retiro', 'retiros') : fmtPesos(g.costo), tip: tipGrupo(g),
  })), fmtMedida, vacio, 8);

  renderProyeccion(consumos, dias, filtro);
  renderPrestamosReporte();
  renderSinConsumo(consumos, filtro);
}

function tipGrupo(g, cantidad = '') {
  return `<b>${esc(g.etiqueta ?? g.clave)}</b><br>${fmtPesos(g.costo)} · ${plural(g.retiros, 'retiro', 'retiros')}` +
    (cantidad ? `<br>${esc(cantidad)}` : '') + (g.sinPrecio ? `<br><span class="text-slate-300">${g.sinPrecio} sin precio</span>` : '');
}

// Barras horizontales (HTML): valor al final de cada barra; el resto se agrupa en "Otros".
function barras(cont, filas, fmt, vacio, maximo = 8) {
  const hayDatos = filas.length > 0;
  filas = filas.filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor);
  if (!filas.length) {
    cont.innerHTML = hayDatos
      ? '<li class="py-6 text-center text-sm text-slate-400">Estos consumos no tienen precio cargado. Probá con “Retiros”.</li>'
      : vacio;
    return;
  }
  const visibles = filas.slice(0, maximo);
  const resto = filas.slice(maximo);
  if (resto.length) {
    const total = resto.reduce((s, f) => s + f.valor, 0);
    visibles.push({ etiqueta: `Otros (${resto.length})`, valor: total, detalle: '', otros: true,
      tip: `<b>Otros ${resto.length}</b><br>${resto.slice(0, 6).map((f) => esc(f.etiqueta)).join(', ')}${resto.length > 6 ? '…' : ''}` });
  }
  const mayor = Math.max(...visibles.map((f) => f.valor)) || 1;
  cont.innerHTML = visibles.map((f) => `
    <li class="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]" data-tip="${esc(f.tip || '')}">
      <div class="min-w-0">
        <p class="truncate text-sm text-slate-800" title="${esc(f.etiqueta)}">${esc(f.etiqueta)}</p>
        ${f.detalle ? `<p class="truncate text-[11px] text-slate-500">${esc(f.detalle)}</p>` : ''}
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <span class="block h-3 shrink-0 rounded-r" style="width:calc((100% - 5.75rem) * ${(f.valor / mayor).toFixed(4)});min-width:${f.valor ? 2 : 0}px;background:${f.otros ? COLOR_OTROS : COLOR_DATO}"></span>
        <span class="whitespace-nowrap text-xs tabular-nums text-slate-700">${fmt(f.valor)}</span>
      </div>
    </li>`).join('');
}

// Escala con números redondos para el eje.
function escalaRedonda(maximo, divisiones = 4, entero = false) {
  if (!(maximo > 0)) return [0, entero ? 1 : 1];
  const bruto = maximo / divisiones;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  let paso = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p >= bruto);
  if (entero) paso = Math.max(1, Math.ceil(paso));
  const tope = Math.ceil(maximo / paso - 1e-9) * paso;
  const ticks = [];
  for (let v = 0; v <= tope + paso / 2; v += paso) ticks.push(+v.toFixed(6));
  return ticks;
}

// Agrupa los consumos por día, semana (lunes) o mes según el largo del período, incluyendo los vacíos.
function cubetasTiempo(consumos) {
  const dias = diasEntre(rep.desde, rep.hasta);
  const modo = dias <= 45 ? 'dia' : dias <= 210 ? 'semana' : 'mes';
  const claveDe = (iso) => {
    if (modo === 'dia') return iso;
    if (modo === 'mes') return iso.slice(0, 7);
    const d = fechaDeIso(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDeFecha(d);
  };
  const cubetas = [];
  const indice = new Map();
  for (let iso = rep.desde; iso <= rep.hasta; iso = masDias(iso, 1)) {
    const k = claveDe(iso);
    if (!indice.has(k)) { indice.set(k, cubetas.length); cubetas.push({ clave: k, desde: iso, hasta: iso, costo: 0, retiros: 0, sinPrecio: 0 }); }
    cubetas[indice.get(k)].hasta = iso;
  }
  for (const c of consumos) {
    const i = indice.get(claveDe(c.dia));
    if (i == null) continue;
    cubetas[i].retiros += 1;
    if (c.costo == null) cubetas[i].sinPrecio += 1; else cubetas[i].costo += c.costo;
  }
  for (const b of cubetas) {
    const [a, m] = [b.desde.slice(0, 4), Number(b.desde.slice(5, 7))];
    b.corta = modo === 'mes' ? MESES[m - 1] : diaCorto(b.desde);
    b.larga = modo === 'dia' ? fechaDeIso(b.desde).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' })
      : modo === 'mes' ? `${MESES_LARGOS[m - 1]} ${a}` : `Semana del ${diaCorto(b.desde)} al ${diaCorto(b.hasta)}`;
  }
  return { modo, cubetas };
}

function renderGraficoTiempo(consumos) {
  const { modo, cubetas } = cubetasTiempo(consumos);
  const nombre = rep.medida === 'costo' ? 'Costo de consumos' : 'Retiros';
  $('#r-tiempo-titulo').textContent = `${nombre} en el tiempo`;
  $('#r-tiempo-sub').textContent = { dia: 'por día', semana: 'por semana', mes: 'por mes' }[modo];
  rep.cubetas = cubetas;
  dibujarColumnas($('#r-tiempo'), cubetas);
  $('#r-tiempo-tabla').innerHTML = `<thead class="text-left text-slate-500"><tr><th class="py-1 pr-3 font-medium">${{ dia: 'Día', semana: 'Semana', mes: 'Mes' }[modo]}</th><th class="py-1 pr-3 text-right font-medium">Costo</th><th class="py-1 text-right font-medium">Retiros</th></tr></thead><tbody>` +
    cubetas.map((b) => `<tr class="border-t border-slate-100"><td class="py-1 pr-3">${esc(b.larga)}</td><td class="py-1 pr-3 text-right tabular-nums">${fmtPesos(b.costo)}</td><td class="py-1 text-right tabular-nums">${b.retiros}</td></tr>`).join('') + '</tbody>';
}

// Columnas verticales en SVG: barras finas, punta redondeada, eje con números redondos y aviso al pasar el dedo/mouse.
function dibujarColumnas(cont, cubetas) {
  ocultarTooltip();
  const ancho = Math.max(280, Math.round(cont.clientWidth || 640));
  const alto = 220;
  const valores = cubetas.map((b) => (rep.medida === 'costo' ? b.costo : b.retiros));
  const ticks = escalaRedonda(Math.max(0, ...valores), 4, rep.medida === 'retiros');
  const tope = ticks[ticks.length - 1] || 1;
  const textoEje = (v) => (rep.medida === 'costo' ? `$ ${fmtCompacto(v)}` : fmtEntero.format(v));
  const mIzq = Math.max(...ticks.map((t) => textoEje(t).length)) * 6.4 + 10;
  const m = { t: 10, r: 6, b: 24, l: mIzq };
  const w = ancho - m.l - m.r, h = alto - m.t - m.b;
  const banda = w / cubetas.length;
  const grosor = Math.max(1, Math.min(24, banda - 2));
  const y = (v) => m.t + h - (v / tope) * h;
  const cadaCuanto = Math.max(1, Math.ceil(cubetas.length / Math.max(1, Math.floor(w / 46))));
  let svg = `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" height="${alto}" role="img" aria-label="${esc($('#r-tiempo-titulo').textContent)}" class="block select-none overflow-visible" font-family="inherit">`;
  for (const t of ticks) {
    svg += `<line x1="${m.l}" x2="${ancho - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? '#eef2f6' : '#cbd5e1'}" stroke-width="1" shape-rendering="crispEdges"/>`;
    svg += `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#64748b" style="font-variant-numeric:tabular-nums">${esc(textoEje(t))}</text>`;
  }
  cubetas.forEach((b, i) => {
    const v = valores[i];
    const x = m.l + i * banda + (banda - grosor) / 2;
    if (v > 0) {
      const yTop = y(v), y0 = y(0);
      const r = Math.min(4, grosor / 2, y0 - yTop);
      svg += `<path data-barra="${i}" d="M${x},${y0}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + grosor - r}Q${x + grosor},${yTop} ${x + grosor},${yTop + r}V${y0}Z" fill="${COLOR_DATO}"/>`;
    }
    if (i % cadaCuanto === 0) svg += `<text x="${m.l + i * banda + banda / 2}" y="${alto - 6}" text-anchor="middle" font-size="11" fill="#64748b">${esc(b.corta)}</text>`;
    const tip = `<b>${esc(b.larga)}</b><br>${fmtPesos(b.costo)} · ${plural(b.retiros, 'retiro', 'retiros')}${b.sinPrecio ? `<br><span class="text-slate-300">${b.sinPrecio} sin precio</span>` : ''}`;
    svg += `<rect data-tip="${esc(tip)}" data-i="${i}" x="${m.l + i * banda}" y="${m.t}" width="${banda}" height="${h}" fill="transparent"/>`;
  });
  cont.innerHTML = svg + '</svg>';
}

function renderProyeccion(consumos, dias, filtro) {
  const usado = new Map();
  for (const c of consumos) usado.set(c.insumo_id, (usado.get(c.insumo_id) || 0) + (c.cantidad || 0));
  const filas = estado.insumos.filter(filtro).map((i) => {
    const cant = usado.get(i.id) || 0;
    const porDia = cant / dias;
    const alcanza = porDia > 0 ? i.stock_actual / porDia : null;
    const comprar = Math.max(0, Math.ceil(porDia * 30 + i.stock_minimo - i.stock_actual - 1e-9));
    return { i, cant, porDia, alcanza, comprar, costoCompra: i.ultimo_precio != null ? comprar * i.ultimo_precio : null };
  }).filter((f) => f.cant > 0 || f.i.estado_stock !== 'ok');
  const orden = (f) => (f.i.stock_actual <= 0 ? -1 : f.alcanza ?? (f.i.estado_stock !== 'ok' ? 1e6 : 1e7));
  filas.sort((a, b) => orden(a) - orden(b) || a.i.nombre.localeCompare(b.i.nombre, 'es'));

  const insignia = (f) => {
    if (f.i.stock_actual <= 0) return ['Agotado', 'bg-red-50 text-red-700 ring-red-200'];
    if (f.alcanza == null) return ['Sin consumo', 'bg-slate-50 text-slate-600 ring-slate-200'];
    const d = Math.floor(f.alcanza);
    const texto = d < 1 ? 'Menos de 1 día' : d > 365 ? 'Más de 1 año' : `~${plural(d, 'día', 'días')}`;
    return [texto, d <= 7 ? 'bg-red-50 text-red-700 ring-red-200' : d <= 30 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'];
  };
  $('#r-proyeccion').innerHTML = filas.length ? filas.map((f) => {
    const [texto, clases] = insignia(f);
    const u = f.i.unidad_medida;
    const fecha = f.alcanza != null && f.alcanza <= 365 && f.i.stock_actual > 0 ? fmtDia(masDias(hoyISO(), Math.floor(f.alcanza))) : '';
    return `<tr>
      <td class="px-3 py-2 sm:px-4"><p class="font-medium text-slate-800">${esc(f.i.nombre)}</p><p class="text-xs tabular-nums text-slate-600 sm:hidden">Stock: ${fmtNum.format(f.i.stock_actual)} ${esc(u)}</p><p class="font-mono text-[11px] text-slate-500">${esc(f.i.codigo || '')}${f.i.estado_stock !== 'ok' ? `${f.i.codigo ? ' · ' : ''}<span class="font-sans">${f.i.estado_stock === 'agotado' ? 'agotado' : 'bajo mínimo'}</span>` : ''}</p></td>
      <td class="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums sm:table-cell">${fmtNum.format(f.i.stock_actual)} <span class="text-xs text-slate-500">${esc(u)}</span></td>
      <td class="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums sm:table-cell">${fmtNum.format(f.cant)}</td>
      <td class="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums md:table-cell">${fmtNum.format(+(f.porDia * 7).toFixed(1))}</td>
      <td class="px-2 py-2 sm:px-3"><span class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${clases}">${texto}</span>${fecha ? `<p class="mt-0.5 whitespace-nowrap text-[11px] text-slate-500">hasta ${fecha}</p>` : ''}</td>
      <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums sm:px-4">${f.comprar ? `${fmtNum.format(f.comprar)} <span class="text-xs text-slate-500">${esc(u)}</span>${f.costoCompra != null ? `<p class="text-[11px] text-slate-500">${fmtPesos(f.costoCompra)}</p>` : ''}` : '<span class="text-slate-400">—</span>'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="px-4 py-6 text-center text-sm text-slate-400">Sin consumos ni insumos bajo mínimo en este período.</td></tr>';
  const conCompra = filas.filter((f) => f.comprar > 0);
  const total = conCompra.reduce((s, f) => s + (f.costoCompra || 0), 0);
  const sinPrecio = conCompra.filter((f) => f.costoCompra == null).length;
  $('#r-proyeccion-pie').innerHTML = conCompra.length
    ? `<tr><td colspan="6" class="px-4 py-2 text-right text-sm"><span class="text-slate-500">Compra sugerida (${plural(conCompra.length, 'insumo', 'insumos')}):</span> <b class="tabular-nums">${fmtPesos(total)}</b>${sinPrecio ? ` <span class="text-xs text-slate-500">+ ${sinPrecio} sin precio</span>` : ''}</td></tr>`
    : '';
}

function renderPrestamosReporte() {
  const pr = rep.prestamos;
  const devueltos = pr.filter((p) => p.estado === 'Devuelto');
  const promedio = devueltos.length ? devueltos.reduce((s, p) => s + (p.dias || 0), 0) / devueltos.length : null;
  const datosPr = [
    ['Préstamos', fmtEntero.format(pr.length)],
    ['Devueltos', fmtEntero.format(devueltos.length)],
    ['Siguen afuera', fmtEntero.format(pr.length - devueltos.length)],
    ['Fuera de plazo', fmtEntero.format(pr.filter((p) => p.fuera_de_plazo).length)],
    ['Con daño', fmtEntero.format(pr.filter((p) => p.condicion_devolucion === 'Con daño').length)],
    ['Duración media', promedio == null ? '—' : plural(+promedio.toFixed(1), 'día', 'días')],
  ];
  $('#r-prestamos-datos').innerHTML = datosPr.map(([t, v]) => `<div class="bg-white px-3 py-2.5"><dt class="text-[11px] text-slate-500">${t}</dt><dd class="text-lg font-semibold tabular-nums text-slate-800">${v}</dd></div>`).join('');
  const porEquipo = new Map();
  for (const p of pr) {
    const g = porEquipo.get(p.equipo_id) || { etiqueta: p.equipo, codigo: p.codigo_serie, valor: 0, dias: 0 };
    g.valor += 1; g.dias += p.dias || 0;
    porEquipo.set(p.equipo_id, g);
  }
  barras($('#r-top-equipos'), [...porEquipo.values()].map((g) => ({
    etiqueta: g.etiqueta, valor: g.valor, detalle: `${g.codigo} · ${plural(+(g.dias / g.valor).toFixed(1), 'día', 'días')} prom.`,
    tip: `<b>${esc(g.etiqueta)}</b><br>${plural(g.valor, 'préstamo', 'préstamos')}`,
  })), (v) => plural(v, 'préstamo', 'préstamos'), '<li class="py-6 text-center text-sm text-slate-400">Sin préstamos en este período.</li>', 6);
}

function renderSinConsumo(consumos, filtro) {
  const usados = new Set(consumos.map((c) => c.insumo_id));
  const quietos = estado.insumos.filter((i) => filtro(i) && !usados.has(i.id) && i.stock_actual > 0)
    .sort((a, b) => (b.valor_stock || 0) - (a.valor_stock || 0));
  const valor = quietos.reduce((s, i) => s + (i.valor_stock || 0), 0);
  $('#r-sin-consumo-nota').textContent = quietos.length
    ? `${plural(quietos.length, 'insumo', 'insumos')} con stock que no se usaron · ${fmtPesos(valor)} inmovilizados`
    : 'Todos los insumos con stock tuvieron consumo.';
  const max = 8;
  $('#r-sin-consumo').innerHTML = quietos.slice(0, max).map((i) => `
    <li class="flex items-center gap-3 px-4 py-2">
      <div class="min-w-0 flex-1"><p class="truncate text-sm text-slate-800">${esc(i.nombre)}</p><p class="text-[11px] text-slate-500">${fmtNum.format(i.stock_actual)} ${esc(i.unidad_medida)} · ${esc(i.categoria)}</p></div>
      <span class="whitespace-nowrap text-xs tabular-nums text-slate-700">${i.valor_stock != null ? fmtPesos(i.valor_stock) : 'sin precio'}</span>
    </li>`).join('') + (quietos.length > max ? `<li class="px-4 py-2 text-xs text-slate-500">y ${quietos.length - max} más (ver en Excel)</li>` : '');
}

// Aviso flotante para gráficos (mouse y toque)
const tooltip = $('#tooltip-grafico');
let tipActivo = null;
function moverTooltip(ev) {
  const pad = 12, r = tooltip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY - r.height - pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y < 8) y = ev.clientY + pad;
  tooltip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
}
function ocultarTooltip() {
  tooltip.classList.add('hidden');
  if (tipActivo) { $$('[data-barra]', $('#r-tiempo')).forEach((b) => b.setAttribute('fill', COLOR_DATO)); tipActivo = null; }
}
document.addEventListener('pointerover', (ev) => {
  const el = ev.target.closest?.('[data-vista="reportes"] [data-tip]');
  if (!el || !el.dataset.tip) return;
  if (tipActivo !== el) ocultarTooltip();
  tipActivo = el;
  tooltip.innerHTML = el.dataset.tip;
  tooltip.classList.remove('hidden');
  if (el.dataset.i != null) $(`[data-barra="${el.dataset.i}"]`, $('#r-tiempo'))?.setAttribute('fill', COLOR_DATO_FUERTE);
  moverTooltip(ev);
});
document.addEventListener('pointermove', (ev) => { if (tipActivo) moverTooltip(ev); });
document.addEventListener('pointerout', (ev) => {
  // Con el dedo el aviso queda visible hasta tocar en otro lado.
  if (ev.pointerType !== 'touch' && tipActivo && !tipActivo.contains(ev.relatedTarget)) ocultarTooltip();
});
document.addEventListener('pointerdown', (ev) => {
  if (tipActivo && !ev.target.closest?.('[data-tip]')) ocultarTooltip();
});
document.addEventListener('scroll', ocultarTooltip, { passive: true });

// Filtros
$('#r-periodo').addEventListener('change', (ev) => {
  rep.periodo = ev.target.value;
  guardarLocal('rep-periodo', rep.periodo);
  if (rep.periodo !== 'custom') { rep.desde = ''; cargarReporte(); }
  else $('#r-desde').focus();
});
['#r-desde', '#r-hasta'].forEach((sel) => $(sel).addEventListener('change', () => {
  rep.periodo = 'custom';
  guardarLocal('rep-periodo', 'custom');
  rep.desde = $('#r-desde').value;
  rep.hasta = $('#r-hasta').value;
  if (rep.desde && rep.hasta) cargarReporte();
}));
$('#r-categoria').addEventListener('change', (ev) => { rep.categoria = ev.target.value; renderReporte(); });
$('#r-medida').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-medida]');
  if (!b || b.dataset.medida === rep.medida) return;
  rep.medida = b.dataset.medida;
  guardarLocal('rep-medida', rep.medida);
  prepararFiltrosReporte();
  renderReporte();
});
let redibujo;
window.addEventListener('resize', () => {
  clearTimeout(redibujo);
  redibujo = setTimeout(() => { if (vistaActual() === 'reportes' && rep.cubetas) dibujarColumnas($('#r-tiempo'), rep.cubetas); }, 150);
});
$('#btn-imprimir-reporte').addEventListener('click', () => window.print());
window.addEventListener('beforeprint', () => { if (vistaActual() === 'reportes' && rep.cubetas) dibujarColumnas($('#r-tiempo'), rep.cubetas); });

// ---------- Exportar a Excel ----------
let promesaXLSX = null;
const cargarXLSX = () => promesaXLSX ??= new Promise((ok, falla) => {
  if (window.XLSX) return ok(window.XLSX);
  const s = document.createElement('script');
  s.src = 'vendor/xlsx.mini.min.js';
  s.onload = () => ok(window.XLSX);
  s.onerror = () => { promesaXLSX = null; falla(new Error('No se pudo cargar el generador de Excel. Revisá la conexión.')); };
  document.head.appendChild(s);
});
// Fecha local → número de serie de Excel (así se puede filtrar y ordenar por fecha).
const serialExcel = (valor) => {
  if (!valor) return null;
  const d = typeof valor === 'string' && valor.length === 10 ? fechaDeIso(valor) : new Date(valor);
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - Date.UTC(1899, 11, 30)) / 864e5;
};

function hoja(XLSX, encabezados, filas, formatos = {}, anchos = []) {
  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...filas]);
  const rango = XLSX.utils.decode_range(ws['!ref']);
  for (const [col, z] of Object.entries(formatos)) {
    for (let r = 1; r <= rango.e.r; r++) {
      const celda = ws[XLSX.utils.encode_cell({ r, c: Number(col) })];
      if (celda && celda.t === 'n') celda.z = z;
    }
  }
  ws['!cols'] = encabezados.map((h, i) => ({ wch: anchos[i] || Math.max(10, String(h).length + 2) }));
  if (filas.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezados.length - 1 } }) };
  return ws;
}

$('#btn-excel').addEventListener('click', async (ev) => {
  const boton = ev.currentTarget;
  if (!rep.cargadoEn) return toast('Esperá a que termine de cargar el reporte.');
  boton.disabled = true;
  try {
    const XLSX = await cargarXLSX();
    const PESOS = '"$" #,##0.00', FECHA_HORA = 'dd/mm/yyyy hh:mm', FECHA = 'dd/mm/yyyy', NUM = '#,##0.###';
    const filtro = (c) => !rep.categoria || c.categoria === rep.categoria;
    const consumos = rep.consumos.filter(filtro);
    const dias = diasEntre(rep.desde, rep.hasta);
    const libro = XLSX.utils.book_new();

    const costo = consumos.reduce((s, c) => s + (c.costo || 0), 0);
    const resumen = XLSX.utils.aoa_to_sheet([
      ['Reporte de insumos y equipos — Laboratorio de Logística'],
      [],
      ['Período', `${fmtDia(rep.desde)} al ${fmtDia(rep.hasta)} (${dias} días)`],
      ['Categoría de insumo', rep.categoria || 'Todas'],
      ['Generado', new Date().toLocaleString('es-UY')],
      ['Generado por', nombreDe(estado.usuario?.id)],
      [],
      ['Costo de consumos', costo],
      ['Retiros registrados', consumos.length],
      ['Retiros sin precio cargado', consumos.filter((c) => c.costo == null).length],
      ['Insumos distintos usados', new Set(consumos.map((c) => c.insumo_id)).size],
      ['Préstamos de equipos', rep.prestamos.length],
      ['Préstamos fuera de plazo', rep.prestamos.filter((p) => p.fuera_de_plazo).length],
      ['Devoluciones con daño', rep.prestamos.filter((p) => p.condicion_devolucion === 'Con daño').length],
      [],
      ['El costo usa el precio unitario vigente al momento de cada retiro.'],
    ]);
    resumen.B8.z = PESOS;
    resumen['!cols'] = [{ wch: 30 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(libro, resumen, 'Resumen');

    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['Fecha', 'Código', 'Insumo', 'Categoría', 'Cantidad', 'Unidad', 'Precio unitario', 'Costo', 'Práctica / motivo', 'Retiró', 'Registró'],
      consumos.map((c) => [serialExcel(c.fecha_hora), c.codigo || '', c.insumo, c.categoria, c.cantidad, c.unidad_medida, c.precio_unitario, c.costo, c.practica_motivo, c.responsable, c.registrado_por || '']),
      { 0: FECHA_HORA, 4: NUM, 6: PESOS, 7: PESOS }, [16, 12, 30, 16, 10, 10, 14, 14, 28, 20, 24]), 'Consumos');

    const porInsumo = agrupar(consumos, (c) => c.insumo_id, (c) => ({ codigo: c.codigo, nombre: c.insumo, categoria: c.categoria, unidad: c.unidad_medida }));
    const stockDe = new Map(estado.insumos.map((i) => [i.id, i]));
    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['Código', 'Insumo', 'Categoría', 'Unidad', 'Cantidad consumida', 'Retiros', 'Costo', 'Stock actual', 'Días que alcanza'],
      porInsumo.sort((a, b) => b.costo - a.costo).map((g) => {
        const i = stockDe.get(g.clave);
        const porDia = g.cantidad / dias;
        return [g.codigo || '', g.nombre, g.categoria, g.unidad, g.cantidad, g.retiros, g.costo, i?.stock_actual ?? null, i && porDia > 0 ? Math.floor(i.stock_actual / porDia) : null];
      }),
      { 4: NUM, 6: PESOS, 7: NUM }, [12, 30, 16, 10, 12, 9, 14, 12, 12]), 'Por insumo');

    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['Práctica / motivo', 'Retiros', 'Costo'],
      agrupar(consumos, (c) => c.practica_motivo.trim()).sort((a, b) => b.costo - a.costo).map((g) => [g.clave, g.retiros, g.costo]),
      { 2: PESOS }, [36, 10, 14]), 'Por práctica');

    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['Retiro', 'N.º de serie', 'Activo fijo UTEC', 'Activo fijo N', 'Equipo', 'Categoría', 'Retiró', 'Contacto', 'Práctica / motivo', 'Devolución prevista', 'Devuelto', 'Estado', 'Condición', 'Fuera de plazo', 'Días', 'Obs. retiro', 'Obs. devolución', 'Registró', 'Recibió'],
      rep.prestamos.map((p) => [serialExcel(p.fecha_retiro), p.codigo_serie, p.activo_fijo_utec || '', p.activo_fijo_n || '', p.equipo, p.categoria, p.usuario_responsable, p.contacto || '', p.practica_motivo || '',
        serialExcel(p.fecha_prevista), serialExcel(p.fecha_devolucion), p.estado, p.condicion_devolucion || '', p.fuera_de_plazo ? 'Sí' : 'No', p.dias,
        p.observaciones_retiro || '', p.observaciones_devolucion || '', p.registrado_por || '', p.recibido_por || '']),
      { 0: FECHA_HORA, 9: FECHA, 10: FECHA_HORA, 14: '0.0' }, [16, 12, 14, 14, 26, 14, 20, 16, 24, 12, 16, 10, 10, 8, 7, 24, 24, 22, 22]), 'Préstamos');

    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['Código', 'Insumo', 'Categoría', 'Stock', 'Mínimo', 'Unidad', 'Estado', 'Proveedor', 'Último precio', 'Fecha precio', 'Valor en stock'],
      estado.insumos.filter(filtro).map((i) => [i.codigo || '', i.nombre, i.categoria, i.stock_actual, i.stock_minimo, i.unidad_medida,
        ESTILO_ESTADO[i.estado_stock]?.texto || i.estado_stock, i.proveedor || '', i.ultimo_precio, serialExcel(i.fecha_ultimo_precio), i.valor_stock]),
      { 3: NUM, 4: NUM, 8: PESOS, 9: FECHA, 10: PESOS }, [12, 30, 16, 10, 10, 10, 12, 20, 14, 12, 14]), 'Stock actual');

    XLSX.utils.book_append_sheet(libro, hoja(XLSX,
      ['N.º de serie', 'Activo fijo UTEC', 'Activo fijo N', 'Equipo', 'Categoría', 'Marca / modelo', 'Ubicación', 'Estado', 'Prestado a', 'Devolución prevista', 'Fecha de compra', 'Valor de compra', 'Observaciones'],
      estado.equipos.map((e) => [e.codigo_serie, e.activo_fijo_utec || '', e.activo_fijo_n || '', e.nombre, e.categoria, e.marca_modelo || '', e.ubicacion || '', e.estado, e.prestado_a || '',
        serialExcel(e.prestamo_hasta), serialExcel(e.fecha_adquisicion), e.valor_compra, e.observaciones || '']),
      { 9: FECHA, 10: FECHA, 11: PESOS }, [14, 16, 14, 26, 14, 20, 16, 14, 20, 12, 12, 14, 30]), 'Equipos');

    XLSX.writeFile(libro, `reporte-insumos_${rep.desde}_a_${rep.hasta}.xlsx`, { compression: true });
    toast('Excel descargado.');
  } catch (err) {
    toast(err.message);
  } finally {
    boton.disabled = false;
  }
});

// ---------- Sesión (inicio y cierre) ----------
let sesionActiva = false;

function mostrarLogin() {
  sesionActiva = false;
  estado.usuario = null;
  estado.conectados = [];
  cuentaObligatoria = '';
  if (modalCuenta.open) modalCuenta.close();
  if (canal) { sb.removeChannel(canal); canal = null; }
  $('#usuario').classList.replace('flex', 'hidden');
  $('#pantalla-login').classList.replace('hidden', 'flex');
  setTimeout(() => $('#l-email').focus(), 50);
}

async function iniciarApp(sesion, motivo = '') {
  if (sesionActiva) return;
  sesionActiva = true;
  estado.usuario = sesion.user;
  $('#pantalla-login').classList.replace('flex', 'hidden');
  $('#usuario').classList.replace('hidden', 'flex');
  mostrarVista();
  await cargarDatos();

  const perfil = miPerfil();
  $('#c-responsable').value = leerLocal('responsable') || perfil?.nombre || '';
  datos.actualizarPerfil(estado.usuario.id, { ultimo_acceso: new Date().toISOString() }).catch(() => {});
  conectarEventos();
  mostrarAvisoInstalar();

  // Primer ingreso por invitación / recuperación: crear contraseña. Sin nombre: pedirlo.
  const enlace = motivo || tipoEnlace;
  if (enlace === 'invite' || enlace === 'recovery') abrirCuenta(enlace);
  else if (perfil && !perfil.nombre) abrirCuenta('nombre');
}

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#l-email').value.trim();
  const password = $('#l-clave').value;
  const errorEl = $('#l-error');
  if (!email || !password) return mostrarError(errorEl, 'Completá correo y contraseña.');
  const boton = ev.currentTarget.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const m = /invalid login/i.test(error.message) ? 'Correo o contraseña incorrectos.'
        : /not confirmed/i.test(error.message) ? 'El correo todavía no está confirmado.'
        : traducirError(error).message;
      return mostrarError(errorEl, m);
    }
    mostrarError(errorEl, '');
    $('#l-clave').value = '';
    iniciarApp(data.session);
  } finally {
    boton.disabled = false;
  }
});

$('#btn-salir').addEventListener('click', async () => {
  modalCuenta.close();
  if (canal) await canal.untrack().catch(() => {});
  await sb.auth.signOut();
  mostrarLogin();
});

// "¿Olvidaste tu contraseña?": manda un correo con un enlace para crear una nueva.
$('#btn-olvide').addEventListener('click', async () => {
  const email = $('#l-email').value.trim();
  const info = $('#l-info');
  mostrarError($('#l-error'), '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarError($('#l-error'), 'Escribí tu correo arriba y volvé a tocar "¿Olvidaste tu contraseña?".');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) {
    const m = /rate limit|seconds/i.test(error.message)
      ? 'Por ahora no se pueden enviar más correos: el plan gratuito permite 2 por hora para todo el sistema. Probá en una hora o pedile al responsable del laboratorio una contraseña provisoria.'
      : traducirError(error).message;
    return mostrarError($('#l-error'), m);
  }
  info.textContent = `Si ${email} tiene cuenta, va a recibir un correo con un enlace para crear una contraseña nueva.`;
  info.classList.remove('hidden');
});

// ---------- Inicio ----------
(async () => {
  if (!sb) {
    $('#falta-config').classList.replace('hidden', 'grid');
    return;
  }
  sb.auth.onAuthStateChange((evento, sesion) => {
    if (evento === 'SIGNED_OUT') mostrarLogin();
    // setTimeout: no consultar la base dentro de este aviso (supabase-js puede trabarse).
    else if (sesion && evento === 'PASSWORD_RECOVERY') setTimeout(() => sesionActiva ? abrirCuenta('recovery') : iniciarApp(sesion, 'recovery'), 0);
    else if (sesion && evento === 'SIGNED_IN') setTimeout(() => iniciarApp(sesion), 0);
  });
  const { data } = await sb.auth.getSession();
  if (data.session) iniciarApp(data.session);
  else mostrarLogin();
})();
