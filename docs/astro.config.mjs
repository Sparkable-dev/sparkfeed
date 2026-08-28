// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
	// Served as a subdirectory of the marketing site: https://sparkfeed.dev/docs
	// (better SEO than a docs subdomain — link equity consolidates on the apex).
	site: 'https://sparkfeed.dev',
	// The /api/ prefix moved to /internals/ when the generated API Reference
	// took the name. These URLs are public, so the old ones must keep working.
	// Destinations carry the /docs base explicitly. Astro prefixes the *source*
	// with `base` when matching but emits the destination verbatim, so a bare
	// '/internals/...' here 301s off the docs site entirely.
	redirects: {
		'/api/feed-fetching': '/docs/internals/feed-fetching',
		'/api/parsing-xml': '/docs/internals/parsing-xml',
		'/api/storage-flow': '/docs/internals/storage-flow',
	},
	base: '/docs',
	markdown: {
		// Load-bearing, despite `markdown.gfm` defaulting to true: under Astro 6 +
		// @astrojs/mdx that default does not reach .mdx files, and removing this
		// makes every GFM table on the site render as raw `| pipe | text |`.
		// Verified by building without it — `grep -c '<table'` returns 0.
		remarkPlugins: [remarkGfm],
	},
	vite: {
		preview: {
			allowedHosts: true,
		},
	},
	integrations: [
		starlight({
			title: 'Sparkfeed',
			description: 'Self-hosted RSS aggregator and any-site-to-RSS crawler. Workspaces, sharing, and built-in AI.',
			// No `logo`: it is only consumed by Starlight's SiteTitle, which is only
			// rendered by Starlight's own Header — and `components.Header` below
			// replaces that entirely. The brand mark is inlined in Sidebar.astro.
			head: [
				{
					// Applies the stored sidebar collapse state before first paint so the
					// layout never flashes open then snaps shut.
					tag: 'script',
					content: `
						(function () {
							try {
								if (localStorage.getItem('sf-sidebar') === 'collapsed') {
									document.documentElement.dataset.sidebar = 'collapsed';
								}
							} catch (e) {}
						})();
					`,
				},
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Sparkable-dev/sparkfeed-app' },
				{ icon: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/company/sparkable-dev/' },
			],
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
			},
			// Order matters — these are emitted as plain imports in source order, so
			// later files win ties. None of them are wrapped in `@layer`: Starlight
			// puts all of its own CSS inside `@layer starlight.*`, and unlayered CSS
			// beats every layer regardless of specificity. That is what lets these
			// files style third-party markup without a single `!important`.
			customCss: [
				'./src/styles/tokens.css',
				'./src/styles/base.css',
				'./src/styles/layout.css',
				'./src/styles/content.css',
				'./src/styles/components.css',
				// Page-scoped: every selector is anchored to a `.sf-` class that only
				// the landing components emit, so it cannot reach the article pages.
				'./src/styles/landing.css',
			],
			components: {
				Footer: './src/components/Footer.astro',
				Sidebar: './src/components/Sidebar.astro',
				Header: './src/components/Header.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
				PageTitle: './src/components/PageTitle.astro',
				PageSidebar: './src/components/PageSidebar.astro',
				// Splash-page hero. Also renders on Starlight's built-in 404, which
				// the component branches on — see the note at the top of the file.
				Hero: './src/components/Hero.astro',
			},
			// Powers the "Edit this page on GitHub" action in the right rail
			// (src/components/PageSidebar.astro). Starlight appends `entry.filePath`
			// (e.g. src/content/docs/…) to this base.
			editLink: {
				baseUrl: 'https://github.com/Sparkable-dev/sparkfeed-app/edit/main/docs/',
			},
			// Code-block chrome is configured here, not patched in CSS. The previous
			// approach hid the frame header from the stylesheet, which for untitled
			// terminal blocks (```bash) also stripped the top border and squared the
			// top corners, because plugin-frames drops those itself for `.is-terminal`.
			//
			// `useStarlightUiThemeColors` is pinned off deliberately. It defaults to
			// `themes === undefined`, and when on, Starlight writes its own
			// `theme.styleOverrides.frames` — which the engine applies AFTER the
			// `styleOverrides` below, silently winning. Setting `themes` already
			// disables it; stating it stops that from changing by accident.
			//
			// Colour values are `[dark, light]` tuples, the supported per-theme form.
			expressiveCode: {
				themes: ['github-dark', 'github-light'],
				useStarlightUiThemeColors: false,

				// The docs use ```env for .env samples, which is not a Shiki language —
				// every one of those blocks was silently falling back to plain text and
				// emitting a build warning. Shiki ships the grammar as `dotenv`.
				shiki: {
					langAlias: { env: 'dotenv' },
				},

				frames: {
					// Don't promote a leading `// src/foo.ts` comment into a tab title.
					extractFileNameFromCode: false,
					// Our shell blocks use comments as instructions; keep them when copied.
					removeCommentsWhenCopyingTerminalFrames: false,
				},

				// Render shell blocks as ordinary code frames instead of terminal windows.
				//
				// This is the whole fix for the "empty bar above every bash block". EC's
				// base rule is `.frame .header { display: none }` — only `.has-title` and
				// `.is-terminal` re-show it. So an untitled *code* frame already has no
				// header, correct borders and correct copy-button spacing, while an
				// untitled *terminal* frame always renders a titlebar. Once the macOS
				// dots are gone that titlebar carries no information, and hiding it in
				// CSS (the previous approach) also strips the frame's top border and
				// squares its top corners, because plugin-frames drops those itself for
				// `.is-terminal`.
				//
				// Result: one consistent chrome for every code block on the site.
				defaultProps: {
					overridesByLang: {
						'ansi,bash,bat,batch,cmd,console,nu,nushell,powershell,ps,ps1,sh,shell,shellscript,shellsession,zsh':
							{ frame: 'code' },
					},
				},

				styleOverrides: {
					// Hex equivalents of the OKLCH tokens in src/styles/tokens.css — EC
					// resolves these at build time and cannot read CSS variables for
					// values it parses as colours. Keep them in sync with the surface
					// and border tokens.
					borderRadius: '0.5rem', // matches --sf-radius-md
					borderWidth: '1px',
					borderColor: ['#2e2e35', '#e5e5e9'],
					codeBackground: ['#151518', '#fafafa'],
					codePaddingBlock: '0.875rem',
					codePaddingInline: '1rem',
					codeFontFamily: 'var(--sl-font-mono)',
					codeFontSize: '0.8125rem',
					codeLineHeight: '1.65',
					uiFontFamily: 'var(--sl-font)',
					uiFontSize: '0.75rem',
					uiPaddingBlock: '0.4rem',
					uiPaddingInline: '1rem',
					scrollbarThumbColor: ['#ffffff1f', '#0000001f'],
					scrollbarThumbHoverColor: ['#ffffff33', '#00000033'],

					frames: {
						frameBoxShadowCssValue: 'none',

						// Terminal windows (```bash / ```sh / ```powershell).
						//
						// The titlebar is NOT hidden — plugin-frames drops the top border
						// and squares the top corners for `.is-terminal`, so hiding it
						// (what the old CSS hack did) leaves a visibly broken frame. It is
						// instead made seamless: dots removed at source, background matched
						// to the code area, and no bottom rule. The result reads as extra
						// top padding on the block rather than as an empty window bar.
						terminalTitlebarDotsForeground: 'transparent',
						terminalTitlebarDotsOpacity: '0',
						// Terminal frames carry their own code background, separate from
						// `codeBackground`. Left alone they keep the github theme's value
						// and a ```bash block ends up a different colour from a ```ts one.
						terminalBackground: ['#151518', '#fafafa'],
						terminalTitlebarBackground: ['#151518', '#fafafa'],
						terminalTitlebarForeground: ['#8b8b96', '#63636e'],
						terminalTitlebarBorderBottomColor: 'transparent',

						// Editor tabs (```ts title="src/foo.ts")
						editorBackground: ['#151518', '#fafafa'],
						editorTabBarBackground: ['#111114', '#f4f4f6'],
						editorTabBarBorderColor: ['#2e2e35', '#e5e5e9'],
						editorTabBarBorderBottomColor: ['#2e2e35', '#e5e5e9'],
						editorActiveTabBackground: ['#151518', '#fafafa'],
						editorActiveTabForeground: ['#fafafa', '#09090b'],
						editorActiveTabBorderColor: 'transparent',
						editorActiveTabIndicatorTopColor: 'transparent',
						editorActiveTabIndicatorBottomColor: 'transparent',
						editorActiveTabIndicatorHeight: '0px',
						editorTabBorderRadius: '0.375rem', // matches --sf-radius-sm

						// Copy button. Hover-revealed on pointer devices and always visible
						// on touch — that is the plugin's own behaviour and it is correct;
						// only the colours are set, so it stays legible in light mode
						// instead of inheriting github-dark's foreground.
						inlineButtonForeground: ['#c3c3cb', '#52525b'],
						inlineButtonBackground: ['#ffffff', '#000000'],
						inlineButtonBorder: ['#ffffff', '#000000'],
						inlineButtonBorderOpacity: '0.14',
						inlineButtonBackgroundIdleOpacity: '0',
						inlineButtonBackgroundHoverOrFocusOpacity: '0.1',
						inlineButtonBackgroundActiveOpacity: '0.16',

						// "Copied!" tooltip
						tooltipSuccessBackground: ['#fafafa', '#09090b'],
						tooltipSuccessForeground: ['#09090b', '#ffffff'],
					},
				},
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'What is SparkFeed?', slug: 'getting-started/what-is-sparkfeed' },
						{ label: 'Why SparkFeed?', slug: 'getting-started/why-sparkfeed' },
						{ label: 'Features Overview', slug: 'getting-started/features-overview' },
					],
				},
				{
					label: 'Installation',
					items: [
						{ label: 'Prerequisites', slug: 'installation/prerequisites' },
						{ label: 'Local Setup', slug: 'installation/local-setup' },
						{ label: 'Run the Project', slug: 'installation/run-the-project' },
						{ label: 'Build & Deploy', slug: 'installation/build-and-deploy' },
						{ label: 'Try Demo Mode', slug: 'installation/demo-mode' },
					],
				},
				{
					label: 'Configuration',
					items: [
						{ label: 'AI Providers', slug: 'configuration/ai-providers' },
						{ label: 'Environment Variables', slug: 'configuration/environment-variables' },
					],
				},
				{
					label: 'Core Concepts',
					items: [
						{ label: 'How RSS Works', slug: 'core-concepts/how-rss-works' },
						{ label: 'Feed Aggregation', slug: 'core-concepts/feed-aggregation' },
						{ label: 'Application Database', slug: 'core-concepts/local-database' },
						{ label: 'Folder & Feed Management', slug: 'core-concepts/folder-and-feed-management' },
					],
				},
				{
					label: 'Features',
					items: [
						{ label: 'Minimal UI & UX', slug: 'features/minimal-ui' },
						{ label: 'Offline Reading', slug: 'features/offline-reading' },
						{ label: 'Favorites System', slug: 'features/favorites-system' },
						{ label: 'Responsive Design', slug: 'features/responsive-design' },
					],
				},
				{
					label: 'Spark AI',
					// `configuration/ai-providers` deliberately does NOT appear here as
					// well. It is listed under Configuration, matching its slug. A page
					// listed twice breaks three things: Breadcrumbs.astro takes the first
					// matching trail (so the crumb would read "Spark AI" on a
					// /configuration/… URL), getPrevNextLinks locates the current page by
					// first match (making prev/next arbitrary), and `aria-current` gets
					// applied to two rows at once.
					items: [
						{ label: 'Content Summarization', slug: 'ai-features/content-summarization' },
						{ label: 'Social Media Generation', slug: 'ai-features/social-media-generation' },
						{ label: 'Trend Detection', slug: 'ai-features/trend-detection' },
						{ label: 'Smart Categorization', slug: 'ai-features/smart-categorization' },
					],
				},
				{
					label: 'Advanced Usage',
					items: [
						{ label: 'Custom Feeds', slug: 'advanced/custom-feeds' },
						{ label: 'Export & Backup', slug: 'advanced/export-and-backup' },
						{ label: 'Performance Optimization', slug: 'advanced/performance-optimization' },
					],
				},
				{
					label: 'Developer',
					items: [
						{ label: 'MCP Server', slug: 'developer/mcp' },
						{ label: 'API Keys', slug: 'developer/api-keys' },
						{ label: 'Webhooks', slug: 'developer/webhooks' },
					],
				},
				{
					label: 'Troubleshooting',
					items: [
						{ label: 'Database & Migrations', slug: 'troubleshooting/database-and-migrations' },
						{ label: 'Deployment Issues', slug: 'troubleshooting/deployment' },
					],
				},
				{
					label: 'Tech Stack',
					items: [
						{ label: 'Frontend (React + Tailwind)', slug: 'tech-stack/frontend' },
						{ label: 'Backend (Nitro)', slug: 'tech-stack/backend' },
						{ label: 'Database (PostgreSQL + Drizzle)', slug: 'tech-stack/database' },
						{ label: 'State Management (Zustand)', slug: 'tech-stack/state-management' },
					],
				},
				{
					label: 'Internals',
					collapsed: true,
					items: [
						{ label: 'Feed Fetching Logic', slug: 'internals/feed-fetching' },
						{ label: 'Parsing XML', slug: 'internals/parsing-xml' },
						{ label: 'Storage Flow', slug: 'internals/storage-flow' },
					],
				},

				/*
					API Reference — a second mode, not another group.

					`Sidebar.astro` splits this list in two on every render: pages
					under /api-reference render with the API sidebar, everything else
					with the prose sidebar. Both trees live here because Starlight
					needs one config, and because Breadcrumbs and prev/next are both
					derived from it.

					The endpoint pages are GENERATED from /api/v1/openapi.json by
					`scripts/generate-api-reference.ts` before each build, so this
					list is the one place their order is decided. Adding a tool to the
					registry adds a page; adding it here puts it in the nav.
				*/
				{
					label: 'API Reference',
					items: [
						{ label: 'Overview', slug: 'api-reference/overview' },
						{ label: 'Authentication', slug: 'api-reference/authentication' },
						{ label: 'Rate Limits', slug: 'api-reference/rate-limits' },
						{ label: 'Errors', slug: 'api-reference/errors' },
					],
				},
				{
					label: 'Workspace',
					items: [{ label: '/workspace', slug: 'api-reference/workspace/get' }],
				},
				{
					label: 'Folders',
					items: [
						{ label: '/folders', slug: 'api-reference/folders/get' },
						{ label: '/folders', slug: 'api-reference/folders/post' },
					],
				},
				{
					label: 'Feeds',
					items: [
						{ label: '/feeds', slug: 'api-reference/feeds/get' },
						{ label: '/feeds', slug: 'api-reference/feeds/post' },
						{ label: '/feeds/{feed_id}', slug: 'api-reference/feeds-feed_id/patch' },
					],
				},
				{
					label: 'Articles',
					items: [
						{ label: '/articles', slug: 'api-reference/articles/get' },
						{ label: '/articles/{id}', slug: 'api-reference/articles-id/get' },
						{ label: '/articles/read', slug: 'api-reference/articles-read/post' },
						{ label: '/articles/favorite', slug: 'api-reference/articles-favorite/post' },
					],
				},
				{
					label: 'Discover',
					items: [{ label: '/discover', slug: 'api-reference/discover/get' }],
				},
			],
		}),
	],
});
