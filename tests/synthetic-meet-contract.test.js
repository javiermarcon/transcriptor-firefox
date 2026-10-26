/**
 * Contrato sintético de eventos Meet ↔ host Native Messaging.
 * No prueba el DOM real de Google Meet; usa fixtures marcados synthetic.
 */
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const Protocol = require("../shared/protocol.js");
const MeetSchema = require("../shared/meet-event-schema.js");

const FIXTURE = path.join(__dirname, "fixtures", "synthetic-meet-events.json");

describe("synthetic meet ↔ native contract", () => {
  it("el fixture sintético valida contra meet-event-schema y record_meet_event", () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.match(String(raw._comment || ""), /SYNTHETIC/i);
    assert.equal(typeof raw.recording_started_at_epoch_ms, "number");
    assert.ok(Array.isArray(raw.events));
    assert.ok(raw.events.length >= 2);

    const sessionIds = new Set();
    for (const event of raw.events) {
      const validated = MeetSchema.validateMeetEvent(event);
      assert.equal(validated.ok, true, validated.error);
      sessionIds.add(validated.event.session_id);

      const request = Protocol.buildRequest(
        Protocol.ACTIONS.RECORD_MEET_EVENT,
        validated.event,
        { generateId: () => "req-synthetic" }
      );
      assert.equal(request.protocol_version, Protocol.PROTOCOL_VERSION);
      assert.equal(request.action, "record_meet_event");
      assert.equal(request.payload.session_id, validated.event.session_id);
      assert.equal(request.payload.event_type, validated.event.event_type);
      assert.equal(typeof request.payload.timestamp_epoch_ms, "number");
    }
    assert.equal(
      sessionIds.size,
      1,
      "todos los eventos deben compartir session_id"
    );
  });

  it("incluye un participante, dos nombres, join/leave y active_speaker", () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    const types = new Set(raw.events.map((e) => e.event_type));
    assert.ok(types.has("participant_joined"));
    assert.ok(types.has("participant_left"));
    assert.ok(types.has("active_speaker_changed"));
    assert.ok(types.has("observation_started"));
    assert.ok(types.has("observation_stopped"));

    const joined = raw.events.filter(
      (e) => e.event_type === "participant_joined"
    );
    const names = new Set(joined.map((e) => e.display_name));
    assert.ok(names.has("Javier"));
    assert.ok(names.has("Nacho"));
    assert.equal(names.size, 2);

    const speakers = raw.events.filter(
      (e) => e.event_type === "active_speaker_changed"
    );
    assert.ok(speakers.length >= 2);
    // Relativos al inicio de grabación (documentación de alineación con WhisperX).
    for (const event of speakers) {
      const relS =
        (event.timestamp_epoch_ms - raw.recording_started_at_epoch_ms) / 1000;
      assert.ok(Number.isFinite(relS));
      assert.ok(relS >= 0);
    }
  });

  it("eventos repetidos del mismo hablante siguen siendo válidos", () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    const nacho = raw.events.filter(
      (e) =>
        e.event_type === "active_speaker_changed" && e.display_name === "Nacho"
    );
    assert.ok(nacho.length >= 2);
    for (const event of nacho) {
      assert.equal(MeetSchema.validateMeetEvent(event).ok, true);
    }
  });
});
