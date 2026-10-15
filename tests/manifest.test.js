const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);

describe("manifest firefox", () => {
  it("usa MV3 con ID fijo y background.page (no service_worker)", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(
      manifest.browser_specific_settings.gecko.id,
      "meetings-transcriptor@example.org"
    );
    assert.equal(typeof manifest.background.page, "string");
    assert.equal(manifest.background.service_worker, undefined);
    assert.ok(
      fs.existsSync(path.join(root, manifest.background.page)),
      manifest.background.page
    );
  });

  it("pide solo permisos mínimos y no APIs Chrome-only implícitas", () => {
    assert.deepEqual(manifest.permissions.sort(), [
      "activeTab",
      "nativeMessaging",
    ]);
    assert.deepEqual(manifest.host_permissions, ["https://meet.google.com/*"]);
    assert.equal(manifest.permissions.includes("<all_urls>"), false);
    assert.equal("externally_connectable" in manifest, false);
    assert.ok(Array.isArray(manifest.content_scripts));
    assert.ok(
      manifest.content_scripts[0].matches.every((m) =>
        m.startsWith("https://meet.google.com/")
      )
    );
  });

  it("declara popup existente", () => {
    assert.ok(fs.existsSync(path.join(root, manifest.action.default_popup)));
  });

  it("validate-manifest.js termina en éxito", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts/validate-manifest.js")],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Manifest OK/);
  });

  it("el código de la extensión no referencia chrome.* como API requerida", () => {
    const files = [
      "background/background.js",
      "popup/popup.js",
      "shared/native-client.js",
      "shared/background-controller.js",
    ];
    for (const rel of files) {
      const source = fs.readFileSync(path.join(root, rel), "utf8");
      assert.equal(
        source.includes("chrome."),
        false,
        `${rel} no debe depender de chrome.*`
      );
    }
  });
});
