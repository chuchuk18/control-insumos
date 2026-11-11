// StockLab — Invitar usuarios (función de Supabase, "Edge Function" llamada "invitar").
// Solo un administrador puede usarla. Crea la cuenta con una contraseña provisoria
// (modo "clave", no depende del correo) o manda una invitación por correo (modo "correo").
// La clave de servicio nunca sale del servidor de Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Contraseña provisoria fácil de dictar: sin letras ni números que se confundan (0/O, 1/l/I).
function generarClave(largo = 10) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', numeros = '23456789';
  const todos = letras + numeros;
  const azar = crypto.getRandomValues(new Uint32Array(largo));
  const c = Array.from(azar, (n) => todos[n % todos.length]);
  c[0] = letras[azar[0] % letras.length];
  c[largo - 1] = numeros[azar[largo - 1] % numeros.length];
  return c.join('');
}

function traducir(msg: string) {
  if (/already (been )?registered|already exists/i.test(msg)) return 'Ese correo ya tiene una cuenta.';
  if (/rate limit|too many/i.test(msg)) return 'Se alcanzó el límite de correos del plan gratuito. Usá la opción de contraseña provisoria.';
  if (/not authorized|address not authorized/i.test(msg)) return 'El servicio de correo de Supabase no permite escribir a ese correo. Usá la opción de contraseña provisoria.';
  return msg;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // ¿Quién llama? Se verifica con su propia sesión que sea administrador activo.
  const quien = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: rol, error: errorRol } = await quien.rpc('mi_rol');
  if (errorRol || rol !== 'admin') return json({ error: 'Solo un administrador puede invitar usuarios.' }, 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const nombre = String(body.nombre ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const rolNuevo = ['admin', 'operador', 'invitado'].includes(body.rol) ? body.rol : 'invitado';
  const modo = body.modo === 'correo' ? 'correo' : 'clave';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'El correo no es válido.' }, 400);

  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });
  let id: string;
  let clave: string | null = null;
  if (modo === 'correo') {
    const redirectTo = typeof body.redirectTo === 'string' && body.redirectTo.startsWith('https://') ? body.redirectTo : undefined;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { nombre }, redirectTo });
    if (error) return json({ error: traducir(error.message) }, 400);
    id = data.user.id;
  } else {
    clave = generarClave();
    const { data, error } = await admin.auth.admin.createUser({
      email, password: clave, email_confirm: true, user_metadata: { nombre, clave_provisoria: true },
    });
    if (error) return json({ error: traducir(error.message) }, 400);
    id = data.user.id;
  }

  const { error: errorPerfil } = await admin.from('perfiles')
    .upsert({ id, email, nombre: nombre || null, rol: rolNuevo, activo: true });
  if (errorPerfil) return json({ error: 'La cuenta se creó, pero no se pudo asignar el rol: ' + errorPerfil.message }, 500);

  return json({ ok: true, email, rol: rolNuevo, modo, clave });
});
