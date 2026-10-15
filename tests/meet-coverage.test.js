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
const {
  createBackgroundController,
} = require("../shared/background-controller.js");
const MeetTab = require("../shared/meet-tab.js");
const Protocol = require("../shared/protocol.js");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  const dom = new JSDOM(html);
  Object.defineProperty(dom.window.document, "hidden", {
    configurable: true,
    get: () => false,
  });
  return dom.window.document;
}

describe("meet coverage extras", () => {
  it("schema clamp y validaciones de borde", () => {
    assert.equal(Schema.clampConfidence(-1), 0);
    assert.equal(Schema.clampConfidence(2), 1);
    assert.equal(Schema.clampConfidence("x"), 0);
    assert.throws(() =>
      Schema.buildMeetEvent({
        event_type: Schema.EVENT_TYPES.PARTICIPANT_SEEN,
      })
    );
    const withDefaults = Schema.buildMeetEvent({
      session_id: " s ",
      event_type: Schema.EVENT_TYPES.PARTICIPANT_SEEN,
      details: { a: 1 },
    });
    assert.equal(withDefaults.session_id, "s");
    assert.equal(withDefaults.details.a, 1);
    assert.equal(Schema.validateMeetEvent({}).ok, false);
  });

  it("snapshot usa fallbacks de lista y tiles aria", () => {
    assert.equal(DomSnapshot.looksLikePersonName("https://x"), false);
    assert.equal(DomSnapshot.looksLikePersonName("You"), false);
    assert.equal(DomSnapshot.looksLikePersonName("12345"), false);
    assert.equal(DomSnapshot.normalizeName("  a   b "), "a b");
    assert.deepEqual(DomSnapshot.collectByAriaTiles({}), []);
    assert.equal(DomSnapshot.detectActiveSpeaker({}, null), null);

    const listOnly = new JSDOM(`<!doctype html><body>
      <div role="list" aria-label="People">
        <div role="listitem">Dana Ruiz</div>
        <div role="listitem">Microphone</div>
      </div>
    </body>`).window.document;
    const listSnap = DomSnapshot.captureMeetSnapshot(listOnly);
    assert.equal(listSnap.strategy, "dom_people_list");
    assert.equal(listSnap.participants[0].display_name, "Dana Ruiz");

    const tiles = new JSDOM(`<!doctype html><body>
      <div data-participant-tile="true" aria-label="Elena Soto (Presenting)"></div>
      <div aria-label="Elena Soto speaking"></div>
    </body>`).window.document;
    const tileSnap = DomSnapshot.captureMeetSnapshot(tiles);
    assert.equal(tileSnap.strategy, "dom_aria_tile");
    assert.ok(tileSnap.active_speaker);

    const empty = DomSnapshot.captureMeetSnapshot(
      new JSDOM("<html><body></body></html>").window.document
    );
    assert.equal(empty.strategy, "none");
    assert.equal(empty.active_speaker, null);
  });

  it("diff ignora entradas inválidas y speakers iguales", () => {
    const events = ParticipantDiff.diffParticipants(
      [
        { key: null },
        { key: "a", display_name: "A", source: "s", confidence: 0.5 },
      ],
      [{ key: "a", display_name: "A", source: "s", confidence: 0.5 }],
      { session_id: "s", timestamp_epoch_ms: 1, schema: Schema }
    );
    assert.equal(events.length, 0);

    assert.equal(SpeakerDiff.sameSpeaker(null, null), true);
    assert.equal(
      SpeakerDiff.diffActiveSpeaker(null, null, { session_id: "s" }).length,
      0
    );
    assert.equal(
      SpeakerDiff.diffActiveSpeaker(
        { display_name: "A", participant_key: "k" },
        { display_name: "A", participant_key: "k" },
        { session_id: "s", timestamp_epoch_ms: 1, schema: Schema }
      ).length,
      0
    );
    assert.equal(
      SpeakerDiff.diffActiveSpeaker(
        { display_name: "A" },
        { display_name: "A" },
        { session_id: "s", timestamp_epoch_ms: 1, schema: Schema }
      ).length,
      0
    );
  });

  it("observation exige session, rate-limit, observer y diagnóstico", () => {
    assert.throws(() => createMeetObservation({}), /getDocument/);
    const emitted = [];
    let hidden = false;
    const doc = loadFixture("meet-roster-a.html");
    Object.defineProperty(doc, "hidden", {
      configurable: true,
      get: () => hidden,
    });

    let observerCb = null;
    const observation = createMeetObservation({
      getDocument: () => doc,
      pollIntervalMs: 5,
      maxEventsPerMinute: 3,
      setIntervalFn: (fn) => {
        fn();
        return 11;
      },
      clearIntervalFn: () => {},
      createMutationObserver: (cb) => {
        observerCb = cb;
        return {
          observe() {},
          disconnect() {},
        };
      },
      now: () => 1000,
      onEvents(events) {
        emitted.push(...events);
      },
    });

    assert.throws(() => observation.start(""), /session_id/);
    observation.setDiagnostic(true);
    observation.start("sess-1", { diagnostic: true });
    assert.equal(observation.getDiagnostics().diagnostic, true);
    assert.ok(typeof observerCb === "function");

    // Forzar rate limit.
    observation.tick();
    observation.tick();
    const count = emitted.length;
    observation.tick();
    assert.ok(emitted.length <= count + 3);

    hidden = true;
    const beforeHidden = emitted.length;
    observation.tick();
    assert.equal(emitted.length, beforeHidden);

    observation.stop();
    observation.stop();
    assert.equal(observation.isActive(), false);
  });

  it("background cubre errores de observación y eventos inválidos", async () => {
    let failNotify = true;
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      maxDiagnosticEvents: 2,
      client: {
        getStatus: async () => ({
          ok: true,
          data: { status: "recording", session_id: "sess-x" },
        }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-x" },
        }),
        stopRecording: async () => ({ ok: true, data: { status: "ready" } }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 3,
        url: "https://meet.google.com/a",
        title: "t",
      }),
      notifyMeetTab: async () => {
        if (failNotify) {
          throw new Error("content ausente");
        }
        return { ok: false, error: { message: "no arrancó" } };
      },
    });

    const started = await controller.handleStartRecording({
      tab: { id: 3, url: "https://meet.google.com/a", title: "t" },
    });
    assert.match(
      started.observationError || "",
      /content ausente|no arrancó|No se pudo/
    );

    failNotify = false;
    await controller.handleStartRecording({
      tab: { id: 3, url: "https://meet.google.com/a", title: "t" },
    });

    const badEvent = await controller.handleMeetEvent({
      event: { event_type: "nope" },
    });
    assert.equal(badEvent.ok, false);

    await controller.handleMessage({ type: "SET_DIAGNOSTIC", enabled: true });
    await controller.handleMessage({
      type: "MEET_EVENT",
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 1,
        source: "dom_people_list",
        display_name: "A",
        confidence: 0.5,
      },
    });
    await controller.handleMessage({
      type: "MEET_EVENT",
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 2,
        source: "dom_people_list",
        display_name: "B",
        confidence: 0.5,
      },
    });
    await controller.handleMessage({
      type: "MEET_EVENT",
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 3,
        source: "dom_people_list",
        display_name: "C",
        confidence: 0.5,
      },
    });
    const diag = await controller.handleMessage({ type: "GET_DIAGNOSTICS" });
    assert.ok(diag.recentEvents.length <= 2);

    await controller.handleMessage({ type: "SET_DIAGNOSTIC", enabled: false });
    const cleared = await controller.handleMessage({ type: "GET_DIAGNOSTICS" });
    assert.equal(cleared.recentEvents.length, 0);

    // Host deja de estar recording: corta observación.
    const statusController = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-y" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 9,
        url: "https://meet.google.com/a",
        title: "t",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    await statusController.handleStartRecording({
      tab: { id: 9, url: "https://meet.google.com/a", title: "t" },
    });
    assert.equal(statusController.getObservationTabId(), 9);
    await statusController.handleGetStatus({});
    assert.equal(statusController.getObservationTabId(), null);

    const noRecordFn = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-z" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 1,
        url: "https://meet.google.com/a",
        title: "t",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    await noRecordFn.handleStartRecording({
      tab: { id: 1, url: "https://meet.google.com/a", title: "t" },
    });
    const unsupported = await noRecordFn.handleMeetEvent({
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 1,
        source: "x",
        display_name: "A",
        confidence: 0.4,
      },
    });
    assert.equal(unsupported.error.code, "HOST_UNSUPPORTED");

    assert.equal(controller.isDiagnosticEnabled(), false);
    assert.equal(typeof controller.getLastSessionId(), "string");

    // SET_DIAGNOSTIC con observación activa: éxito y fallo de notify.
    let notifyMode = "ok";
    const diagCtrl = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-diag" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
        recordMeetEvent: async () => {
          throw Object.assign(new Error("boom"), { code: "HOST_UNAVAILABLE" });
        },
      },
      getActiveTab: async () => ({
        id: 4,
        url: "https://meet.google.com/a",
        title: "t",
      }),
      notifyMeetTab: async () => {
        if (notifyMode === "throw") {
          throw new Error("fail");
        }
        return { ok: true };
      },
    });
    await diagCtrl.handleStartRecording({
      tab: { id: 4, url: "https://meet.google.com/a", title: "t" },
    });
    notifyMode = "throw";
    await diagCtrl.handleMessage({ type: "SET_DIAGNOSTIC", enabled: true });
    notifyMode = "ok";
    await diagCtrl.handleMessage({ type: "SET_DIAGNOSTIC", enabled: true });
    const recordFail = await diagCtrl.handleMeetEvent({
      event: {
        event_type: "participant_joined",
        timestamp_epoch_ms: 1,
        source: "dom_people_list",
        display_name: "Z",
        confidence: 0.5,
      },
    });
    assert.equal(recordFail.ok, false);

    const mismatch = await diagCtrl.handleMeetEvent({
      event: {
        session_id: "otra",
        event_type: "participant_joined",
        timestamp_epoch_ms: 1,
        source: "dom_people_list",
        display_name: "Z",
        confidence: 0.5,
      },
    });
    assert.equal(mismatch.error.code, "SESSION_MISMATCH");

    // start sin tabId
    const noTabId = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-nt" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        url: "https://meet.google.com/a",
        title: "t",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    const startedNoId = await noTabId.handleStartRecording({
      tab: { url: "https://meet.google.com/a", title: "t" },
    });
    assert.match(startedNoId.observationError, /tabId/i);
  });

  it("observation debounce y documento nulo", () => {
    const timeouts = [];
    const doc = loadFixture("meet-roster-a.html");
    let observerCb = null;
    const observation = createMeetObservation({
      getDocument: () => doc,
      pollIntervalMs: 99999,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: (fn) => {
        timeouts.push(fn);
        return 1;
      },
      createMutationObserver: (cb) => {
        observerCb = cb;
        return { observe() {}, disconnect() {} };
      },
      now: () => 42,
      onEvents() {},
    });
    observation.start("sess-deb");
    assert.ok(observerCb);
    observerCb();
    observerCb();
    assert.equal(timeouts.length, 1);
    timeouts[0]();
    observation.stop();

    const nullDocObs = createMeetObservation({
      getDocument: () => null,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      now: () => 1,
      onEvents: () => {},
    });
    nullDocObs.start("sess-null");
    nullDocObs.tick();
    nullDocObs.stop();

    assert.equal(DomSnapshot.findPeopleLists({}).length, 0);
    assert.deepEqual(DomSnapshot.collectByParticipantId({}), []);

    // Nombre en hijo sin data-self-name en el contenedor.
    const nested = new JSDOM(`<!doctype html><body>
      <div data-participant-id="u-1"><div><span>Flor López</span></div></div>
      <div data-participant-id="u-1b" data-is-speaking="true" aria-label="alguien speaking"></div>
    </body>`).window.document;
    const nestedSnap = DomSnapshot.captureMeetSnapshot(nested);
    assert.ok(
      nestedSnap.participants.some((p) => p.display_name === "Flor López")
    );
  });

  it("cubre ramas restantes de snapshot, observation y background", async () => {
    assert.equal(
      Schema.validateMeetEvent({
        get event_type() {
          throw { notAnError: true };
        },
      }).error,
      "evento inválido"
    );

    ParticipantDiff.diffParticipants(null, null, {
      session_id: "s",
      timestamp_epoch_ms: 1,
    });

    const personas = new JSDOM(`<!doctype html><body>
      <div role="list" aria-label="Personas">
        <div role="listitem">Gabi Núñez</div>
      </div>
      <div data-participant-id=""></div>
      <div data-participant-id="bad"><span>You</span></div>
      <div data-participant-tile="true" aria-label="Microphone"></div>
    </body>`).window.document;
    const personasSnap = DomSnapshot.captureMeetSnapshot(personas);
    assert.equal(personasSnap.strategy, "dom_people_list");
    assert.ok(
      personasSnap.participants.some((p) => p.display_name === "Gabi Núñez")
    );

    const badTiles = DomSnapshot.collectByAriaTiles(
      new JSDOM(`<!doctype html><body>
        <div data-participant-tile="true" aria-label="You"></div>
        <div data-participant-tile="true" aria-label="https://evil.example"></div>
      </body>`).window.document
    );
    assert.equal(badTiles.length, 0);

    const childName = DomSnapshot.collectByParticipantId(
      new JSDOM(`<!doctype html><body>
        <div data-participant-id="u-child" data-self-name="You">
          <span>${"Z".repeat(70)}</span>
          <span>Nombre Corto Válido</span>
        </div>
      </body>`).window.document
    );
    assert.equal(childName[0].display_name, "Nombre Corto Válido");

    const matchedSpeaker = new JSDOM(`<!doctype html><body>
      <div data-participant-id="p1" data-self-name="Ana Pérez"></div>
      <div data-is-speaking="true" aria-label="Ana Pérez" data-self-name="You"></div>
    </body>`).window.document;
    const matchedSnap = DomSnapshot.captureMeetSnapshot(matchedSpeaker);
    assert.equal(matchedSnap.active_speaker.display_name, "Ana Pérez");
    assert.equal(
      matchedSnap.active_speaker.source,
      Schema.SOURCES.DOM_SPEAKING_ATTR
    );

    const matchedAria = DomSnapshot.detectActiveSpeaker(
      new JSDOM(`<!doctype html><body>
        <div aria-label="Ana Pérez hablando" data-self-name="You"></div>
      </body>`).window.document,
      [
        {
          key: "k",
          display_name: "Ana Pérez",
          source: Schema.SOURCES.DOM_PARTICIPANT_ID,
        },
      ]
    );
    assert.equal(matchedAria.source, Schema.SOURCES.DOM_SPEAKING_ARIA);

    assert.equal(
      DomSnapshot.detectActiveSpeaker(
        new JSDOM(`<!doctype html><body>
          <div data-is-speaking="true" data-self-name="You" aria-label="noise"></div>
        </body>`).window.document,
        [{ key: "k", display_name: "Nadie Aquí" }]
      ),
      null
    );

    const noRootDoc = new JSDOM("<html><body><p>sin lista</p></body></html>")
      .window.document;
    Object.defineProperty(noRootDoc, "hidden", {
      configurable: true,
      get: () => false,
    });
    const obsNoRoot = createMeetObservation({
      getDocument: () => noRootDoc,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      createMutationObserver: () => ({ observe() {}, disconnect() {} }),
      now: () => 7,
      onEvents() {},
    });
    obsNoRoot.start("sess-a");
    assert.equal(obsNoRoot.getSessionId(), "sess-a");
    obsNoRoot.start("sess-b");
    assert.equal(obsNoRoot.getSessionId(), "sess-b");
    obsNoRoot.stop();

    let stopThrows = false;
    const bg = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-stop" },
        }),
        stopRecording: async () => ({ ok: true, data: { status: "ready" } }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 8,
        url: "https://meet.google.com/x",
        title: "t",
      }),
      notifyMeetTab: async (_id, msg) => {
        if (msg.type === "STOP_MEET_OBSERVATION" && stopThrows) {
          throw new Error("tab closed");
        }
        if (msg.type === "START_MEET_OBSERVATION") {
          throw Object.create(null);
        }
        return { ok: true };
      },
    });
    const started = await bg.handleStartRecording({
      tab: { id: 8, url: "https://meet.google.com/x", title: "t" },
    });
    assert.match(started.observationError || "", /No se pudo contactar/);
    stopThrows = true;
    await bg.handleStopRecording({});

    const bare = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-tabid" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => null,
      notifyMeetTab: async () => ({ ok: true }),
    });
    await bare.handleMessage({ type: "SET_DIAGNOSTIC", enabled: true });
    const viaTabId = await bare.handleStartRecording({
      tab: {
        tabId: 22,
        url: "https://meet.google.com/x",
        title: "t",
      },
    });
    assert.equal(viaTabId.observationActive, true);
    assert.equal(bare.getObservationTabId(), 22);

    const whitespaceSession = await bare.handleMeetEvent({
      event: {
        session_id: "   ",
        event_type: "participant_joined",
        timestamp_epoch_ms: 1,
        source: "dom_people_list",
        display_name: "A",
        confidence: 0.5,
      },
    });
    assert.equal(whitespaceSession.ok, true);

    const noEventPayload = await bare.handleMeetEvent({});
    assert.equal(noEventPayload.ok, false);

    const unknownSpeaker = DomSnapshot.detectActiveSpeaker(
      new JSDOM(`<!doctype html><body>
        <div data-speaking="true" data-self-name="Voz Extraña"></div>
      </body>`).window.document,
      []
    );
    assert.equal(unknownSpeaker.display_name, "Voz Extraña");
    assert.equal(unknownSpeaker.participant_key, null);
    assert.equal(unknownSpeaker.source, Schema.SOURCES.DOM_SPEAKING_ATTR);

    // Defaults: onEvents vacío y notifyMeetTab ausente.
    const defaultObs = createMeetObservation({
      getDocument: () => noRootDoc,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      now: () => 1,
    });
    defaultObs.start("sess-default");
    defaultObs.stop();

    const noNotify = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      eventSchema: Schema,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-nn" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
        recordMeetEvent: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 5,
        url: "https://meet.google.com/x",
        title: "t",
      }),
    });
    const startedDefaultNotify = await noNotify.handleStartRecording({
      tab: { id: 5, url: "https://meet.google.com/x", title: "t" },
    });
    assert.match(
      startedDefaultNotify.observationError || "",
      /content script|no pudo/i
    );
  });
});
