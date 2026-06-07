import { copyFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

const outdir = "dist";

// Step 1: Ensure the output directory exists.
//
// Do not delete dist by default. The CLI dynamically imports split chunks
// during long-running sessions; deleting old chunks while a claudex process is
// open breaks lazy paths such as /compact with ERR_MODULE_NOT_FOUND.
await mkdir(outdir, { recursive: true });

// Step 2: Bundle with splitting
const result = await Bun.build({
    entrypoints: ["src/entrypoints/cli.tsx"],
    outdir,
    target: "bun",
    splitting: true,
});

if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir);
const IMPORT_META_REQUIRE = "var __require = import.meta.require;";
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`;

let patched = 0;
for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const filePath = join(outdir, file);
    const content = await readFile(filePath, "utf-8");
    if (content.includes(IMPORT_META_REQUIRE)) {
        await writeFile(
            filePath,
            content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
        );
        patched++;
    }
}

await copyFile(join(outdir, "cli.js"), join(outdir, "claudex.js"));

console.log(
    `Bundled ${result.outputs.length} files to ${outdir}/ (patched ${patched} for Node.js compat)`,
);
