@echo off
rem Arranca el Visor OpenAPI con proxy CORS.
rem El certificado cliente (mutual TLS) se carga desde el propio visor,
rem con el boton "Certificado..." (tambien se puede pasar por CLI:
rem   start.cmd [puerto] --cert ruta.p12 --pass contraseña).
rem
rem --use-system-ca: usa los certificados de Windows (necesario en redes
rem corporativas con inspeccion TLS, p.ej. para las APIs de gencat.cat).
node --use-system-ca "%~dp0server.js" %*
