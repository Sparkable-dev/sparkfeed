import { z } from 'astro:content';
import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema({
			/**
			 * Fields the generated API Reference pages set. `docsSchema` rejects
			 * unknown frontmatter, so without this the generator's output fails
			 * the content build.
			 */
			extend: z.object({
				method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).optional(),
				path: z.string().optional(),
				operationId: z.string().optional(),
			}),
		}) }),
	// Used to reword a few built-in Starlight strings — see src/content/i18n/en.json.
	i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
