#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function validateManifest(manifest, options = {}) {
  const root = options.root || path.join(__dirname, "..");
  const existsSync = options.existsSync || fs.existsSync;
  const errors = [];

  function assert(condition, message) {
    if (!condition) {
      errors.push(message);
    }
  }

  assert(
    manifest && typeof manifest === "object",
    "manifest debe ser un objeto"
  );
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors };
  }

  assert(manifest.manifest_version === 3, "manifest_version debe ser 3");
  assert(
    manifest.browser_specific_settings &&
      manifest.browser_specific_settings.gecko &&
      manifest.browser_specific_settings.gecko.id ===
        "meetings-transcriptor@example.org",
    "ID fijo meetings-transcriptor@example.org requerido"
  );
  assert(
    Array.isArray(manifest.permissions) &&
      manifest.permissions.includes("nativeMessaging"),
    "Falta permiso nativeMessaging"
  );
  assert(
    !manifest.permissions.includes("<all_urls>"),
    "No debe pedir acceso general a todas las URLs"
  );
  assert(
    !manifest.host_permissions ||
      (Array.isArray(manifest.host_permissions) &&
        manifest.host_permissions.every((p) =>
          p.startsWith("https://meet.google.com/")
        )),
    "host_permissions solo puede incluir Meet si existe"
  );
  assert(
    manifest.background &&
      Array.isArray(manifest.background.scripts) &&
      manifest.background.scripts.length > 0,
    "Firefox MV3 debe usar background.scripts"
  );
  assert(
    !(manifest.background && manifest.background.service_worker),
    "No usar service_worker como única opción en esta extensión Firefox"
  );

  if (manifest.background && Array.isArray(manifest.background.scripts)) {
    for (const rel of manifest.background.scripts) {
      assert(existsSync(path.join(root, rel)), `Falta script de fondo: ${rel}`);
    }
  }

  assert(
    manifest.action &&
      typeof manifest.action.default_popup === "string" &&
      existsSync(path.join(root, manifest.action.default_popup)),
    "Falta popup HTML"
  );

  return { ok: errors.length === 0, errors };
}

function main(deps = {}) {
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const log = deps.log || console.log.bind(console);
  const error = deps.error || console.error.bind(console);
  const exit = deps.exit || process.exit.bind(process);
  const root = deps.root || path.join(__dirname, "..");
  const manifestPath = deps.manifestPath || path.join(root, "manifest.json");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const result = validateManifest(manifest, {
    root,
    existsSync: deps.existsSync,
  });

  if (!result.ok) {
    error("Manifest inválido:");
    for (const item of result.errors) {
      error(`- ${item}`);
    }
    exit(1);
    return result;
  }

  log("Manifest OK");
  return result;
}

if (require.main === module) {
  main();
}

module.exports = { validateManifest, main };
