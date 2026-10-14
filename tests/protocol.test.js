const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol.js");

describe("protocol", () => {
  it("construye solicitudes versionadas con payload seguro", () => {
    const request = Protocol.buildRequest(
      Protocol.ACTIONS.START_RECORDING,
      { url: "https://meet.google.com/abc-defg-hij", title: "Standup" },
      { generateId: () => "req-1" }
    );

    assert.deepEqual(request, {
      protocol_version: 1,
      request_id: "req-1",
      action: "start_recording",
      payload: {
        url: "https://meet.google.com/abc-defg-hij",
        title: "Standup",
      },
    });

    const emptyPayload = Protocol.buildRequest(
      Protocol.ACTIONS.GET_STATUS,
      null,
      { generateId: () => "req-2" }
    );
    assert.deepEqual(emptyPayload.payload, {});
  });

  it("rechaza acciones desconocidas", () => {
    assert.throws(
      () => Protocol.buildRequest("rm -rf /", {}, { generateId: () => "x" }),
      /no soportada/i
    );
  });

  it("valida respuestas correctas y con error", () => {
    const ok = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "a",
        ok: true,
        data: { status: "ready" },
      },
      "a"
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.data.status, "ready");

    const fail = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "a",
        ok: false,
        error: { code: "BUSY", message: "Ya hay una grabación" },
      },
      "a"
    );
    assert.equal(fail.ok, false);
    assert.equal(fail.error.code, "BUSY");
    assert.equal(fail.error.message, "Ya hay una grabación");
  });

  it("rechaza versiones de protocolo incompatibles", () => {
    const result = Protocol.validateResponse(
      {
        protocol_version: 99,
        request_id: "a",
        ok: true,
        data: {},
      },
      "a"
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_RESPONSE");
  });

  it("rechaza respuestas con request_id incorrecto o ausente", () => {
    const outOfOrder = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "other",
        ok: true,
        data: {},
      },
      "expected"
    );
    assert.equal(outOfOrder.ok, false);
    assert.equal(outOfOrder.error.code, "OUT_OF_ORDER");
  });

  it("rechaza JSON inválido, null, arrays y mensajes incompletos", () => {
    for (const bad of [null, undefined, "texto", 12, [], { ok: true }]) {
      const result = Protocol.validateResponse(bad, "x");
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "INVALID_RESPONSE");
    }

    const missingOk = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "x",
        data: {},
      },
      "x"
    );
    assert.equal(missingOk.ok, false);
    assert.equal(missingOk.error.code, "INVALID_RESPONSE");
  });

  it("normaliza errores del host con campos ausentes o de tipo incorrecto", () => {
    const noErrorObject = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "x",
        ok: false,
        error: "boom",
      },
      "x"
    );
    assert.equal(noErrorObject.ok, false);
    assert.equal(noErrorObject.error.code, "HOST_ERROR");
    assert.match(noErrorObject.error.message, /error/i);

    const emptyMessage = Protocol.validateResponse(
      {
        protocol_version: 1,
        request_id: "x",
        ok: false,
        error: { code: 123, message: "   " },
      },
      "x"
    );
    assert.equal(emptyMessage.error.code, "HOST_ERROR");
    assert.match(emptyMessage.error.message, /error/i);
  });

  it("exige session_id tras un inicio exitoso", () => {
    const missing = Protocol.requireSessionId({});
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "MISSING_SESSION_ID");

    const blank = Protocol.requireSessionId({ session_id: "  " });
    assert.equal(blank.ok, false);

    const wrongType = Protocol.requireSessionId({ session_id: 42 });
    assert.equal(wrongType.ok, false);

    const present = Protocol.requireSessionId({ session_id: " sess-9 " });
    assert.equal(present.ok, true);
    assert.equal(present.session_id, "sess-9");
  });

  it("mapea errores de host ausente y desconexión", () => {
    const missing = Protocol.mapConnectionError(
      new Error("No such native application com.meetings.transcriptor")
    );
    assert.equal(missing.code, "HOST_NOT_FOUND");
    assert.match(missing.message, /no está instalado/i);

    const disconnected = Protocol.mapConnectionError(
      new Error("Native port disconnected")
    );
    assert.equal(disconnected.code, "HOST_DISCONNECTED");

    const other = Protocol.mapConnectionError(new Error("EPIPE"));
    assert.equal(other.code, "HOST_UNAVAILABLE");
  });

  it("normaliza estados del host sin inventar grabación", () => {
    assert.deepEqual(Protocol.normalizeHostStatus({ status: "idle" }), {
      status: "ready",
      session_id: null,
    });
    assert.deepEqual(
      Protocol.normalizeHostStatus({
        status: "recording",
        session_id: "s1",
      }),
      { status: "recording", session_id: "s1" }
    );
    assert.equal(
      Protocol.normalizeHostStatus({ status: "weird" }).status,
      "ready"
    );
    assert.equal(
      Protocol.normalizeHostStatus({ status: "error", message: "falló" })
        .message,
      "falló"
    );
  });

  it("no contiene eval ni shell en el módulo de protocolo", () => {
    const fs = require("fs");
    const source = fs.readFileSync(
      require.resolve("../shared/protocol.js"),
      "utf8"
    );
    assert.equal(source.includes("eval("), false);
    assert.equal(source.includes("child_process"), false);
    assert.equal(source.includes("Function("), false);
  });
});
