/**
 * Contexto privilegiado: única capa que habla con el host nativo.
 */
(() => {
  const { createNativeClient } = MeetingsNativeClient;
  const { createBackgroundController } = MeetingsBackgroundController;

  const controller = createBackgroundController({
    client: createNativeClient(),
    protocol: MeetingsProtocol,
    async getActiveTab() {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tabs[0] || null;
    },
  });

  browser.runtime.onMessage.addListener((message) =>
    controller.handleMessage(message)
  );
})();
