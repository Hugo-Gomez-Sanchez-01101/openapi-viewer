# Visor OpenAPI

Visor web de documentos OpenAPI (2.0 / 3.x) con importación de archivos **JSON** y
**YAML**, múltiples documentos en pestañas, y un proxy local que permite usar
"Try it out" contra APIs sin CORS, incluso si exigen certificado cliente (mutual TLS).

## Uso rápido

```
start.cmd [puerto]
```

Por defecto escucha en el puerto 80: abre <http://localhost>. Carga tus specs con el
botón **"Abrir archivos…"** o arrastrándolos a la página (puedes seleccionar varios a la
vez; cada uno se abre en su pestaña).

Requiere **Node.js ≥ 25** (se usa el flag `--use-system-ca` para que Node confíe en los
certificados del almacén de Windows, necesario en redes corporativas con inspección TLS).
Sin dependencias: Swagger UI y js-yaml se cargan por CDN, y `server.js` solo usa la
librería estándar de Node.

## Proxy CORS

Las peticiones de "Try it out" hacia otros orígenes se redirigen automáticamente por
`/proxy?url=…` del servidor local, que las reenvía a la API y devuelve la respuesta sin
restricciones CORS. Además, el proxy captura las cabeceras `Set-Cookie` de las respuestas
(p. ej. de un endpoint de login) y reenvía esas cookies en las peticiones siguientes al
mismo origen.

## Token Bearer

Para APIs que exigen `Authorization: Bearer <token>` (lo indican con la cabecera
`www-authenticate: Bearer` en sus respuestas 401): botón **"Token…"** → pega el JWT.
Se añade automáticamente a todas las peticiones de "Try it out", aunque el spec no
defina el esquema de seguridad. Se guarda solo en el navegador (localStorage).

## Certificado cliente (mutual TLS)

Para APIs que exigen certificado cliente (p. ej. idCAT en APIs de gencat.cat):

- Desde el visor: botón **"Certificado…"** → selecciona el `.p12`/`.pfx` e introduce su
  contraseña. Se puede cambiar o quitar en caliente, sin reiniciar el servidor.
- Por línea de comandos: `start.cmd [puerto] --cert ruta.p12 --pass contraseña`.

El certificado se mantiene **solo en memoria** del servidor local: no se escribe en disco
y desaparece al parar el proceso. El `.gitignore` excluye `*.p12`/`*.pfx` por si alguno
acabara en la carpeta.

## Archivos

- `index.html` — el visor (Swagger UI + pestañas + diálogo de certificado).
- `server.js` — servidor estático + proxy CORS + gestión del certificado (`/cert`).
- `start.cmd` — arranque en Windows con `--use-system-ca`.
- `ejemplo-api.yaml`, `ejemplo-usuarios.json` — specs de ejemplo para probar.
