/**
 * Post-build: always overwrite dist config from src/config (no merge / no stale files).
 * Mirrors templates.json to dist/templates.json for deployments that still resolve that path.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const srcConfig = path.join(root, "src", "config");
const distConfig = path.join(root, "dist", "config");
const distTemplatesLegacy = path.join(root, "dist", "templates.json");

function main() {
    if (!fs.existsSync(srcConfig)) {
        console.error("[postbuild] Missing", srcConfig);
        process.exit(1);
    }

    fs.mkdirSync(distConfig, { recursive: true });

    for (const name of fs.readdirSync(srcConfig)) {
        const src = path.join(srcConfig, name);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(distConfig, name);
        fs.copyFileSync(src, dest);
        console.log("[postbuild] Overwrote", path.relative(root, dest));
    }

    const templatesSrc = path.join(srcConfig, "templates.json");
    if (fs.existsSync(templatesSrc)) {
        fs.copyFileSync(templatesSrc, distTemplatesLegacy);
        console.log("[postbuild] Overwrote", path.relative(root, distTemplatesLegacy));
    }
}

main();
