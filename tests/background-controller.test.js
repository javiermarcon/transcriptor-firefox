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
          return {
            ok: true,
            data: {
              status: "transcribing",
              transcribed: false,
              transcription_started: true,
              meeting_dir: "/tmp/m",
            },
          };
        },
        getStatus: async () => ({
          ok: true,
          data: {
            status: "transcribing",
            meeting_dir: "/tmp/m",
            progress: {
              percent: 34,
              current_s: 721,
              total_s: 2100,
              label: "[ 34.00%] 12:01 / 35:00",
            },
          },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });

    await controller.handleMessage({ type: "START_RECORDING" });
    const result = await controller.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-12",
      transcribe: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.transcriptorStatus, "transcribing");
    assert.equal(result.sessionId, null);
    assert.equal(result.transcriptionStarted, true);
    assert.equal(result.transcribed, false);
    assert.match(result.hostMessage, /Transcribiendo/);
    assert.deepEqual(stopped[0], {
      session_id: "sess-12",
      transcribe: true,
    });
    assert.equal(controller.getLastSessionId(), null);

    const status = await controller.handleMessage({ type: "GET_STATUS" });
    assert.equal(status.transcriptorStatus, "transcribing");
    assert.equal(status.progress.label, "[ 34.00%] 12:01 / 35:00");

    const doneCtrl = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        getStatus: async () => ({
          ok: true,
          data: {
            status: "ready",
            transcribed: true,
            plain_transcript: "/tmp/t.txt",
            transcription_error: null,
            meeting_dir: "/tmp/m",
          },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    const done = await doneCtrl.handleMessage({ type: "GET_STATUS" });
    assert.equal(done.transcribed, true);
    assert.equal(done.plainTranscript, "/tmp/t.txt");
    assert.equal(done.meetingDir, "/tmp/m");
    assert.equal(done.transcriptionError, null);

    const errCtrl = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        getStatus: async () => ({
          ok: true,
          data: {
            status: "ready",
            transcribed: false,
            transcription_error: "sin GPU",
            meeting_dir: "/tmp/m",
          },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    const failed = await errCtrl.handleMessage({ type: "GET_STATUS" });
    assert.equal(failed.transcriptionError, "sin GPU");
    assert.equal(failed.plainTranscript, null);
  });

  it("STOP_RECORDING informa error de transcripción o solo grabación", async () => {
    const stopped = [];
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-tx", status: "recording" },
        }),
        stopRecording: async (payload) => {
          stopped.push(payload);
          if (payload.transcribe) {
            return {
              ok: true,
              data: {
                status: "ready",
                transcribed: false,
                transcription_error: "sin GPU",
                meeting_dir: "/tmp/m",
              },
            };
          }
          return {
            ok: true,
            data: {
              status: "ready",
              transcribed: false,
              meeting_dir: "/tmp/solo",
            },
          };
        },
      }),
      getActiveTab: async () => meetTab(),
    });

    await controller.handleMessage({ type: "START_RECORDING" });
    const failedTx = await controller.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-tx",
      transcribe: true,
    });
    assert.equal(failedTx.ok, true);
    assert.match(failedTx.hostMessage, /falló la transcripción.*sin GPU/);

    const startedOnly = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-async", status: "recording" },
        }),
        stopRecording: async () => ({
          ok: true,
          data: {
            status: "transcribing",
            transcription_started: true,
            transcribed: false,
          },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    await startedOnly.handleMessage({ type: "START_RECORDING" });
    const asyncStop = await startedOnly.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-async",
      transcribe: true,
    });
    assert.equal(asyncStop.transcriptionStarted, true);
    assert.equal(asyncStop.hostMessage, "Grabación guardada. Transcribiendo…");

    const withPath = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-path", status: "recording" },
        }),
        stopRecording: async () => ({
          ok: true,
          data: {
            status: "ready",
            transcribed: true,
            plain_transcript: "/tmp/done.txt",
          },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    await withPath.handleMessage({ type: "START_RECORDING" });
    const pathStop = await withPath.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-path",
      transcribe: true,
    });
    assert.match(pathStop.hostMessage, /Transcripción lista: \/tmp\/done\.txt/);

    const restarted = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-save", status: "recording" },
        }),
        stopRecording: async (payload) => {
          stopped.push(payload);
          return {
            ok: true,
            data: {
              status: "ready",
              transcribed: true,
              meeting_dir: "/tmp/solo",
            },
          };
        },
      }),
      getActiveTab: async () => meetTab(),
    });
    await restarted.handleMessage({ type: "START_RECORDING" });
    const saveOnly = await restarted.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-save",
      transcribe: false,
    });
    assert.equal(saveOnly.ok, true);
    assert.match(saveOnly.hostMessage, /Grabación guardada en: \/tmp\/solo/);
    assert.deepEqual(stopped[stopped.length - 1], {
      session_id: "sess-save",
      transcribe: false,
    });

    const noPath = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-np", status: "recording" },
        }),
        stopRecording: async () => ({
          ok: true,
          data: { status: "ready", transcribed: true },
        }),
      }),
      getActiveTab: async () => meetTab(),
    });
    await noPath.handleMessage({ type: "START_RECORDING" });
    const readyOnly = await noPath.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-np",
      transcribe: true,
    });
    assert.equal(readyOnly.hostMessage, "Transcripción lista.");

    const emptyData = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-ed", status: "recording" },
        }),
        stopRecording: async () => ({ ok: true, data: null }),
      }),
      getActiveTab: async () => meetTab(),
    });
    await emptyData.handleMessage({ type: "START_RECORDING" });
    const noMsg = await emptyData.handleMessage({
      type: "STOP_RECORDING",
      sessionId: "sess-ed",
      transcribe: false,
    });
    assert.equal(noMsg.ok, true);
    assert.equal(noMsg.hostMessage, "");
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

  it("prioriza la pestaña enviada por el popup sobre getActiveTab", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: createFakeClient({}),
      getActiveTab: async () => ({
        url: "https://example.com",
        title: "Example",
      }),
    });

    const result = await controller.handleMessage({
      type: "GET_STATUS",
      tab: {
        url: "https://meet.google.com/abc-defg-hij",
        title: "Standup",
      },
    });
    assert.equal(result.tab.onMeet, true);
    assert.equal(result.tab.title, "Standup");
  });
});
