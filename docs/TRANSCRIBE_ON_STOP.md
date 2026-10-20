# Transcribir al detener

Al pulsar **Detener y finalizar**, el popup pregunta:

- **Aceptar** → `stop_recording` con `transcribe: true` (WhisperX en segundo plano en el host).
- **Cancelar** → `stop_recording` con `transcribe: false` (solo archivos).

## Contrato

```json
{
  "action": "stop_recording",
  "payload": {
    "session_id": "…",
    "transcribe": true
  }
}
```

Respuesta inmediata (éxito, con transcripción pedida):

```json
{
  "status": "transcribing",
  "transcribed": false,
  "transcription_started": true,
  "meeting_dir": "/…/Reunion_…",
  "files": { "…": "…" }
}
```

Mientras WhisperX corre, `get_status` responde:

```json
{
  "status": "transcribing",
  "meeting_dir": "/…/Reunion_…",
  "progress": {
    "percent": 34.0,
    "current_s": 721.0,
    "total_s": 2100.0,
    "label": "[ 34.00%] 12:01 / 35:00"
  }
}
```

Al terminar, `get_status` vuelve a `ready` con el resultado:

```json
{
  "status": "ready",
  "transcribed": true,
  "meeting_dir": "/…/Reunion_…",
  "plain_transcript": "/…/transcripcion.txt",
  "speaker_transcript": "/…/transcripcion_speakers.txt"
}
```

Si WhisperX falla, `ok` del stop sigue siendo true; el error aparece después en
`get_status` como `transcribed: false` y `transcription_error`.

## Extensión

- El stop usa el timeout NM normal (no hay espera ciega de 1 h).
- El popup hace poll de `GET_STATUS` (~1 s) y muestra el mismo `label` que el CLI
  (`Progreso de audio: …`).
- Tope de seguridad del poll en el popup: 2 h; si se supera, avisa pero el host
  puede seguir transcribiendo.

## Notas

- El host no imprime progreso a stdout NM (corrompería el framing); usa callback /
  stderr.
- No se puede iniciar otra grabación mientras `status === "transcribing"`.
