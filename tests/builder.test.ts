import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGuideHtml } from "../src/html-builder.js";
import { findOrphanFragments, loadGuideRecipes, loadWorkspace } from "../src/loader.js";
import { renderFragmentMarkdown } from "../src/markdown.js";
import {
  createFragmentFrontmatterSchema,
  GuideRecipeSchema,
} from "../src/schema.js";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

describe("Edulogia Guide Builder - Schemas & Validation", () => {
  const allowedTags = new Set(["accesso", "onboarding", "docenti"]);
  const frontmatterSchema = createFragmentFrontmatterSchema(allowedTags);

  it("accetta un frontmatter valido con id piatto (lettere, numeri, '-'), username GitHub e tag registrati", () => {
    const result = frontmatterSchema.safeParse({
      id: "login-base-2",
      author: "@alfredomorresi",
      updated_at: "2026-10-02",
      tags: ["accesso", "onboarding"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.author).toBe("alfredomorresi");
    }
  });

  it("rifiuta un id frammento che contiene '/' (struttura directory) o caratteri non validi", () => {
    const withSlash = frontmatterSchema.safeParse({
      id: "accesso/login-base",
      author: "alfredomorresi",
      updated_at: "2026-10-02",
      tags: ["accesso"],
    });
    expect(withSlash.success).toBe(false);

    const withUnderscore = frontmatterSchema.safeParse({
      id: "login_base",
      author: "alfredomorresi",
      updated_at: "2026-10-02",
      tags: ["accesso"],
    });
    expect(withUnderscore.success).toBe(false);
  });

  it("rifiuta un frontmatter con tag non incluso in guides/tags.yaml", () => {
    const result = frontmatterSchema.safeParse({
      id: "login-base",
      author: "alfredomorresi",
      updated_at: "2026-10-02",
      tags: ["accesso", "tag-inventato"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "Il tag 'tag-inventato' non è valido"
      );
    }
  });

  it("rifiuta un frontmatter con username GitHub non valido o con spazi", () => {
    const result = frontmatterSchema.safeParse({
      id: "login-base",
      author: "Mario Rossi",
      updated_at: "2026-10-02",
      tags: ["accesso"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        "username GitHub valido"
      );
    }
  });

  it("rifiuta campi non previsti nel frontmatter (es. title)", () => {
    const result = frontmatterSchema.safeParse({
      id: "login-base",
      title: "Titolo non permesso",
      author: "alfredomorresi",
      updated_at: "2026-10-02",
      tags: ["accesso"],
    });

    expect(result.success).toBe(false);
  });

  it("valida correttamente una ricetta di guida YAML", () => {
    const result = GuideRecipeSchema.safeParse({
      id: "guida-test",
      output_filename: "guida-test.pdf",
      cover: {
        title: "Guida di Test",
        author: "Team Edulogia",
        version: "1.0.0",
        date: "Ottobre 2026",
      },
      sections: [
        {
          title: "Capitolo 1",
          fragments: ["login-base"],
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe("Edulogia Guide Builder - Rendering, Callouts, Cross-References & Workspace", () => {
  it("trasforma gli alert GitHub a livello di token (inclusi multi-paragrafo e blockquote annidati) e normalizza i titoli per il TOC", () => {
    const sampleMd = [
      "# Titolo Principale",
      "",
      "Testo introduttivo.",
      "",
      "> [!IMPORTANT]",
      "> Primo paragrafo dell'avviso.",
      ">",
      "> > Citazione annidata dentro l'avviso.",
      ">",
      "> Secondo paragrafo dell'avviso.",
      "",
      "## Sottotitolo",
    ].join("\n");
    const fakePath = path.join(ROOT_DIR, "fragments", "accesso", "login-base.md");

    const rendered = renderFragmentMarkdown(sampleMd, fakePath, ROOT_DIR, "s1-f1");

    expect(rendered.html).toContain('<h2 id="s1-f1-titolo-principale">Titolo Principale</h2>');
    expect(rendered.html).toContain('<h3 id="s1-f1-sottotitolo">Sottotitolo</h3>');
    expect(rendered.html).toContain('class="callout callout-important"');
    expect(rendered.html).toContain("<blockquote>\n<p>Citazione annidata dentro l’avviso.</p>\n</blockquote>");
    expect(rendered.html).toContain("<p>Secondo paragrafo dell’avviso.</p>");
    expect(rendered.tocEntries).toHaveLength(2);
    expect(rendered.tocEntries[0].level).toBe(2);
    expect(rendered.tocEntries[1].level).toBe(3);
  });

  it("risolve i riferimenti incrociati tra frammenti in ancore interne del PDF", () => {
    const workspace = loadWorkspace(ROOT_DIR);
    const docentiGuide = workspace.guides.find((g) => g.recipe.id === "guida-docenti")!;
    const html = buildGuideHtml(docentiGuide.recipe, workspace.fragments, ROOT_DIR);

    // Il link ./recupero-password.md dentro login-base.md viene convertito in #fragment-recupero-password
    expect(html).toContain('id="fragment-recupero-password"');
    expect(html).toContain('href="#fragment-recupero-password"');
  });

  it("rileva collisioni di id o output_filename nelle ricette e individua i frammenti orfani", () => {
    const workspace = loadWorkspace(ROOT_DIR);

    // Verifica il calcolo dei frammenti orfani quando una guida usa solo un sottoinsieme
    const singleSectionGuide = [
      {
        ...workspace.guides[0],
        recipe: {
          ...workspace.guides[0].recipe,
          sections: [{ title: "Cap 1", fragments: ["login-base"] }],
        },
      },
    ];
    const orphans = findOrphanFragments(workspace.fragments, singleSectionGuide);
    expect(orphans.some((f) => f.frontmatter.id === "caricamento-materiali")).toBe(true);
    expect(orphans.some((f) => f.frontmatter.id === "login-base")).toBe(false);

    // Verifica collisione di output_filename in una directory temporanea
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edulogia-test-"));
    try {
      const guidesDir = path.join(tmpDir, "guides");
      fs.mkdirSync(guidesDir, { recursive: true });
      const sampleYaml1 = `
id: guida-uno
output_filename: stesso-nome.pdf
cover:
  title: T1
  author: A
  version: "1.0"
  date: Oggi
sections:
  - title: S1
    fragments: [login-base]
`;
      const sampleYaml2 = `
id: guida-due
output_filename: stesso-nome.pdf
cover:
  title: T2
  author: A
  version: "1.0"
  date: Oggi
sections:
  - title: S1
    fragments: [login-base]
`;
      fs.writeFileSync(path.join(guidesDir, "g1.yaml"), sampleYaml1);
      fs.writeFileSync(path.join(guidesDir, "g2.yaml"), sampleYaml2);

      expect(() => loadGuideRecipes(tmpDir, workspace.fragments)).toThrow(
        /output_filename duplicato/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("carica l'intero workspace e assembla l'HTML completo delle guide senza dipendere dal numero esatto di file", () => {
    const workspace = loadWorkspace(ROOT_DIR);

    expect(workspace.allowedTags.size).toBeGreaterThanOrEqual(1);
    expect(workspace.fragments.size).toBeGreaterThanOrEqual(1);
    expect(workspace.guides.length).toBeGreaterThanOrEqual(1);

    const firstGuide = workspace.guides[0];
    const html = buildGuideHtml(
      firstGuide.recipe,
      workspace.fragments,
      ROOT_DIR
    );

    expect(html).toContain(firstGuide.recipe.cover.title);
    expect(html).toContain("Indice dei Contenuti");
    expect(html).toContain("@alfredomorresi");
    expect(html).toContain("data:image/svg+xml;base64,");
  });
});
