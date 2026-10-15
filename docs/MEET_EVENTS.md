# Eventos visibles de Google Meet

La extensión puede observar la **interfaz visible** de Meet durante una grabación y enviar eventos temporales al host local con la acción Native Messaging `record_meet_event`.

Esto **no** identifica quién pronunció cada frase de la transcripción. Solo registra indicios visuales (lista de participantes / indicador de habla) con marca temporal.

## Cuándo se activa

1. El usuario inicia una grabación desde el popup.
2. El host confirma `session_id`.
3. El background envía `START_MEET_OBSERVATION` al content script de la pestaña Meet.
4. Al detener la grabación (o si el host deja de reportar `recording`), se envía `STOP_MEET_OBSERVATION` y cesa el polling/observer.

Fuera de `https://meet.google.com/*` o sin sesión activa no se recolecta nada.

## Contrato `record_meet_event`

Solicitud (protocolo v1):

```json
{
  "protocol_version": 1,
  "request_id": "...",
  "action": "record_meet_event",
  "payload": {
    "session_id": "sess-...",
    "event_type": "participant_joined",
    "timestamp_epoch_ms": 1710000000000,
    "source": "dom_people_list",
    "display_name": "Ana Pérez",
    "participant_key": "dom_people_list:name:ana pérez",
    "confidence": 0.55,
    "quality": "heuristic_unstable_selector",
    "details": { "reason": "appeared_in_snapshot" }
  }
}
```

Respuesta esperada del host:

```json
{
  "protocol_version": 1,
  "request_id": "...",
  "ok": true,
  "data": {}
}
```

El host (fuera de este repo) debe persistir localmente. La extensión no guarda audio ni envía datos a servicios remotos.

### Tipos de evento

| `event_type`                                  | Significado                                       |
| --------------------------------------------- | ------------------------------------------------- |
| `observation_started` / `observation_stopped` | Ciclo de vida de la recolección                   |
| `participant_joined` / `participant_left`     | Apareció / desapareció entre snapshots            |
| `participant_seen`                            | Reservado; no se emite en el flujo actual de diff |
| `active_speaker_changed`                      | Cambió el indicador visual de habla               |

## Fiabilidad de las detecciones

| Fuente (`source`)    | Qué mira                                                      | Fiabilidad                                              |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| `dom_participant_id` | Nodos con `data-participant-id` + nombre visible              | Media-alta **mientras** Meet exponga ese atributo       |
| `dom_people_list`    | Lista accesible de participantes (`role="list"` + aria-label) | Media; depende de que el panel esté abierto/renderizado |
| `dom_aria_tile`      | Tiles con `aria-label` con forma de nombre                    | Baja; muchos falsos positivos posibles                  |
| `dom_speaking_attr`  | `data-is-speaking` / `data-speaking`                          | Media; solo indicador visual                            |
| `dom_speaking_aria`  | `aria-label` con “speaking/hablando”                          | Baja-media                                              |

**No son estables:** selectores CSS/atributos de Meet cambian sin aviso. Por eso cada evento lleva `confidence` y `quality`.

**No inventamos nombres:** si no hay señal usable, no se emite evento de hablante.

## Rendimiento

- Polling cada ~2 s (no MutualObservation del `document` completo).
- `MutationObserver` solo si se encuentra un root acotado (lista de participantes), con debounce 500 ms y `attributeFilter` limitado.
- Tope de eventos por minuto.
- No observa pestañas ocultas (`document.hidden`).

## Modo diagnóstico

En el popup: _Modo diagnóstico (solo en memoria)_.

- Conserva los últimos eventos en el background para inspección.
- No escribe archivos ni envía a red.
- Útil para validar qué ve la extensión en una reunión real antes de confiar en el host.

## Pruebas

```bash
npm test
# o
node --test tests/meet-events.test.js
```

Usa fixtures HTML en `tests/fixtures/` (no requieren Meet real).

## Fuera de alcance (aún)

- Asociación automática entre estos eventos y segmentos WhisperX / diarización.
- OCR o capturas de pantalla continuas.
- APIs privadas de Google, cookies o tokens.
