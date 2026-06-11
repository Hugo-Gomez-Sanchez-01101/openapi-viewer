// Servidor local para el Visor OpenAPI.
// Sirve los archivos estáticos del visor y expone /proxy?url=<url> para
// reenviar las peticiones de "Try it out" a APIs que no envían cabeceras CORS.
//
// Uso:  node server.js [puerto] [--cert ruta.p12] [--pass contraseña]
//   puerto     Puerto de escucha (por defecto 80)
//   --cert     Certificado cliente PKCS#12 (.p12/.pfx) para APIs con mutual TLS
//   --pass     Contraseña del certificado (o variable de entorno CERT_PASS)

const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

// --- Argumentos ---
const args = { port: 80, certPath: null, certPass: process.env.CERT_PASS || '' };
{
  const rest = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cert') args.certPath = argv[++i];
    else if (argv[i] === '--pass') args.certPass = argv[++i];
    else rest.push(argv[i]);
  }
  if (rest[0]) args.port = Number(rest[0]);
}

const PORT = args.port;
const ROOT = __dirname;

// Certificado cliente (mutual TLS). Mutable: se puede cambiar en caliente
// desde el visor (POST /cert) además de indicarse por línea de comandos.
let clientCert = null; // { pfx: Buffer, passphrase: string, name: string }

function setClientCert(pfx, passphrase, name) {
  // Valida que el .p12 se puede abrir con esa contraseña antes de aceptarlo.
  tls.createSecureContext({ pfx, passphrase });
  clientCert = { pfx, passphrase, name };
  console.log('[cert] certificado cliente activo: ' + name);
}

if (args.certPath) {
  try {
    setClientCert(fs.readFileSync(args.certPath), args.certPass, path.basename(args.certPath));
  } catch (e) {
    console.error('ERROR: no se pudo cargar el certificado "' + args.certPath + '": ' + e.message);
    process.exit(1);
  }
}

// Almacena cookies por origen (URL destino).
// Estructura: { 'https://ejemplo.com': 'cookie1=val1; cookie2=val2' }
const cookieJar = {};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Cabeceras de la petición entrante que no deben reenviarse a la API destino.
const SKIP_REQUEST_HEADERS = new Set([
  'host', 'origin', 'referer', 'connection',
  'accept-encoding',
]);

// Cabeceras de la respuesta que Node gestiona por su cuenta.
const SKIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding', 'connection', 'keep-alive',
]);

function storeCookies(origin, setCookies) {
  const newCookies = setCookies.map(c => c.split(';')[0].trim()).filter(Boolean);
  if (!newCookies.length) return;
  // Fusiona por nombre: las cookies nuevas sustituyen a las anteriores.
  const jar = new Map(
    (cookieJar[origin] || '').split('; ').filter(Boolean).map(c => [c.split('=')[0], c])
  );
  for (const c of newCookies) jar.set(c.split('=')[0], c);
  cookieJar[origin] = [...jar.values()].join('; ');
  console.log(`[cookies] almacenadas para ${origin}: ${cookieJar[origin]}`);
}

function handleProxy(req, res, requestUrl) {
  const target = requestUrl.searchParams.get('url');
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Parámetro "url" ausente o inválido.');
    return;
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Solo se permiten URLs http(s).');
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!SKIP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }

  // Incluye las cookies guardadas para este origen (si el cliente no envía las suyas).
  const origin = targetUrl.origin;
  if (cookieJar[origin]) {
    headers['cookie'] = headers['cookie']
      ? headers['cookie'] + '; ' + cookieJar[origin]
      : cookieJar[origin];
  }

  const lib = targetUrl.protocol === 'https:' ? https : http;
  const options = { method: req.method, headers };
  if (targetUrl.protocol === 'https:' && clientCert) {
    options.pfx = clientCert.pfx;
    options.passphrase = clientCert.passphrase;
  }

  const upstreamReq = lib.request(targetUrl, options, upstream => {
    // Captura Set-Cookie para reenviarlas en peticiones posteriores.
    if (upstream.headers['set-cookie']) {
      storeCookies(origin, upstream.headers['set-cookie']);
    }

    const responseHeaders = {};
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (!SKIP_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }

    res.writeHead(upstream.statusCode, responseHeaders);
    upstream.pipe(res);
    console.log(`[proxy] ${req.method} ${targetUrl} -> ${upstream.statusCode}`);
  });

  upstreamReq.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('El proxy no pudo conectar con ' + targetUrl + '\n' + e.message);
    console.error(`[proxy] ${req.method} ${targetUrl} -> ERROR: ${e.message}`);
  });

  // Reenvía el cuerpo de la petición tal cual.
  req.pipe(upstreamReq);
}

// GET    /cert  -> { name } del certificado activo (o name: null)
// POST   /cert  -> carga un certificado: JSON { name, pfxBase64, pass }
// DELETE /cert  -> desactiva el certificado actual
async function handleCert(req, res) {
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET') {
    json(200, { name: clientCert ? clientCert.name : null });
    return;
  }

  if (req.method === 'DELETE') {
    clientCert = null;
    console.log('[cert] certificado cliente desactivado');
    json(200, { name: null });
    return;
  }

  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const { name, pfxBase64, pass } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      if (!pfxBase64) throw new Error('Falta el contenido del certificado.');
      setClientCert(Buffer.from(pfxBase64, 'base64'), pass || '', name || 'certificado.p12');
      json(200, { name: clientCert.name });
    } catch (e) {
      const msg = /mac verify|invalid password|pkcs12/i.test(e.message)
        ? 'Contraseña incorrecta o archivo .p12 no válido.'
        : e.message;
      json(400, { error: msg });
    }
    return;
  }

  json(405, { error: 'Método no permitido' });
}

function serveStatic(req, res, requestUrl) {
  let filePath = decodeURIComponent(requestUrl.pathname);
  if (filePath === '/') filePath = '/index.html';
  const resolved = path.join(ROOT, filePath);

  // Evita salir del directorio del visor.
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado: ' + filePath);
      return;
    }
    const type = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (requestUrl.pathname === '/proxy') {
    handleProxy(req, res, requestUrl);
  } else if (requestUrl.pathname === '/cert') {
    handleCert(req, res);
  } else {
    serveStatic(req, res, requestUrl);
  }
}).listen(PORT, () => {
  console.log(`Visor OpenAPI disponible en  http://localhost${PORT === 80 ? '' : ':' + PORT}`);
  console.log('Las peticiones de "Try it out" se reenvían a través de /proxy para evitar bloqueos CORS.');
  if (clientCert) console.log('Mutual TLS activo: el proxy presenta el certificado cliente en conexiones https.');
  console.log('Puedes cargar o cambiar el certificado cliente desde el botón "Certificado…" del visor.');
});
