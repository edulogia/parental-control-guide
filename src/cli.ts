import fs from "node:fs";
import path from "node:path";
import { buildGuideHtml } from "./html-builder.js";
import { loadWorkspace } from "./loader.js";
import { generatePdfs, PdfGenerationJob } from "./pdf-generator.js";

function parseArgs(argv: string[]) {
  const command = argv[2] || "help";
  let guidePath: string | undefined;
  let htmlOnly = false;

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--guide" && argv[i + 1]) {
      guidePath = argv[++i];
    } else if (arg === "--html-only") {
      htmlOnly = true;
    }
  }

  return { command, guidePath, htmlOnly };
}

async function main() {
  const rootDir = process.cwd();
  const { command, guidePath, htmlOnly } = parseArgs(process.argv);

  if (command === "validate") {
    const workspace = loadWorkspace(rootDir, guidePath);
    console.log(
      `✅ Validazione completata con successo!\n` +
        `   - Tag consentiti in guides/tags.yaml: ${workspace.allowedTags.size}\n` +
        `   - Frammenti Markdown validati: ${workspace.fragments.size}\n` +
        `   - Ricette guide validate: ${workspace.guides.length}`
    );
    if (workspace.orphanFragments.length > 0) {
      console.warn(
        `\n⚠️  Attenzione: ${workspace.orphanFragments.length} frammento/i orfano/i (non inclusi in nessuna guida):`
      );
      for (const orphan of workspace.orphanFragments) {
        console.warn(`   - [${orphan.frontmatter.id}] (${orphan.relativePath})`);
      }
    }
    return;
  }

  if (command === "catalog") {
    const workspace = loadWorkspace(rootDir);
    const orphanIds = new Set(
      workspace.orphanFragments.map((f) => f.frontmatter.id)
    );
    console.log("=== CATALOGO TAG CONSENTITI (guides/tags.yaml) ===");
    for (const tag of workspace.allowedTags.values()) {
      console.log(`  • ${tag.id.padEnd(18)} - ${tag.description}`);
    }

    console.log("\n=== CATALOGO FRAMMENTI DISPONIBILI (fragments/) ===");
    for (const fragment of workspace.fragments.values()) {
      const { id, author, updated_at, tags } = fragment.frontmatter;
      const orphanBadge = orphanIds.has(id) ? " ⚠️ [ORFANO]" : "";
      console.log(`  • [${id}] "${fragment.extractedTitle}"${orphanBadge}`);
      console.log(
        `    File: ${fragment.relativePath} | Autore GitHub: @${author} | Aggiornato: ${updated_at} | Tag: ${tags.join(", ")}`
      );
    }
    return;
  }

  if (command === "build") {
    const workspace = loadWorkspace(rootDir, guidePath);
    const distDir = path.join(rootDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });

    const jobs: PdfGenerationJob[] = [];

    for (const loadedGuide of workspace.guides) {
      const { recipe } = loadedGuide;
      const html = buildGuideHtml(recipe, workspace.fragments, rootDir);
      const outputPdfPath = path.join(distDir, recipe.output_filename);
      const outputHtmlPath = path.join(
        distDir,
        recipe.output_filename.replace(/\.pdf$/i, ".html")
      );

      if (htmlOnly) {
        fs.writeFileSync(outputHtmlPath, html, "utf-8");
        console.log(
          `📄 Anteprima HTML generata: ${path.relative(rootDir, outputHtmlPath)}`
        );
      } else {
        jobs.push({
          html,
          outputPdfPath,
          outputHtmlPath,
        });
      }
    }

    if (!htmlOnly && jobs.length > 0) {
      console.log(`⏳ Generazione di ${jobs.length} guida/e in PDF in corso...`);
      await generatePdfs(jobs);
      for (const job of jobs) {
        console.log(
          `✅ PDF generato con successo: ${path.relative(rootDir, job.outputPdfPath)}`
        );
      }
    }
    return;
  }

  console.log(`Uso:
  npm run validate                         Valida guides/tags.yaml, tutti i frammenti e le ricette
  npm run catalog                          Mostra l'elenco dei tag e dei frammenti disponibili
  npm run build                            Genera i PDF di tutte le guide in dist/
  npm run build -- --guide <percorso>      Genera il PDF di una singola guida
  npm run build -- --html-only             Genera solo l'HTML in dist/ senza invocare Chromium`);
}

main().catch((err) => {
  console.error(`\n❌ Errore:\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
