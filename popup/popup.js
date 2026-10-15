(() => {
  const { derivePopupView } = MeetingsPopupState;
  const { createInitialState, applyBackgroundResult } = MeetingsPopupController;

  const els = {
    tabStatus: document.getElementById("tab-status"),
    meetingTitle: document.getElementById("meeting-title"),
    transcriptorStatus: document.getElementById("transcriptor-status"),
    sessionRow: document.getElementById("session-row"),
    sessionId: document.getElementById("session-id"),
    observationStatus: document.getElementById("observation-status"),
    errorMessage: document.getElementById("error-message"),
    observationError: document.getElementById("observation-error"),
    startBtn: document.getElementById("start-btn"),
    stopBtn: document.getElementById("stop-btn"),
    diagnosticToggle: document.getElementById("diagnostic-toggle"),
    diagnosticPanel: document.getElementById("diagnostic-panel"),
    diagnosticEvents: document.getElementById("diagnostic-events"),
    refreshDiagBtn: document.getElementById("refresh-diag-btn"),
  };

  let current = createInitialState();

  function formatEvents(events) {
    if (!events || !events.length) {
      return "Sin eventos.";
    }
    return events
      .slice(-12)
      .map((event) => {
        const name = event.display_name || "—";
        return `${event.timestamp_epoch_ms} ${event.event_type} ${name} (${event.source}, c=${event.confidence})`;
      })
      .join("\n");
  }

  function render() {
    const view = derivePopupView(current);

    els.tabStatus.textContent = view.tabLabel;
    els.meetingTitle.textContent = view.meetingTitle;
    els.transcriptorStatus.textContent = view.transcriptorLabel;
    els.transcriptorStatus.dataset.status = view.transcriptorStatus;
    els.observationStatus.textContent = view.observationLabel;

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

    if (view.observationError) {
      els.observationError.hidden = false;
      els.observationError.textContent = view.observationError;
    } else {
      els.observationError.hidden = true;
      els.observationError.textContent = "";
    }

    els.startBtn.disabled = view.startDisabled;
    els.stopBtn.disabled = view.stopDisabled;
    els.stopBtn.hidden = !view.stopVisible;
    els.startBtn.textContent = view.busy ? "Trabajando…" : "Iniciar grabación";
    els.stopBtn.textContent = view.busy
      ? "Finalizando…"
      : "Detener y finalizar";

    els.diagnosticToggle.checked = view.diagnosticEnabled;
    els.diagnosticPanel.hidden = !view.diagnosticVisible;
    els.diagnosticEvents.textContent = formatEvents(current.recentEvents);
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

  async function refreshDiagnostics() {
    try {
      const result = await sendToBackground({ type: "GET_DIAGNOSTICS" });
      if (result && result.ok) {
        current = Object.assign({}, current, {
          diagnosticEnabled: Boolean(result.diagnosticEnabled),
          observationActive: Boolean(result.observationActive),
          observationError: result.observationError || "",
          recentEvents: Array.isArray(result.recentEvents)
            ? result.recentEvents
            : [],
        });
        render();
      }
    } catch (_err) {
      // Silencioso: el diagnóstico es opcional.
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

  els.diagnosticToggle.addEventListener("change", async () => {
    const enabled = els.diagnosticToggle.checked;
    try {
      await sendToBackground({ type: "SET_DIAGNOSTIC", enabled });
      current = Object.assign({}, current, {
        diagnosticEnabled: enabled,
        recentEvents: enabled ? current.recentEvents : [],
      });
      render();
      if (enabled) {
        await refreshDiagnostics();
      }
    } catch (_err) {
      els.diagnosticToggle.checked = current.diagnosticEnabled;
    }
  });

  els.refreshDiagBtn.addEventListener("click", () => {
    refreshDiagnostics();
  });

  render();
  send("GET_STATUS");
})();
