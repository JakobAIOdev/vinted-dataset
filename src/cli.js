import { scrapeDataset, serveDataset } from "./service.js";

async function main() {
  const command = process.argv[2] ?? "scrape";

  if (command === "scrape") {
    const result = await scrapeDataset();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "serve") {
    const result = await serveDataset();
    process.stdout.write(`Listening on port ${result.port}, output dir ${result.outputDir}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
