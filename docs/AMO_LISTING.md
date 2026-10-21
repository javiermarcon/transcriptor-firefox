# Texto para addons.mozilla.org (listed)

Copiá estos campos en el Developer Hub al publicar/actualizar el add-on
**después** de que el zip/xpi pase la validación automática.

Desde nov. 2025 AMO exige en `manifest.json`:

```json
"browser_specific_settings": {
  "gecko": {
    "data_collection_permissions": { "required": ["none"] }
  }
}
```

Sin eso falla el upload con _The 'data_collection_permissions' property is missing_
y **no** llega al formulario de descripción (Edit Product Page).
La descripción larga se edita en **Edit Product Page** → Description → **Edit**.

Fuente: este repo + host obligatorio
[javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor).

## Nombre sugerido (≤ ~50 caracteres)

- **ES:** `Meetings Transcriptor (host local)`
- **EN:** `Meetings Transcriptor (local host)`

## Resumen / Summary (≤ ~250 caracteres)

**ES:**

```text
Controla un transcriptor LOCAL de Google Meet. Requiere instalar el host Python
com.meetings.transcriptor (repo companion). No sube audio a internet.
```

**EN:**

```text
Controls a LOCAL Google Meet transcriber. Requires the companion Python host
com.meetings.transcriptor. Does not upload audio to the internet.
```

## Descripción completa (ES) — pegar en AMO

AMO solo admite Markdown limitado (negrita, cursiva, links, listas, code).
**No uses `#` títulos.** En Description → Edit, pegá exactamente:

````
**Importante: esta extensión no graba ni transcribe sola.**

Necesita software local en tu PC: el host Native Messaging del proyecto [javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor) (`com.meetings.transcriptor`). Sin ese host verás “Desconectado” y no habrá grabación.

**Qué hace**

- Popup para iniciar/detener grabación en pestañas `https://meet.google.com/…`.
- Al detener, pregunta si transcribir ahora (WhisperX en tu máquina) y muestra progreso.
- Selector de perfil de grabación (cuando el host lista perfiles).
- Metadatos visibles de participantes/hablante (heurístico) enviados solo al host local.

**Qué NO hace**

- No ejecuta FFmpeg ni WhisperX dentro de Firefox.
- No sube audio, video ni reuniones a internet.
- No envía datos a servidores remotos de terceros.
- No instala el host por sí misma.

**Instalación del host (obligatorio)**

1. Cloná e instalá [javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor) (venv, dependencias, GPU/CPU según el README).
2. Registrá el host Native Messaging:

```
./scripts/native-messaging.sh install
./scripts/native-messaging.sh verify
```

3. Reiniciá Firefox e instalá/actualizá esta extensión.

**Configuración básica (en el host, no en la extensión)**

- **HF_TOKEN**: token de Hugging Face en `~/.config/meetings-transcriptor.env` (necesario para diarización WhisperX).
- **DEVICE / GPU**: `DEVICE=auto`, `cuda` o `cpu` en el mismo archivo (detalle en el README del transcriptor).
- **Perfil**: carpetas de perfil en el directorio de reuniones del host; la extensión solo elige el nombre vía `list_profiles`.

Documentación del host: [github.com/javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor).
Código de la extensión: [github.com/javiermarcon/transcriptor-firefox](https://github.com/javiermarcon/transcriptor-firefox) (licencia MIT).

**Permisos (mínimos)**

- `nativeMessaging` — hablar solo con `com.meetings.transcriptor`.
- `activeTab` — leer URL/título de la pestaña activa al usar el popup.
- Host permission solo `https://meet.google.com/*` (content script).

Privacidad: el procesamiento de audio queda en tu máquina, a cargo del host local.
````

## Descripción completa (EN) — opcional

````
**Important: this add-on does not record or transcribe by itself.**

It requires local software: the Native Messaging host from [javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor) (`com.meetings.transcriptor`). Without that host you will see “Disconnected” and recording will not work.

**What it does**

- Popup to start/stop recording on `https://meet.google.com/…` tabs.
- On stop, asks whether to transcribe now (WhisperX on your machine) and shows progress.
- Recording profile picker (when the host lists profiles).
- Visible Meet participant/speaker metadata (heuristic), sent only to the local host.

**What it does NOT do**

- Does not run FFmpeg or WhisperX inside Firefox.
- Does not upload audio, video, or meetings to the internet.
- Does not send data to third-party remote servers.
- Does not install the host by itself.

**Required host setup**

1. Install [javiermarcon/transcriptor](https://github.com/javiermarcon/transcriptor) (venv, dependencies, GPU/CPU per its README).
2. Register the Native Messaging host:

```
./scripts/native-messaging.sh install
./scripts/native-messaging.sh verify
```

3. Restart Firefox and install/update this add-on.

**Configuration (on the host, not in the add-on)**

- **HF_TOKEN** in `~/.config/meetings-transcriptor.env`.
- **DEVICE**: `auto`, `cuda`, or `cpu`.
- **Profile**: meeting profiles live on the host; the add-on only selects a name.

MIT source: [transcriptor-firefox](https://github.com/javiermarcon/transcriptor-firefox) + [transcriptor](https://github.com/javiermarcon/transcriptor).

**Minimal permissions**

- `nativeMessaging` — talk only to `com.meetings.transcriptor`.
- `activeTab` — read active tab URL/title when opening the popup.
- Host permission only `https://meet.google.com/*`.

Privacy: audio processing stays on your machine via the local host.
````

## Categorías / etiquetas sugeridas

- Productivity / Meetings
- Keywords: `google meet`, `local`, `transcription`, `native messaging`, `whisper`, `offline`

## Checklist al publicar listed

- [ ] Nombre y summary mencionan **host / software local**.
- [ ] Description (Markdown) pegada desde este archivo.
- [ ] Links a ambos repos GitHub.
- [ ] Homepage / Contributions opcionales.
- [ ] `strict_min_version` ≥ `140.0` (y `gecko_android` ≥ `142.0`) si usás `data_collection_permissions`.
- [ ] Tras cambiar `name`/`description` en `manifest.json`, subir **New Version**.
- [ ] En “Where to Host Version”, si dice **On your own**, pulsá **Change** y elegí
      listarlo **On this site** (listed) antes de Continue.
