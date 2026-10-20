/**
 * Protocolo versionado para Native Messaging con com.meetings.transcriptor.
 * Compatible con Node (tests) y con scripts clásicos de la extensión.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsProtocol = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /* c8 ignore stop */
  const PROTOCOL_VERSION = 1;
  const NATIVE_HOST_NAME = "com.meetings.transcriptor";
  const ACTIONS = Object.freeze({
    GET_STATUS: "get_status",
    LIST_PROFILES: "list_profiles",
    START_RECORDING: "start_recording",
    STOP_RECORDING: "stop_recording",
    RECORD_MEET_EVENT: "record_meet_event",
  });

  const PROFILE_NAME_RE = /^[A-Za-z0-9_.-]+$/;

  const ERROR_MESSAGES = Object.freeze({
    HOST_NOT_FOUND:
      "El host local del transcriptor no está instalado o Firefox no puede encontrarlo.",
    HOST_DISCONNECTED:
      "Se perdió la conexión con el host local del transcriptor.",
    TIMEOUT: "El host local no respondió a tiempo.",
    INVALID_RESPONSE: "La respuesta del host local no es válida.",
    OUT_OF_ORDER:
      "Se recibió una respuesta fuera de orden o para otra solicitud.",
    MISSING_SESSION_ID:
      "El host no confirmó el inicio de la grabación (falta session_id).",
    UNKNOWN_ACTION: "Acción no soportada por el protocolo.",
    START_REJECTED: "El host local no pudo iniciar la grabación.",
    STOP_REJECTED: "El host local no pudo detener la grabación.",
  });

  function createRequestId(generateId) {
    if (typeof generateId === "function") {
      return String(generateId());
    }
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildRequest(action, payload = {}, options = {}) {
    if (!Object.values(ACTIONS).includes(action)) {
      throw new Error(ERROR_MESSAGES.UNKNOWN_ACTION);
    }
    return {
      protocol_version: PROTOCOL_VERSION,
      request_id: createRequestId(options.generateId),
      action,
      payload: payload && typeof payload === "object" ? payload : {},
    };
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateResponse(response, expectedRequestId) {
    if (!isObject(response)) {
      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: ERROR_MESSAGES.INVALID_RESPONSE,
        },
      };
    }

    if (response.protocol_version !== PROTOCOL_VERSION) {
      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: ERROR_MESSAGES.INVALID_RESPONSE,
        },
      };
    }

    if (
      expectedRequestId !== undefined &&
      response.request_id !== expectedRequestId
    ) {
      return {
        ok: false,
        error: {
          code: "OUT_OF_ORDER",
          message: ERROR_MESSAGES.OUT_OF_ORDER,
        },
      };
    }

    if (response.ok === true) {
      const data = isObject(response.data) ? response.data : {};
      return {
        ok: true,
        request_id: response.request_id,
        data,
      };
    }

    if (response.ok === false) {
      const error = isObject(response.error) ? response.error : {};
      return {
        ok: false,
        request_id: response.request_id,
        error: {
          code: typeof error.code === "string" ? error.code : "HOST_ERROR",
          message:
            typeof error.message === "string" && error.message.trim()
              ? error.message
              : "El host local devolvió un error.",
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "INVALID_RESPONSE",
        message: ERROR_MESSAGES.INVALID_RESPONSE,
      },
    };
  }

  function requireSessionId(data) {
    if (
      !isObject(data) ||
      typeof data.session_id !== "string" ||
      !data.session_id.trim()
    ) {
      return {
        ok: false,
        error: {
          code: "MISSING_SESSION_ID",
          message: ERROR_MESSAGES.MISSING_SESSION_ID,
        },
      };
    }
    return { ok: true, session_id: data.session_id.trim() };
  }

  function mapConnectionError(err) {
    if (
      err &&
      typeof err.code === "string" &&
      err.code.startsWith("HOST_") &&
      typeof err.message === "string" &&
      err.message.trim()
    ) {
      return { code: err.code, message: err.message };
    }

    const raw = err && (err.message || String(err));
    const text = String(raw || "").toLowerCase();
    if (
      text.includes("no such native application") ||
      text.includes("specified native messaging host not found") ||
      (text.includes("native application") && text.includes("not found")) ||
      text.includes("host not found")
    ) {
      return {
        code: "HOST_NOT_FOUND",
        message: ERROR_MESSAGES.HOST_NOT_FOUND,
      };
    }
    if (text.includes("disconnected") || text.includes("disconnect")) {
      return {
        code: "HOST_DISCONNECTED",
        message: ERROR_MESSAGES.HOST_DISCONNECTED,
      };
    }
    return {
      code: "HOST_UNAVAILABLE",
      message:
        "No se pudo comunicar con el host local del transcriptor. ¿Está instalado y registrado?",
    };
  }

  function normalizeProgress(raw) {
    if (!isObject(raw)) {
      return null;
    }
    const percent = typeof raw.percent === "number" ? raw.percent : null;
    const currentS = typeof raw.current_s === "number" ? raw.current_s : null;
    const totalS = typeof raw.total_s === "number" ? raw.total_s : null;
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (percent === null && !label) {
      return null;
    }
    return {
      percent,
      current_s: currentS,
      total_s: totalS,
      label: label || null,
    };
  }

  function normalizeHostStatus(data) {
    const status = isObject(data) ? data.status : undefined;
    const sessionId =
      isObject(data) && typeof data.session_id === "string"
        ? data.session_id
        : null;

    if (status === "recording") {
      return { status: "recording", session_id: sessionId };
    }
    if (status === "transcribing") {
      const meetingDir =
        isObject(data) && typeof data.meeting_dir === "string"
          ? data.meeting_dir
          : null;
      return {
        status: "transcribing",
        session_id: sessionId,
        meeting_dir: meetingDir,
        progress: normalizeProgress(isObject(data) ? data.progress : null),
      };
    }
    if (status === "error") {
      return {
        status: "error",
        session_id: sessionId,
        message:
          isObject(data) && typeof data.message === "string"
            ? data.message
            : "El transcriptor reportó un error.",
      };
    }
    if (status === "ready" || status === "idle" || status === undefined) {
      return { status: "ready", session_id: sessionId };
    }
    return { status: "ready", session_id: sessionId };
  }

  function isValidProfileName(name) {
    return typeof name === "string" && PROFILE_NAME_RE.test(name.trim());
  }

  function normalizeProfilesData(data) {
    const source = isObject(data) ? data : {};
    const profiles = Array.isArray(source.profiles)
      ? source.profiles
          .filter((name) => isValidProfileName(name))
          .map((name) => name.trim())
      : [];
    const unique = [];
    const seen = new Set();
    for (const name of profiles) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(name);
    }

    let defaultProfile =
      typeof source.default_profile === "string"
        ? source.default_profile.trim()
        : null;
    if (!isValidProfileName(defaultProfile || "")) {
      defaultProfile = null;
    }
    if (defaultProfile && !unique.some((p) => p === defaultProfile)) {
      // El default puede existir en env aunque aún no haya carpeta listada.
      unique.unshift(defaultProfile);
    }

    return {
      profiles: unique,
      default_profile: defaultProfile,
    };
  }

  return {
    PROTOCOL_VERSION,
    NATIVE_HOST_NAME,
    ACTIONS,
    ERROR_MESSAGES,
    PROFILE_NAME_RE,
    buildRequest,
    validateResponse,
    requireSessionId,
    mapConnectionError,
    normalizeHostStatus,
    normalizeProgress,
    isValidProfileName,
    normalizeProfilesData,
  };
});
