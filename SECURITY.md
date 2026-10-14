# Seguridad

Modelo de seguridad de la extensión v0.1.0 según el código actual.

## Permisos solicitados

| Permiso           | Por qué                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `nativeMessaging` | Hablar con el host local `com.meetings.transcriptor`                 |
| `activeTab`       | Leer URL/título de la pestaña activa cuando el usuario abre el popup |

No se solicitan:

- `<all_urls>` / host permissions amplios
- `tabs` persistente
- almacenamiento (`storage`)
- capturas de pantalla / `desktopCapture`
- red remota explícita

## Información que recibe y envía

**Recibe (pestaña activa, vía `tabs.query` + `activeTab`):**

- URL (solo se reenvía al host si es Meet)
- Título de la pestaña

**Envía al host local (JSON por Native Messaging):**

- `get_status` sin payload sensible
- `start_recording` con `{ url, title }`
- `stop_recording` con `{ session_id }`

**No envía** audio, video, cookies, tokens de Google ni listas de participantes.

## Restricción de mensajes al host

- Único nombre de host: `com.meetings.transcriptor`.
- Conexión solo desde el background (`connectNative`), no desde content scripts (no hay content scripts).
- El SO/Firefox también exige que el manifiesto nativo liste `meetings-transcriptor@example.org` en `allowed_extensions`.

## Validación de mensajes y errores

Implementado en código:

- `protocol_version` debe ser `1`.
- Matching estricto de `request_id` para completar una promesa.
- Respuestas no objeto / sin `ok` → `INVALID_RESPONSE`.
- Start sin `session_id` string no vacío → error `MISSING_SESSION_ID` (no se marca grabación).
- Acciones desconocidas en `buildRequest` lanzan error.
- Errores de conexión mapeados a códigos `HOST_NOT_FOUND` / `HOST_DISCONNECTED` / `HOST_UNAVAILABLE`.
- Timeouts evitan quedar colgado indefinidamente.

## URLs inesperadas, datos inválidos e inyección

Implementado:

- `isMeetUrl` exige `https:` + hostname exacto `meet.google.com` (rechaza `http`, otros hosts y strings no-URL).
- Start desde background se aborta con `NOT_MEET_TAB` si la pestaña no es Meet.
- No hay `eval`, `new Function`, ni `child_process` en los módulos de la extensión (también lo refuerza ESLint: `no-eval`, `no-implied-eval`, `no-new-func`).
- El protocolo no interpreta el payload como comando de shell; es JSON tipado por acción.

No implementado (riesgo residual):

- Firmado criptográfico de mensajes con el host.
- Allowlist adicional de paths Meet más estricta que el hostname.
- Sandbox del proceso host (depende del SO / del proyecto del host).

## Límites de confianza navegador ↔ proceso local

- Firefox aísla la extensión del host salvo el canal Native Messaging.
- El host local, una vez autorizado, es **código confiable de máquina**: puede hacer lo que su binario permita (grabar audio, escribir disco, etc.). Esa superficie está fuera de este repositorio.
- Una extensión maliciosa con el mismo ID no debería poder hablar con el host salvo que el manifiesto nativo la autorice; durante desarrollo temporal el ID está fijado a propósito.

## Qué se guarda y qué no

| Dato              | ¿Se guarda?                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Audio/video       | No en la extensión                                                                        |
| Transcripciones   | No en la extensión                                                                        |
| `session_id`      | Solo en memoria del background (`lastSessionId`) mientras dura la sesión de la event page |
| Preferencias      | No hay `storage`                                                                          |
| Telemetría remota | No                                                                                        |

Al cerrar Firefox o dormir la event page, el estado en memoria puede perderse; el host es la fuente de verdad vía `get_status`.

## Riesgos conocidos y mitigaciones pendientes

| Riesgo                               | Estado                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Host ausente / roto                  | Mitigado en UI con estado desconectado + mensaje                             |
| Host responde `ok` sin `session_id`  | Mitigado: no se marca grabación                                              |
| Host malicioso local                 | Pendiente / fuera de alcance: confiar en el binario instalado por el usuario |
| Phishing visual del popup            | Pendiente: no hay firma de UI más allá del ID de extensión                   |
| Title/URL sensibles enviados al host | Aceptado por diseño para nombrar la sesión; solo desde pestaña Meet          |
| Cambio de pestaña con popup abierto  | No hay listener en vivo; el usuario debe reabrir/reconsultar                 |
| Grabación real end-to-end            | Depende del host externo; no afirmarse como validada solo por esta extensión |

Este documento no inventa controles: si algo aparece como “pendiente”, no está implementado en código.
