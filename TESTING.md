# Testing

## Herramientas y motivos

| Herramienta                               | Uso            | Motivo                                                                                   |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| **Node.js `node:test` + `assert/strict`** | Suite unitaria | Cero dependencias de runtime; suficiente para módulos UMD y mocks de puertos nativos     |
| **c8**                                    | Cobertura      | Umbral CI del **99%** (statements/branches/functions/lines) sobre `shared/` y `scripts/` |
| **ESLint 9**                              | Lint JS        | Detecta `eval`, variables huérfanas y errores obvios sin imponer un framework            |
| **Prettier 3**                            | Formato        | Formato reproducible de JS/JSON/HTML/CSS/Markdown                                        |
| **`scripts/validate-manifest.js`**        | Gate de config | Verifica ID fijo, permisos mínimos y `background.page` Firefox                           |
| **pre-commit**                            | Hooks Git      | Misma idea que el repo Python: controles locales antes del commit                        |

No se usa Vitest ni Jest: añadirían un segundo runner sin ganancia clara sobre `node:test` para este tamaño de proyecto.

## Instalación de dependencias de desarrollo

Requisitos: Node.js ≥ 18, npm, y `pre-commit` en el PATH (para hooks).

```bash
cd /home/javier/proyectos/meetings/transcriptor-firefox
npm install
pre-commit install   # opcional, solo si vas a crear commits en este clone
```

## Ejecutar toda la suite

```bash
npm test                 # suite sin medir cobertura
npm run test:coverage    # suite + c8 con umbral 99% (falla si baja)
```

La configuración está en `.c8rc.json`. El alcance son `shared/**/*.js` y `scripts/**/*.js` (lógica testeable). Los entrypoints de Firefox (`background/`, `popup/`) son cableado fino y quedan fuera del umbral.

Control único local (formato + lint + manifest + tests con cobertura):

```bash
npm run check
```

## Ejecutar un archivo o grupo

```bash
node --test tests/protocol.test.js
node --test tests/native-client.test.js
node --test tests/popup-state.test.js
node --test tests/background-controller.test.js
node --test tests/manifest.test.js
node --test tests/coverage-gaps.test.js
```

## Interpretar fallos

- `ERR_ASSERTION`: el comportamiento divergió del esperado; leé el `expected`/`actual`.
- `TIMEOUT` / `HOST_*` en tests del cliente: el mock no respondió o el matching de `request_id` falló.
- Fallos de ESLint: corregí el código; no desactives reglas globales para un caso puntual.
- `prettier --check` falla: ejecutá `npm run format` y revisá el diff.
- `validate-manifest` falla: el `manifest.json` rompe una invariante (ID, permisos, scripts).

## Qué cubre automatización vs Firefox real

### Automatizado (sin Google, sin reunión, sin host real)

- Serialización/validación del protocolo v1.
- Cliente Native Messaging con puerto simulado (`tests/helpers/fake-port.js`).
- Timeouts, desconexiones, respuestas fuera de orden, JSON inválido.
- Detección de pestaña Meet / fuera de Meet / sin URL.
- Derivación de estado del popup y prevención de “Grabando” ficticio.
- Orquestación background (start/stop/get) con cliente falso.
- Invariantes del manifest y ausencia de dependencia `chrome.*`.
- Diffs de participantes/hablante y lifecycle de observación (`tests/meet-events.test.js` + fixtures HTML).
- Contrato sintético de eventos Meet (`tests/fixtures/synthetic-meet-events.json` +
  `tests/synthetic-meet-contract.test.js`; **no** son capturas reales de Meet).

### Integración local (manual o semi-manual)

- Cargar la extensión temporalmente en Firefox.
- Abrir el popup con y sin host registrado.
- Verificar mensajes en español cuando el host no existe.
- Con diagnóstico activo, ver eventos detectados durante una grabación.
- El host Python persiste `record_meet_event` en `meet_events.jsonl` (ver repo
  `transcriptor`, `docs/VALIDATION.md`).

### Manual pendiente (reunión real)

Ver sección final y `../transcriptor/docs/VALIDATION.md` si el clone está al lado.

## Native Messaging con host simulado

Los tests no lanzan un proceso nativo real. Usan `createFakePort()`:

1. Inyectan `connectNative: () => port` en `createNativeClient`.
2. Esperan el mensaje saliente con `waitForSent`.
3. Emulan respuestas con `port.emitMessage(...)` o `emitDisconnect(...)`.

Para una prueba manual con host real, el manifiesto nativo debe autorizar `meetings-transcriptor@example.org` (ver `README.md` y `SECURITY.md`).

## Estados del popup

Cubiertos en `tests/popup-state.test.js`:

- Estado inicial desconectado.
- Host listo / desconectado / error.
- Inicio y detención correctos vía `applyBackgroundResult`.
- Errores al iniciar/detener.
- Botones deshabilitados según estado y `busy`.
- Nunca `recording` sin `session_id` confirmado.

## Permisos, errores, desconexiones y timeouts

| Escenario                                | Dónde se prueba                                              |
| ---------------------------------------- | ------------------------------------------------------------ |
| Host no encontrado                       | `native-client`, `background-controller`, `protocol`         |
| Timeout                                  | `native-client`                                              |
| Disconnect mid-request                   | `native-client`                                              |
| `request_id` incorrecto                  | `protocol`, `native-client`                                  |
| Versión de protocolo distinta            | `protocol`                                                   |
| Mensajes incompletos / tipos incorrectos | `protocol`                                                   |
| Start/stop rechazados por host           | `native-client`, `background-controller`, `popup-controller` |
| Pestaña no Meet al iniciar               | `background-controller`                                      |
| Permisos del manifest                    | `manifest.test.js`, `validate-manifest`                      |

## Pruebas manuales pendientes (reunión real de Google Meet)

Estas **no** forman parte de `npm test`:

1. Entrar a una reunión Meet real con el host nativo instalado y operativo.
2. Iniciar grabación desde el popup y confirmar archivos de sesión en el lado del host.
3. Activar modo diagnóstico y contrastar nombres detectados con la UI de Meet.
4. Abrir/cerrar el panel de participantes y ver joins/leaves heurísticos.
5. Detener: el popup pregunta si transcribir; con Aceptar debe mostrar progreso (`Transcribiendo… [xx%] …`) vía `get_status` y al final la ruta del transcript. Con Cancelar solo guarda archivos. Observación → `Metadatos: Inactiva`.
6. Verificar persistencia local de la secuencia en `meet_events.jsonl` del host
   (`$BASE_DIR/<perfil>/Reunion_…/`).
7. Validar comportamiento si el host se cae a mitad de una grabación.
8. Guía unipersonal (Meet solo / segunda cuenta propia): ver
   `transcriptor/docs/VALIDATION.md` en el repo del host.

## pre-commit

```bash
# instalar hooks en .git (una vez por clone)
pre-commit install

# correr sobre archivos concretos tocados
pre-commit run --files manifest.json shared/protocol.js

# correr todos los hooks sobre el repo (usar con cuidado en repos grandes)
pre-commit run --all-files
```

Los hooks locales invocan `npm run format:check`, `npm run lint`, `npm run validate:manifest` y `npm run test:coverage` (umbral 99%). Requieren `npm install` previo; no reinstalan dependencias en cada ejecución.
