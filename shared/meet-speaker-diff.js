/**
 * Diff del indicador visual de hablante activo.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsMeetEventSchema);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetSpeakerDiff = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Schema) {
  /* c8 ignore stop */
  function sameSpeaker(a, b) {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    if (a.participant_key && b.participant_key) {
      return a.participant_key === b.participant_key;
    }
    return (
      Boolean(a.display_name) &&
      Boolean(b.display_name) &&
      a.display_name === b.display_name
    );
  }

  function diffActiveSpeaker(previous, next, context = {}) {
    const schema = context.schema || Schema;
    if (!next) {
      return [];
    }
    if (sameSpeaker(previous, next)) {
      return [];
    }

    return [
      schema.buildMeetEvent({
        session_id: context.session_id,
        event_type: schema.EVENT_TYPES.ACTIVE_SPEAKER_CHANGED,
        timestamp_epoch_ms: context.timestamp_epoch_ms,
        source: next.source,
        display_name: next.display_name,
        participant_key: next.participant_key,
        confidence: next.confidence,
        quality: next.quality,
        details: {
          previous_display_name: previous && previous.display_name,
          previous_participant_key: previous && previous.participant_key,
          note: "Indicador visual únicamente; no implica autoría de una frase.",
        },
      }),
    ];
  }

  return { diffActiveSpeaker, sameSpeaker };
});
