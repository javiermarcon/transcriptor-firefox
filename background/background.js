/**
 * Contexto privilegiado: única capa que habla con el host nativo.
 * El listener de onMessage se registra de forma síncrona para que Firefox
 * pueda despertar el event page ante sendMessage del popup.
 */
(() => {
  let controller = null;
  let initError = null;

  function initController() {
    if (controller || initError) {
      return;
    }
    try {
      if (
        typeof MeetingsNativeClient === "undefined" ||
        typeof MeetingsBackgroundController === "undefined" ||
        typeof MeetingsProtocol === "undefined" ||
        typeof MeetingsMeetEventSchema === "undefined"
      ) {
        throw new Error(
          "No se cargaron los módulos compartidos del background."
        );
      }

      const { createNativeClient } = MeetingsNativeClient;
      const { createBackgroundController } = MeetingsBackgroundController;

      controller = createBackgroundController({
        client: createNativeClient(),
        protocol: MeetingsProtocol,
        eventSchema: MeetingsMeetEventSchema,
        async getActiveTab() {
          const tabs = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          return tabs[0] || null;
        },
        async notifyMeetTab(tabId, message) {
          return browser.tabs.sendMessage(tabId, message);
        },
      });
    } catch (err) {
      initError = err;
      console.error(
        "[Meetings Transcriptor] Fallo al iniciar background:",
        err
      );
    }
  }

  // Registro síncrono: obligatorio en event pages MV3 de Firefox.
  browser.runtime.onMessage.addListener((message) => {
    initController();

    if (initError || !controller) {
      return Promise.resolve({
        ok: false,
        tab: {
          onMeet: false,
          url: "",
          title: "",
          label: "Fuera de Meet",
        },
        transcriptorStatus: "error",
        sessionId: null,
        error: {
          code: "BACKGROUND_INIT_FAILED",
          message:
            initError && initError.message
              ? initError.message
              : "El proceso en segundo plano no pudo iniciarse.",
        },
      });
    }

    return controller.handleMessage(message);
  });

  initController();
  console.info("[Meetings Transcriptor] Background listo");
})();
