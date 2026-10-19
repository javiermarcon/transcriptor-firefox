# Perfiles de grabación

La extensión permite elegir el **perfil del transcriptor** (carpeta con
`initial_prompt.txt` / `hotwords.txt`) antes de iniciar una grabación.

## Contrato Native Messaging (host)

### `list_profiles`

Solicitud:

```json
{
  "protocol_version": 1,
  "request_id": "...",
  "action": "list_profiles",
  "payload": {}
}
```

Respuesta `data` esperada:

```json
{
  "profiles": ["Shipii", "motonave"],
  "default_profile": "Shipii"
}
```

- `profiles`: nombres válidos (`^[A-Za-z0-9_.-]+$`), carpetas bajo `BASE_DIR`.
- `default_profile`: opcional; suele coincidir con `NATIVE_MESSAGING_PROFILE`.

### `start_recording` con perfil

```json
{
  "action": "start_recording",
  "payload": {
    "url": "https://meet.google.com/abc-defg-hij",
    "title": "Standup",
    "profile": "Shipii"
  }
}
```

El host debe:

1. Aceptar el campo opcional `profile`.
2. Usarlo en lugar de (o con fallback a) `NATIVE_MESSAGING_PROFILE`.
3. Devolver `profile` en `data` al confirmar el inicio.

## Comportamiento de la extensión

| Host                      | UI                                                                  |
| ------------------------- | ------------------------------------------------------------------- |
| Soporta `list_profiles`   | Selector obligatorio si hay perfiles                                |
| Responde `UNKNOWN_ACTION` | Aviso; inicia sin enviar `profile` (compatibilidad con host actual) |
| Lista vacía               | No permite iniciar hasta que exista al menos un perfil              |

La preferencia de perfil se guarda en memoria del background mientras viva la
event page (no usa `storage`).

## Estado del host Python

En el repositorio del transcriptor, el host actual **aún no** implementa
`list_profiles` y **rechaza** campos extra en `start_recording`. Hasta
actualizarlo, el popup mostrará el aviso de compatibilidad y la grabación
seguirá usando `NATIVE_MESSAGING_PROFILE`.
