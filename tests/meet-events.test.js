const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const Schema = require("../shared/meet-event-schema.js");
const DomSnapshot = require("../shared/meet-dom-snapshot.js");
const ParticipantDiff = require("../shared/meet-participant-diff.js");
const SpeakerDiff = require("../shared/meet-speaker-diff.js");
const { createMeetObservation } = require("../shared/meet-observation.js");
const Protocol = require("../shared/protocol.js");
const { createNativeClient } = require("../shared/native-client.js");
const {
  createBackgroundController,
} = require("../shared/background-controller.js");
const MeetTab = require("../shared/meet-tab.js");
const { createFakePort, waitForSent } = require("./helpers/fake-port.js");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  const dom = new JSDOM(html);
  Object.defineProperty(dom.window.document, "hidden", {
    configurable: true,
    writable: true,
    value: false,
  });
  return dom.window.document;
}

describe("meet-event-schema", () => {
  it("construye y valida eventos mínimos", () => {
    const event = Schema.buildMeetEvent({
      session_id: "sess-1",
      event_type: Schema.EVENT_TYPES.PARTICIPANT_JOINED,
      display_name: "Ana",
      participant_key: "k1",
      source: Schema.SOURCES.DOM_PEOPLE_LIST,
      confidence: 0.55,
      timestamp_epoch_ms: 1000,
    });
    assert.equal(event.session_id, "sess-1");
    assert.equal(event.event_type, "participant_joined");
    assert.equal(Schema.validateMeetEvent(event).ok, true);
    assert.equal(Schema.validateMeetEvent(null).ok, false);
    assert.throws(() =>
      Schema.buildMeetEvent({ session_id: "x", event_type: "nope" })
    );
  });
});

describe("meet-dom-snapshot", () => {
  it("extrae participantes y hablante activo desde fixture A", () => {
    const doc = loadFixture("meet-roster-a.html");
    const snapshot = DomSnapshot.captureMeetSnapshot(doc);
    assert.ok(snapshot.participant_count >= 2);
    const names = snapshot.participants.map((p) => p.display_name).sort();
    assert.ok(names.includes("Ana Pérez"));
    assert.ok(names.includes("Bruno Díaz"));
    assert.ok(snapshot.active_speaker);
    assert.equal(snapshot.active_speaker.display_name, "Ana Pérez");
    assert.ok(snapshot.active_speaker.confidence >= 0.5);
    assert.equal(snapshot.scoped_root_found, true);
  });

  it("detecta cambio de roster y hablante entre fixtures", () => {
    const a = DomSnapshot.captureMeetSnapshot(
      loadFixture("meet-roster-a.html")
    );
    const b = DomSnapshot.captureMeetSnapshot(
      loadFixture("meet-roster-b.html")
    );

    const events = ParticipantDiff.diffParticipants(
      a.participants,
      b.participants,
      {
        session_id: "sess-1",
        timestamp_epoch_ms: 2000,
        schema: Schema,
      }
    );
    const types = events.map((e) => e.event_type).sort();
    assert.ok(types.includes("participant_joined"));
    assert.ok(types.includes("participant_left"));

    const speakerEvents = SpeakerDiff.diffActiveSpeaker(
      a.active_speaker,
      b.active_speaker,
      {
        session_id: "sess-1",
        timestamp_epoch_ms: 2000,
        schema: Schema,
      }
    );
    assert.equal(speakerEvents.length, 1);
    assert.equal(speakerEvents[0].display_name, "Carla Gómez");
    assert.match(speakerEvents[0].details.note, /no implica autoría/i);
  });
});

describe("meet-observation", () => {
  it("emite start/stop y deja de observar al detener", () => {
    const emitted = [];
    let doc = loadFixture("meet-roster-a.html");
    const timers = [];
    const observation = createMeetObservation({
      schema: Schema,
      domSnapshot: DomSnapshot,
      participantDiff: ParticipantDiff,
      speakerDiff: SpeakerDiff,
      getDocument: () => doc,
      pollIntervalMs: 10000,
      setIntervalFn: (fn) => {
        timers.push(fn);
        return 1;
      },
      clearIntervalFn: () => {
        timers.length = 0;
      },
      now: () => 5000,
      onEvents(events) {
        emitted.push(...events);
      },
    });

    observation.start("sess-9");
    assert.equal(observation.isActive(), true);
    assert.ok(emitted.some((e) => e.event_type === "observation_started"));
    assert.ok(emitted.some((e) => e.event_type === "participant_joined"));

    doc = loadFixture("meet-roster-b.html");
    observation.tick();
    assert.ok(emitted.some((e) => e.display_name === "Carla Gómez"));

    observation.stop();
    assert.equal(observation.isActive(), false);
    assert.ok(emitted.some((e) => e.event_type === "observation_stopped"));
    const before = emitted.length;
    observation.tick();
    assert.equal(emitted.length, before);
  });
});

describe("record_meet_event protocol bridge", () => {
  it("envía record_meet_event al host nativo", async () => {
    const port = createFakePort();
    let n = 0;
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => `evt-${(n += 1)}`,
    });
    const pending = client.recordMeetEvent({
      session_id: "sess-1",
      event_type: "participant_joined",
      timestamp_epoch_ms: 1,
      source: "dom_people_list",
      display_name: "Ana",
      confidence: 0.5,
    });
    await waitForSent(port, 1);
    assert.equal(port.sent[0].action, "record_meet_event");
    port.emitMessage({
      protocol_version: 1,
      request_id: "evt-1",
      ok: true,
      data: {},
    });
    assert.equal((await pending).ok, true);

    const pendingEmpty = client.recordMeetEvent(null);
    await waitForSent(port, 2);
    assert.deepEqual(port.sent[1].payload, {});
    port.emitMessage({
      protocol_version: 1,
      request_id: "evt-2",
      ok: true,
      data: {},
    });
    assert.equal((await pendingEmpty).ok, true);
  });

  it("reenvía eventos del content script solo con sesión activa y corta observación al stop", async () => {
    const notifications = [];
    const recorded = [];
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-42", status: "recording" },
        }),
        stopRecording: async () => ({ ok: true, data: { status: "ready" } }),
        recordMeetEvent: async (event) => {
          recorded.push(event);
          return { ok: true, data: {} };
        },
      },
      getActiveTab: async () => ({
        id: 7,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async (tabId, message) => {
        notifications.push({ tabId, message });
        return { ok: true };
      },
    });

    const started = await controller.handleMessage({
      type: "START_RECORDING",
      tab: {
        id: 7,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
    });
    assert.equal(started.ok, true);
    assert.equal(started.observationActive, true);
    assert.ok(
      notifications.some((n) => n.message.type === "START_MEET_OBSERVATION")
    );

    await controller.handleMessage({ type: "SET_DIAGNOSTIC", enabled: true });
    const meetEvent = await controller.handleMessage({
      type: "MEET_EVENT",
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 10,
        source: "dom_people_list",
        display_name: "Ana",
        participant_key: "k",
        confidence: 0.55,
      },
    });
    assert.equal(meetEvent.ok, true);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].session_id, "sess-42");

    const diag = await controller.handleMessage({ type: "GET_DIAGNOSTICS" });
    assert.equal(diag.recentEvents.length, 1);

    const stopped = await controller.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-42",
      tab: {
        id: 7,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.observationActive, false);
    assert.ok(
      notifications.some((n) => n.message.type === "STOP_MEET_OBSERVATION")
    );

    const rejected = await controller.handleMessage({
      type: "MEET_EVENT",
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 11,
        source: "dom_people_list",
        display_name: "Ana",
        confidence: 0.55,
      },
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "NO_SESSION");
  });
});
