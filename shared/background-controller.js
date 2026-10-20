/**
 * Orquestación del background: pestaña activa + cliente Native Messaging.
 * Separado del cableado de browser.* para poder probarse en Node.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsMeetTab, root.MeetingsMeetEventSchema);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsBackgroundController = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (MeetTab, EventSchema) {
    /* c8 ignore stop */
    function createBackgroundController(options = {}) {
      const meetTab = options.meetTab || MeetTab;
      const eventSchema = options.eventSchema || EventSchema;
      const client = options.client;
      const getActiveTab = options.getActiveTab;
      const protocol = options.protocol;
      const notifyMeetTab =
        options.notifyMeetTab || (async () => ({ ok: false }));
      const maxDiagnosticEvents = options.maxDiagnosticEvents || 40;

      if (!client || typeof client.getStatus !== "function") {
        throw new Error("client Native Messaging requerido");
      }
      if (typeof getActiveTab !== "function") {
        throw new Error("getActiveTab requerido");
      }

      let lastSessionId = null;
      let observationTabId = null;
      let diagnosticEnabled = false;
      let diagnosticEvents = [];
      let lastObservationError = null;
      let preferredProfile = null;
      let cachedProfiles = [];
      let profilesSupported = false;
      let profilesError = "";
      let defaultProfile = null;

      function isValidProfile(name) {
        if (protocol && typeof protocol.isValidProfileName === "function") {
          return protocol.isValidProfileName(name);
        }
        return (
          typeof name === "string" && /^[A-Za-z0-9_.-]+$/.test(name.trim())
        );
      }

      function profileSnapshot() {
        return {
          profilesSupported,
          profiles: cachedProfiles.slice(),
          defaultProfile,
          selectedProfile: preferredProfile,
          profilesError,
        };
      }

      async function refreshProfiles() {
        if (typeof client.listProfiles !== "function") {
          profilesSupported = false;
          cachedProfiles = [];
          defaultProfile = null;
          profilesError = "";
          return profileSnapshot();
        }

        try {
          const response = await client.listProfiles();
          if (!response.ok) {
            const code = response.error && response.error.code;
            profilesSupported = false;
            cachedProfiles = [];
            defaultProfile = null;
            profilesError =
              code === "UNKNOWN_ACTION"
                ? "El host aún no soporta list_profiles; usará NATIVE_MESSAGING_PROFILE."
                : (response.error && response.error.message) ||
                  "No se pudieron listar los perfiles.";
            return profileSnapshot();
          }

          const data = response.data || {};
          profilesSupported = true;
          cachedProfiles = Array.isArray(data.profiles)
            ? data.profiles.slice()
            : [];
          defaultProfile =
            typeof data.default_profile === "string"
              ? data.default_profile
              : null;
          profilesError =
            cachedProfiles.length === 0
              ? "No hay perfiles en el directorio base del transcriptor."
              : "";

          if (preferredProfile && !cachedProfiles.includes(preferredProfile)) {
            preferredProfile = null;
          }
          if (!preferredProfile && defaultProfile) {
            preferredProfile = defaultProfile;
          }
          if (!preferredProfile && cachedProfiles.length === 1) {
            preferredProfile = cachedProfiles[0];
          }
          return profileSnapshot();
        } catch (err) {
          profilesSupported = false;
          cachedProfiles = [];
          defaultProfile = null;
          profilesError =
            err && err.message
              ? err.message
              : "No se pudieron listar los perfiles.";
          return profileSnapshot();
        }
      }

      function toErrorPayload(err) {
        return {
          ok: false,
          error: {
            code: err && err.code ? err.code : "HOST_UNAVAILABLE",
            message:
              err && err.message
                ? err.message
                : "No se pudo comunicar con el host local del transcriptor.",
          },
        };
      }

      function hostUnavailableStatus(code) {
        return code === "HOST_NOT_FOUND" ||
          code === "HOST_UNAVAILABLE" ||
          code === "HOST_DISCONNECTED"
          ? "disconnected"
          : "error";
      }

      function pushDiagnostic(event) {
        diagnosticEvents.push(event);
        if (diagnosticEvents.length > maxDiagnosticEvents) {
          diagnosticEvents = diagnosticEvents.slice(-maxDiagnosticEvents);
        }
      }

      async function resolveTabInfo(message) {
        if (message && message.tab && typeof message.tab === "object") {
          return meetTab.describeActiveTab(message.tab);
        }
        return meetTab.describeActiveTab(await getActiveTab());
      }

      async function startObservation(sessionId, tab) {
        const tabId =
          tab && typeof tab.id === "number"
            ? tab.id
            : messageTabIdFallback(tab);
        if (typeof tabId !== "number") {
          lastObservationError =
            "No hay tabId de Meet para iniciar la observación de participantes.";
          return;
        }
        observationTabId = tabId;
        lastObservationError = null;
        try {
          const result = await notifyMeetTab(tabId, {
            type: "START_MEET_OBSERVATION",
            sessionId,
            diagnostic: diagnosticEnabled,
          });
          if (result && result.ok === false) {
            lastObservationError =
              (result.error && result.error.message) ||
              "El content script no pudo iniciar la observación.";
          }
        } catch (err) {
          lastObservationError =
            err && err.message
              ? err.message
              : "No se pudo contactar el content script de Meet.";
        }
      }

      function messageTabIdFallback(tab) {
        return tab && typeof tab.tabId === "number" ? tab.tabId : null;
      }

      async function stopObservation() {
        const tabId = observationTabId;
        observationTabId = null;
        if (typeof tabId !== "number") {
          return;
        }
        try {
          await notifyMeetTab(tabId, { type: "STOP_MEET_OBSERVATION" });
        } catch (_err) {
          // La pestaña pudo cerrarse; la recolección local igual se corta al unload.
        }
      }

      async function handleGetStatus(message) {
        const tabInfo = await resolveTabInfo(message);
        try {
          const response = await client.getStatus();
          if (!response.ok) {
            return Object.assign(
              {
                ok: false,
                tab: tabInfo,
                transcriptorStatus: "error",
                sessionId: lastSessionId,
                observationActive: Boolean(observationTabId),
                diagnosticEnabled,
                error: response.error,
              },
              profileSnapshot()
            );
          }

          const data = response.data || {};
          if (data.status === "recording" && data.session_id) {
            lastSessionId = data.session_id;
          } else if (data.status !== "recording") {
            if (lastSessionId) {
              await stopObservation();
            }
            lastSessionId = null;
          }

          const profiles = await refreshProfiles();
          const status = data.status || "ready";
          const hostMessage =
            typeof data.message === "string" ? data.message.trim() : "";
          const progress =
            data.progress && typeof data.progress === "object"
              ? data.progress
              : null;
          return Object.assign(
            {
              ok: status !== "error",
              tab: tabInfo,
              transcriptorStatus: status,
              sessionId: data.session_id || lastSessionId,
              hostMessage,
              progress,
              transcribed: Boolean(data.transcribed),
              transcriptionError:
                typeof data.transcription_error === "string"
                  ? data.transcription_error
                  : null,
              plainTranscript:
                typeof data.plain_transcript === "string"
                  ? data.plain_transcript
                  : null,
              meetingDir:
                typeof data.meeting_dir === "string" ? data.meeting_dir : null,
              observationActive: Boolean(observationTabId),
              diagnosticEnabled,
              observationError: lastObservationError || "",
              error:
                status === "error"
                  ? {
                      code: "HOST_STATUS_ERROR",
                      message:
                        hostMessage ||
                        "El transcriptor reportó un estado de error.",
                    }
                  : undefined,
            },
            profiles
          );
        } catch (err) {
          const failure = toErrorPayload(err);
          return Object.assign(
            {
              ok: false,
              tab: tabInfo,
              transcriptorStatus: hostUnavailableStatus(failure.error.code),
              sessionId: lastSessionId,
              observationActive: Boolean(observationTabId),
              diagnosticEnabled,
              error: failure.error,
            },
            profileSnapshot()
          );
        }
      }

      function handleSetPreferredProfile(message) {
        const raw = message && message.profile;
        if (raw === null || raw === "") {
          preferredProfile = null;
          return Promise.resolve(
            Object.assign({ ok: true }, profileSnapshot())
          );
        }
        if (!isValidProfile(raw)) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "INVALID_PROFILE",
              message:
                "Nombre de perfil inválido. Usá letras, números, punto, guion o guion bajo.",
            },
          });
        }
        const name = String(raw).trim();
        if (
          profilesSupported &&
          cachedProfiles.length &&
          !cachedProfiles.includes(name)
        ) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "UNKNOWN_PROFILE",
              message: `El perfil "${name}" no está en la lista del host.`,
            },
          });
        }
        preferredProfile = name;
        return Promise.resolve(Object.assign({ ok: true }, profileSnapshot()));
      }

      async function handleStartRecording(message) {
        const tabInfo = await resolveTabInfo(message);

        if (!tabInfo.onMeet) {
          return Object.assign(
            {
              ok: false,
              tab: tabInfo,
              transcriptorStatus: "error",
              sessionId: lastSessionId,
              error: {
                code: "NOT_MEET_TAB",
                message:
                  "Abrí una pestaña de Google Meet antes de iniciar la grabación.",
              },
            },
            profileSnapshot()
          );
        }

        const requestedProfile =
          message &&
          typeof message.profile === "string" &&
          message.profile.trim()
            ? message.profile.trim()
            : preferredProfile;

        if (requestedProfile) {
          if (!isValidProfile(requestedProfile)) {
            return Object.assign(
              {
                ok: false,
                tab: tabInfo,
                transcriptorStatus: "error",
                sessionId: lastSessionId,
                error: {
                  code: "INVALID_PROFILE",
                  message:
                    "Nombre de perfil inválido. Usá letras, números, punto, guion o guion bajo.",
                },
              },
              profileSnapshot()
            );
          }
          preferredProfile = requestedProfile;
        }

        if (
          profilesSupported &&
          cachedProfiles.length > 0 &&
          !preferredProfile
        ) {
          return Object.assign(
            {
              ok: false,
              tab: tabInfo,
              transcriptorStatus: "error",
              sessionId: lastSessionId,
              error: {
                code: "PROFILE_REQUIRED",
                message: "Elegí un perfil antes de iniciar la grabación.",
              },
            },
            profileSnapshot()
          );
        }

        try {
          const startPayload = {
            url: tabInfo.url,
            title: tabInfo.title || "Reunión de Google Meet",
          };
          // Solo enviar profile si el host listó perfiles (acepta el campo).
          if (profilesSupported && preferredProfile) {
            startPayload.profile = preferredProfile;
          }

          const response = await client.startRecording(startPayload);

          if (!response.ok) {
            return Object.assign(
              {
                ok: false,
                tab: tabInfo,
                transcriptorStatus: "error",
                sessionId: lastSessionId,
                error: response.error,
              },
              profileSnapshot()
            );
          }

          lastSessionId = response.data.session_id;
          const recordedProfile =
            response.data && typeof response.data.profile === "string"
              ? response.data.profile
              : preferredProfile;
          if (recordedProfile && isValidProfile(recordedProfile)) {
            preferredProfile = recordedProfile.trim();
          }
          await startObservation(lastSessionId, message && message.tab);
          return Object.assign(
            {
              ok: true,
              tab: tabInfo,
              transcriptorStatus: "recording",
              sessionId: lastSessionId,
              observationActive: Boolean(observationTabId),
              diagnosticEnabled,
              observationError: lastObservationError || "",
            },
            profileSnapshot()
          );
        } catch (err) {
          const failure = toErrorPayload(err);
          return Object.assign(
            {
              ok: false,
              tab: tabInfo,
              transcriptorStatus: hostUnavailableStatus(failure.error.code),
              sessionId: lastSessionId,
              error: failure.error,
            },
            profileSnapshot()
          );
        }
      }

      async function handleStopRecording(message) {
        const tabInfo = await resolveTabInfo(message);
        const sessionId =
          (message && message.sessionId) || lastSessionId || null;

        if (!sessionId) {
          return {
            ok: false,
            tab: tabInfo,
            transcriptorStatus: "error",
            sessionId: null,
            error: {
              code: "NO_SESSION",
              message: "No hay una sesión de grabación activa para detener.",
            },
          };
        }

        await stopObservation();

        const transcribe = Boolean(message && message.transcribe);
        try {
          const response = await client.stopRecording({
            session_id: sessionId,
            transcribe,
          });
          if (!response.ok) {
            return Object.assign(
              {
                ok: false,
                tab: tabInfo,
                transcriptorStatus: "error",
                sessionId,
                observationActive: false,
                error: response.error,
              },
              profileSnapshot()
            );
          }

          lastSessionId = null;
          const data = response.data || {};
          const transcriptionStarted = Boolean(data.transcription_started);
          let hostMessage = "";
          let transcriptorStatus = "ready";
          if (transcriptionStarted) {
            transcriptorStatus = "transcribing";
            hostMessage = data.meeting_dir
              ? `Grabación guardada. Transcribiendo… (${data.meeting_dir})`
              : "Grabación guardada. Transcribiendo…";
          } else if (transcribe && data.transcribed) {
            hostMessage = data.plain_transcript
              ? `Transcripción lista: ${data.plain_transcript}`
              : "Transcripción lista.";
          } else if (transcribe && data.transcription_error) {
            hostMessage = `Grabación detenida, pero falló la transcripción: ${data.transcription_error}`;
          } else if (data.meeting_dir) {
            hostMessage = `Grabación guardada en: ${data.meeting_dir}`;
          }

          return Object.assign(
            {
              ok: true,
              tab: tabInfo,
              transcriptorStatus,
              sessionId: null,
              observationActive: false,
              diagnosticEnabled,
              hostMessage,
              transcribed: Boolean(data.transcribed),
              transcriptionStarted,
              meetingDir: data.meeting_dir || null,
            },
            profileSnapshot()
          );
        } catch (err) {
          const failure = toErrorPayload(err);
          return Object.assign(
            {
              ok: false,
              tab: tabInfo,
              transcriptorStatus: "error",
              sessionId,
              observationActive: false,
              error: failure.error,
            },
            profileSnapshot()
          );
        }
      }

      async function handleMeetEvent(message) {
        if (!lastSessionId) {
          return {
            ok: false,
            error: {
              code: "NO_SESSION",
              message: "No hay sesión activa para eventos Meet.",
            },
          };
        }

        const incoming = message.event || {};
        if (
          typeof incoming.session_id === "string" &&
          incoming.session_id.trim() &&
          incoming.session_id.trim() !== lastSessionId
        ) {
          return {
            ok: false,
            error: {
              code: "SESSION_MISMATCH",
              message: "El evento no corresponde a la sesión activa.",
            },
          };
        }

        const validated = eventSchema.validateMeetEvent(
          Object.assign({}, incoming, {
            session_id: lastSessionId,
          })
        );
        if (!validated.ok) {
          return {
            ok: false,
            error: { code: "INVALID_MEET_EVENT", message: validated.error },
          };
        }

        if (diagnosticEnabled) {
          pushDiagnostic(validated.event);
        }

        if (typeof client.recordMeetEvent !== "function") {
          return {
            ok: false,
            error: {
              code: "HOST_UNSUPPORTED",
              message: "El cliente no soporta record_meet_event.",
            },
          };
        }

        try {
          const response = await client.recordMeetEvent(validated.event);
          return response;
        } catch (err) {
          return toErrorPayload(err);
        }
      }

      function handleGetDiagnostics() {
        return Promise.resolve({
          ok: true,
          diagnosticEnabled,
          observationActive: Boolean(observationTabId),
          sessionId: lastSessionId,
          observationError: lastObservationError || "",
          recentEvents: diagnosticEnabled ? diagnosticEvents.slice() : [],
        });
      }

      function handleSetDiagnostic(message) {
        diagnosticEnabled = Boolean(message && message.enabled);
        if (!diagnosticEnabled) {
          diagnosticEvents = [];
        }
        if (typeof observationTabId === "number") {
          return notifyMeetTab(observationTabId, {
            type: "SET_MEET_DIAGNOSTIC",
            enabled: diagnosticEnabled,
          })
            .then(() => ({
              ok: true,
              diagnosticEnabled,
            }))
            .catch(() => ({
              ok: true,
              diagnosticEnabled,
            }));
        }
        return Promise.resolve({ ok: true, diagnosticEnabled });
      }

      function handleMessage(message) {
        if (!message || typeof message !== "object") {
          return Promise.resolve({
            ok: false,
            error: { code: "BAD_MESSAGE", message: "Mensaje inválido." },
          });
        }

        switch (message.type) {
          case "GET_STATUS":
            return handleGetStatus(message);
          case "START_RECORDING":
            return handleStartRecording(message);
          case "STOP_RECORDING":
            return handleStopRecording(message);
          case "SET_PREFERRED_PROFILE":
            return handleSetPreferredProfile(message);
          case "MEET_EVENT":
            return handleMeetEvent(message);
          case "GET_DIAGNOSTICS":
            return handleGetDiagnostics();
          case "SET_DIAGNOSTIC":
            return handleSetDiagnostic(message);
          case "PROTOCOL_INFO":
            return Promise.resolve({
              ok: true,
              host: protocol ? protocol.NATIVE_HOST_NAME : undefined,
              protocol_version: protocol
                ? protocol.PROTOCOL_VERSION
                : undefined,
              actions: protocol ? protocol.ACTIONS : undefined,
            });
          default:
            return Promise.resolve({
              ok: false,
              error: {
                code: "UNKNOWN_MESSAGE",
                message: "Tipo de mensaje no reconocido.",
              },
            });
        }
      }

      return {
        handleMessage,
        handleGetStatus,
        handleStartRecording,
        handleStopRecording,
        handleMeetEvent,
        getLastSessionId() {
          return lastSessionId;
        },
        getObservationTabId() {
          return observationTabId;
        },
        isDiagnosticEnabled() {
          return diagnosticEnabled;
        },
        getPreferredProfile() {
          return preferredProfile;
        },
      };
    }

    return { createBackgroundController };
  }
);
