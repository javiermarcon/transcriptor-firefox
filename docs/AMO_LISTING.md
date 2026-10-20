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
La descripción larga se edita en **Edit Product Page** del add-on ya creado,
no en el primer paso de subir el archivo.
Fuente: este repo + host obligatorio
[`javiermarcon/transcriptor`](https://github.com/javiermarcon/transcriptor).

## Nombre sugerido (≤ ~50 caracteres)

**ES:** `Meetings Transcriptor (host local)`

**EN:** `Meetings Transcriptor (local host)`

Evitar nombres que suenen a “transcribe in the cloud” o “AI Meet add-on” sin aclarar el host.

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

```html
<p>
  <strong>Importante: esta extensión no graba ni transcribe sola.</strong>
  Necesita software local instalado en tu PC: el host Native Messaging del
  proyecto
  <a href="https://github.com/javiermarcon/transcriptor"
    >javiermarcon/transcriptor</a
  >
  (<code>com.meetings.transcriptor</code>). Sin ese host verás “Desconectado” y
  no habrá grabación.
</p>

<h3>Qué hace</h3>
<ul>
  <li>
    Popup para iniciar/detener grabación en pestañas
    <code>https://meet.google.com/…</code>.
  </li>
  <li>
    Al detener, pregunta si transcribir ahora (WhisperX en tu máquina) y muestra
    progreso.
  </li>
  <li>Selector de perfil de grabación (cuando el host lista perfiles).</li>
  <li>
    Metadatos visibles de participantes/hablante (heurístico) enviados solo al
    host local.
  </li>
</ul>

<h3>Qué NO hace</h3>
<ul>
  <li>No ejecuta FFmpeg ni WhisperX dentro de Firefox.</li>
  <li>No sube audio, video ni reuniones a internet.</li>
  <li>No envía datos a servidores remotos de terceros.</li>
  <li>No instala el host por sí misma.</li>
</ul>

<h3>Instalación del host (obligatorio)</h3>
<ol>
  <li>
    Cloná e instalá
    <a href="https://github.com/javiermarcon/transcriptor"
      >https://github.com/javiermarcon/transcriptor</a
    >
    (venv, dependencias, GPU/CPU según el README).
  </li>
  <li>
    Registrá el host Native Messaging:
    <pre>
./scripts/native-messaging.sh install
./scripts/native-messaging.sh verify</pre>
  </li>
  <li>Reiniciá Firefox e instalá/actualizá esta extensión.</li>
</ol>

<h3>Configuración básica (en el host, no en la extensión)</h3>
<ul>
  <li>
    <strong>HF_TOKEN</strong>: token de Hugging Face en
    <code>~/.config/meetings-transcriptor.env</code> (necesario para diarización
    WhisperX).
  </li>
  <li>
    <strong>DEVICE / GPU</strong>: <code>DEVICE=auto</code>, <code>cuda</code> o
    <code>cpu</code> en el mismo archivo (detalle en el README del
    transcriptor).
  </li>
  <li>
    <strong>Perfil</strong>: carpetas de perfil en el directorio de reuniones
    del host; la extensión solo elige el nombre vía <code>list_profiles</code>.
  </li>
</ul>

<p>
  Documentación del host:
  <a href="https://github.com/javiermarcon/transcriptor"
    >github.com/javiermarcon/transcriptor</a
  >. Código de la extensión:
  <a href="https://github.com/javiermarcon/transcriptor-firefox"
    >github.com/javiermarcon/transcriptor-firefox</a
  >
  (licencia MIT).
</p>

<h3>Permisos (mínimos)</h3>
<ul>
  <li>
    <code>nativeMessaging</code> — hablar solo con
    <code>com.meetings.transcriptor</code>.
  </li>
  <li>
    <code>activeTab</code> — leer URL/título de la pestaña activa al usar el
    popup.
  </li>
  <li>
    Host permission solo <code>https://meet.google.com/*</code> (content
    script).
  </li>
</ul>

<p>
  Privacidad: todo el procesamiento de audio queda en tu máquina a cargo del
  host local.
</p>
```

## Descripción completa (EN) — opcional

```html
<p>
  <strong
    >Important: this add-on does not record or transcribe by itself.</strong
  >
  It requires local software: the Native Messaging host from
  <a href="https://github.com/javiermarcon/transcriptor"
    >javiermarcon/transcriptor</a
  >
  (<code>com.meetings.transcriptor</code>). Without that host you will see
  “Disconnected” and recording will not work.
</p>

<h3>What it does</h3>
<ul>
  <li>
    Popup to start/stop recording on
    <code>https://meet.google.com/…</code> tabs.
  </li>
  <li>
    On stop, asks whether to transcribe now (WhisperX on your machine) and shows
    progress.
  </li>
  <li>Recording profile picker (when the host lists profiles).</li>
  <li>
    Visible Meet participant/speaker metadata (heuristic), sent only to the
    local host.
  </li>
</ul>

<h3>What it does NOT do</h3>
<ul>
  <li>Does not run FFmpeg or WhisperX inside Firefox.</li>
  <li>Does not upload audio, video, or meetings to the internet.</li>
  <li>Does not send data to third-party remote servers.</li>
  <li>Does not install the host by itself.</li>
</ul>

<h3>Required host setup</h3>
<ol>
  <li>
    Install
    <a href="https://github.com/javiermarcon/transcriptor"
      >https://github.com/javiermarcon/transcriptor</a
    >
    (venv, dependencies, GPU/CPU per its README).
  </li>
  <li>
    Register the Native Messaging host:
    <pre>
./scripts/native-messaging.sh install
./scripts/native-messaging.sh verify</pre>
  </li>
  <li>Restart Firefox and install/update this add-on.</li>
</ol>

<h3>Configuration (on the host, not in the add-on)</h3>
<ul>
  <li>
    <strong>HF_TOKEN</strong> in
    <code>~/.config/meetings-transcriptor.env</code>.
  </li>
  <li>
    <strong>DEVICE</strong>: <code>auto</code>, <code>cuda</code>, or
    <code>cpu</code>.
  </li>
  <li>
    <strong>Profile</strong>: meeting profiles live on the host; the add-on only
    selects a name.
  </li>
</ul>

<p>
  MIT source:
  <a href="https://github.com/javiermarcon/transcriptor-firefox"
    >transcriptor-firefox</a
  >
  +
  <a href="https://github.com/javiermarcon/transcriptor">transcriptor</a>.
</p>
```

## Categorías / etiquetas sugeridas

- Productivity / Meetings
- Keywords: `google meet`, `local`, `transcription`, `native messaging`, `whisper`, `offline`

## Checklist al publicar listed

- [ ] Nombre y summary mencionan **host / software local**.
- [ ] Primer párrafo de la descripción: “no funciona sola”.
- [ ] Links a ambos repos GitHub.
- [ ] Política de privacidad / texto: no sube audio.
- [ ] Capturas: popup desconectado + popup grabando (opcional).
- [ ] Tras cambiar `name`/`description` en `manifest.json`, regenerar `.xpi` firmado (nueva versión).
