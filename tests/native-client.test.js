const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol.js");
const { createNativeClient } = require("../shared/native-client.js");
const {
  createFakePort,
  waitForSent,
  waitForSentMs,
} = require("./helpers/fake-port.js");

describe("native-client", () => {
  it("no marca grabación iniciada sin session_id del host", async () => {
    const port = createFakePort();
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => "start-1",
      timeoutMs: 200,
    });

    const pending = client.startRecording({
      url: "https://meet.google.com/aaa-bbbb-ccc",
      title: "Demo",
    });

    await waitForSent(port, 1);
    assert.equal(port.sent[0].action, "start_recording");
    assert.deepEqual(port.sent[0].payload, {
      url: "https://meet.google.com/aaa-bbbb-ccc",
      title: "Demo",
    });

    port.emitMessage({
      protocol_version: 1,
      request_id: "start-1",
      ok: true,
      data: {},
    });

    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "MISSING_SESSION_ID");
  });

  it("devuelve session_id solo cuando el host confirma el inicio", async () => {
    const port = createFakePort();
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => "start-2",
    });

    const pending = client.startRecording({
      url: "https://meet.google.com/aaa-bbbb-ccc",
      title: "Demo",
    });
    await waitForSent(port, 1);

    port.emitMessage({
      protocol_version: 1,
      request_id: "start-2",
      ok: true,
      data: { session_id: "sess-42" },
    });

    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.data.session_id, "sess-42");
    assert.equal(result.data.status, "recording");
  });

  it("propaga errores del host al iniciar o detener sin inventar éxito", async () => {
    const port = createFakePort();
    let n = 0;
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => `req-${++n}`,
    });

    const startPending = client.startRecording({
      url: "https://meet.google.com/aaa-bbbb-ccc",
      title: "Demo",
    });
    await waitForSent(port, 1);
    port.emitMessage({
      protocol_version: 1,
      request_id: "req-1",
      ok: false,
      error: { code: "DEVICE_BUSY", message: "Micrófono ocupado" },
    });
    const startResult = await startPending;
    assert.equal(startResult.ok, false);
    assert.equal(startResult.error.code, "DEVICE_BUSY");

    const stopPending = client.stopRecording({ session_id: "sess-1" });
    await waitForSent(port, 2);
    port.emitMessage({
      protocol_version: 1,
      request_id: "req-2",
      ok: false,
      error: { code: "NO_SESSION", message: "Sesión inexistente" },
    });
    const stopResult = await stopPending;
    assert.equal(stopResult.ok, false);
    assert.equal(stopResult.error.code, "NO_SESSION");
  });

  it("ignora respuestas con request_id distinto y aplica timeout", async () => {
    let connects = 0;
    let ids = 0;
    const ports = [createFakePort(), createFakePort()];
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => ports[Math.min(connects++, ports.length - 1)],
      generateId: () => `status-${++ids}`,
      timeoutMs: 30,
    });

    const pending = client.getStatus();
    await waitForSent(ports[0], 1);

    ports[0].emitMessage({
      protocol_version: 1,
      request_id: "otro",
      ok: true,
      data: { status: "ready" },
    });
    ports[0].emitMessage(null);
    ports[0].emitMessage("no-json");

    // Tras el timeout del primer intento reintenta en un puerto nuevo.
    await waitForSentMs(ports[1], 1, 500);
    await assert.rejects(pending, (err) => err.code === "TIMEOUT");
    assert.equal(connects, 2);
  });

  it("reintenta una vez tras TIMEOUT y recupera el puerto", async () => {
    let connects = 0;
    let ids = 0;
    const ports = [createFakePort(), createFakePort()];
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => ports[connects++],
      generateId: () => `retry-${++ids}`,
      timeoutMs: 30,
    });

    const pending = client.getStatus();
    await waitForSent(ports[0], 1);
    await waitForSentMs(ports[1], 1, 500);
    ports[1].emitMessage({
      protocol_version: 1,
      request_id: "retry-2",
      ok: true,
      data: { status: "ready" },
    });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "ready");
  });

  it("propaga desconexión del host a solicitudes pendientes", async () => {
    const port = createFakePort();
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => "status-2",
      timeoutMs: 500,
    });

    const pending = client.getStatus();
    await waitForSent(port, 1);
    port.emitDisconnect(new Error("disconnected"));

    await assert.rejects(pending, (err) => err.code === "HOST_DISCONNECTED");
  });

  it("reporta host no encontrado al conectar", async () => {
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => {
        throw new Error("No such native application com.meetings.transcriptor");
      },
    });

    await assert.rejects(
      client.getStatus(),
      (err) => err.code === "HOST_NOT_FOUND"
    );
  });

  it("envía stop_recording con la misma session_id", async () => {
    const port = createFakePort();
    let counter = 0;
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => `req-${++counter}`,
    });

    const stopPending = client.stopRecording({ session_id: "sess-42" });
    await waitForSent(port, 1);

    assert.deepEqual(port.sent[0].payload, { session_id: "sess-42" });
    port.emitMessage({
      protocol_version: 1,
      request_id: "req-1",
      ok: true,
      data: { status: "ready" },
    });

    const result = await stopPending;
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "ready");
  });

  it("resuelve get_status con estado normalizado", async () => {
    const port = createFakePort();
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => "status-3",
    });

    const pending = client.getStatus();
    await waitForSent(port, 1);
    port.emitMessage({
      protocol_version: 1,
      request_id: "status-3",
      ok: true,
      data: { status: "idle" },
    });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "ready");
  });
});
