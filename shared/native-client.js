/**
 * Cliente Native Messaging desacoplado de la UI.
 * Usa browser.runtime.connectNative desde el contexto privilegiado.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsProtocol);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsNativeClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Protocol) {
  /* c8 ignore stop */
  function createNativeClient(options = {}) {
    const protocol =
      options.protocol !== undefined ? options.protocol : Protocol;
    if (!protocol) {
      throw new Error("MeetingsProtocol no está disponible.");
    }

    const hostName = options.hostName || protocol.NATIVE_HOST_NAME;
    const timeoutMs = options.timeoutMs || 10000;
    const connectNative =
      options.connectNative ||
      (typeof browser !== "undefined" &&
        browser.runtime &&
        browser.runtime.connectNative &&
        browser.runtime.connectNative.bind(browser.runtime));

    if (typeof connectNative !== "function") {
      throw new Error("connectNative no está disponible en este contexto.");
    }

    let port = null;
    let connecting = null;
    const pending = new Map();

    function rejectAll(error) {
      const entries = Array.from(pending.values());
      pending.clear();
      for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
    }

    function cleanupPort() {
      if (!port) {
        return;
      }
      try {
        if (port.onMessage && port.onMessage.removeListener) {
          port.onMessage.removeListener(onMessage);
        }
        if (port.onDisconnect && port.onDisconnect.removeListener) {
          port.onDisconnect.removeListener(onDisconnect);
        }
      } catch (_err) {
        // ignore
      }
      port = null;
    }

    function onMessage(message) {
      if (!message || typeof message !== "object") {
        return;
      }
      const requestId = message.request_id;
      if (!requestId || !pending.has(requestId)) {
        return;
      }
      const entry = pending.get(requestId);
      pending.delete(requestId);
      clearTimeout(entry.timer);
      entry.resolve(protocol.validateResponse(message, requestId));
    }

    function onDisconnect() {
      const disconnectError = port && port.error ? port.error : null;
      cleanupPort();
      const mapped = protocol.mapConnectionError(
        disconnectError || new Error("disconnected")
      );
      rejectAll(Object.assign(new Error(mapped.message), mapped));
    }

    function ensureConnected() {
      if (port) {
        return Promise.resolve(port);
      }
      if (connecting) {
        return connecting;
      }

      connecting = Promise.resolve()
        .then(() => connectNative(hostName))
        .then((nextPort) => {
          if (!nextPort) {
            throw Object.assign(
              new Error(protocol.ERROR_MESSAGES.HOST_NOT_FOUND),
              { code: "HOST_NOT_FOUND" }
            );
          }
          port = nextPort;
          if (port.onMessage && port.onMessage.addListener) {
            port.onMessage.addListener(onMessage);
          }
          if (port.onDisconnect && port.onDisconnect.addListener) {
            port.onDisconnect.addListener(onDisconnect);
          }
          return port;
        })
        .catch((err) => {
          cleanupPort();
          const mapped = protocol.mapConnectionError(err);
          throw Object.assign(new Error(mapped.message), mapped);
        })
        .finally(() => {
          connecting = null;
        });

      return connecting;
    }

    function forceDropPort() {
      const old = port;
      cleanupPort();
      if (old && typeof old.disconnect === "function") {
        try {
          old.disconnect();
        } catch (_err) {
          // ignore
        }
      }
    }

    function requestOnce(action, payload, requestOptions) {
      const req = protocol.buildRequest(action, payload, {
        generateId: requestOptions.generateId || options.generateId,
      });
      const waitMs = requestOptions.timeoutMs || timeoutMs;

      return ensureConnected().then(
        (activePort) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(req.request_id);
              // El event page de Firefox puede dejar un puerto zombie mientras
              // el host quedó bloqueado (p. ej. wait de FFmpeg). Soltarlo.
              forceDropPort();
              reject(
                Object.assign(new Error(protocol.ERROR_MESSAGES.TIMEOUT), {
                  code: "TIMEOUT",
                })
              );
            }, waitMs);

            pending.set(req.request_id, { resolve, reject, timer });

            try {
              activePort.postMessage(req);
            } catch (err) {
              pending.delete(req.request_id);
              clearTimeout(timer);
              forceDropPort();
              const mapped = protocol.mapConnectionError(err);
              reject(Object.assign(new Error(mapped.message), mapped));
            }
          })
      );
    }

    function request(action, payload = {}, requestOptions = {}) {
      const allowRetry = requestOptions.retryOnTimeout !== false;
      return requestOnce(action, payload, requestOptions).catch((err) => {
        if (
          allowRetry &&
          err &&
          err.code === "TIMEOUT" &&
          !requestOptions._retried
        ) {
          return requestOnce(
            action,
            payload,
            Object.assign({}, requestOptions, {
              _retried: true,
              retryOnTimeout: false,
            })
          );
        }
        throw err;
      });
    }

    function getStatus(requestOptions) {
      return request(protocol.ACTIONS.GET_STATUS, {}, requestOptions).then(
        (response) => {
          if (!response.ok) {
            return response;
          }
          const raw = response.data || {};
          const normalized = protocol.normalizeHostStatus(raw);
          return {
            ok: true,
            request_id: response.request_id,
            data: Object.assign({}, normalized, {
              transcribed: Boolean(raw.transcribed),
              transcription_error:
                typeof raw.transcription_error === "string"
                  ? raw.transcription_error
                  : null,
              meeting_dir:
                typeof raw.meeting_dir === "string"
                  ? raw.meeting_dir
                  : normalized.meeting_dir || null,
              plain_transcript:
                typeof raw.plain_transcript === "string"
                  ? raw.plain_transcript
                  : null,
              speaker_transcript:
                typeof raw.speaker_transcript === "string"
                  ? raw.speaker_transcript
                  : null,
              profile: typeof raw.profile === "string" ? raw.profile : null,
            }),
          };
        }
      );
    }

    function listProfiles(requestOptions) {
      return request(
        protocol.ACTIONS.LIST_PROFILES,
        {},
        Object.assign({ timeoutMs: 5000 }, requestOptions || {})
      ).then((response) => {
        if (!response.ok) {
          return response;
        }
        return {
          ok: true,
          request_id: response.request_id,
          data: protocol.normalizeProfilesData(response.data),
        };
      });
    }

    function startRecording({ url, title, profile }, requestOptions) {
      const payload = { url, title };
      if (
        typeof profile === "string" &&
        profile.trim() &&
        protocol.isValidProfileName(profile)
      ) {
        payload.profile = profile.trim();
      }
      return request(
        protocol.ACTIONS.START_RECORDING,
        payload,
        requestOptions
      ).then((response) => {
        if (!response.ok) {
          return {
            ok: false,
            request_id: response.request_id,
            error: {
              code: response.error.code || "START_REJECTED",
              message:
                response.error.message ||
                protocol.ERROR_MESSAGES.START_REJECTED,
            },
          };
        }
        const session = protocol.requireSessionId(response.data);
        if (!session.ok) {
          return {
            ok: false,
            request_id: response.request_id,
            error: session.error,
          };
        }
        return {
          ok: true,
          request_id: response.request_id,
          data: {
            session_id: session.session_id,
            status: "recording",
          },
        };
      });
    }

    function stopRecording({ session_id, transcribe }, requestOptions) {
      const payload = { session_id };
      if (typeof transcribe === "boolean") {
        payload.transcribe = transcribe;
      }
      // WhisperX corre en segundo plano en el host; el stop debe responder rápido.
      const opts = Object.assign(
        { retryOnTimeout: false },
        requestOptions || {}
      );
      return request(protocol.ACTIONS.STOP_RECORDING, payload, opts).then(
        (response) => {
          if (!response.ok) {
            return {
              ok: false,
              request_id: response.request_id,
              error: {
                code: response.error.code || "STOP_REJECTED",
                message:
                  response.error.message ||
                  protocol.ERROR_MESSAGES.STOP_REJECTED,
              },
            };
          }
          const data = response.data || {};
          const statusHint = data.transcription_started
            ? "transcribing"
            : data.status || "ready";
          return {
            ok: true,
            request_id: response.request_id,
            data: Object.assign(
              protocol.normalizeHostStatus(
                Object.assign({}, data, { status: statusHint })
              ),
              {
                transcribed: Boolean(data.transcribed),
                transcription_started: Boolean(data.transcription_started),
                transcription_error:
                  typeof data.transcription_error === "string"
                    ? data.transcription_error
                    : null,
                meeting_dir:
                  typeof data.meeting_dir === "string"
                    ? data.meeting_dir
                    : null,
                profile: typeof data.profile === "string" ? data.profile : null,
                plain_transcript:
                  typeof data.plain_transcript === "string"
                    ? data.plain_transcript
                    : null,
                speaker_transcript:
                  typeof data.speaker_transcript === "string"
                    ? data.speaker_transcript
                    : null,
                files:
                  data.files && typeof data.files === "object"
                    ? data.files
                    : null,
              }
            ),
          };
        }
      );
    }

    function recordMeetEvent(event, requestOptions) {
      return request(
        protocol.ACTIONS.RECORD_MEET_EVENT,
        event && typeof event === "object" ? event : {},
        Object.assign({ timeoutMs: 5000 }, requestOptions || {})
      );
    }

    function disconnect() {
      rejectAll(
        Object.assign(new Error(protocol.ERROR_MESSAGES.HOST_DISCONNECTED), {
          code: "HOST_DISCONNECTED",
        })
      );
      if (port && typeof port.disconnect === "function") {
        try {
          port.disconnect();
        } catch (_err) {
          // ignore
        }
      }
      cleanupPort();
    }

    return {
      request,
      getStatus,
      listProfiles,
      startRecording,
      stopRecording,
      recordMeetEvent,
      disconnect,
      _pending: pending,
    };
  }

  return { createNativeClient };
});
