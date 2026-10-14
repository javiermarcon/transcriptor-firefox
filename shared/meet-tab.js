/**
 * Detección de pestañas de Google Meet (sin content script).
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetTab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /* c8 ignore stop */
  const MEET_ORIGIN = "https://meet.google.com";

  function isMeetUrl(url) {
    if (typeof url !== "string" || !url) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" && parsed.hostname === "meet.google.com"
      );
    } catch (_err) {
      return false;
    }
  }

  function describeActiveTab(tab) {
    const url = tab && typeof tab.url === "string" ? tab.url : "";
    const title = tab && typeof tab.title === "string" ? tab.title.trim() : "";
    const onMeet = isMeetUrl(url);

    return {
      onMeet,
      url: onMeet ? url : "",
      title: onMeet ? title : "",
      label: onMeet ? "Google Meet" : "Fuera de Meet",
    };
  }

  return {
    MEET_ORIGIN,
    isMeetUrl,
    describeActiveTab,
  };
});
