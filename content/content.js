/**
 * Content script en meet.google.com: observa solo durante grabación activa.
 */
(() => {
  if (window.__meetingsTranscriptorContentLoaded) {
    return;
  }
  window.__meetingsTranscriptorContentLoaded = true;

  const observation = MeetingsMeetObservation.createMeetObservation({
    getDocument: () => document,
    createMutationObserver: (cb) => new MutationObserver(cb),
    pollIntervalMs: 2000,
    maxEventsPerMinute: 60,
    onEvents(events) {
      for (const event of events) {
        browser.runtime.sendMessage({ type: "MEET_EVENT", event }).catch(() => {
          // El background puede estar dormido un instante; el siguiente tick reintenta contexto.
        });
      }
    },
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") {
      return Promise.resolve({ ok: false });
    }

    switch (message.type) {
      case "START_MEET_OBSERVATION":
        try {
          observation.start(message.sessionId, {
            diagnostic: Boolean(message.diagnostic),
          });
          return Promise.resolve({
            ok: true,
            observing: true,
            sessionId: message.sessionId,
          });
        } catch (err) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "OBSERVATION_START_FAILED",
              message: err && err.message ? err.message : "No se pudo observar",
            },
          });
        }
      case "STOP_MEET_OBSERVATION":
        observation.stop();
        return Promise.resolve({ ok: true, observing: false });
      case "GET_MEET_DIAGNOSTICS":
        return Promise.resolve({
          ok: true,
          diagnostics: observation.getDiagnostics(),
        });
      case "SET_MEET_DIAGNOSTIC":
        observation.setDiagnostic(Boolean(message.enabled));
        return Promise.resolve({
          ok: true,
          diagnostic: Boolean(message.enabled),
        });
      default:
        return Promise.resolve({ ok: false, error: { code: "UNKNOWN" } });
    }
  });
})();
