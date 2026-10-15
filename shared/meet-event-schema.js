/**
 * Esquema de eventos Meet enviados al host vía record_meet_event.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetEventSchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /* c8 ignore stop */
  const EVENT_TYPES = Object.freeze({
    OBSERVATION_STARTED: "observation_started",
    OBSERVATION_STOPPED: "observation_stopped",
    PARTICIPANT_JOINED: "participant_joined",
    PARTICIPANT_LEFT: "participant_left",
    PARTICIPANT_SEEN: "participant_seen",
    ACTIVE_SPEAKER_CHANGED: "active_speaker_changed",
  });

  const SOURCES = Object.freeze({
    DOM_PARTICIPANT_ID: "dom_participant_id",
    DOM_PEOPLE_LIST: "dom_people_list",
    DOM_ARIA_TILE: "dom_aria_tile",
    DOM_SPEAKING_ATTR: "dom_speaking_attr",
    DOM_SPEAKING_ARIA: "dom_speaking_aria",
    EXTENSION: "extension",
  });

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clampConfidence(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    if (n < 0) {
      return 0;
    }
    if (n > 1) {
      return 1;
    }
    return n;
  }

  function buildMeetEvent(input = {}, options = {}) {
    const now = typeof options.now === "function" ? options.now() : Date.now();
    const eventType = input.event_type;
    if (!Object.values(EVENT_TYPES).includes(eventType)) {
      throw new Error("event_type de Meet no soportado.");
    }
    if (typeof input.session_id !== "string" || !input.session_id.trim()) {
      throw new Error("session_id requerido para eventos Meet.");
    }

    const event = {
      session_id: input.session_id.trim(),
      event_type: eventType,
      timestamp_epoch_ms:
        typeof input.timestamp_epoch_ms === "number" &&
        Number.isFinite(input.timestamp_epoch_ms)
          ? input.timestamp_epoch_ms
          : now,
      source:
        typeof input.source === "string" && input.source.trim()
          ? input.source.trim()
          : SOURCES.EXTENSION,
      confidence: clampConfidence(
        input.confidence === undefined ? 0.5 : input.confidence
      ),
      quality:
        typeof input.quality === "string" && input.quality.trim()
          ? input.quality.trim()
          : "heuristic",
    };

    if (typeof input.display_name === "string" && input.display_name.trim()) {
      event.display_name = input.display_name.trim();
    }
    if (
      typeof input.participant_key === "string" &&
      input.participant_key.trim()
    ) {
      event.participant_key = input.participant_key.trim();
    }
    if (isObject(input.details)) {
      event.details = input.details;
    }

    return event;
  }

  function validateMeetEvent(event) {
    if (!isObject(event)) {
      return { ok: false, error: "evento inválido" };
    }
    try {
      const normalized = buildMeetEvent(event, {
        now: () => event.timestamp_epoch_ms || Date.now(),
      });
      return { ok: true, event: normalized };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : "evento inválido",
      };
    }
  }

  return {
    EVENT_TYPES,
    SOURCES,
    buildMeetEvent,
    validateMeetEvent,
    clampConfidence,
  };
});
