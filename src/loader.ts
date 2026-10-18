import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import {
  createFragmentFrontmatterSchema,
  FragmentFrontmatter,
  GuideRecipe,
  GuideRecipeSchema,
  TagDefinition,
  TagsConfigSchema,
} from "./schema.js";

export interface LoadedFragment {
  frontmatter: FragmentFrontmatter;
  content: string;
  filePath: string;
  relativePath: string;
  extractedTitle: string;
}

export interface LoadedGuide {
  recipe: GuideRecipe;
  filePath: string;
  relativePath: string;
}

export interface WorkspaceData {
  allowedTags: Map<string, TagDefinition>;
  fragments: Map<string, LoadedFragment>;
  guides: LoadedGuide[];
  orphanFragments: LoadedFragment[];
}

/**
 * Ricerca ricorsiva dei file con una determinata estensione in una directory.
 */
function findFilesRecursively(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursively(fullPath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * Estrae il primo titolo Markdown (# ...) dal corpo del frammento per il catalogo.
 */
function extractFirstHeading(markdown: string, fallbackId: string): string {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return fallbackId;
}

/**
 * Carica e valida il catalogo centrale dei tag da guides/tags.yaml
 */
export function loadAllowedTags(rootDir: string): Map<string, TagDefinition> {
  const tagsFilePath = path.join(rootDir, "guides", "tags.yaml");
  if (!fs.existsSync(tagsFilePath)) {
    throw new Error(
      `File dei tag non trovato in '${path.relative(rootDir, tagsFilePath)}'.`
    );
  }

  const rawContent = fs.readFileSync(tagsFilePath, "utf-8");
  const parsedYaml = YAML.parse(rawContent);
  const result = TagsConfigSchema.safeParse(parsedYaml);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Errore di validazione in guides/tags.yaml:\n${issues}`);
  }

  const tagsMap = new Map<string, TagDefinition>();
  for (const tag of result.data.tags) {
    if (tagsMap.has(tag.id)) {
      throw new Error(
        `Tag duplicato '${tag.id}' trovato in guides/tags.yaml.`
      );
    }
    tagsMap.set(tag.id, tag);
  }

  return tagsMap;
}

/**
 * Carica e valida tutti i frammenti Markdown (.md) presenti nella cartella fragments/
 */
export function loadFragments(
  rootDir: string,
  allowedTags: Set<string>
): Map<string, LoadedFragment> {
  const fragmentsDir = path.join(rootDir, "fragments");
  const mdFiles = findFilesRecursively(fragmentsDir, ".md");

  if (mdFiles.length === 0) {
    throw new Error(
      `Nessun frammento Markdown (.md) trovato nella cartella 'fragments/'.`
    );
  }

  const schema = createFragmentFrontmatterSchema(allowedTags);
  const fragmentsMap = new Map<string, LoadedFragment>();
  const errors: string[] = [];

  for (const filePath of mdFiles) {
    const relativePath = path.relative(rootDir, filePath);
    const rawFile = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(rawFile);

    const validation = schema.safeParse(parsed.data);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `    * [${i.path.join(".") || "frontmatter"}] ${i.message}`)
        .join("\n");
      errors.push(`- ${relativePath}:\n${issues}`);
      continue;
    }

    const frontmatter = validation.data;
    if (fragmentsMap.has(frontmatter.id)) {
      const existing = fragmentsMap.get(frontmatter.id)!;
      errors.push(
        `- ${relativePath}: ID frammento duplicato '${frontmatter.id}' (già definito in ${existing.relativePath})`
      );
      continue;
    }

    if (!parsed.content.trim()) {
      errors.push(`- ${relativePath}: Il corpo Markdown del frammento è vuoto`);
      continue;
    }

    fragmentsMap.set(frontmatter.id, {
      frontmatter,
      content: parsed.content,
      filePath,
      relativePath,
      extractedTitle: extractFirstHeading(parsed.content, frontmatter.id),
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `Errori di validazione nei frammenti Markdown:\n${errors.join("\n")}`
    );
  }

  return fragmentsMap;
}

/**
 * Carica e valida le ricette delle guide presenti in guides/*.yaml (escludendo tags.yaml)
 */
export function loadGuideRecipes(
  rootDir: string,
  fragmentsMap: Map<string, LoadedFragment>,
  specificGuidePath?: string
): LoadedGuide[] {
  const guidesDir = path.join(rootDir, "guides");
  let yamlFiles: string[] = [];

  if (specificGuidePath) {
    const resolved = path.resolve(rootDir, specificGuidePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File guida specificato non trovato: ${specificGuidePath}`);
    }
    yamlFiles = [resolved];
  } else {
    const allYaml = [
      ...findFilesRecursively(guidesDir, ".yaml"),
      ...findFilesRecursively(guidesDir, ".yml"),
    ];
    yamlFiles = allYaml.filter((filePath) => {
      const base = path.basename(filePath).toLowerCase();
      return base !== "tags.yaml" && base !== "tags.yml";
    });
  }

  if (yamlFiles.length === 0) {
    throw new Error(`Nessun file ricetta (.yaml) trovato nella cartella 'guides/'.`);
  }

  const loadedGuides: LoadedGuide[] = [];
  const seenGuideIds = new Map<string, string>();
  const seenOutputFilenames = new Map<string, string>();
  const errors: string[] = [];

  for (const filePath of yamlFiles) {
    const relativePath = path.relative(rootDir, filePath);
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const parsedYaml = YAML.parse(rawContent);

    const validation = GuideRecipeSchema.safeParse(parsedYaml);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `    * [${i.path.join(".")}] ${i.message}`)
        .join("\n");
      errors.push(`- ${relativePath}:\n${issues}`);
      continue;
    }

    const recipe = validation.data;
    const recipeIssues: string[] = [];

    // Verifica collisioni su id della guida
    if (seenGuideIds.has(recipe.id)) {
      recipeIssues.push(
        `    * ID guida duplicato '${recipe.id}' (già definito in ${seenGuideIds.get(recipe.id)})`
      );
    } else {
      seenGuideIds.set(recipe.id, relativePath);
    }

    // Verifica collisioni su output_filename
    const normalizedOutput = recipe.output_filename.toLowerCase();
    if (seenOutputFilenames.has(normalizedOutput)) {
      recipeIssues.push(
        `    * output_filename duplicato '${recipe.output_filename}' (già utilizzato in ${seenOutputFilenames.get(normalizedOutput)})`
      );
    } else {
      seenOutputFilenames.set(normalizedOutput, relativePath);
    }

    // Verifica che tutti i frammenti referenziati esistano
    for (const section of recipe.sections) {
      for (const fragmentId of section.fragments) {
        if (!fragmentsMap.has(fragmentId)) {
          recipeIssues.push(
            `    * Frammento '${fragmentId}' (nella sezione "${section.title}") non trovato in fragments/`
          );
        }
      }
    }

    // Verifica che il logo di copertina (se specificato) esista
    if (recipe.cover.logo) {
      const logoPath = path.resolve(rootDir, recipe.cover.logo);
      if (!fs.existsSync(logoPath)) {
        recipeIssues.push(
          `    * Logo di copertina '${recipe.cover.logo}' non trovato`
        );
      }
    }

    if (recipeIssues.length > 0) {
      errors.push(`- ${relativePath}:\n${recipeIssues.join("\n")}`);
      continue;
    }

    loadedGuides.push({
      recipe,
      filePath,
      relativePath,
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `Errori di validazione nelle ricette delle guide:\n${errors.join("\n")}`
    );
  }

  return loadedGuides;
}

/**
 * Individuazione dei frammenti "orfani" (presenti in fragments/ ma non inclusi in nessuna guida).
 */
export function findOrphanFragments(
  fragmentsMap: Map<string, LoadedFragment>,
  guides: LoadedGuide[]
): LoadedFragment[] {
  const usedIds = new Set<string>();
  for (const guide of guides) {
    for (const section of guide.recipe.sections) {
      for (const fragmentId of section.fragments) {
        usedIds.add(fragmentId);
      }
    }
  }

  const orphans: LoadedFragment[] = [];
  for (const fragment of fragmentsMap.values()) {
    if (!usedIds.has(fragment.frontmatter.id)) {
      orphans.push(fragment);
    }
  }
  return orphans;
}

/**
 * Carica e valida l'intero workspace (tag, frammenti e guide).
 */
export function loadWorkspace(
  rootDir: string,
  specificGuidePath?: string
): WorkspaceData {
  const allowedTags = loadAllowedTags(rootDir);
  const allowedTagIds = new Set(allowedTags.keys());
  const fragments = loadFragments(rootDir, allowedTagIds);
  const guides = loadGuideRecipes(rootDir, fragments, specificGuidePath);
  const orphanFragments = specificGuidePath
    ? []
    : findOrphanFragments(fragments, guides);

  return {
    allowedTags,
    fragments,
    guides,
    orphanFragments,
  };
}
