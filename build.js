const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "dist");
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

if (!sourceManifest || !Array.isArray(sourceManifest.scrapers)) {
  throw new Error("manifest.json must contain a scrapers array");
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "providers"), { recursive: true });

const publishedScrapers = sourceManifest.scrapers.map((scraper) => {
  if (!scraper.id || !scraper.filename) {
    throw new Error("Every scraper needs an id and filename");
  }
  const source = path.resolve(root, scraper.filename);
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source)) {
    throw new Error("Provider file not found or outside repository: " + scraper.filename);
  }
  const destinationName = path.basename(scraper.filename);
  fs.copyFileSync(source, path.join(output, "providers", destinationName));
  return { ...scraper, filename: "providers/" + destinationName };
});

const publishedManifest = {
  name: sourceManifest.name || "STREAMFLIX2",
  version: sourceManifest.version || "0.1.0",
  scrapers: publishedScrapers
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(publishedManifest, null, 2) + "\n");
console.log("Built " + publishedScrapers.length + " Nuvio provider(s) into dist/");
