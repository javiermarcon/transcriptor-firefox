# Meetings Transcriptor (Firefox)

Extensión Firefox para **controlar** un transcriptor local de reuniones de Google Meet mediante Native Messaging.

ID fijo: `meetings-transcriptor@example.org`.

## Propósito y alcance actual

La extensión permite:

- Abrir un popup desde la barra de herramientas.
- Detectar si la pestaña activa es `https://meet.google.com/…`.
- Consultar el estado del host local `com.meetings.transcriptor`.
- Pedir al host iniciar o detener una grabación con acción explícita del usuario.
- Elegir el perfil de grabación del transcriptor (cuando el host implemente `list_profiles`).
- Durante una grabación, observar metadatos visibles de participantes/hablante en Meet y enviarlos al host con `record_meet_event`.
- Mostrar errores claros si el host no está instalado, no responde o rechaza la operación.

La extensión **no**:

- Ejecuta FFmpeg ni lógica de transcripción.
- Asocia automáticamente hablantes visuales con segmentos de WhisperX.
- Envía audio, video o datos a servicios remotos.
- Instala el host nativo por sí misma.

## Estado real de implementación

| Capacidad                                    | Estado                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| Popup + estados de UI                        | Implementado                                               |
| Detección de pestaña Meet por URL            | Implementado                                               |
| Cliente Native Messaging + protocolo v1      | Implementado en la extensión                               |
| Evitar “Grabando” sin `session_id` del host  | Implementado                                               |
| Metadatos de participantes / hablante visual | Implementado (heurístico; ver `docs/MEET_EVENTS.md`)       |
| Selector de perfil de grabación              | Implementado en la extensión; host: ver `docs/PROFILES.md` |
| Persistencia de eventos en el host           | Pendiente en el host (`record_meet_event`)                 |
| Suite unitaria, lint, format, pre-commit     | Implementado                                               |
| Host nativo real / grabación end-to-end      | **Fuera de este repo**                                     |
| Prueba manual en reunión Meet real           | Pendiente (ver `TESTING.md`)                               |

Hasta validar un host real, no se debe asumir que una grabación de reunión completa funciona solo porque la UI está lista.

## Requisitos

- Firefox 121+ (Manifest V3 con `background.page`).
- Node.js ≥ 18 y npm (desarrollo / calidad).
- `pre-commit` (hooks Git de desarrollo).
- Host `com.meetings.transcriptor` (opcional para UI; obligatorio para grabar de verdad).

## Instalación de dependencias de desarrollo

```bash
npm install
pre-commit install   # una vez por clone, si vas a crear commits
```

## Carga temporal en Firefox

1. Abrí `about:debugging#/runtime/this-firefox`.
2. **Cargar complemento temporal…** y elegí `manifest.json`.
3. El icono aparece en la barra de herramientas.
4. La carga temporal se pierde al cerrar Firefox (intencional).

Firefox puede mostrar _“This WebExtension has a temporary ID”_ aunque el **Extension ID** sea `meetings-transcriptor@example.org`. Eso indica instalación temporal (no persistente), no que falte el ID fijo. El UUID interno (`moz-extension://…`) es normal.

Tras cambiar código: en about:debugging pulsá **Reload** en la extensión y volvé a abrir el popup. Si el background figura como _Stopped_, abrí el popup otra vez (el event page MV3 se detiene en idle).

No se instala automáticamente en el perfil.

## Pruebas y controles de calidad

```bash
npm test                 # suite unitaria (node:test)
npm run test:coverage    # suite + cobertura c8 (umbral 99%)
npm run lint             # ESLint
npm run format:check     # Prettier
npm run validate:manifest
npm run check            # formato + lint + manifest + tests con cobertura
```

Hooks:

```bash
pre-commit run --files <archivos>
pre-commit run --all-files   # usar con criterio
```

Detalle completo: [`TESTING.md`](./TESTING.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Host no instalado

Si Firefox no encuentra `com.meetings.transcriptor`:

- el popup abre igual;
- estado **Desconectado** + mensaje en español;
- no se simula una grabación activa.

Registro típico del manifiesto nativo (lo provee el proyecto del host):

```text
~/.mozilla/native-messaging-hosts/com.meetings.transcriptor.json
```

Debe incluir `meetings-transcriptor@example.org` en `allowed_extensions`.

## Limitaciones actuales

- Sin observación en vivo de cambio de pestaña mientras el popup permanece abierto.
- Sin host empaquetado en este repositorio.
- Grabación real no verificada end-to-end en CI.
- Los selectores DOM de Meet son inestables; las detecciones llevan `confidence`/`quality`.
- Ver a alguien en la lista no demuestra que pronunció una frase concreta.

## Documentación

- [`AGENTS.md`](./AGENTS.md) — reglas para agentes de IA
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — arquitectura efectiva
- [`SECURITY.md`](./SECURITY.md) — modelo de seguridad
- [`TESTING.md`](./TESTING.md) — pruebas y calidad
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — flujo de contribución
- [`docs/MEET_EVENTS.md`](./docs/MEET_EVENTS.md) — eventos Meet, contrato `record_meet_event` y fiabilidad

## Estructura

```text
transcriptor-firefox/
├── manifest.json
├── background/
├── popup/
├── shared/          # lógica testeable (protocolo, cliente, UI state, controllers)
├── scripts/         # validate-manifest
├── tests/
├── icons/
└── docs de ingeniería (*.md)
```
