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

    function request(action, payload = {}, requestOptions = {}) {
      const req = protocol.buildRequest(action, payload, {
        generateId: requestOptions.generateId || options.generateId,
      });
      const waitMs = requestOptions.timeoutMs || timeoutMs;

      return ensureConnected().then(
        (activePort) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(req.request_id);
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
              const mapped = protocol.mapConnectionError(err);
              reject(Object.assign(new Error(mapped.message), mapped));
            }
          })
      );
    }

    function getStatus(requestOptions) {
      return request(protocol.ACTIONS.GET_STATUS, {}, requestOptions).then(
        (response) => {
          if (!response.ok) {
            return response;
          }
          return {
            ok: true,
            request_id: response.request_id,
            data: protocol.normalizeHostStatus(response.data),
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

    function stopRecording({ session_id }, requestOptions) {
      return request(
        protocol.ACTIONS.STOP_RECORDING,
        { session_id },
        requestOptions
      ).then((response) => {
        if (!response.ok) {
          return {
            ok: false,
            request_id: response.request_id,
            error: {
              code: response.error.code || "STOP_REJECTED",
              message:
                response.error.message || protocol.ERROR_MESSAGES.STOP_REJECTED,
            },
          };
        }
        return {
          ok: true,
          request_id: response.request_id,
          data: protocol.normalizeHostStatus(
            Object.assign({ status: "ready" }, response.data || {})
          ),
        };
      });
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
