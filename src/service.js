import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { BRAND_PREFIX_ALPHABET, DEFAULT_OUTPUT_DIR, REGIONS, ROOT_CATALOGS } from "./config.js";

function resolveOutputDir() {
  if (process.env.DATASET_OUTPUT_DIR) {
    return path.resolve(process.cwd(), process.env.DATASET_OUTPUT_DIR);
  }
  return path.resolve(DEFAULT_OUTPUT_DIR.pathname);
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonOrDefault(filePath, fallbackValue) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stdout.write(`[dataset] ${message}\n`);
}

function toSlug(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function toCatalogPath(root) {
  const slug = String(root.slug || "").replace(/^\/?catalog\//, "");
  if (/^\d+-/.test(slug)) {
    return slug;
  }
  return `${root.id}-${slug}`;
}

function collectNodeSizeId(node) {
  return (
    node.size_id ??
    node.sizeGroupId ??
    node.size_group_id ??
    node.size_group_ids?.[0] ??
    node.size_group?.id ??
    null
  );
}

function toGroupNode(node) {
  const label = node.title ?? node.name ?? `catalog-${node.id}`;
  const nextNode = {
    id: node.id,
    slug: node.code ?? toSlug(label, `catalog-${node.id}`),
    children: {}
  };

  const sizeId = collectNodeSizeId(node);
  if (sizeId !== null && sizeId !== undefined) {
    nextNode.size_id = Number(sizeId);
  }

  const children = node.catalogs ?? node.children ?? [];
  for (const child of children) {
    nextNode.children[child.title ?? child.name ?? `catalog-${child.id}`] = toGroupNode(child);
  }

  return nextNode;
}

function balancedSlice(source, startIndex) {
  const openChar = source[startIndex];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;

    if (depth === 0) {
      return source.slice(startIndex, index + 1);
    }
  }

  return null;
}

function extractJsonAfterMarker(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const firstBraceIndex = source.indexOf("{", markerIndex + marker.length);
  const firstBracketIndex = source.indexOf("[", markerIndex + marker.length);
  const candidates = [firstBraceIndex, firstBracketIndex].filter((value) => value !== -1);
  if (candidates.length === 0) {
    return null;
  }

  const startIndex = Math.min(...candidates);
  const slice = balancedSlice(source, startIndex);
  if (!slice) {
    return null;
  }

  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function extractCatalogDtosFromHtml(html) {
  const directMarkers = [
    "\"dtos\":{\"catalogs\":",
    "\"catalogs\":[{\"id\":1904",
    "\"initialCatalogState\":"
  ];

  for (const marker of directMarkers) {
    const parsed = extractJsonAfterMarker(html, marker);
    if (!parsed) continue;

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (Array.isArray(parsed.catalogs)) {
      return parsed.catalogs;
    }

    if (parsed.dtos && Array.isArray(parsed.dtos.catalogs)) {
      return parsed.dtos.catalogs;
    }
  }

  const catalogMatch = html.match(/"dtos":\{"catalogs":(\[.*?\])(?:,"|})/s);
  if (catalogMatch) {
    try {
      return JSON.parse(catalogMatch[1]);
    } catch {
      return null;
    }
  }

  return null;
}

async function extractCatalogTreeFromPage(page) {
  return page.evaluate(() => {
    function balancedSlice(source, startIndex) {
      const openChar = source[startIndex];
      const closeChar = openChar === "{" ? "}" : "]";
      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === "\"") {
            inString = false;
          }
          continue;
        }

        if (char === "\"") {
          inString = true;
          continue;
        }

        if (char === openChar) depth += 1;
        if (char === closeChar) depth -= 1;

        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }

      return null;
    }

    function extractArrayAfterMarker(source, marker) {
      const markerIndex = source.indexOf(marker);
      if (markerIndex === -1) {
        return null;
      }

      const startIndex = source.indexOf("[", markerIndex + marker.length);
      if (startIndex === -1) {
        return null;
      }

      const slice = balancedSlice(source, startIndex);
      if (!slice) {
        return null;
      }

      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }

    const scripts = Array.from(document.scripts).map((script) => script.textContent || "");
    const pushRegex = /self\.__next_f\.push\(\[1,("(?:\\.|[^"])*")\]\)/gs;

    for (const text of scripts) {
      let match;
      while ((match = pushRegex.exec(text))) {
        try {
          const decoded = JSON.parse(match[1]);
          const fromCatalogTree = extractArrayAfterMarker(decoded, "\"catalogTree\":");
          if (Array.isArray(fromCatalogTree) && fromCatalogTree.length > 0) {
            return fromCatalogTree;
          }

          const fromDtos = extractArrayAfterMarker(decoded, "\"dtos\":{\"catalogs\":");
          if (Array.isArray(fromDtos) && fromDtos.length > 0) {
            return fromDtos;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  });
}

async function discoverRootCatalogs(page, region) {
  log(`Discovering root catalogs for ${region.code}`);
  const tree = await extractCatalogTreeFromPage(page);

  if (Array.isArray(tree) && tree.length > 0) {
    return tree.map((node) => ({
      id: node.id,
      slug: String(node.url || `/catalog/${node.id}`)
        .split("/")
        .filter(Boolean)
        .pop()
    }));
  }

  return ROOT_CATALOGS;
}

function normalizeSearchOptions(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.options)) return payload.options;
  if (Array.isArray(payload.filters)) return payload.filters;
  return [];
}

function normalizeFacetOptions(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.options)) return payload.options;
  if (Array.isArray(payload.facets)) return payload.facets;
  return [];
}

async function fetchJsonInPage(page, urlPath) {
  return page.evaluate(async (nextPath) => {
    const response = await fetch(nextPath, {
      credentials: "include",
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} for ${nextPath}: ${body.slice(0, 300)}`);
    }

    return response.json();
  }, urlPath);
}

function buildFilterUrl({ catalogIds, filterCode, searchText = "" }) {
  const params = new URLSearchParams({
    catalog_ids: catalogIds.join(","),
    size_ids: "",
    brand_ids: "",
    status_ids: "",
    color_ids: "",
    patterns_ids: "",
    material_ids: ""
  });

  if (searchText) {
    params.set("filter_search_code", filterCode);
    params.set("filter_search_text", searchText);
    return `/api/v2/catalog/filters/search?${params.toString()}`;
  }

  params.set("filter_code", filterCode);
  return `/api/v2/catalog/filters/facets?${params.toString()}`;
}

async function bootstrapRegionPage(region) {
  log(`Launching browser for ${region.code} (${region.domain})`);
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false"
  });

  const context = await browser.newContext({
    locale: region.code === "uk" ? "en-GB" : `${region.code}-${region.code.toUpperCase()}`
  });

  const page = await context.newPage();
  const entryUrl = `https://${region.domain}/catalog/${ROOT_CATALOGS[0].id}-${ROOT_CATALOGS[0].slug}`;
  log(`Opening ${entryUrl}`);
  await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  log(`Session ready for ${region.code}`);

  return { browser, context, page };
}

async function loadCatalogTree(page, region, rootCatalogs) {
  const groups = {};

  for (const root of rootCatalogs) {
    const pageUrl = `https://${region.domain}/catalog/${toCatalogPath(root)}`;
    log(`Loading catalog tree ${region.code}:${root.id}`);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
    let catalogDtos = await extractCatalogTreeFromPage(page);

    if (!Array.isArray(catalogDtos) || catalogDtos.length === 0) {
      const html = await page.content();
      catalogDtos = extractCatalogDtosFromHtml(html);
    }

    if (!Array.isArray(catalogDtos) || catalogDtos.length === 0) {
      throw new Error(`Unable to extract catalog tree for region ${region.code} and root ${root.id}`);
    }

    for (const catalog of catalogDtos) {
      groups[catalog.title ?? catalog.name ?? `catalog-${catalog.id}`] = toGroupNode(catalog);
    }
  }

  return groups;
}

function collectRootCatalogIds(groups) {
  return Object.values(groups)
    .map((node) => node.id)
    .filter((value, index, array) => array.indexOf(value) === index);
}

async function collectFlatFacet(page, catalogIds, filterCode) {
  const payload = await fetchJsonInPage(page, buildFilterUrl({ catalogIds, filterCode }));
  return normalizeFacetOptions(payload);
}

async function collectBrands(page, catalogIds) {
  const brandMap = new Map();
  let requests = 0;

  const topBrands = await collectFlatFacet(page, catalogIds, "brand");
  requests += 1;
  for (const entry of topBrands) {
    if (entry?.title && entry?.id) {
      brandMap.set(entry.title, String(entry.id));
    }
  }

  const queue = [...BRAND_PREFIX_ALPHABET];
  const seenPrefixes = new Set(queue);

  while (queue.length > 0) {
    const prefix = queue.shift();
    const payload = await fetchJsonInPage(
      page,
      buildFilterUrl({ catalogIds, filterCode: "brand", searchText: prefix })
    );
    requests += 1;
    const options = normalizeSearchOptions(payload);

    for (const entry of options) {
      if (entry?.title && entry?.id) {
        brandMap.set(entry.title, String(entry.id));
      }
    }

    if (options.length >= 90 && prefix.length < 4) {
      for (const next of BRAND_PREFIX_ALPHABET) {
        const extended = `${prefix}${next}`;
        if (seenPrefixes.has(extended)) continue;
        seenPrefixes.add(extended);
        queue.push(extended);
      }
    }

    if (requests % 25 === 0) {
      log(`Brand discovery: ${requests} requests, ${brandMap.size} brands, queue ${queue.length}`);
    }

    await sleep(150);
  }

  log(`Brand discovery finished: ${requests} requests, ${brandMap.size} brands`);
  return Object.fromEntries([...brandMap.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function normalizeOptionLabel(entry) {
  return entry.title ?? entry.label ?? entry.name ?? null;
}

function normalizeOptionId(entry) {
  const rawId = entry.id ?? entry.value ?? entry.code;
  if (rawId === null || rawId === undefined) return null;
  return Number(rawId);
}

async function collectColors(page, catalogIds) {
  const options = await collectFlatFacet(page, catalogIds, "color");
  return options
    .map((entry) => ({
      id: String(entry.id),
      label: normalizeOptionLabel(entry),
      hex: entry.hex ?? entry.color_hex ?? null
    }))
    .filter((entry) => entry.id && entry.label);
}

async function collectStatuses(page, catalogIds) {
  const options = await collectFlatFacet(page, catalogIds, "status");
  return options
    .map((entry) => ({
      id: String(entry.id),
      label: normalizeOptionLabel(entry),
      type: entry.type ?? null
    }))
    .filter((entry) => entry.id && entry.label);
}

async function collectSizes(page, catalogIds) {
  const options = await collectFlatFacet(page, catalogIds, "size");
  const groups = {};

  for (const entry of options) {
    const label = normalizeOptionLabel(entry);
    const id = normalizeOptionId(entry);
    if (!label || !id) continue;

    const groupId =
      entry.size_group_id ??
      entry.group_id ??
      entry.parent_id ??
      entry.parent?.id ??
      entry.type_id ??
      "default";

    if (!groups[groupId]) {
      groups[groupId] = {};
    }

    groups[groupId][label] = id;
  }

  return groups;
}

export async function scrapeDataset() {
  const outputDir = resolveOutputDir();
  const startedAt = new Date().toISOString();
  const selectedRegionCodes = (process.env.REGION_CODES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedRegions =
    selectedRegionCodes.length > 0
      ? REGIONS.filter((region) => selectedRegionCodes.includes(region.code))
      : REGIONS;
  const brandRegionCode = process.env.BRAND_REGION || selectedRegions[0]?.code || "de";
  let rootCatalogs = null;

  await ensureDir(outputDir);
  log(`Output dir: ${outputDir}`);
  log(`Regions: ${selectedRegions.map((region) => region.code).join(", ")}`);
  log(`Brand source region: ${brandRegionCode}`);

  const existingBrands = await readJsonOrDefault(path.join(outputDir, "brand.json"), {});
  const existingColors = await readJsonOrDefault(path.join(outputDir, "colors.json"), []);
  const existingStatuses = await readJsonOrDefault(path.join(outputDir, "statuses.json"), []);
  const existingSizes = await readJsonOrDefault(path.join(outputDir, "sizes.json"), {});
  const existingMeta = await readJsonOrDefault(path.join(outputDir, "_meta.json"), {});

  const colorsById = new Map(existingColors.map((entry) => [entry.id, entry]));
  const statusesById = new Map(existingStatuses.map((entry) => [entry.id, entry]));
  const sizesByGroup = { ...existingSizes };
  let brandJson = { ...existingBrands };
  const scrapedRegions = new Set(existingMeta.scraped_regions ?? []);

  for (const region of selectedRegions) {
    log(`Starting region ${region.code}`);
    const { browser, page } = await bootstrapRegionPage(region);

    try {
      if (!rootCatalogs) {
        rootCatalogs = await discoverRootCatalogs(page, region);
        log(`Discovered roots: ${rootCatalogs.map((root) => root.id).join(", ")}`);
      }

      const groups = await loadCatalogTree(page, region, rootCatalogs);
      groupsByRegion[region.code] = groups;

      const catalogIds = collectRootCatalogIds(groups);
      log(`Using root catalog ids for filters: ${catalogIds.join(", ")}`);

      if (region.code === brandRegionCode) {
        log(`Collecting brands from ${region.code}`);
        const regionBrands = await collectBrands(page, catalogIds).catch((error) => {
          log(`Brand collection failed for ${region.code}: ${error instanceof Error ? error.message : String(error)}`);
          return {};
        });
        brandJson = {
          ...brandJson,
          ...regionBrands
        };
      }

      const colors = await collectColors(page, catalogIds).catch(() => []);
      log(`Collected ${colors.length} colors from ${region.code}`);
      for (const entry of colors) {
        colorsById.set(entry.id, entry);
      }

      const statuses = await collectStatuses(page, catalogIds).catch(() => []);
      log(`Collected ${statuses.length} statuses from ${region.code}`);
      for (const entry of statuses) {
        statusesById.set(entry.id, entry);
      }

      const sizeGroups = await collectSizes(page, catalogIds).catch(() => ({}));
      log(`Collected ${Object.keys(sizeGroups).length} size groups from ${region.code}`);
      for (const [groupId, values] of Object.entries(sizeGroups)) {
        sizesByGroup[groupId] = {
          ...(sizesByGroup[groupId] ?? {}),
          ...values
        };
      }

      await writeJson(path.join(outputDir, region.code, "groups.json"), groups);
      log(`Wrote ${region.code}/groups.json`);
      scrapedRegions.add(region.code);
    } finally {
      await browser.close();
      log(`Finished region ${region.code}`);
    }
  }

  await writeJson(path.join(outputDir, "brand.json"), brandJson);
  await writeJson(
    path.join(outputDir, "colors.json"),
    [...colorsById.values()].sort((left, right) => left.label.localeCompare(right.label))
  );
  await writeJson(
    path.join(outputDir, "statuses.json"),
    [...statusesById.values()].sort((left, right) => left.id.localeCompare(right.id))
  );
  await writeJson(path.join(outputDir, "sizes.json"), sizesByGroup);
  await writeJson(path.join(outputDir, "regions.json"), REGIONS);
  await writeJson(path.join(outputDir, "_meta.json"), {
    generated_at: startedAt,
    region_count: REGIONS.length,
    roots: rootCatalogs ?? existingMeta.roots ?? ROOT_CATALOGS,
    scraped_regions: [...scrapedRegions].sort()
  });

  log("Dataset export finished");

  return { outputDir, generatedAt: startedAt };
}

async function readDataset(outputDir) {
  const exists = await stat(outputDir).then(() => true).catch(() => false);
  if (!exists) {
    return null;
  }

  const entries = await readdir(outputDir, { withFileTypes: true });
  const dataset = {};

  for (const entry of entries) {
    const fullPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      dataset[entry.name] = {};
      const nestedEntries = await readdir(fullPath, { withFileTypes: true });
      for (const nestedEntry of nestedEntries) {
        if (!nestedEntry.isFile() || !nestedEntry.name.endsWith(".json")) continue;
        const nestedPath = path.join(fullPath, nestedEntry.name);
        dataset[entry.name][nestedEntry.name] = JSON.parse(await readFile(nestedPath, "utf8"));
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    dataset[entry.name] = JSON.parse(await readFile(fullPath, "utf8"));
  }

  return dataset;
}

function jsonResponse(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

export async function serveDataset() {
  const outputDir = resolveOutputDir();
  let runningRefresh = null;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(response, 200, {
        ok: true,
        output_dir: outputDir,
        refresh_running: Boolean(runningRefresh)
      });
    }

    if (request.method === "POST" && url.pathname === "/refresh") {
      if (!runningRefresh) {
        runningRefresh = scrapeDataset().finally(() => {
          runningRefresh = null;
        });
      }

      const result = await runningRefresh;
      return jsonResponse(response, 202, result);
    }

    if (request.method === "GET" && url.pathname === "/dataset") {
      const dataset = await readDataset(outputDir);
      if (!dataset) {
        return jsonResponse(response, 404, { error: "dataset_not_found" });
      }
      return jsonResponse(response, 200, dataset);
    }

    if (request.method === "GET" && url.pathname.startsWith("/dataset/")) {
      const relativePath = url.pathname.replace("/dataset/", "");
      const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(outputDir, safePath);

      try {
        const value = JSON.parse(await readFile(filePath, "utf8"));
        return jsonResponse(response, 200, value);
      } catch (error) {
        return jsonResponse(response, 404, {
          error: "file_not_found",
          path: safePath,
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return jsonResponse(response, 404, { error: "not_found" });
  });

  const port = Number(process.env.PORT || "4010");
  await new Promise((resolve) => server.listen(port, resolve));
  return { port, outputDir };
}
