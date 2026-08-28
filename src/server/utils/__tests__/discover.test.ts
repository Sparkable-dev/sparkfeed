import { describe, expect, it } from 'vitest'
import {

  feedIdentity,
  feedLinksInHtml,
  sectionCandidates,
  sectionsInHtml
} from '../discover'
import { feedSignals } from '../feed-signals'
import type {DiscoveredFeed} from '../discover';

/**
 * Signals are built the real way rather than stubbed, because `feedIdentity`
 * now reads `signals.identity` — a hand-written object would let the two drift
 * apart and the identity tests below would stop testing anything.
 */
const feed = (over: Partial<DiscoveredFeed> = {}): DiscoveredFeed => {
  const base = {
    url: 'https://example.com/feed',
    title: 'Example' as string | null,
    itemCount: 10,
    sampleTitles: ['First post'],
    kind: 'section' as const,
    section: null,
    ...over,
  }
  return {
    ...base,
    signals: feedSignals({
      requestedUrl: base.url,
      finalUrl: base.url,
      feed: { title: base.title, items: base.sampleTitles.map((title) => ({ title })) },
    }),
  }
}

describe('sectionCandidates', () => {
  // Each expectation below matches a feed URL confirmed live during research.
  it('prefixes the section for a bare directory anchor (Ars Technica shape)', () => {
    const c = sectionCandidates('https://arstechnica.com/feed/', 'science')
    expect(c).toContain('https://arstechnica.com/science/feed/')
  })

  it('inserts before the filename for a nested anchor (The Verge shape)', () => {
    const c = sectionCandidates('https://www.theverge.com/rss/index.xml', 'tech')
    expect(c).toContain('https://www.theverge.com/rss/tech/index.xml')
  })

  it('swaps the first segment for a section-scoped anchor (OpenAI shape)', () => {
    const c = sectionCandidates('https://openai.com/news/rss.xml', 'research')
    expect(c).toContain('https://openai.com/research/rss.xml')
  })

  it('never repeats a candidate', () => {
    const c = sectionCandidates('https://example.com/feed/', 'blog')
    expect(new Set(c).size).toBe(c.length)
  })

  it('returns nothing for an unparseable anchor', () => {
    expect(sectionCandidates('not a url', 'blog')).toEqual([])
  })
})

describe('feedIdentity', () => {
  it('treats the same feed served at two paths as one', () => {
    // Sites routinely serve one feed from /feed, /rss and /rss.xml; deduping by
    // URL alone would show it three times.
    const a = feed({ url: 'https://example.com/feed' })
    const b = feed({ url: 'https://example.com/rss.xml' })
    expect(feedIdentity(a)).toBe(feedIdentity(b))
  })

  it('separates genuinely different section feeds', () => {
    const tech = feed({ title: 'Tech | The Verge', sampleTitles: ['A chip story'] })
    const games = feed({ title: 'Gaming | The Verge', sampleTitles: ['A game story'] })
    expect(feedIdentity(tech)).not.toBe(feedIdentity(games))
  })

  it('is case-insensitive and survives missing fields', () => {
    expect(feedIdentity(feed({ title: 'EXAMPLE' }))).toBe(feedIdentity(feed({ title: 'example' })))
    expect(() => feedIdentity(feed({ title: null, sampleTitles: [] }))).not.toThrow()
  })
})

describe('sectionsInHtml', () => {
  const origin = 'https://arstechnica.com'

  it('ranks sections by how often the nav links them', () => {
    const html = `
      <a href="/science/">Science</a><a href="/science/x">More</a><a href="/science/y">More</a>
      <a href="/gadgets/">Gadgets</a>
    `
    expect(sectionsInHtml(html, origin)[0]).toBe('science')
  })

  it('ignores other origins', () => {
    const html = `<a href="https://twitter.com/arstechnica">Twitter</a>`
    expect(sectionsInHtml(html, origin)).toEqual([])
  })

  it('drops boilerplate that is never a content section', () => {
    const html = `
      <a href="/privacy">Privacy</a><a href="/careers">Careers</a>
      <a href="/login">Login</a><a href="/pricing">Pricing</a>
    `
    expect(sectionsInHtml(html, origin)).toEqual([])
  })

  it('drops filenames and numeric ids', () => {
    const html = `<a href="/favicon.ico">i</a><a href="/2024/">y</a>`
    expect(sectionsInHtml(html, origin)).toEqual([])
  })
})

describe('feedLinksInHtml', () => {
  it('finds body links to feeds, which is how a bare openai.com resolves', () => {
    // openai.com advertises no feed in <head>; it links one in the page.
    const html = `<a href="/news/rss.xml">RSS</a>`
    expect(feedLinksInHtml(html, 'https://openai.com/')).toEqual([
      'https://openai.com/news/rss.xml',
    ])
  })

  it('accepts the usual shapes and rejects ordinary links', () => {
    const html = `
      <a href="/feed">a</a><a href="/blog/atom.xml">b</a>
      <a href="/about">no</a><a href="/feedback">no</a>
    `
    const out = feedLinksInHtml(html, 'https://example.com/')
    expect(out).toContain('https://example.com/feed')
    expect(out).toContain('https://example.com/blog/atom.xml')
    expect(out).not.toContain('https://example.com/about')
    expect(out).not.toContain('https://example.com/feedback')
  })
})
