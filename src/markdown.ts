import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

export interface TocEntry {
  id: string;
  title: string;
  level: number; // 1 = Capitolo, 2 = Titolo Frammento (#), 3 = Sottotitolo (##)
}

export interface RenderedFragment {
  html: string;
  tocEntries: TocEntry[];
}

export interface CrossReferenceTarget {
  id: string;
  slugPrefix?: string; // Definito se il frammento fa parte della guida corrente
}

export interface CrossReferenceContext {
  byId: Map<string, CrossReferenceTarget>;
  byFilePath: Map<string, CrossReferenceTarget>;
}

interface MarkdownRenderEnv {
  fragmentDir: string;
  rootDir: string;
  slugPrefix: string;
  tocEntries: TocEntry[];
  usedSlugs: Map<string, number>;
  crossRef?: CrossReferenceContext;
}

const CALLOUT_LABELS: Record<string, string> = {
  note: "Nota",
  tip: "Suggerimento",
  important: "Importante",
  warning: "Attenzione",
  caution: "Cautela",
};

const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/**
 * Crea uno slug URL-safe per i titoli dell'indice.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Converte un file immagine locale in Data URI Base64 per l'embedding sicuro nel PDF.
 */
export function resolveImageToDataUri(
  imageSrc: string,
  baseDir: string,
  rootDir: string
): string {
  if (
    imageSrc.startsWith("http://") ||
    imageSrc.startsWith("https://") ||
    imageSrc.startsWith("data:")
  ) {
    return imageSrc;
  }

  let resolvedPath = path.resolve(baseDir, imageSrc);
  if (!fs.existsSync(resolvedPath)) {
    resolvedPath = path.resolve(rootDir, imageSrc);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Immagine non trovata: '${imageSrc}' (cercata in '${baseDir}' e '${rootDir}')`
    );
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const fileBuffer = fs.readFileSync(resolvedPath);
  return `data:${mime};base64,${fileBuffer.toString("base64")}`;
}

/**
 * Risolve un link Markdown (relativo a file .md, schema fragment:<id> o ancora #<id>)
 * trasformandolo in un riferimento interno cliccabile nel PDF se il frammento è presente nella guida.
 */
function resolveMarkdownHref(
  rawHref: string,
  env: MarkdownRenderEnv
): { href: string | null } {
  if (
    rawHref.startsWith("http://") ||
    rawHref.startsWith("https://") ||
    rawHref.startsWith("mailto:") ||
    rawHref.startsWith("tel:")
  ) {
    return { href: rawHref };
  }

  const hashIndex = rawHref.indexOf("#");
  const pathPart = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
  const hashPart = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : "";

  // 1. Link con schema esplicito fragment:<id>[#sottotitolo]
  if (pathPart.startsWith("fragment:")) {
    const targetId = pathPart.slice("fragment:".length).trim();
    const target = env.crossRef?.byId.get(targetId);
    if (target) {
      if (!target.slugPrefix) {
        return { href: null }; // Frammento esistente ma non incluso in questa guida
      }
      return {
        href: hashPart
          ? `#${target.slugPrefix}-${slugify(hashPart)}`
          : `#fragment-${target.id}`,
      };
    }
  }

  // 2. Link a un altro file Markdown (.md)
  if (pathPart.toLowerCase().endsWith(".md") && env.crossRef) {
    let resolvedMdPath = path.resolve(env.fragmentDir, pathPart);
    if (!env.crossRef.byFilePath.has(resolvedMdPath)) {
      resolvedMdPath = path.resolve(env.rootDir, pathPart);
    }

    const target = env.crossRef.byFilePath.get(resolvedMdPath);
    if (target) {
      if (!target.slugPrefix) {
        return { href: null }; // Frammento esistente ma non incluso in questa guida
      }
      return {
        href: hashPart
          ? `#${target.slugPrefix}-${slugify(hashPart)}`
          : `#fragment-${target.id}`,
      };
    }
  }

  // 3. Link solo ancora (#...)
  if (!pathPart && hashPart) {
    // Se corrisponde all'id di un frammento
    const target = env.crossRef?.byId.get(hashPart);
    if (target) {
      if (!target.slugPrefix) {
        return { href: null };
      }
      return { href: `#fragment-${target.id}` };
    }

    // Altrimenti è un riferimento a un titolo interno allo stesso frammento
    if (
      !hashPart.startsWith(`${env.slugPrefix}-`) &&
      !hashPart.startsWith("fragment-") &&
      !hashPart.startsWith("chapter-")
    ) {
      return { href: `#${env.slugPrefix}-${slugify(hashPart)}` };
    }
  }

  return { href: rawHref };
}

/**
 * Crea e configura l'istanza condivisa di MarkdownIt con regole basate su token:
 * - trasformazione dei callout GitHub (> [!NOTE], > [!WARNING], ecc.) a livello di token
 * - normalizzazione dei titoli (# -> h2, ## -> h3) e raccolta voci TOC
 * - embedding immagini locali in Data URI
 * - risoluzione dei riferimenti incrociati tra frammenti
 */
function createMarkdownProcessor(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });

  // Regola token-level per i callout GitHub (> [!NOTE], > [!TIP], ecc.)
  md.core.ruler.after("inline", "github_callouts", (state) => {
    const tokens = state.tokens;
    const calloutRegex =
      /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\r?\n|[ \t]+|$)/i;

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") {
        continue;
      }

      const firstOpen = tokens[i + 1];
      const firstInline = tokens[i + 2];
      if (
        firstOpen?.type !== "paragraph_open" ||
        firstInline?.type !== "inline"
      ) {
        continue;
      }

      const match = firstInline.content.match(calloutRegex);
      if (!match) {
        continue;
      }

      const type = match[1].toLowerCase();
      const label = CALLOUT_LABELS[type] || match[1];

      // Trova il blockquote_close corrispondente gestendo eventuali blockquote annidati
      let depth = 1;
      let closeIdx = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === "blockquote_open") {
          depth++;
        } else if (tokens[j].type === "blockquote_close") {
          depth--;
          if (depth === 0) {
            closeIdx = j;
            break;
          }
        }
      }

      if (closeIdx === -1) {
        continue;
      }

      tokens[i].type = "callout_open";
      tokens[i].tag = "div";
      tokens[i].meta = { type, label };

      tokens[closeIdx].type = "callout_close";
      tokens[closeIdx].tag = "div";

      // Rimuove il marker [!TYPE] dal token inline e dai suoi children
      firstInline.content = firstInline.content.slice(match[0].length);
      if (firstInline.children && firstInline.children.length > 0) {
        const firstChild = firstInline.children[0];
        if (firstChild.type === "text") {
          firstChild.content = firstChild.content.replace(
            /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i,
            ""
          );
          if (firstChild.content === "") {
            firstInline.children.shift();
          }
        }
        if (
          firstInline.children[0]?.type === "softbreak" ||
          firstInline.children[0]?.type === "hardbreak"
        ) {
          firstInline.children.shift();
        }
      }

      // Se il primo paragrafo conteneva solo [!TYPE], rimuove il paragrafo vuoto
      if (!firstInline.children || firstInline.children.length === 0) {
        tokens.splice(i + 1, 3);
      }
    }
  });

  md.renderer.rules.callout_open = (tokens, idx) => {
    const { type, label } = tokens[idx].meta as { type: string; label: string };
    return `<div class="callout callout-${type}">\n  <div class="callout-header"><span>${label}</span></div>\n  <div class="callout-body">`;
  };

  md.renderer.rules.callout_close = () => {
    return `</div>\n</div>\n`;
  };

  // Risoluzione immagini locali in Data URI
  const defaultImageRender =
    md.renderer.rules.image ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };

  md.renderer.rules.image = (tokens, idx, options, env: MarkdownRenderEnv, self) => {
    const token = tokens[idx];
    const srcIndex = token.attrIndex("src");
    if (srcIndex >= 0 && token.attrs && env?.rootDir) {
      const originalSrc = token.attrs[srcIndex][1];
      token.attrs[srcIndex][1] = resolveImageToDataUri(
        originalSrc,
        env.fragmentDir,
        env.rootDir
      );
    }
    return defaultImageRender(tokens, idx, options, env, self);
  };

  // Risoluzione riferimenti incrociati tra frammenti nei link
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };

  const defaultLinkClose =
    md.renderer.rules.link_close ||
    function (tokens, idx, options, _env, self) {
      return self.renderToken(tokens, idx, options);
    };

  md.renderer.rules.link_open = (tokens, idx, options, env: MarkdownRenderEnv, self) => {
    const token = tokens[idx];
    const hrefIndex = token.attrIndex("href");
    if (hrefIndex >= 0 && token.attrs && env) {
      const originalHref = token.attrs[hrefIndex][1];
      const resolved = resolveMarkdownHref(originalHref, env);
      if (resolved.href === null) {
        token.meta = { ...token.meta, omittedCrossRef: true };
        return `<span class="cross-ref-omitted">`;
      }
      token.attrs[hrefIndex][1] = resolved.href;
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.link_close = (tokens, idx, options, env: MarkdownRenderEnv, self) => {
    // Verifica se il link_open corrispondente è stato convertito in <span>
    for (let i = idx - 1; i >= 0; i--) {
      if (tokens[i].type === "link_close") {
        break;
      }
      if (tokens[i].type === "link_open") {
        if (tokens[i].meta?.omittedCrossRef) {
          return `</span>`;
        }
        break;
      }
    }
    return defaultLinkClose(tokens, idx, options, env, self);
  };

  // Normalizzazione dei livelli dei titoli (# -> h2, ## -> h3, ecc.) e raccolta TOC
  md.renderer.rules.heading_open = (tokens, idx, _options, env: MarkdownRenderEnv) => {
    const token = tokens[idx];
    const inlineToken = tokens[idx + 1];
    const rawTitle = inlineToken?.content || "";

    const originalLevel = Number.parseInt(token.tag.slice(1), 10);
    const shiftedLevel = Math.min(originalLevel + 1, 6);

    const baseSlug = `${env.slugPrefix}-${slugify(rawTitle) || "section"}`;
    const count = env.usedSlugs.get(baseSlug) || 0;
    env.usedSlugs.set(baseSlug, count + 1);
    const finalSlug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;

    if (shiftedLevel <= 3) {
      env.tocEntries.push({
        id: finalSlug,
        title: rawTitle,
        level: shiftedLevel,
      });
    }

    return `<h${shiftedLevel} id="${finalSlug}">`;
  };

  md.renderer.rules.heading_close = (tokens, idx) => {
    const token = tokens[idx];
    const originalLevel = Number.parseInt(token.tag.slice(1), 10);
    const shiftedLevel = Math.min(originalLevel + 1, 6);
    return `</h${shiftedLevel}>`;
  };

  return md;
}

const sharedMarkdownProcessor = createMarkdownProcessor();

/**
 * Renderizza un frammento Markdown in HTML, normalizzando i livelli dei titoli,
 * estraendo le voci per l'Indice (TOC), risolvendo le immagini locali e i link tra frammenti.
 */
export function renderFragmentMarkdown(
  markdown: string,
  fragmentFilePath: string,
  rootDir: string,
  slugPrefix: string,
  crossRef?: CrossReferenceContext
): RenderedFragment {
  const env: MarkdownRenderEnv = {
    fragmentDir: path.dirname(fragmentFilePath),
    rootDir,
    slugPrefix,
    tocEntries: [],
    usedSlugs: new Map<string, number>(),
    crossRef,
  };

  const html = sharedMarkdownProcessor.render(markdown, env);

  return {
    html,
    tocEntries: env.tocEntries,
  };
}
