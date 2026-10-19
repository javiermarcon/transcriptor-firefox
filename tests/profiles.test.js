const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const Protocol = require("../shared/protocol.js");
const { createNativeClient } = require("../shared/native-client.js");
const {
  createBackgroundController,
} = require("../shared/background-controller.js");
const MeetTab = require("../shared/meet-tab.js");
const { derivePopupView } = require("../shared/popup-state.js");
const { createFakePort, waitForSent } = require("./helpers/fake-port.js");

describe("profiles protocol", () => {
  it("valida nombres y normaliza listados", () => {
    assert.equal(Protocol.isValidProfileName("Shipii"), true);
    assert.equal(Protocol.isValidProfileName("../x"), false);
    assert.equal(Protocol.isValidProfileName(""), false);

    const normalized = Protocol.normalizeProfilesData({
      profiles: ["Shipii", "bad/name", "Shipii", "motonave", 3],
      default_profile: "nuevo",
    });
    assert.deepEqual(normalized.profiles, ["nuevo", "Shipii", "motonave"]);
    assert.equal(normalized.default_profile, "nuevo");
  });
});

describe("profiles native-client", () => {
  it("lista perfiles y envía profile en start_recording", async () => {
    const port = createFakePort();
    let n = 0;
    const client = createNativeClient({
      protocol: Protocol,
      connectNative: () => port,
      generateId: () => `p-${(n += 1)}`,
    });

    const listPending = client.listProfiles();
    await waitForSent(port, 1);
    assert.equal(port.sent[0].action, "list_profiles");
    port.emitMessage({
      protocol_version: 1,
      request_id: "p-1",
      ok: true,
      data: { profiles: ["Shipii"], default_profile: "Shipii" },
    });
    const listed = await listPending;
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.data.profiles, ["Shipii"]);

    const startPending = client.startRecording({
      url: "https://meet.google.com/abc-defg-hij",
      title: "Daily",
      profile: "Shipii",
    });
    await waitForSent(port, 2);
    assert.equal(port.sent[1].action, "start_recording");
    assert.equal(port.sent[1].payload.profile, "Shipii");
    port.emitMessage({
      protocol_version: 1,
      request_id: "p-2",
      ok: true,
      data: { session_id: "sess-1", profile: "Shipii" },
    });
    assert.equal((await startPending).ok, true);

    const withoutProfile = client.startRecording({
      url: "https://meet.google.com/abc-defg-hij",
      title: "Daily",
      profile: "../bad",
    });
    await waitForSent(port, 3);
    assert.equal(port.sent[2].payload.profile, undefined);
    port.emitMessage({
      protocol_version: 1,
      request_id: "p-3",
      ok: true,
      data: { session_id: "sess-2" },
    });
    await withoutProfile;

    const failPending = client.listProfiles();
    await waitForSent(port, 4);
    port.emitMessage({
      protocol_version: 1,
      request_id: "p-4",
      ok: false,
      error: { code: "UNKNOWN_ACTION", message: "no" },
    });
    const failed = await failPending;
    assert.equal(failed.ok, false);
  });
});

describe("profiles background + popup", () => {
  it("exige perfil cuando el host lista opciones", async () => {
    const recorded = [];
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        listProfiles: async () => ({
          ok: true,
          data: { profiles: ["Shipii", "motonave"], default_profile: "Shipii" },
        }),
        startRecording: async (payload) => {
          recorded.push(payload);
          return {
            ok: true,
            data: { session_id: "sess-p", profile: payload.profile },
          };
        },
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 1,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });

    const status = await controller.handleGetStatus({});
    assert.equal(status.profilesSupported, true);
    assert.equal(status.selectedProfile, "Shipii");
    assert.deepEqual(status.profiles, ["Shipii", "motonave"]);

    const view = derivePopupView({
      tab: status.tab,
      transcriptorStatus: "ready",
      profilesSupported: true,
      profiles: status.profiles,
      selectedProfile: null,
    });
    assert.equal(view.canStart, false);

    await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "motonave",
    });
    assert.equal(controller.getPreferredProfile(), "motonave");

    const started = await controller.handleStartRecording({
      tab: {
        id: 1,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
      profile: "motonave",
    });
    assert.equal(started.ok, true);
    assert.equal(recorded[0].profile, "motonave");
  });

  it("no envía profile si el host no soporta list_profiles", async () => {
    const recorded = [];
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        listProfiles: async () => ({
          ok: false,
          error: { code: "UNKNOWN_ACTION", message: "no" },
        }),
        startRecording: async (payload) => {
          recorded.push(payload);
          return { ok: true, data: { session_id: "sess-legacy" } };
        },
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 2,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });

    const status = await controller.handleGetStatus({});
    assert.equal(status.profilesSupported, false);
    assert.match(
      status.profilesError,
      /list_profiles|NATIVE_MESSAGING_PROFILE/
    );

    const started = await controller.handleStartRecording({
      tab: {
        id: 2,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
      profile: "Shipii",
    });
    assert.equal(started.ok, true);
    assert.equal(recorded[0].profile, undefined);

    const bad = await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "../x",
    });
    assert.equal(bad.error.code, "INVALID_PROFILE");
  });

  it("cubre bordes de listado, preferencia y perfil requerido", async () => {
    assert.deepEqual(Protocol.normalizeProfilesData(null).profiles, []);
    assert.equal(Protocol.isValidProfileName("   "), false);

    let listMode = "empty";
    const controller = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        listProfiles: async () => {
          if (listMode === "empty") {
            return { ok: true, data: { profiles: [] } };
          }
          if (listMode === "throw") {
            throw new Error("list boom");
          }
          if (listMode === "other-error") {
            return {
              ok: false,
              error: { code: "HOST_ERROR", message: "falló listar" },
            };
          }
          if (listMode === "solo") {
            return { ok: true, data: { profiles: ["Unico"] } };
          }
          return {
            ok: true,
            data: {
              profiles: ["Shipii", "motonave"],
              default_profile: "Shipii",
            },
          };
        },
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-b", profile: "Shipii" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 3,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });

    const empty = await controller.handleGetStatus({});
    assert.equal(empty.profilesSupported, true);
    assert.match(empty.profilesError, /No hay perfiles/);
    assert.equal(
      derivePopupView({
        tab: empty.tab,
        transcriptorStatus: "ready",
        profilesSupported: true,
        profiles: [],
      }).canStart,
      false
    );

    listMode = "throw";
    const threw = await controller.handleGetStatus({});
    assert.match(threw.profilesError, /list boom/);

    listMode = "other-error";
    const other = await controller.handleGetStatus({});
    assert.match(other.profilesError, /falló listar/);

    listMode = "solo";
    const solo = await controller.handleGetStatus({});
    assert.equal(solo.selectedProfile, "Unico");

    listMode = "full";
    await controller.handleGetStatus({});
    await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "Shipii",
    });
    const cleared = await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "",
    });
    assert.equal(cleared.selectedProfile, null);

    const unknown = await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "no-existe",
    });
    assert.equal(unknown.error.code, "UNKNOWN_PROFILE");

    const required = await controller.handleStartRecording({
      tab: {
        id: 3,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
    });
    assert.equal(required.error.code, "PROFILE_REQUIRED");

    const invalidStart = await controller.handleStartRecording({
      tab: {
        id: 3,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      },
      profile: "../bad",
    });
    assert.equal(invalidStart.error.code, "INVALID_PROFILE");

    const noListFn = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({
          ok: false,
          error: { code: "X", message: "no" },
        }),
        startRecording: async () => ({ ok: true, data: { session_id: "s" } }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 4,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    const noListStatus = await noListFn.handleGetStatus({});
    assert.equal(noListStatus.profilesSupported, false);

    const {
      applyBackgroundResult,
      createInitialState,
    } = require("../shared/popup-controller.js");
    const applied = applyBackgroundResult(createInitialState(), {
      ok: true,
      profilesSupported: true,
      profiles: ["Shipii"],
      selectedProfile: "Shipii",
      defaultProfile: "Shipii",
      profilesError: "",
      transcriptorStatus: "ready",
      sessionId: null,
    });
    assert.equal(applied.selectedProfile, "Shipii");
    assert.equal(derivePopupView(applied).profileSelectEnabled, true);

    // Preferencia que deja de existir al refrescar.
    listMode = "full";
    await controller.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "motonave",
    });
    listMode = "solo";
    const refreshed = await controller.handleGetStatus({});
    assert.equal(refreshed.selectedProfile, "Unico");

    // Fallback isValidProfile sin helpers del protocolo.
    const noProto = createBackgroundController({
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        listProfiles: async () => ({
          ok: true,
          data: { profiles: ["Shipii"], default_profile: "Shipii" },
        }),
        startRecording: async () => ({
          ok: true,
          data: { session_id: "sess-np" },
        }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 5,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    await noProto.handleGetStatus({});
    const setOk = await noProto.handleMessage({
      type: "SET_PREFERRED_PROFILE",
      profile: "Shipii",
    });
    assert.equal(setOk.ok, true);

    let oddMode = "bare-ok";
    const odd = createBackgroundController({
      protocol: Protocol,
      meetTab: MeetTab,
      client: {
        getStatus: async () => ({ ok: true, data: { status: "ready" } }),
        listProfiles: async () => {
          if (oddMode === "bare-ok") {
            return { ok: true };
          }
          if (oddMode === "no-message") {
            return { ok: false, error: { code: "HOST_ERROR" } };
          }
          throw Object.create(null);
        },
        startRecording: async () => ({ ok: true, data: { session_id: "o" } }),
        stopRecording: async () => ({ ok: true, data: {} }),
      },
      getActiveTab: async () => ({
        id: 6,
        url: "https://meet.google.com/abc-defg-hij",
        title: "Daily",
      }),
      notifyMeetTab: async () => ({ ok: true }),
    });
    const bare = await odd.handleGetStatus({});
    assert.equal(bare.profilesSupported, true);
    oddMode = "no-message";
    const noMsg = await odd.handleGetStatus({});
    assert.match(noMsg.profilesError, /No se pudieron listar/);
    oddMode = "throw-nullish";
    const nullish = await odd.handleGetStatus({});
    assert.match(nullish.profilesError, /No se pudieron listar/);
  });
});
