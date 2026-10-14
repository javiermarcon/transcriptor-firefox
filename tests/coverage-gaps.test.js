const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol.js");
const MeetTab = require("../shared/meet-tab.js");
const { createNativeClient } = require("../shared/native-client.js");
const {
  createBackgroundController,
} = require("../shared/background-controller.js");
const {
  derivePopupView,
  TRANSCRIPTOR_STATUS,
} = require("../shared/popup-state.js");
const {
  createInitialState,
  applyBackgroundResult,
} = require("../shared/popup-controller.js");
const { createFakePort, waitForSent } = require("./helpers/fake-port.js");
const { validateManifest, main } = require("../scripts/validate-manifest.js");

function meetTab() {
  return {
    url: "https://meet.google.com/abc-defg-hij",
    title: "Standup",
  };
}

describe("coverage gaps: protocol", () => {
  it("genera request_id con crypto.randomUUID y con fallback", () => {
    const previous = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "uuid-fixed" },
    });
    try {
      const withCrypto = Protocol.buildRequest(Protocol.ACTIONS.GET_STATUS);
      assert.equal(withCrypto.request_id, "uuid-fixed");

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {},
      });
      const fallback = Protocol.buildRequest(Protocol.ACTIONS.GET_STATUS);
      assert.match(fallback.request_id, /^req-/);

      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: undefined,
      });
      const withoutCrypto = Protocol.buildRequest(Protocol.ACTIONS.GET_STATUS);
      assert.match(withoutCrypto.request_id, /^req-/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: previous,
      });
    }

    const preserved = Protocol.mapConnectionError(
      Object.assign(new Error("ya tipado"), { code: "HOST_NOT_FOUND" })
    );
    assert.equal(preserved.code, "HOST_NOT_FOUND");
    assert.equal(preserved.message, "ya tipado");

    assert.deepEqual(
      Protocol.validateResponse(
        {
          protocol_version: 1,
          request_id: "d1",
          ok: true,
          data: "no-object",
        },
        "d1"
      ).data,
      {}
    );

    assert.equal(
      Protocol.mapConnectionError(
        new Error("Specified native messaging host not found")
      ).code,
      "HOST_NOT_FOUND"
    );
    assert.equal(
      Protocol.mapConnectionError(new Error("Native application foo not found"))
        .code,
      "HOST_NOT_FOUND"
    );
    assert.equal(
      Protocol.mapConnectionError(new Error("native application crashed")).code,
      "HOST_UNAVAILABLE"
    );
    assert.equal(Protocol.mapConnectionError(null).code, "HOST_UNAVAILABLE");
    assert.equal(Protocol.mapConnectionError(42).code, "HOST_UNAVAILABLE");
    assert.equal(Protocol.mapConnectionError({}).code, "HOST_UNAVAILABLE");
    assert.equal(
      Protocol.mapConnectionError(
        Object.assign(new Error(""), { code: "HOST_X" })
      ).code,
      "HOST_UNAVAILABLE"
    );

    assert.deepEqual(Protocol.normalizeHostStatus(null), {
      status: "ready",
      session_id: null,
    });
    assert.deepEqual(Protocol.normalizeHostStatus("ready"), {
      status: "ready",
      session_id: null,
    });
    assert.equal(
      Protocol.normalizeHostStatus({ status: "error" }).message,
      "El transcriptor reportó un error."
    );
    assert.equal(
      Protocol.normalizeHostStatus({ status: "error", message: 12 }).message,
      "El transcriptor reportó un error."
    );
  });
});

describe("coverage gaps: meet-tab", () => {
  it("rechaza URLs que hacen fallar el parser", () => {
    assert.equal(MeetTab.isMeetUrl("https://[::1"), false);
    assert.equal(MeetTab.isMeetUrl("http://%"), false);
  });
});

describe("coverage gaps: popup-state/controller", () => {
  it("usa defaults cuando falta tab o el estado es desconocido", () => {
    const noTab = derivePopupView({
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
    });
    assert.equal(noTab.tabLabel, "Fuera de Meet");
    assert.equal(noTab.canStart, false);

    const unknownWithError = derivePopupView({
      tab: { onMeet: true, title: "X", label: "Google Meet" },
      transcriptorStatus: "weird",
      errorMessage: "falló",
    });
    assert.equal(unknownWithError.transcriptorStatus, "error");

    const unknownWithoutError = derivePopupView({
      tab: { onMeet: true, title: "X", label: "Google Meet" },
      transcriptorStatus: "weird",
    });
    assert.equal(unknownWithoutError.transcriptorStatus, "disconnected");

    const labelFallback = derivePopupView({
      tab: { onMeet: true, title: "X" },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
    });
    assert.equal(labelFallback.tabLabel, "Google Meet");

    const outsideNoLabel = derivePopupView({
      tab: { onMeet: false, title: "" },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
    });
    assert.equal(outsideNoLabel.tabLabel, "Fuera de Meet");
  });

  it("aplica error sin mensaje y HOST_ sin status explícito", () => {
    const noMessage = applyBackgroundResult(createInitialState(), {
      ok: false,
      tab: {
        onMeet: true,
        title: "X",
        label: "Google Meet",
        url: "https://meet.google.com/x",
      },
    });
    assert.equal(noMessage.transcriptorStatus, "error");
    assert.match(noMessage.errorMessage, /error al hablar/i);

    const hostCode = applyBackgroundResult(createInitialState(), {
      ok: false,
      error: { code: "HOST_UNAVAILABLE", message: "caído" },
    });
    assert.equal(hostCode.transcriptorStatus, "disconnected");
    assert.equal(hostCode.errorMessage, "caído");

    const plainError = applyBackgroundResult(createInitialState(), {
      ok: false,
      error: { code: "OTHER", message: "falló" },
    });
    assert.equal(plainError.transcriptorStatus, "error");

    const customApi = applyBackgroundResult(
      createInitialState({
        TRANSCRIPTOR_STATUS: {
          DISCONNECTED: "disconnected",
          READY: "ready",
          RECORDING: "recording",
          ERROR: "error",
        },
      }),
      { ok: true, transcriptorStatus: "ready", sessionId: null },
      {
        TRANSCRIPTOR_STATUS: {
          DISCONNECTED: "disconnected",
          READY: "ready",
          RECORDING: "recording",
          ERROR: "error",
        },
      }
    );
    assert.equal(customApi.transcriptorStatus, "ready");
  });
});

describe("coverage gaps: background-controller", () => {
  it("valida dependencias requeridas", () => {
    assert.throws(
      () => createBackgroundController({ getActiveTab: async () => null }),
      /client Native Messaging requerido/
    );
    assert.throws(
      () =>
        createBackgroundController({
          client: { getStatus: async () => ({}) },
        }),
      /getActiveTab requerido/
    );
  });

  it("cubre get_status no ok, recording y PROTOCOL_INFO", async () => {
    const recordingClient = {
      getStatus: async () => ({
        ok: true,
        data: { status: "recording", session_id: "sess-live", message: "ok" },
      }),
      startRecording: async () => ({ ok: true, data: { session_id: "x" } }),
      stopRecording: async () => ({ ok: true, data: { status: "ready" } }),
    };
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: recordingClient,
      getActiveTab: async () => meetTab(),
    });

    const recording = await controller.handleGetStatus();
    assert.equal(recording.transcriptorStatus, "recording");
    assert.equal(recording.sessionId, "sess-live");
    assert.equal(recording.hostMessage, "ok");

    const failedStatus = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({
          ok: false,
          error: { code: "BUSY", message: "ocupado" },
        }),
        startRecording: async () => ({ ok: false, error: { code: "X" } }),
        stopRecording: async () => ({ ok: false, error: { code: "Y" } }),
      },
      getActiveTab: async () => meetTab(),
    });
    const bad = await failedStatus.handleGetStatus();
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "BUSY");

    const info = await controller.handleMessage({ type: "PROTOCOL_INFO" });
    assert.equal(info.ok, true);
    assert.equal(info.host, Protocol.NATIVE_HOST_NAME);
    assert.equal(info.protocol_version, 1);

    const infoWithoutProtocol = await createBackgroundController({
      meetTab: MeetTab,
      client: recordingClient,
      getActiveTab: async () => meetTab(),
    }).handleMessage({ type: "PROTOCOL_INFO" });
    assert.equal(infoWithoutProtocol.host, undefined);
  });

  it("mapea errores de start/stop y HOST_DISCONNECTED", async () => {
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => {
          throw Object.assign(new Error("bye"), { code: "HOST_DISCONNECTED" });
        },
        startRecording: async () => {
          throw Object.assign(new Error("sin host"), {
            code: "HOST_UNAVAILABLE",
          });
        },
        stopRecording: async () => {
          throw new Error("boom");
        },
      },
      getActiveTab: async () => meetTab(),
    });

    const disconnected = await controller.handleGetStatus();
    assert.equal(disconnected.transcriptorStatus, "disconnected");

    const startFail = await controller.handleStartRecording();
    assert.equal(startFail.transcriptorStatus, "disconnected");

    const withSession = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-err" },
        }),
        stopRecording: async () => {
          throw Object.assign(new Error("x"), { code: "EPIPE" });
        },
      },
      getActiveTab: async () => ({
        url: "https://meet.google.com/abc-defg-hij",
        title: "",
      }),
    });
    await withSession.handleStartRecording();
    const stopFail = await withSession.handleStopRecording({});
    assert.equal(stopFail.ok, false);
    assert.equal(stopFail.sessionId, "sess-err");
    assert.equal(stopFail.error.code, "EPIPE");

    const noCode = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => {
          throw {};
        },
        startRecording: async () => {
          throw {};
        },
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => meetTab(),
    });
    const generic = await noCode.handleGetStatus();
    assert.equal(generic.error.code, "HOST_UNAVAILABLE");
    assert.match(generic.error.message, /No se pudo comunicar/);

    const recordingNoSession = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({
          ok: true,
          data: { status: "recording" },
        }),
        startRecording: async () => ({ ok: true, data: { session_id: "x" } }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => meetTab(),
    });
    const rec = await recordingNoSession.handleGetStatus();
    assert.equal(rec.transcriptorStatus, "recording");
    assert.equal(rec.sessionId, null);

    const emptyStatus = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: {} }),
        startRecording: async () => ({ ok: true, data: { session_id: "x" } }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => meetTab(),
    });
    const empty = await emptyStatus.handleGetStatus();
    assert.equal(empty.transcriptorStatus, "ready");

    const startTimeout = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        startRecording: async () => {
          throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
        },
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => meetTab(),
    });
    const timedOut = await startTimeout.handleStartRecording();
    assert.equal(timedOut.transcriptorStatus, "error");
    assert.equal(timedOut.error.code, "TIMEOUT");

    const nullData = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: null }),
        startRecording: async () => ({ ok: true, data: { session_id: "x" } }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => meetTab(),
    });
    const nulled = await nullData.handleGetStatus();
    assert.equal(nulled.transcriptorStatus, "ready");
  });
});

describe("coverage gaps: native-client", () => {
  const originalBrowser = global.browser;

  afterEach(() => {
    if (originalBrowser === undefined) {
      delete global.browser;
    } else {
      global.browser = originalBrowser;
    }
  });

  it("exige protocol y connectNative", () => {
    assert.throws(
      () => createNativeClient({ protocol: null, connectNative: () => ({}) }),
      /MeetingsProtocol no está disponible/
    );
    delete global.browser;
    assert.throws(
      () => createNativeClient({ protocol: Protocol }),
      /connectNative no está disponible/
    );
    global.browser = { runtime: {} };
    assert.throws(
      () => createNativeClient({ protocol: Protocol }),
      /connectNative no está disponible/
    );
  });

  it("usa browser.runtime.connectNative cuando no se inyecta", async () => {
    const port = createFakePort();
    global.browser = {
      runtime: {
        connectNative: () => port,
      },
    };
    const client = createNativeClient({
      generateId: () => "browser-1",
    });
    const pending = client.getStatus();
    await waitForSent(port, 1);
    port.emitMessage({
      protocol_version: 1,
      request_id: "browser-1",
      ok: true,
      data: { status: "ready" },
    });
    assert.equal((await pending).ok, true);
  });

  it("rechaza puerto nulo y reutiliza conexión en curso", async () => {
    await assert.rejects(
      createNativeClient({
        protocol: Protocol,
        connectNative: () => null,
      }).getStatus(),
      (err) => err.code === "HOST_NOT_FOUND"
    );

    let resolveConnect;
    const connectPromise = new Promise((resolve) => {
      resolveConnect = resolve;
    });
    const port = createFakePort();
    let connects = 0;
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => {
        connects += 1;
        return connectPromise;
      },
      generateId: () => `c-${connects}-${Date.now()}`,
    });

    const first = client.getStatus({ generateId: () => "a1" });
    const second = client.getStatus({ generateId: () => "a2" });
    resolveConnect(port);
    await waitForSent(port, 2);
    assert.equal(connects, 1);
    port.emitMessage({
      protocol_version: 1,
      request_id: "a1",
      ok: true,
      data: { status: "ready" },
    });
    port.emitMessage({
      protocol_version: 1,
      request_id: "a2",
      ok: true,
      data: { status: "ready" },
    });
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
  });

  it("propaga fallos de postMessage, getStatus no ok y disconnect", async () => {
    const port = createFakePort();
    port.postMessage = () => {
      throw new Error("disconnected while sending");
    };
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => "pm-1",
    });
    await assert.rejects(
      client.getStatus(),
      (err) => err.code === "HOST_DISCONNECTED"
    );

    const port2 = createFakePort();
    const client2 = createNativeClient({
      protocol: Protocol,
      connectNative: () => port2,
      generateId: () => "st-bad",
    });
    const pending = client2.getStatus();
    await waitForSent(port2, 1);
    port2.emitMessage({
      protocol_version: 1,
      request_id: "st-bad",
      ok: false,
      error: { code: "BUSY", message: "ocupado" },
    });
    const bad = await pending;
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, "BUSY");

    const port3 = createFakePort();
    const client3 = createNativeClient({
      protocol: Protocol,
      connectNative: () => port3,
      generateId: () => "disc-1",
    });
    const pending3 = client3.getStatus();
    await waitForSent(port3, 1);
    client3.disconnect();
    await assert.rejects(pending3, (err) => err.code === "HOST_DISCONNECTED");

    const port4 = createFakePort();
    port4.onMessage.removeListener = () => {
      throw new Error("remove failed");
    };
    const client4 = createNativeClient({
      protocol: Protocol,
      connectNative: () => port4,
      generateId: () => "disc-2",
    });
    const p4 = client4.getStatus();
    await waitForSent(port4, 1);
    port4.disconnect = () => {
      throw new Error("disconnect failed");
    };
    client4.disconnect();
    await assert.rejects(p4, (err) => err.code === "HOST_DISCONNECTED");

    const port5 = createFakePort();
    const client5 = createNativeClient({
      protocol: Protocol,
      connectNative: () => port5,
      generateId: () => "reuse",
    });
    const first = client5.getStatus({ generateId: () => "r1" });
    await waitForSent(port5, 1);
    port5.emitMessage({
      protocol_version: 1,
      request_id: "r1",
      ok: true,
      data: { status: "ready" },
    });
    await first;
    const second = client5.getStatus({ generateId: () => "r2" });
    await waitForSent(port5, 2);
    port5.emitMessage({
      protocol_version: 1,
      request_id: "r2",
      ok: true,
      data: { status: "ready" },
    });
    assert.equal((await second).ok, true);
  });

  it("cubre defaults de START/STOP_REJECTED con protocolo incompleto", async () => {
    const port = createFakePort();
    let n = 0;
    const looseProtocol = Object.assign({}, Protocol, {
      validateResponse() {
        return { ok: false, request_id: `g-${n}`, error: {} };
      },
    });
    const client = createNativeClient({
      protocol: looseProtocol,
      connectNative: () => port,
      generateId: () => `g-${++n}`,
    });

    const startPending = client.startRecording({
      url: "https://meet.google.com/a",
      title: "t",
    });
    await waitForSent(port, 1);
    port.emitMessage({ request_id: "g-1" });
    const startResult = await startPending;
    assert.equal(startResult.error.code, "START_REJECTED");
    assert.match(startResult.error.message, /no pudo iniciar/i);

    const stopPending = client.stopRecording({ session_id: "s1" });
    await waitForSent(port, 2);
    port.emitMessage({ request_id: "g-2" });
    const stopResult = await stopPending;
    assert.equal(stopResult.error.code, "STOP_REJECTED");
    assert.match(stopResult.error.message, /no pudo detener/i);

    const okProtocol = Object.assign({}, Protocol, {
      validateResponse(_message, requestId) {
        return { ok: true, request_id: requestId, data: null };
      },
    });
    const clientOk = createNativeClient({
      protocol: okProtocol,
      connectNative: () => port,
      generateId: () => "ok-data",
    });
    const stopOk = clientOk.stopRecording({ session_id: "s1" });
    await waitForSent(port, 3);
    port.emitMessage({ request_id: "ok-data" });
    assert.equal((await stopOk).data.status, "ready");
  });
});

describe("coverage gaps: validate-manifest", () => {
  it("acepta el manifest real y rechaza invariantes rotas", () => {
    const fs = require("fs");
    const path = require("path");
    const root = path.join(__dirname, "..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8")
    );

    assert.equal(validateManifest(manifest, { root }).ok, true);
    assert.equal(validateManifest(null).ok, false);
    assert.equal(validateManifest(undefined).ok, false);

    const withMeetHost = Object.assign({}, manifest, {
      host_permissions: ["https://meet.google.com/*"],
    });
    assert.equal(validateManifest(withMeetHost, { root }).ok, true);

    const badHost = Object.assign({}, manifest, {
      host_permissions: ["https://evil.example/*"],
    });
    assert.equal(validateManifest(badHost, { root }).ok, false);

    const hostNotArray = Object.assign({}, manifest, {
      host_permissions: "https://meet.google.com/*",
    });
    assert.equal(validateManifest(hostNotArray, { root }).ok, false);

    const allUrls = Object.assign({}, manifest, {
      permissions: ["nativeMessaging", "<all_urls>"],
    });
    assert.match(
      validateManifest(allUrls, { root }).errors.join(" "),
      /todas las URLs/
    );

    const missingPage = validateManifest(manifest, {
      root,
      existsSync: (p) => !String(p).includes("background.html"),
    });
    assert.equal(missingPage.ok, false);

    const withScripts = Object.assign({}, manifest, {
      background: {
        scripts: ["shared/protocol.js", "background/background.js"],
      },
    });
    assert.equal(validateManifest(withScripts, { root }).ok, true);

    const missingScript = validateManifest(withScripts, {
      root,
      existsSync: (p) => !String(p).includes("background.js"),
    });
    assert.equal(missingScript.ok, false);

    const noPopup = validateManifest(
      Object.assign({}, manifest, { action: {} }),
      { root }
    );
    assert.equal(noPopup.ok, false);

    const withWorker = Object.assign({}, manifest, {
      background: Object.assign({}, manifest.background, {
        service_worker: "sw.js",
      }),
    });
    assert.equal(validateManifest(withWorker, { root }).ok, false);

    const noBackground = Object.assign({}, manifest, { background: {} });
    assert.equal(validateManifest(noBackground, { root }).ok, false);
  });

  it("main imprime OK y sale con código 1 si el manifest es inválido", () => {
    const logs = [];
    const errors = [];
    let exitCode = null;

    const ok = main({
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (code) => {
        exitCode = code;
      },
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(logs, ["Manifest OK"]);
    assert.equal(exitCode, null);

    const bad = main({
      readFileSync: () =>
        JSON.stringify({
          manifest_version: 2,
          permissions: [],
          background: { scripts: [] },
          action: {},
        }),
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (code) => {
        exitCode = code;
      },
    });
    assert.equal(bad.ok, false);
    assert.equal(exitCode, 1);
    assert.ok(errors.some((line) => /Manifest inválido/.test(line)));
    assert.ok(errors.some((line) => line.startsWith("- ")));
  });
});
