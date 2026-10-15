/**
 * Diff de participantes entre snapshots sucesivos.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsMeetEventSchema);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetParticipantDiff = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Schema) {
  /* c8 ignore stop */
  function indexByKey(participants) {
    const map = new Map();
    for (const participant of participants || []) {
      if (!participant || typeof participant.key !== "string") {
        continue;
      }
      map.set(participant.key, participant);
    }
    return map;
  }

  function diffParticipants(previous, next, context = {}) {
    const schema = context.schema || Schema;
    const prev = indexByKey(previous);
    const curr = indexByKey(next);
    const events = [];
    const sessionId = context.session_id;
    const now = context.timestamp_epoch_ms;

    for (const [key, participant] of curr.entries()) {
      if (!prev.has(key)) {
        events.push(
          schema.buildMeetEvent({
            session_id: sessionId,
            event_type: schema.EVENT_TYPES.PARTICIPANT_JOINED,
            timestamp_epoch_ms: now,
            source: participant.source,
            display_name: participant.display_name,
            participant_key: key,
            confidence: participant.confidence,
            quality: participant.quality,
            details: { reason: "appeared_in_snapshot" },
          })
        );
      }
    }

    for (const [key, participant] of prev.entries()) {
      if (!curr.has(key)) {
        events.push(
          schema.buildMeetEvent({
            session_id: sessionId,
            event_type: schema.EVENT_TYPES.PARTICIPANT_LEFT,
            timestamp_epoch_ms: now,
            source: participant.source,
            display_name: participant.display_name,
            participant_key: key,
            confidence: participant.confidence,
            quality: participant.quality,
            details: { reason: "missing_from_snapshot" },
          })
        );
      }
    }

    return events;
  }

  return { diffParticipants, indexByKey };
});
