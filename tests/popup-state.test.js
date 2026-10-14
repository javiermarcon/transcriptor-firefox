const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  derivePopupView,
  TRANSCRIPTOR_STATUS,
} = require("../shared/popup-state.js");
const {
  createInitialState,
  applyBackgroundResult,
} = require("../shared/popup-controller.js");
const { describeActiveTab, isMeetUrl } = require("../shared/meet-tab.js");

describe("meet-tab", () => {
  it("reconoce solo URLs https de meet.google.com", () => {
    assert.equal(isMeetUrl("https://meet.google.com/abc-defg-hij"), true);
    assert.equal(isMeetUrl("https://meet.google.com/"), true);
    assert.equal(isMeetUrl("http://meet.google.com/abc"), false);
    assert.equal(isMeetUrl("https://mail.google.com/"), false);
    assert.equal(isMeetUrl("https://meet.google.com.evil.example/"), false);
    assert.equal(isMeetUrl("javascript:alert(1)"), false);
    assert.equal(isMeetUrl(""), false);
    assert.equal(isMeetUrl(null), false);
  });

  it("describe pestaña activa, ausente o sin URL/título", () => {
    const onMeet = describeActiveTab({
      url: "https://meet.google.com/abc-defg-hij",
      title: "Standup semanal",
    });
    assert.equal(onMeet.onMeet, true);
    assert.equal(onMeet.label, "Google Meet");
    assert.equal(onMeet.title, "Standup semanal");

    const outside = describeActiveTab({
      url: "https://example.com",
      title: "Example",
    });
    assert.equal(outside.onMeet, false);
    assert.equal(outside.label, "Fuera de Meet");
    assert.equal(outside.title, "");

    const missing = describeActiveTab(null);
    assert.equal(missing.onMeet, false);
    assert.equal(missing.url, "");

    const noUrl = describeActiveTab({ title: "Sin url" });
    assert.equal(noUrl.onMeet, false);

    const noTitle = describeActiveTab({
      url: "https://meet.google.com/xyz-abcd-efg",
    });
    assert.equal(noTitle.onMeet, true);
    assert.equal(noTitle.title, "");
  });
});

describe("popup-state", () => {
  it("estado inicial desconectado y sin acciones", () => {
    const initial = createInitialState();
    const view = derivePopupView(initial);
    assert.equal(view.transcriptorStatus, TRANSCRIPTOR_STATUS.DISCONNECTED);
    assert.equal(view.canStart, false);
    assert.equal(view.canStop, false);
    assert.equal(view.meetingTitle, "—");
  });

  it("deshabilita iniciar fuera de Meet o sin host listo", () => {
    const outside = derivePopupView({
      tab: { onMeet: false, title: "", label: "Fuera de Meet" },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
      sessionId: null,
    });
    assert.equal(outside.canStart, false);
    assert.equal(outside.startDisabled, true);

    const disconnected = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.DISCONNECTED,
      errorMessage: "El host local no está instalado.",
    });
    assert.equal(disconnected.canStart, false);
    assert.match(disconnected.errorMessage, /no está instalado/);
  });

  it("permite iniciar solo en Meet con transcriptor listo", () => {
    const view = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
      sessionId: null,
    });
    assert.equal(view.canStart, true);
    assert.equal(view.canStop, false);
    assert.equal(view.meetingTitle, "Daily");
    assert.equal(view.transcriptorLabel, "Listo");
  });

  it("usa título por defecto cuando Meet no expone title", () => {
    const view = derivePopupView({
      tab: { onMeet: true, title: "", label: "Google Meet" },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
      sessionId: null,
    });
    assert.equal(view.meetingTitle, "Reunión de Google Meet");
  });

  it("permite detener solo mientras graba con session_id", () => {
    const recording = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.RECORDING,
      sessionId: "sess-1",
    });
    assert.equal(recording.canStart, false);
    assert.equal(recording.canStop, true);
    assert.equal(recording.stopVisible, true);

    const recordingWithoutSession = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.RECORDING,
      sessionId: null,
    });
    assert.equal(recordingWithoutSession.canStop, false);
  });

  it("bloquea acciones mientras busy o en error", () => {
    const busy = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.READY,
      sessionId: null,
      busy: true,
    });
    assert.equal(busy.canStart, false);

    const error = derivePopupView({
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
      },
      transcriptorStatus: TRANSCRIPTOR_STATUS.ERROR,
      errorMessage: "falló",
      sessionId: null,
    });
    assert.equal(error.canStart, false);
    assert.equal(error.canStop, false);
  });

  it("nunca muestra grabación activa si el host no la confirmó", () => {
    const afterFailedStart = applyBackgroundResult(createInitialState(), {
      ok: false,
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
        url: "https://meet.google.com/abc",
      },
      transcriptorStatus: "error",
      sessionId: null,
      error: { code: "MISSING_SESSION_ID", message: "Falta session_id" },
    });
    const view = derivePopupView(afterFailedStart);
    assert.notEqual(view.transcriptorStatus, TRANSCRIPTOR_STATUS.RECORDING);
    assert.equal(view.canStop, false);
    assert.equal(view.sessionId, null);
  });
});

describe("popup-controller", () => {
  it("aplica host listo, inicio correcto y detención correcta", () => {
    let state = createInitialState();

    state = applyBackgroundResult(state, {
      ok: true,
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
        url: "https://meet.google.com/abc",
      },
      transcriptorStatus: "ready",
      sessionId: null,
    });
    assert.equal(state.transcriptorStatus, "ready");
    assert.equal(state.errorMessage, "");

    state = applyBackgroundResult(state, {
      ok: true,
      tab: state.tab,
      transcriptorStatus: "recording",
      sessionId: "sess-9",
    });
    assert.equal(state.sessionId, "sess-9");
    assert.equal(derivePopupView(state).canStop, true);

    state = applyBackgroundResult(state, {
      ok: true,
      tab: state.tab,
      transcriptorStatus: "ready",
      sessionId: null,
    });
    assert.equal(state.sessionId, null);
    assert.equal(derivePopupView(state).canStart, true);
  });

  it("mantiene error visible ante fallos de inicio/detención o host ausente", () => {
    let state = createInitialState();
    state = applyBackgroundResult(state, {
      ok: false,
      tab: {
        onMeet: true,
        title: "Daily",
        label: "Google Meet",
        url: "https://meet.google.com/abc",
      },
      transcriptorStatus: "disconnected",
      sessionId: null,
      error: {
        code: "HOST_NOT_FOUND",
        message: "El host local del transcriptor no está instalado.",
      },
    });
    assert.equal(state.transcriptorStatus, "disconnected");
    assert.match(state.errorMessage, /no está instalado/);

    state = applyBackgroundResult(state, {
      ok: false,
      tab: state.tab,
      transcriptorStatus: "error",
      sessionId: null,
      error: { code: "START_REJECTED", message: "No se pudo iniciar" },
    });
    assert.equal(state.transcriptorStatus, "error");
    assert.equal(state.errorMessage, "No se pudo iniciar");
  });

  it("tolera respuestas inesperadas sin dejar estado ficticio de grabación", () => {
    const state = applyBackgroundResult(
      {
        tab: {
          onMeet: true,
          title: "Daily",
          label: "Google Meet",
        },
        transcriptorStatus: "ready",
        sessionId: null,
        errorMessage: "",
        busy: false,
      },
      null
    );
    assert.equal(state.transcriptorStatus, "error");
    assert.equal(state.sessionId, null);
    assert.match(state.errorMessage, /inesperada/i);
  });
});
