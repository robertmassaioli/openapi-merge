import { defineConfig } from 'vitepress';

// Served from GitHub Pages as a project site (no custom domain configured),
// so every asset and internal link must be rooted at /openapi-merge/, not /.
// `vitepress dev`/`preview` do honour this locally too (confirmed: both serve
// at http://localhost:<port>/openapi-merge/, not /) -- verified directly
// rather than assumed, after an earlier version of this comment claimed the
// opposite.
const base = '/openapi-merge/';

export default defineConfig({
  base,
  title: 'openapi-merge',
  description: 'Merge multiple OpenAPI 3.0, 3.1 and 3.2 documents into one, via a CLI tool or a TypeScript library.',
  lastUpdated: true,
  cleanUrls: true,

  head: [['link', { rel: 'icon', href: `${base}favicon.svg` }]],

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: 'Guide', link: '/guide/which-package' },
      { text: 'CLI Reference', link: '/cli/' },
      { text: 'Library Reference', link: '/library/' },
      // /api/index.html, not /api/: `vitepress dev`'s SPA history-fallback
      // intercepts a bare directory path before it reaches the static file in
      // public/api/, serving a blank app shell instead (`vitepress preview`
      // and the real GitHub Pages deploy both resolve /api/ correctly via a
      // real static-file server, so this only bites the dev server -- but the
      // explicit filename works identically in all three, so there's no
      // reason not to always use it).
      { text: 'API Reference', link: '/api/index.html', target: '_self' },
      { text: 'GitHub', link: 'https://github.com/robertmassaioli/openapi-merge' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Which package do I want?', link: '/guide/which-package' },
            { text: 'Quick start: CLI', link: '/guide/quick-start-cli' },
            { text: 'Quick start: library', link: '/guide/quick-start-library' },
            { text: 'Developing on openapi-merge', link: '/guide/development' },
          ],
        },
      ],
      '/cli/': [
        {
          text: 'CLI reference',
          items: [
            { text: 'Getting started', link: '/cli/' },
            { text: 'Configuration reference', link: '/cli/configuration' },
            { text: 'Command-line flags', link: '/cli/cli-flags' },
            { text: 'Formatting', link: '/cli/formatting' },
            { text: 'Cross-document $refs', link: '/cli/cross-document-refs' },
            { text: 'Security', link: '/cli/security' },
            { text: 'Exit codes', link: '/cli/exit-codes' },
            { text: 'OpenAPI version support', link: '/cli/openapi-versions' },
            { text: 'Examples', link: '/cli/examples' },
          ],
        },
      ],
      '/library/': [
        {
          text: 'Library reference',
          items: [
            { text: 'Getting started', link: '/library/' },
            { text: 'Merge options', link: '/library/merge-options' },
            { text: 'Per-input options', link: '/library/per-input-options' },
            { text: 'Merging behaviour', link: '/library/merging-behaviour' },
            { text: 'Examples', link: '/library/examples' },
            { text: 'Generated API reference', link: '/library/api-reference' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/robertmassaioli/openapi-merge' }],

    editLink: {
      pattern: 'https://github.com/robertmassaioli/openapi-merge/edit/main/packages/docs-site/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Robert Massaioli',
    },
  },
});
