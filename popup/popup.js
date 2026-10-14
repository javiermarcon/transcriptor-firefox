(() => {
  const { derivePopupView } = MeetingsPopupState;
  const { createInitialState, applyBackgroundResult } = MeetingsPopupController;

  const els = {
    tabStatus: document.getElementById("tab-status"),
    meetingTitle: document.getElementById("meeting-title"),
    transcriptorStatus: document.getElementById("transcriptor-status"),
    sessionRow: document.getElementById("session-row"),
    sessionId: document.getElementById("session-id"),
    errorMessage: document.getElementById("error-message"),
    startBtn: document.getElementById("start-btn"),
    stopBtn: document.getElementById("stop-btn"),
  };

  let current = createInitialState();

  function render() {
    const view = derivePopupView(current);

    els.tabStatus.textContent = view.tabLabel;
    els.meetingTitle.textContent = view.meetingTitle;
    els.transcriptorStatus.textContent = view.transcriptorLabel;
    els.transcriptorStatus.dataset.status = view.transcriptorStatus;

    if (view.sessionId) {
      els.sessionRow.hidden = false;
      els.sessionId.textContent = view.sessionId;
    } else {
      els.sessionRow.hidden = true;
      els.sessionId.textContent = "—";
    }

    if (view.errorMessage) {
      els.errorMessage.hidden = false;
      els.errorMessage.textContent = view.errorMessage;
    } else {
      els.errorMessage.hidden = true;
      els.errorMessage.textContent = "";
    }

    els.startBtn.disabled = view.startDisabled;
    els.stopBtn.disabled = view.stopDisabled;
    els.stopBtn.hidden = !view.stopVisible;
    els.startBtn.textContent = view.busy ? "Trabajando…" : "Iniciar grabación";
    els.stopBtn.textContent = view.busy
      ? "Finalizando…"
      : "Detener y finalizar";
  }

  function isConnectionError(err) {
    const message = String((err && err.message) || err || "");
    return /Receiving end does not exist|Could not establish connection/i.test(
      message
    );
  }

  async function wakeBackground() {
    if (typeof browser.runtime.getBackgroundPage !== "function") {
      return;
    }
    try {
      await browser.runtime.getBackgroundPage();
    } catch (_err) {
      // En ventanas privadas puede fallar; sendMessage sigue siendo el canal.
    }
  }

  async function sendToBackground(message) {
    await wakeBackground();
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      if (!isConnectionError(err)) {
        throw err;
      }
      // Carrera conocida en Firefox MV3: el primer mensaje despierta el event page.
      await wakeBackground();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return browser.runtime.sendMessage(message);
    }
  }

  function humanizeBackgroundError(err) {
    if (isConnectionError(err)) {
      return "No se pudo hablar con el proceso en segundo plano. Recargá la extensión en about:debugging y volvé a abrir el popup.";
    }
    return err && err.message
      ? err.message
      : "No se pudo comunicar con el proceso en segundo plano.";
  }

  async function readActiveTab() {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tabs[0] || null;
    } catch (_err) {
      return null;
    }
  }

  async function send(type, extra = {}) {
    current = Object.assign({}, current, {
      busy: true,
      errorMessage: "",
    });
    render();
    try {
      const tab = await readActiveTab();
      const result = await sendToBackground(
        Object.assign({ type, tab }, extra)
      );
      current = applyBackgroundResult(current, result);
    } catch (err) {
      current = applyBackgroundResult(current, {
        ok: false,
        transcriptorStatus: "error",
        error: {
          code: "BACKGROUND_UNAVAILABLE",
          message: humanizeBackgroundError(err),
        },
      });
    } finally {
      current = Object.assign({}, current, { busy: false });
      render();
    }
  }

  els.startBtn.addEventListener("click", () => {
    if (els.startBtn.disabled) {
      return;
    }
    send("START_RECORDING");
  });

  els.stopBtn.addEventListener("click", () => {
    if (els.stopBtn.disabled) {
      return;
    }
    send("STOP_RECORDING", { sessionId: current.sessionId });
  });

  render();
  send("GET_STATUS");
})();
