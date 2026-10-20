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
    profileSelect: document.getElementById("profile-select"),
    profileHint: document.getElementById("profile-hint"),
    errorMessage: document.getElementById("error-message"),
    infoMessage: document.getElementById("info-message"),
    observationError: document.getElementById("observation-error"),
    startBtn: document.getElementById("start-btn"),
    stopBtn: document.getElementById("stop-btn"),
    diagnosticToggle: document.getElementById("diagnostic-toggle"),
    diagnosticPanel: document.getElementById("diagnostic-panel"),
    diagnosticEvents: document.getElementById("diagnostic-events"),
    refreshDiagBtn: document.getElementById("refresh-diag-btn"),
  };

  let current = createInitialState();
  let syncingProfileSelect = false;

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

  function syncProfileSelect(view) {
    syncingProfileSelect = true;
    try {
      const select = els.profileSelect;
      select.innerHTML = "";

      if (!view.profilesSupported) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Perfil del host (por defecto)";
        select.appendChild(option);
        select.value = "";
        select.disabled = true;
      } else if (!view.profiles.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Sin perfiles";
        select.appendChild(option);
        select.value = "";
        select.disabled = true;
      } else {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Elegí un perfil…";
        select.appendChild(placeholder);
        for (const name of view.profiles) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        }
        select.value = view.selectedProfile || "";
        select.disabled = !view.profileSelectEnabled;
      }

      if (view.profileHint) {
        els.profileHint.hidden = false;
        els.profileHint.textContent = view.profileHint;
      } else {
        els.profileHint.hidden = true;
        els.profileHint.textContent = "";
      }
    } finally {
      syncingProfileSelect = false;
    }
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

    if (view.infoMessage) {
      els.infoMessage.hidden = false;
      els.infoMessage.textContent = view.infoMessage;
    } else {
      els.infoMessage.hidden = true;
      els.infoMessage.textContent = "";
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
      ? view.busyLabel || "Finalizando…"
      : "Detener y finalizar";

    els.diagnosticToggle.checked = view.diagnosticEnabled;
    els.diagnosticPanel.hidden = !view.diagnosticVisible;
    els.diagnosticEvents.textContent = formatEvents(current.recentEvents);
    syncProfileSelect(view);
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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const TRANSCRIPTION_POLL_MS = 1000;
  const TRANSCRIPTION_MAX_MS = 2 * 60 * 60 * 1000;

  async function pollTranscriptionProgress() {
    const deadline = Date.now() + TRANSCRIPTION_MAX_MS;
    current = Object.assign({}, current, {
      busy: true,
      busyLabel: "Transcribiendo…",
    });
    render();

    while (Date.now() < deadline) {
      try {
        const tab = await readActiveTab();
        const result = await sendToBackground({ type: "GET_STATUS", tab });
        current = applyBackgroundResult(current, result);

        if (result.transcriptorStatus === "transcribing") {
          const label =
            result.progress && typeof result.progress.label === "string"
              ? result.progress.label.trim()
              : "";
          const info = label ? `Transcribiendo… ${label}` : "Transcribiendo…";
          current = Object.assign({}, current, {
            busy: true,
            busyLabel: info,
            infoMessage: info,
            errorMessage: "",
          });
          render();
          await sleep(TRANSCRIPTION_POLL_MS);
          continue;
        }

        if (result.transcribed) {
          const path = result.plainTranscript;
          current = Object.assign({}, current, {
            infoMessage: path
              ? `Transcripción lista: ${path}`
              : "Transcripción lista.",
            errorMessage: "",
            transcriptionStarted: false,
          });
        } else if (result.transcriptionError) {
          current = Object.assign({}, current, {
            infoMessage: `Grabación detenida, pero falló la transcripción: ${result.transcriptionError}`,
            errorMessage: "",
            transcriptionStarted: false,
          });
        } else {
          current = Object.assign({}, current, {
            transcriptionStarted: false,
          });
        }
        break;
      } catch (err) {
        current = applyBackgroundResult(current, {
          ok: false,
          transcriptorStatus: "error",
          error: {
            code: "BACKGROUND_UNAVAILABLE",
            message: humanizeBackgroundError(err),
          },
        });
        break;
      }
    }

    if (
      Date.now() >= deadline &&
      current.transcriptorStatus === "transcribing"
    ) {
      current = Object.assign({}, current, {
        errorMessage:
          "La transcripción sigue en curso pero superó el tiempo de espera del popup. Revisá el host o volvé a abrir el popup más tarde.",
        infoMessage: "",
      });
    }

    current = Object.assign({}, current, { busy: false, busyLabel: "" });
    render();
  }

  async function send(type, extra = {}) {
    current = Object.assign({}, current, {
      busy: true,
      busyLabel: extra.busyLabel || "",
      errorMessage: "",
      infoMessage: "",
    });
    render();
    try {
      const tab = await readActiveTab();
      const payload = Object.assign({ type, tab }, extra);
      delete payload.busyLabel;
      const result = await sendToBackground(payload);
      current = applyBackgroundResult(current, result);
      if (
        type === "STOP_RECORDING" &&
        result &&
        result.ok &&
        (result.transcriptionStarted ||
          result.transcriptorStatus === "transcribing")
      ) {
        // Mantener busy mientras WhisperX reporta progreso vía get_status.
        current = Object.assign({}, current, {
          busy: true,
          busyLabel: "Transcribiendo…",
        });
        render();
        await pollTranscriptionProgress();
        return;
      }
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
      if (current.transcriptorStatus !== "transcribing") {
        current = Object.assign({}, current, { busy: false, busyLabel: "" });
      }
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
    const profile = els.profileSelect.value || current.selectedProfile || null;
    send("START_RECORDING", profile ? { profile } : {});
  });

  els.stopBtn.addEventListener("click", () => {
    if (els.stopBtn.disabled) {
      return;
    }
    const transcribe = window.confirm(
      "¿Transcribir ahora?\n\nAceptar: detener y transcribir (puede demorar varios minutos).\nCancelar: detener y solo guardar la grabación."
    );
    send("STOP_RECORDING", {
      sessionId: current.sessionId,
      transcribe,
      busyLabel: transcribe ? "Transcribiendo…" : "Finalizando…",
    });
  });

  els.profileSelect.addEventListener("change", async () => {
    if (syncingProfileSelect) {
      return;
    }
    const profile = els.profileSelect.value || null;
    current = Object.assign({}, current, { selectedProfile: profile });
    render();
    try {
      const result = await sendToBackground({
        type: "SET_PREFERRED_PROFILE",
        profile,
      });
      if (result && result.ok) {
        current = applyBackgroundResult(current, result);
        render();
      } else if (result && result.error && result.error.message) {
        current = Object.assign({}, current, {
          errorMessage: result.error.message,
        });
        render();
      }
    } catch (_err) {
      // El valor local se mantiene; al iniciar se reenvía.
    }
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
