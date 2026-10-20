/**
 * Transiciones de estado del popup a partir de respuestas del background.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsPopupState);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsPopupController = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (PopupState) {
    /* c8 ignore stop */
    function createInitialState(PopupStateApi) {
      const api = PopupStateApi || PopupState;
      return {
        tab: { onMeet: false, title: "", label: "Fuera de Meet" },
        transcriptorStatus: api.TRANSCRIPTOR_STATUS.DISCONNECTED,
        sessionId: null,
        errorMessage: "",
        busy: false,
        observationActive: false,
        diagnosticEnabled: false,
        observationError: "",
        recentEvents: [],
        profilesSupported: false,
        profiles: [],
        selectedProfile: null,
        defaultProfile: null,
        profilesError: "",
      };
    }

    function applyBackgroundResult(current, result, PopupStateApi) {
      const api = PopupStateApi || PopupState;
      const next = Object.assign({}, current);

      if (!result || typeof result !== "object") {
        next.transcriptorStatus = api.TRANSCRIPTOR_STATUS.ERROR;
        next.errorMessage = "Respuesta inesperada de la extensión.";
        return next;
      }

      if (result.tab) {
        next.tab = result.tab;
      }

      if (result.transcriptorStatus) {
        next.transcriptorStatus = result.transcriptorStatus;
      }

      next.sessionId =
        typeof result.sessionId === "string" ? result.sessionId : null;

      if (typeof result.observationActive === "boolean") {
        next.observationActive = result.observationActive;
      }
      if (typeof result.diagnosticEnabled === "boolean") {
        next.diagnosticEnabled = result.diagnosticEnabled;
      }
      if (typeof result.observationError === "string") {
        next.observationError = result.observationError;
      }
      if (Array.isArray(result.recentEvents)) {
        next.recentEvents = result.recentEvents;
      }
      if (typeof result.profilesSupported === "boolean") {
        next.profilesSupported = result.profilesSupported;
      }
      if (Array.isArray(result.profiles)) {
        next.profiles = result.profiles;
      }
      if (Object.prototype.hasOwnProperty.call(result, "selectedProfile")) {
        next.selectedProfile =
          typeof result.selectedProfile === "string"
            ? result.selectedProfile
            : null;
      }
      if (Object.prototype.hasOwnProperty.call(result, "defaultProfile")) {
        next.defaultProfile =
          typeof result.defaultProfile === "string"
            ? result.defaultProfile
            : null;
      }
      if (typeof result.profilesError === "string") {
        next.profilesError = result.profilesError;
      }

      const hostMessage =
        typeof result.hostMessage === "string" ? result.hostMessage.trim() : "";

      if (result.ok) {
        if (
          next.transcriptorStatus === api.TRANSCRIPTOR_STATUS.ERROR &&
          hostMessage
        ) {
          // El host puede responder ok:true con status "error" y un mensaje.
          next.errorMessage = hostMessage;
        } else {
          next.errorMessage = "";
        }
      } else if (result.error && result.error.message) {
        next.errorMessage = result.error.message;
        if (
          result.transcriptorStatus === api.TRANSCRIPTOR_STATUS.DISCONNECTED ||
          (result.error.code && String(result.error.code).includes("HOST_"))
        ) {
          next.transcriptorStatus =
            result.transcriptorStatus || api.TRANSCRIPTOR_STATUS.DISCONNECTED;
        } else {
          next.transcriptorStatus =
            result.transcriptorStatus || api.TRANSCRIPTOR_STATUS.ERROR;
        }
      } else if (hostMessage) {
        next.errorMessage = hostMessage;
        next.transcriptorStatus =
          result.transcriptorStatus || api.TRANSCRIPTOR_STATUS.ERROR;
      } else {
        next.errorMessage = "Ocurrió un error al hablar con el host local.";
        next.transcriptorStatus = api.TRANSCRIPTOR_STATUS.ERROR;
      }

      return next;
    }

    return {
      createInitialState,
      applyBackgroundResult,
    };
  }
);
