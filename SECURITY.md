# Seguridad

Modelo de seguridad de la extensión v0.3.0 según el código actual.

La grabación y la transcripción las realiza el host local del repo compañero
[`javiermarcon/transcriptor`](https://github.com/javiermarcon/transcriptor)
(MIT). Esta extensión solo envía mensajes JSON controlados por Native Messaging.

## Permisos solicitados

| Permiso                                       | Por qué                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| `nativeMessaging`                             | Hablar con el host local `com.meetings.transcriptor`     |
| `activeTab`                                   | Leer URL/título/id de la pestaña activa al usar el popup |
| `host_permissions: https://meet.google.com/*` | Content script y mensajería solo en Meet                 |

No se solicitan:

- `<all_urls>` / host permissions fuera de Meet
- almacenamiento persistente (`storage`)
- capturas de pantalla / `desktopCapture`
- red remota explícita

## Información que recibe y envía

**Desde la pestaña Meet (DOM visible, solo durante grabación):**

- Nombres de visualización detectados
- Señales visuales de hablante activo (si existen)
- Timestamps y metadatos de calidad/confianza

**Envía al host local (JSON por Native Messaging):**

- `get_status`
- `list_profiles` (si el host lo implementa)
- `start_recording` / `stop_recording` (con `profile` opcional)
- `record_meet_event` con el payload documentado en `docs/MEET_EVENTS.md`

**No envía** audio, video, cookies, tokens de Google ni datos a servicios externos.

## Restricción de mensajes al host

- Único nombre de host: `com.meetings.transcriptor`.
- `connectNative` solo desde el background.
- Content scripts hablan con el background; el background habla con el host.
- El manifiesto nativo debe listar `meetings-transcriptor@example.org`.

## Validación

- Protocolo v1 con `request_id`.
- Eventos Meet validados (`session_id`, `event_type`, etc.) antes de reenviar.
- Observación activa solo con sesión de grabación confirmada.
- Sin `eval` / `new Function` / shell.

## Qué se guarda y qué no

| Dato                    | ¿Se guarda en la extensión?                                     |
| ----------------------- | --------------------------------------------------------------- |
| Audio/video             | No                                                              |
| Eventos Meet            | No de forma persistente; buffer diagnóstico opcional en memoria |
| Persistencia de eventos | Responsabilidad del host vía `record_meet_event`                |

## Riesgos conocidos

| Riesgo                                   | Mitigación / estado                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Selectores Meet inestables               | `confidence`/`quality`; documentado; no inventar nombres                                 |
| Confundir presencia con autoría de frase | Advertencia en eventos y docs                                                            |
| Host aún sin `record_meet_event`         | La extensión envía el contrato; errores del host no inventan éxito local de persistencia |
| Host aún sin `list_profiles` / `profile` | No se envía `profile` en start; se usa el default del host (`NATIVE_MESSAGING_PROFILE`)  |
| Content script cargado en Meet idle      | No observa hasta `START_MEET_OBSERVATION`                                                |
