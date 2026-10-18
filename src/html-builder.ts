import fs from "node:fs";
import path from "node:path";
import { LoadedFragment } from "./loader.js";
import {
  CrossReferenceContext,
  CrossReferenceTarget,
  renderFragmentMarkdown,
  resolveImageToDataUri,
  slugify,
  TocEntry,
} from "./markdown.js";
import { GuideRecipe } from "./schema.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Costruisce il contesto per risolvere i riferimenti incrociati tra frammenti
 * all'interno della guida corrente.
 */
function buildCrossReferenceContext(
  recipe: GuideRecipe,
  fragmentsMap: Map<string, LoadedFragment>
): CrossReferenceContext {
  const includedSlugPrefixes = new Map<string, string>();
  recipe.sections.forEach((section, sectionIndex) => {
    section.fragments.forEach((fragmentId, fragIndex) => {
      if (!includedSlugPrefixes.has(fragmentId)) {
        includedSlugPrefixes.set(
          fragmentId,
          `s${sectionIndex + 1}-f${fragIndex + 1}`
        );
      }
    });
  });

  const byId = new Map<string, CrossReferenceTarget>();
  const byFilePath = new Map<string, CrossReferenceTarget>();

  for (const fragment of fragmentsMap.values()) {
    const target: CrossReferenceTarget = {
      id: fragment.frontmatter.id,
      slugPrefix: includedSlugPrefixes.get(fragment.frontmatter.id),
    };
    byId.set(fragment.frontmatter.id, target);
    byFilePath.set(path.resolve(fragment.filePath), target);
  }

  return { byId, byFilePath };
}

/**
 * Costruisce l'HTML completo per una guida a partire dalla ricetta YAML e dai frammenti.
 */
export function buildGuideHtml(
  recipe: GuideRecipe,
  fragmentsMap: Map<string, LoadedFragment>,
  rootDir: string
): string {
  const templatePath = path.join(rootDir, "themes", "default", "template.html");
  const stylesPath = path.join(rootDir, "themes", "default", "print.css");

  const template = fs.readFileSync(templatePath, "utf-8");
  const styles = fs.readFileSync(stylesPath, "utf-8");

  const crossRefContext = buildCrossReferenceContext(recipe, fragmentsMap);
  const allTocEntries: TocEntry[] = [];
  const sectionHtmlBlocks: string[] = [];
  const renderedFragmentIds = new Set<string>();

  recipe.sections.forEach((section, sectionIndex) => {
    const chapterSlug = `chapter-${sectionIndex + 1}-${slugify(section.title)}`;
    allTocEntries.push({
      id: chapterSlug,
      title: section.title,
      level: 1,
    });

    const fragmentHtmlBlocks: string[] = [];

    section.fragments.forEach((fragmentId, fragIndex) => {
      const fragment = fragmentsMap.get(fragmentId);
      if (!fragment) {
        throw new Error(`Frammento '${fragmentId}' non trovato.`);
      }

      const slugPrefix = `s${sectionIndex + 1}-f${fragIndex + 1}`;
      const rendered = renderFragmentMarkdown(
        fragment.content,
        fragment.filePath,
        rootDir,
        slugPrefix,
        crossRefContext
      );

      allTocEntries.push(...rendered.tocEntries);

      const tagsHtml = fragment.frontmatter.tags
        .map((t) => `<span class="fragment-tag">#${escapeHtml(t)}</span>`)
        .join(" ");

      const isFirstOccurrence = !renderedFragmentIds.has(fragment.frontmatter.id);
      renderedFragmentIds.add(fragment.frontmatter.id);
      const articleIdAttr = isFirstOccurrence
        ? ` id="fragment-${escapeHtml(fragment.frontmatter.id)}"`
        : "";

      fragmentHtmlBlocks.push(`
      <article class="fragment-block"${articleIdAttr} data-fragment-id="${escapeHtml(fragment.frontmatter.id)}">
        <div class="fragment-meta">
          <span class="fragment-meta-badge">${escapeHtml(fragment.frontmatter.id)}</span>
          <span>Autore: <strong>@${escapeHtml(fragment.frontmatter.author)}</strong></span>
          <span>•</span>
          <span>Aggiornato il: ${escapeHtml(fragment.frontmatter.updated_at)}</span>
          ${tagsHtml}
        </div>
        ${rendered.html}
      </article>`);
    });

    const pageBreakClass =
      recipe.options.chapter_page_break && sectionIndex > 0 ? "page-break" : "";

    const descriptionHtml = section.description
      ? `<p class="chapter-description">${escapeHtml(section.description)}</p>`
      : "";

    sectionHtmlBlocks.push(`
    <section class="chapter-section ${pageBreakClass}" id="${chapterSlug}">
      <header class="chapter-header">
        <h1 class="chapter-title">${escapeHtml(section.title)}</h1>
        ${descriptionHtml}
      </header>
      ${fragmentHtmlBlocks.join("\n")}
    </section>`);
  });

  // Costruzione Logo Copertina
  let logoHtml = "";
  if (recipe.cover.logo) {
    const dataUri = resolveImageToDataUri(recipe.cover.logo, rootDir, rootDir);
    logoHtml = `<div class="cover-logo"><img src="${dataUri}" alt="Logo" /></div>`;
  }

  // Costruzione Sottotitolo Copertina
  const subtitleHtml = recipe.cover.subtitle
    ? `<p class="cover-subtitle">${escapeHtml(recipe.cover.subtitle)}</p>`
    : "";

  // Costruzione Indice (Table of Contents)
  let tocHtml = "";
  if (recipe.options.include_toc && allTocEntries.length > 0) {
    const itemsHtml = allTocEntries
      .map(
        (entry) => `
      <li class="toc-item toc-item-level-${entry.level}">
        <a class="toc-link" href="#${entry.id}">
          <span>${escapeHtml(entry.title)}</span>
        </a>
      </li>`
      )
      .join("");

    tocHtml = `
  <nav class="toc-page" aria-label="Indice">
    <h2 class="toc-title">${escapeHtml(recipe.options.toc_title)}</h2>
    <ul class="toc-list">
      ${itemsHtml}
    </ul>
  </nav>`;
  }

  const contentHtml = sectionHtmlBlocks.join("\n");
  return template
    .replace(/\{\{TITLE\}\}/g, () => escapeHtml(recipe.cover.title))
    .replace("{{STYLES}}", () => styles)
    .replace("{{LOGO_HTML}}", () => logoHtml)
    .replace("{{SUBTITLE_HTML}}", () => subtitleHtml)
    .replace("{{AUTHOR}}", () => escapeHtml(recipe.cover.author))
    .replace("{{VERSION}}", () => escapeHtml(recipe.cover.version))
    .replace("{{DATE}}", () => escapeHtml(recipe.cover.date))
    .replace("{{TOC_HTML}}", () => tocHtml)
    .replace("{{CONTENT_HTML}}", () => contentHtml);
}
