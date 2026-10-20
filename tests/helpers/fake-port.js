async function waitForSent(port, count = 1, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (port.sent.length >= count) {
      return port.sent;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `Se esperaban ${count} mensajes enviados, hay ${port.sent.length}`
  );
}

async function waitForSentMs(port, count = 1, timeoutMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (port.sent.length >= count) {
      return port.sent;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `Se esperaban ${count} mensajes enviados en ${timeoutMs}ms, hay ${port.sent.length}`
  );
}

function createFakePort() {
  const messageListeners = [];
  const disconnectListeners = [];
  const sent = [];
  let disconnected = false;

  return {
    sent,
    error: null,
    postMessage(message) {
      if (disconnected) {
        throw new Error("Attempt to postMessage on disconnected port");
      }
      sent.push(message);
    },
    disconnect() {
      disconnected = true;
      for (const listener of disconnectListeners) {
        listener();
      }
    },
    emitMessage(message) {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    emitDisconnect(error) {
      this.error = error || null;
      disconnected = true;
      for (const listener of disconnectListeners) {
        listener();
      }
    },
    onMessage: {
      addListener(fn) {
        messageListeners.push(fn);
      },
      removeListener(fn) {
        const idx = messageListeners.indexOf(fn);
        if (idx >= 0) {
          messageListeners.splice(idx, 1);
        }
      },
    },
    onDisconnect: {
      addListener(fn) {
        disconnectListeners.push(fn);
      },
      removeListener(fn) {
        const idx = disconnectListeners.indexOf(fn);
        if (idx >= 0) {
          disconnectListeners.splice(idx, 1);
        }
      },
    },
  };
}

module.exports = { createFakePort, waitForSent, waitForSentMs };
