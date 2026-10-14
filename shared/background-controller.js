/**
 * Orquestación del background: pestaña activa + cliente Native Messaging.
 * Separado del cableado de browser.* para poder probarse en Node.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsMeetTab);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsBackgroundController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (MeetTab) {
  /* c8 ignore stop */
  function createBackgroundController(options = {}) {
    const meetTab = options.meetTab || MeetTab;
    const client = options.client;
    const getActiveTab = options.getActiveTab;
    const protocol = options.protocol;

    if (!client || typeof client.getStatus !== "function") {
      throw new Error("client Native Messaging requerido");
    }
    if (typeof getActiveTab !== "function") {
      throw new Error("getActiveTab requerido");
    }

    let lastSessionId = null;

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

    async function handleGetStatus() {
      const tabInfo = meetTab.describeActiveTab(await getActiveTab());
      try {
        const response = await client.getStatus();
        if (!response.ok) {
          return {
            ok: false,
            tab: tabInfo,
            transcriptorStatus: "error",
            sessionId: lastSessionId,
            error: response.error,
          };
        }

        const data = response.data || {};
        if (data.status === "recording" && data.session_id) {
          lastSessionId = data.session_id;
        } else if (data.status !== "recording") {
          lastSessionId = null;
        }

        return {
          ok: true,
          tab: tabInfo,
          transcriptorStatus: data.status || "ready",
          sessionId: data.session_id || lastSessionId,
          hostMessage: data.message || "",
        };
      } catch (err) {
        const failure = toErrorPayload(err);
        return {
          ok: false,
          tab: tabInfo,
          transcriptorStatus: hostUnavailableStatus(failure.error.code),
          sessionId: lastSessionId,
          error: failure.error,
        };
      }
    }

    async function handleStartRecording() {
      const tabInfo = meetTab.describeActiveTab(await getActiveTab());

      if (!tabInfo.onMeet) {
        return {
          ok: false,
          tab: tabInfo,
          transcriptorStatus: "error",
          sessionId: lastSessionId,
          error: {
            code: "NOT_MEET_TAB",
            message:
              "Abrí una pestaña de Google Meet antes de iniciar la grabación.",
          },
        };
      }

      try {
        const response = await client.startRecording({
          url: tabInfo.url,
          title: tabInfo.title || "Reunión de Google Meet",
        });

        if (!response.ok) {
          return {
            ok: false,
            tab: tabInfo,
            transcriptorStatus: "error",
            sessionId: lastSessionId,
            error: response.error,
          };
        }

        lastSessionId = response.data.session_id;
        return {
          ok: true,
          tab: tabInfo,
          transcriptorStatus: "recording",
          sessionId: lastSessionId,
        };
      } catch (err) {
        const failure = toErrorPayload(err);
        return {
          ok: false,
          tab: tabInfo,
          transcriptorStatus: hostUnavailableStatus(failure.error.code),
          sessionId: lastSessionId,
          error: failure.error,
        };
      }
    }

    async function handleStopRecording(message) {
      const tabInfo = meetTab.describeActiveTab(await getActiveTab());
      const sessionId = (message && message.sessionId) || lastSessionId || null;

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

      try {
        const response = await client.stopRecording({ session_id: sessionId });
        if (!response.ok) {
          return {
            ok: false,
            tab: tabInfo,
            transcriptorStatus: "error",
            sessionId,
            error: response.error,
          };
        }

        lastSessionId = null;
        return {
          ok: true,
          tab: tabInfo,
          transcriptorStatus: "ready",
          sessionId: null,
        };
      } catch (err) {
        const failure = toErrorPayload(err);
        return {
          ok: false,
          tab: tabInfo,
          transcriptorStatus: "error",
          sessionId,
          error: failure.error,
        };
      }
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
          return handleGetStatus();
        case "START_RECORDING":
          return handleStartRecording();
        case "STOP_RECORDING":
          return handleStopRecording(message);
        case "PROTOCOL_INFO":
          return Promise.resolve({
            ok: true,
            host: protocol ? protocol.NATIVE_HOST_NAME : undefined,
            protocol_version: protocol ? protocol.PROTOCOL_VERSION : undefined,
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
      getLastSessionId() {
        return lastSessionId;
      },
    };
  }

  return { createBackgroundController };
});
