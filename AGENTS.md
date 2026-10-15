# Instrucciones para agentes de IA

Leé este archivo y la documentación enlazada **antes** de modificar código. Las instrucciones describen el código real de este repositorio, no una arquitectura deseada.

## Alcance del repositorio

- Este repo es **solo** la extensión Firefox `meetings-transcriptor@example.org`.
- El transcriptor Python vive en otro repositorio (`../transcriptor` u otra ruta local). **No lo modifiques** desde tareas de este proyecto.
- La extensión **no** contiene FFmpeg, Whisper, diarización ni almacenamiento de audio/video.
- La grabación real depende de un host Native Messaging externo (`com.meetings.transcriptor`). Ese host puede no estar instalado; la extensión debe degradar con errores claros.

## Arquitectura y responsabilidades

| Módulo                                    | Responsabilidad                                                    |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `manifest.json`                           | MV3 Firefox, ID fijo, `background.page`, content scripts solo Meet |
| `shared/protocol.js` / `native-client.js` | NM incluyendo `record_meet_event`                                  |
| `shared/meet-*.js`                        | Detección/diff/observación de metadatos Meet (testeable)           |
| `shared/background-controller.js`         | Start/stop + bridge de eventos Meet                                |
| `content/content.js`                      | Observa solo tras `START_MEET_OBSERVATION`                         |
| `popup/*`                                 | UI + modo diagnóstico en memoria                                   |
| `docs/MEET_EVENTS.md`                     | Contrato y fiabilidad de detecciones                               |

No uses APIs `chrome.*`; usá `browser.*`. No asumas selectores estables de Meet.

## Límites extensión ↔ transcriptor Python

- La extensión solo envía mensajes JSON al host nativo.
- No ejecuta comandos de shell, no llama a APIs remotas y no escribe archivos de reunión.
- No asumas que el host ya implementa el protocolo: tratá respuestas inválidas, timeouts y desconexiones como errores.
- Nunca marques UI como **Grabando** sin `ok: true` y `session_id` del host.

## Convenciones de código

- JavaScript clásico (IIFEs UMD) en `shared/` para cargar en Firefox y en Node tests sin bundler.
- HTML/CSS simples en `popup/`.
- Mensajes de usuario en español.
- Cambios acotados: no introduzcas frameworks ni bundlers sin necesidad documentada.
- Preferí refactor mínimo para testabilidad (como los controllers actuales) en lugar de reescrituras grandes.

## Seguridad Native Messaging

- Solo conectar desde el background privilegiado (`browser.runtime.connectNative`).
- Host fijo: `com.meetings.transcriptor`.
- Validar `protocol_version`, `request_id`, forma de `ok`/`error`/`data`.
- Rechazar acciones desconocidas; no interpolar input en shells.
- `host_permissions` solo para `https://meet.google.com/*`.
- No ampliar permisos a `<all_urls>` ni host permissions globales sin justificación fuerte.
- No asociar automáticamente hablantes visuales con WhisperX en esta fase.

## Permisos Firefox y Meet

Permisos actuales: `nativeMessaging`, `activeTab`.

- `activeTab` alcanza para leer URL/título al abrir el popup.
- No hay `host_permissions` hoy; no los agregues “por si acaso”.
- La detección Meet es por URL (`https://meet.google.com/...`), no por scraping del DOM.

## Pruebas y calidad

Antes de dar por terminado un cambio:

1. Leé la documentación relevante (`README.md`, `ARCHITECTURE.md`, `TESTING.md`, `SECURITY.md` según el cambio).
2. Ejecutá los controles pertinentes. Como mínimo, tras cambios de lógica o config:

   ```bash
   npm run check
   ```

3. Si tocás hooks o el flujo de commit:

   ```bash
   pre-commit run --files <archivos-tocados>
   ```

4. Inspeccioná el diff y el estado de Git.
5. **No afirmes** que ejecutaste tests, lint o pre-commit si no los corriste en esta sesión.
6. **Prohibido** desactivar, debilitar, ignorar o eludir lint/tests/pre-commit para “hacer pasar” una tarea.
7. Si un fallo no se puede resolver, documentalo con evidencia (comando + salida), no lo ocultes.

Scripts oficiales: ver `package.json` y `TESTING.md` (`test`, `test:coverage`, `lint`, `format:check`, `validate:manifest`, `check`).

El umbral de cobertura CI es **99%** (c8 sobre `shared/` y `scripts/`). No bajes el umbral ni excluyas módulos de lógica para hacer pasar el gate.

## Cómo incorporar funcionalidades nuevas

1. Actualizá o añadí pruebas que fallen primero cuando sea razonable.
2. Implementá la lógica en `shared/` si debe ser testeable sin Firefox.
3. Cableá UI/background sin mezclar Native Messaging en el popup.
4. Actualizá `ARCHITECTURE.md` / `SECURITY.md` / `TESTING.md` si cambia el contrato, permisos o flujo.
5. Mantené permisos mínimos y compatibilidad Firefox (MV3 + `background.page`).
6. No implementes análisis de hablantes/visual ni envío remoto en esta fase salvo pedido explícito.

## Git y operaciones destructivas

- No hagas `commit`, `push`, cambio de rama, rebase, reset duro ni force-push salvo pedido explícito del usuario.
- No descartes cambios del usuario.
- No modifiques el repo del transcriptor Python.
