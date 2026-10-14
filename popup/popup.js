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

  async function send(type, extra = {}) {
    current = Object.assign({}, current, {
      busy: true,
      errorMessage: "",
    });
    render();
    try {
      const result = await browser.runtime.sendMessage(
        Object.assign({ type }, extra)
      );
      current = applyBackgroundResult(current, result);
    } catch (err) {
      current = applyBackgroundResult(current, {
        ok: false,
        transcriptorStatus: "error",
        error: {
          code: "BACKGROUND_UNAVAILABLE",
          message:
            err && err.message
              ? err.message
              : "No se pudo comunicar con el proceso en segundo plano.",
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
