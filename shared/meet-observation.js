/**
 * Orquestación acotada de observación Meet: polling + observer opcional limitado.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(
    root.MeetingsMeetEventSchema,
    root.MeetingsMeetDomSnapshot,
    root.MeetingsMeetParticipantDiff,
    root.MeetingsMeetSpeakerDiff
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetObservation = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (Schema, DomSnapshot, ParticipantDiff, SpeakerDiff) {
    /* c8 ignore stop */

    function createMeetObservation(options = {}) {
      const schema = options.schema || Schema;
      const domSnapshot = options.domSnapshot || DomSnapshot;
      const participantDiff = options.participantDiff || ParticipantDiff;
      const speakerDiff = options.speakerDiff || SpeakerDiff;
      const getDocument = options.getDocument;
      const onEvents = options.onEvents || (() => {});
      const pollIntervalMs = options.pollIntervalMs || 2000;
      const maxEventsPerMinute = options.maxEventsPerMinute || 60;
      const setIntervalFn = options.setIntervalFn || setInterval;
      const clearIntervalFn = options.clearIntervalFn || clearInterval;
      const now = options.now || Date.now;

      if (typeof getDocument !== "function") {
        throw new Error("getDocument requerido");
      }

      let active = false;
      let sessionId = null;
      let timer = null;
      let observer = null;
      let previousParticipants = [];
      let previousSpeaker = null;
      let recentEventTimestamps = [];
      let lastSnapshot = null;
      let diagnostic = Boolean(options.diagnostic);

      function trimRateLimit(ts) {
        recentEventTimestamps = recentEventTimestamps.filter(
          (t) => ts - t < 60000
        );
      }

      function allowEvents(count, ts) {
        trimRateLimit(ts);
        return recentEventTimestamps.length + count <= maxEventsPerMinute;
      }

      function emit(events) {
        if (!events.length) {
          return;
        }
        const ts = now();
        if (!allowEvents(events.length, ts)) {
          return;
        }
        for (let i = 0; i < events.length; i += 1) {
          recentEventTimestamps.push(ts);
        }
        onEvents(events, { snapshot: lastSnapshot, diagnostic });
      }

      function tick() {
        if (!active || !sessionId) {
          return;
        }
        const doc = getDocument();
        if (!doc) {
          return;
        }
        // Solo saltar cuando la página declara estar oculta (JSDOM puede no definir hidden).
        if (doc.hidden === true) {
          return;
        }

        const snapshot = domSnapshot.captureMeetSnapshot(doc);
        snapshot.captured_at_ms = now();
        lastSnapshot = snapshot;

        const ts = snapshot.captured_at_ms;
        const joinedLeft = participantDiff.diffParticipants(
          previousParticipants,
          snapshot.participants,
          { session_id: sessionId, timestamp_epoch_ms: ts, schema }
        );
        const speakerEvents = speakerDiff.diffActiveSpeaker(
          previousSpeaker,
          snapshot.active_speaker,
          { session_id: sessionId, timestamp_epoch_ms: ts, schema }
        );

        previousParticipants = snapshot.participants.slice();
        previousSpeaker = snapshot.active_speaker;
        emit(joinedLeft.concat(speakerEvents));
      }

      function attachScopedObserver() {
        if (observer || typeof options.createMutationObserver !== "function") {
          return;
        }
        const doc = getDocument();
        const root = domSnapshot.findScopedRoot(doc);
        if (!root) {
          return;
        }
        const schedule = options.setTimeoutFn || setTimeout;
        let debounceTimer = null;
        observer = options.createMutationObserver(() => {
          if (debounceTimer) {
            return;
          }
          debounceTimer = schedule(() => {
            debounceTimer = null;
            tick();
          }, 500);
        });
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [
            "data-is-speaking",
            "data-speaking",
            "aria-label",
            "data-participant-id",
          ],
        });
      }

      function detachObserver() {
        if (observer && typeof observer.disconnect === "function") {
          observer.disconnect();
        }
        observer = null;
      }

      function start(nextSessionId, startOptions = {}) {
        if (active) {
          stop();
        }
        if (typeof nextSessionId !== "string" || !nextSessionId.trim()) {
          throw new Error("session_id requerido para observar Meet");
        }
        sessionId = nextSessionId.trim();
        diagnostic = Boolean(
          startOptions.diagnostic !== undefined
            ? startOptions.diagnostic
            : diagnostic
        );
        active = true;
        previousParticipants = [];
        previousSpeaker = null;
        recentEventTimestamps = [];
        lastSnapshot = null;

        emit([
          schema.buildMeetEvent({
            session_id: sessionId,
            event_type: schema.EVENT_TYPES.OBSERVATION_STARTED,
            timestamp_epoch_ms: now(),
            source: schema.SOURCES.EXTENSION,
            confidence: 1,
            quality: "extension_lifecycle",
            details: { poll_interval_ms: pollIntervalMs },
          }),
        ]);

        tick();
        attachScopedObserver();
        timer = setIntervalFn(tick, pollIntervalMs);
      }

      function stop() {
        if (!active) {
          return;
        }
        const sid = sessionId;
        active = false;
        if (timer) {
          clearIntervalFn(timer);
          timer = null;
        }
        detachObserver();
        if (sid) {
          emit([
            schema.buildMeetEvent({
              session_id: sid,
              event_type: schema.EVENT_TYPES.OBSERVATION_STOPPED,
              timestamp_epoch_ms: now(),
              source: schema.SOURCES.EXTENSION,
              confidence: 1,
              quality: "extension_lifecycle",
            }),
          ]);
        }
        sessionId = null;
        previousParticipants = [];
        previousSpeaker = null;
      }

      function getDiagnostics() {
        return {
          active,
          session_id: sessionId,
          diagnostic,
          last_snapshot: lastSnapshot,
          recent_event_count: recentEventTimestamps.length,
        };
      }

      function setDiagnostic(enabled) {
        diagnostic = Boolean(enabled);
      }

      return {
        start,
        stop,
        tick,
        isActive: () => active,
        getSessionId: () => sessionId,
        getDiagnostics,
        setDiagnostic,
      };
    }

    return { createMeetObservation };
  }
);
