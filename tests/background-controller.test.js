const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol.js");
const MeetTab = require("../shared/meet-tab.js");
const {
  createBackgroundController,
} = require("../shared/background-controller.js");
const {
  derivePopupView,
  TRANSCRIPTOR_STATUS,
} = require("../shared/popup-state.js");
const {
  applyBackgroundResult,
  createInitialState,
} = require("../shared/popup-controller.js");

function meetTab() {
  return {
    url: "https://meet.google.com/abc-defg-hij",
    title: "Standup",
  };
}

function createFakeClient(handlers) {
  return {
    getStatus:
      handlers.getStatus ||
      (async () => ({ ok: true, data: { status: "ready" } })),
    startRecording:
      handlers.startRecording ||
      (async () => ({
        ok: true,
        data: { session_id: "sess-1", status: "recording" },
      })),
    stopRecording:
      handlers.stopRecording ||
      (async () => ({ ok: true, data: { status: "ready" } })),
  };
}

describe("background-controller", () => {
  it("GET_STATUS con host listo y pestaña Meet", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => meetTab(),
    });

    const result = await controller.handleMessage({ type: "GET_STATUS" });
    assert.equal(result.ok, true);
    assert.equal(result.tab.onMeet, true);
    assert.equal(result.transcriptorStatus, "ready");
    assert.equal(result.sessionId, null);
  });

  it("GET_STATUS con host ausente deja disconnected y no inventa grabación", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        getStatus: async () => {
          throw Object.assign(new Error("host ausente"), {
            code: "HOST_NOT_FOUND",
          });
        },
      }),
      getActiveTab: async () => meetTab(),
    });

    const result = await controller.handleMessage({ type: "GET_STATUS" });
    assert.equal(result.ok, false);
    assert.equal(result.transcriptorStatus, "disconnected");
    assert.equal(result.sessionId, null);

    const view = derivePopupView(
      applyBackgroundResult(createInitialState(), result)
    );
    assert.equal(view.transcriptorStatus, TRANSCRIPTOR_STATUS.DISCONNECTED);
    assert.equal(view.canStart, false);
    assert.notEqual(view.transcriptorStatus, TRANSCRIPTOR_STATUS.RECORDING);
  });

  it("START_RECORDING exige Meet y session_id confirmado", async () => {
    const outside = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => ({ url: "https://example.com", title: "x" }),
    });
    const denied = await outside.handleMessage({ type: "START_RECORDING" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "NOT_MEET_TAB");

    let startedPayload = null;
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async (payload) => {
          startedPayload = payload;
          return {
            ok: true,
            data: { session_id: "sess-77", status: "recording" },
          };
        },
      }),
      getActiveTab: async () => meetTab(),
    });

    const started = await controller.handleMessage({ type: "START_RECORDING" });
    assert.equal(started.ok, true);
    assert.equal(started.transcriptorStatus, "recording");
    assert.equal(started.sessionId, "sess-77");
    assert.deepEqual(startedPayload, {
      url: "https://meet.google.com/abc-defg-hij",
      title: "Standup",
    });
    assert.equal(controller.getLastSessionId(), "sess-77");
  });

  it("START_RECORDING con error del host no deja estado recording", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: false,
          error: { code: "START_REJECTED", message: "FFmpeg falló" },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });

    const result = await controller.handleMessage({ type: "START_RECORDING" });
    assert.equal(result.ok, false);
    assert.equal(result.transcriptorStatus, "error");
    assert.equal(result.sessionId, null);
    assert.equal(controller.getLastSessionId(), null);
  });

  it("STOP_RECORDING finaliza la misma sesión y limpia sessionId", async () => {
    const stopped = [];
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-12", status: "recording" },
        }),
        stopRecording: async (payload) => {
          stopped.push(payload);
          return { ok: true, data: { status: "ready" } };
        },
      }),
      getActiveTab: async () => meetTab(),
    });

    await controller.handleMessage({ type: "START_RECORDING" });
    const result = await controller.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-12",
    });
    assert.equal(result.ok, true);
    assert.equal(result.transcriptorStatus, "ready");
    assert.equal(result.sessionId, null);
    assert.deepEqual(stopped[0], { session_id: "sess-12" });
    assert.equal(controller.getLastSessionId(), null);
  });

  it("STOP_RECORDING sin sesión o con error del host", async () => {
    const empty = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => meetTab(),
    });
    const noSession = await empty.handleMessage({ type: "STOP_RECORDING" });
    assert.equal(noSession.ok, false);
    assert.equal(noSession.error.code, "NO_SESSION");

    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-9", status: "recording" },
        }),
        stopRecording: async () => ({
          ok: false,
          error: { code: "STOP_REJECTED", message: "No se pudo finalizar" },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    await controller.handleMessage({ type: "START_RECORDING" });
    const failedStop = await controller.handleMessage({
      type: "STOP_RECORDING",
    });
    assert.equal(failedStop.ok, false);
    assert.equal(failedStop.sessionId, "sess-9");
    assert.equal(failedStop.error.code, "STOP_REJECTED");
  });

  it("rechaza mensajes inválidos y tipos desconocidos", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => meetTab(),
    });

    const bad = await controller.handleMessage(null);
    assert.equal(bad.error.code, "BAD_MESSAGE");

    const unknown = await controller.handleMessage({ type: "HACK" });
    assert.equal(unknown.error.code, "UNKNOWN_MESSAGE");
  });

  it("usa pestaña nula de forma segura", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => null,
    });
    const result = await controller.handleMessage({ type: "GET_STATUS" });
    assert.equal(result.tab.onMeet, false);
    assert.equal(result.ok, true);
  });
});
