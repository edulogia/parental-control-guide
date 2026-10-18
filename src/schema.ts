import { z } from "zod";

/**
 * Regex ufficiale per lo username di un profilo GitHub:
 * - da 1 a 39 caratteri alfanumerici o trattini singoli interni
 * - non può iniziare o finire con un trattino
 * - supporta opzionalmente il prefisso '@' (che viene normalizzato)
 */
export const GITHUB_USERNAME_REGEX =
  /^@?[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Regex per l'identificativo dei frammenti Markdown:
 * - può contenere solo lettere (maiuscole/minuscole), numeri e il carattere '-'
 * - non deve contenere '/' né riflettere la struttura delle directory
 */
export const FRAGMENT_ID_REGEX = /^[a-zA-Z0-9-]+$/;

/**
 * Schema per il file guides/tags.yaml
 */
export const TagDefinitionSchema = z.object({
  id: z
    .string()
    .min(1, "L'id del tag non può essere vuoto")
    .regex(
      /^[a-z0-9-]+$/,
      "L'id del tag può contenere solo lettere minuscole, numeri e trattini"
    ),
  description: z.string().min(1, "La descrizione del tag è obbligatoria"),
});

export const TagsConfigSchema = z.object({
  tags: z
    .array(TagDefinitionSchema)
    .min(1, "Il file guides/tags.yaml deve contenere almeno un tag"),
});

export type TagDefinition = z.infer<typeof TagDefinitionSchema>;
export type TagsConfig = z.infer<typeof TagsConfigSchema>;

/**
 * Crea lo schema di validazione del frontmatter di un frammento Markdown,
 * verificando che tutti i tag appartengano alla lista definita in guides/tags.yaml.
 */
export function createFragmentFrontmatterSchema(allowedTags: Set<string>) {
  const allowedList = Array.from(allowedTags).sort().join(", ");

  return z
    .object({
      id: z
        .string({ required_error: "Il campo 'id' è obbligatorio nel frontmatter" })
        .min(1, "Il campo 'id' non può essere vuoto")
        .regex(
          FRAGMENT_ID_REGEX,
          "Il campo 'id' può contenere solo lettere, numeri e il carattere '-' (senza '/' o percorsi directory)"
        ),
      author: z
        .string({
          required_error:
            "Il campo 'author' (username GitHub) è obbligatorio nel frontmatter",
        })
        .regex(
          GITHUB_USERNAME_REGEX,
          "Il campo 'author' deve essere uno username GitHub valido (es. 'alfredomorresi')"
        )
        .transform((val) => (val.startsWith("@") ? val.slice(1) : val)),
      updated_at: z
        .string({
          required_error:
            "Il campo 'updated_at' (YYYY-MM-DD) è obbligatorio nel frontmatter",
        })
        .regex(
          ISO_DATE_REGEX,
          "Il campo 'updated_at' deve avere il formato YYYY-MM-DD (es. '2026-10-02')"
        ),
      tags: z
        .array(z.string().min(1), {
          required_error: "Il campo 'tags' è obbligatorio nel frontmatter",
        })
        .min(1, "Il frammento deve avere almeno un tag")
        .superRefine((tags, ctx) => {
          for (const tag of tags) {
            if (!allowedTags.has(tag)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Il tag '${tag}' non è valido. I tag consentiti in guides/tags.yaml sono: [${allowedList}]`,
              });
            }
          }
        }),
    })
    .strict();
}

export type FragmentFrontmatter = z.infer<
  ReturnType<typeof createFragmentFrontmatterSchema>
>;

/**
 * Schema per il file di ricomposizione (ricetta) della guida in guides/*.yaml
 */
export const GuideCoverSchema = z.object({
  title: z.string().min(1, "Il titolo di copertina è obbligatorio"),
  subtitle: z.string().optional(),
  author: z.string().min(1, "L'autore di copertina è obbligatorio"),
  version: z.string().min(1, "La versione è obbligatoria"),
  date: z.string().min(1, "La data di copertina è obbligatoria"),
  logo: z.string().optional(),
});

export const GuideOptionsSchema = z
  .object({
    include_toc: z.boolean().default(true),
    toc_title: z.string().default("Indice dei Contenuti"),
    chapter_page_break: z.boolean().default(true),
  })
  .default({});

export const GuideSectionSchema = z.object({
  title: z.string().min(1, "Il titolo della sezione/capitolo è obbligatorio"),
  description: z.string().optional(),
  fragments: z
    .array(
      z
        .string()
        .min(1)
        .regex(
          FRAGMENT_ID_REGEX,
          "L'id del frammento può contenere solo lettere, numeri e il carattere '-'"
        )
    )
    .min(1, "Ogni sezione deve includere almeno un frammento"),
});

export const GuideRecipeSchema = z.object({
  id: z.string().min(1, "L'id della guida è obbligatorio"),
  output_filename: z
    .string()
    .min(1)
    .regex(/\.pdf$/i, "Il campo 'output_filename' deve terminare con .pdf"),
  cover: GuideCoverSchema,
  options: GuideOptionsSchema,
  sections: z
    .array(GuideSectionSchema)
    .min(1, "La guida deve contenere almeno una sezione"),
});

export type GuideRecipe = z.infer<typeof GuideRecipeSchema>;
export type GuideSection = z.infer<typeof GuideSectionSchema>;
