/**
 * Estado de la UI del popup: qué mostrar y qué acciones habilitar.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsPopupState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /* c8 ignore stop */
  const TRANSCRIPTOR_STATUS = Object.freeze({
    DISCONNECTED: "disconnected",
    READY: "ready",
    RECORDING: "recording",
    TRANSCRIBING: "transcribing",
    ERROR: "error",
  });

  const STATUS_LABELS = Object.freeze({
    disconnected: "Desconectado",
    ready: "Listo",
    recording: "Grabando",
    transcribing: "Transcribiendo",
    error: "Error",
  });

  function derivePopupView(input) {
    const tab = input.tab || {
      onMeet: false,
      title: "",
      label: "Fuera de Meet",
    };
    const busy = Boolean(input.busy);
    const sessionId =
      typeof input.sessionId === "string" && input.sessionId.trim()
        ? input.sessionId.trim()
        : null;
    const errorMessage =
      typeof input.errorMessage === "string" && input.errorMessage.trim()
        ? input.errorMessage.trim()
        : "";
    const infoMessage =
      typeof input.infoMessage === "string" && input.infoMessage.trim()
        ? input.infoMessage.trim()
        : "";
    const busyLabel =
      typeof input.busyLabel === "string" && input.busyLabel.trim()
        ? input.busyLabel.trim()
        : "";

    let transcriptorStatus = input.transcriptorStatus;
    if (!Object.values(TRANSCRIPTOR_STATUS).includes(transcriptorStatus)) {
      transcriptorStatus = errorMessage
        ? TRANSCRIPTOR_STATUS.ERROR
        : TRANSCRIPTOR_STATUS.DISCONNECTED;
    }

    const profilesSupported = Boolean(input.profilesSupported);
    const profiles = Array.isArray(input.profiles) ? input.profiles : [];
    const selectedProfile =
      typeof input.selectedProfile === "string" && input.selectedProfile.trim()
        ? input.selectedProfile.trim()
        : null;
    const profilesError =
      typeof input.profilesError === "string" ? input.profilesError.trim() : "";
    const profileRequired = profilesSupported && profiles.length > 0;
    const profileReady = !profileRequired || Boolean(selectedProfile);

    const canStart =
      !busy &&
      tab.onMeet &&
      transcriptorStatus === TRANSCRIPTOR_STATUS.READY &&
      !sessionId &&
      profileReady &&
      !(profilesSupported && profiles.length === 0);

    const canStop =
      !busy &&
      transcriptorStatus === TRANSCRIPTOR_STATUS.RECORDING &&
      Boolean(sessionId);

    const observationActive = Boolean(input.observationActive);
    const diagnosticEnabled = Boolean(input.diagnosticEnabled);
    const observationError =
      typeof input.observationError === "string"
        ? input.observationError.trim()
        : "";

    return {
      tabLabel: tab.label || (tab.onMeet ? "Google Meet" : "Fuera de Meet"),
      meetingTitle: tab.onMeet ? tab.title || "Reunión de Google Meet" : "—",
      transcriptorStatus,
      /* c8 ignore next 2 */
      transcriptorLabel:
        STATUS_LABELS[transcriptorStatus] || STATUS_LABELS.error,
      sessionId,
      errorMessage,
      infoMessage,
      canStart,
      canStop,
      busy,
      busyLabel,
      startDisabled: !canStart,
      stopDisabled: !canStop,
      startVisible: true,
      stopVisible:
        transcriptorStatus === TRANSCRIPTOR_STATUS.RECORDING ||
        Boolean(sessionId),
      observationActive,
      observationLabel: observationActive ? "Observando Meet" : "Inactiva",
      diagnosticEnabled,
      observationError,
      diagnosticVisible: diagnosticEnabled,
      profilesSupported,
      profiles,
      selectedProfile,
      profilesError,
      profileSelectEnabled:
        !busy &&
        transcriptorStatus === TRANSCRIPTOR_STATUS.READY &&
        !sessionId &&
        profilesSupported &&
        profiles.length > 0,
      profileHint: profilesSupported
        ? profiles.length === 0
          ? profilesError || "No hay perfiles disponibles."
          : ""
        : profilesError ||
          "El host usará el perfil de NATIVE_MESSAGING_PROFILE hasta que soporte list_profiles.",
    };
  }

  return {
    TRANSCRIPTOR_STATUS,
    STATUS_LABELS,
    derivePopupView,
  };
});
