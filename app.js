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
  if (error?.code === '23505') return new Error('Ya existe un insumo con ese nombre o código.');
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
    const consulta = id ? sb.from('insumos').update(campos).eq('id', id) : sb.from('insumos').insert(campos);
    const { error } = await consulta;
    if (error) throw traducirError(error);
  },
  async registrarConsumo(mov) {
    const { error } = await sb.from('movimientos_insumos').insert(mov);
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
const estado = { insumos: [], movimientos: [], perfiles: [], historial: [], conectados: [], usuario: null };

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
    const [perfiles, historial] = await Promise.all([
      datos.perfiles().catch(() => estado.perfiles),
      datos.historial().catch(() => estado.historial),
    ]);
    estado.perfiles = perfiles;
    estado.historial = historial;
    renderTodo();
  } catch (err) {
    toast(`No se pudieron cargar los datos. ${err.message}`);
  }
}

// ---------- Navegación por pestañas (hash) ----------
const VISTAS = ['panel', 'consumo', 'insumos', 'historial'];

function mostrarVista() {
  const actual = VISTAS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'panel';
  $$('[data-vista]').forEach((s) => s.classList.toggle('hidden', s.dataset.vista !== actual));
  $$('[data-nav]').forEach((a) =>
    a.dataset.nav === actual ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'),
  );
  window.scrollTo({ top: 0 });
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
        <div class="flex items-baseline gap-3">
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
          <p class="font-medium">${esc(i.nombre)}</p>
          ${i.codigo ? `<p class="font-mono text-xs text-slate-500">${esc(i.codigo)}</p>` : ''}
          <p class="text-xs text-slate-500 sm:hidden">${[esc(i.categoria), i.proveedor && esc(i.proveedor)].filter(Boolean).join(' · ')}</p>
          ${i.ultimo_precio != null ? `<p class="text-xs text-slate-500 sm:hidden">${precio}${i.fecha_ultimo_precio ? ` · ${fmtDia(i.fecha_ultimo_precio)}` : ''}</p>` : ''}
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
  modal.showModal();
  campos.namedItem(insumo ? 'nombre' : 'codigo').focus();
}

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
    await datos.guardarInsumo(id ? Number(id) : null, campos);
    modal.close();
    toast(id ? 'Insumo actualizado.' : 'Insumo creado.');
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
    ? `<span class="h-2 w-2 rounded-full bg-emerald-300"></span><span class="hidden sm:inline">En vivo${n ? ` · ${n} conectado${n === 1 ? '' : 's'}` : ''}</span>` +
      (n ? `<span class="inline-flex items-center gap-0.5 sm:hidden"><svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path stroke-linecap="round" d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6"/></svg>${n}</span>` : '')
    : '<span class="h-2 w-2 rounded-full bg-amber-700"></span><span class="hidden sm:inline">Reconectando…</span>';
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
  stock_minimo: 'Mínimo', unidad_medida: 'Unidad', proveedor: 'Proveedor', ultimo_precio: 'Últ. precio', fecha_ultimo_precio: 'Fecha precio' };

function valorLegible(campo, v) {
  if (v == null || v === '') return '—';
  if (campo === 'ultimo_precio') return fmtMoneda(Number(v));
  if (campo === 'stock_actual' || campo === 'stock_minimo') return fmtNum.format(Number(v));
  if (campo === 'fecha_ultimo_precio') return fmtDia(v);
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
    (!texto || [h.insumo, h.codigo, h.motivo, h.responsable].some((v) => v && v.toLowerCase().includes(texto))));

  const ICONOS = {
    consumo: ['bg-red-50 text-red-600', '<path stroke-linecap="round" d="M5 12h14"/>'],
    alta: ['bg-emerald-50 text-emerald-600', '<path stroke-linecap="round" d="M12 5v14M5 12h14"/>'],
    edicion: ['bg-marca-50 text-marca-600', '<path stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9l-4-4L4 16v4z"/>'],
  };

  $('#lista-historial').innerHTML = lista.length
    ? lista.slice(0, 200).map((h) => {
        const [color, icono] = ICONOS[h.tipo] || ICONOS.edicion;
        let titulo, detalle = '';
        if (h.tipo === 'consumo') {
          titulo = `Consumo de <strong>${fmtNum.format(h.cantidad)} ${esc(h.unidad_medida)}</strong> · ${esc(h.insumo)}`;
          detalle = `${esc(h.motivo)} · retiró ${esc(h.responsable)}`;
        } else if (h.tipo === 'alta') {
          titulo = `Alta de <strong>${esc(h.insumo)}</strong>`;
          const inicial = h.cambios?.stock_actual?.[1];
          detalle = inicial != null ? `Stock inicial: ${fmtNum.format(Number(inicial))} ${esc(h.unidad_medida)}` : '';
        } else {
          titulo = `${esAjusteDeStock(h) ? '<span class="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Ajuste de stock</span>' : 'Modificación de '}<strong>${esc(h.insumo)}</strong>`;
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
      ? 'Se enviaron demasiados correos. Esperá unos minutos y probá de nuevo.'
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
