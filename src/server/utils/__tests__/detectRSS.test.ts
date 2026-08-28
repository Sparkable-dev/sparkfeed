import { describe, expect, it } from 'vitest'
import { commonPathCandidates, linkTagCandidates } from '../detectRSS'

describe('linkTagCandidates', () => {
  it('resolves relative hrefs against the page URL', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/news/rss.xml">`
    expect(linkTagCandidates(html, 'https://openai.com/index/')).toEqual([
      'https://openai.com/news/rss.xml',
    ])
  })

  it('returns every advertised feed, not just the first', () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="/a.xml">
      <link rel="alternate" type="application/rss+xml" href="/b.xml">
    `
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ])
  })

  it('prefers rss over atom', () => {
    const html = `
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    `
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([
      'https://example.com/rss.xml',
      'https://example.com/atom.xml',
    ])
  })

  it('accepts link tags that omit rel, which many sites do', () => {
    const html = `<link type="application/rss+xml" href="/feed.xml">`
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([
      'https://example.com/feed.xml',
    ])
  })

  it('ignores non-alternate rels such as stylesheets', () => {
    const html = `
      <link rel="stylesheet" type="text/css" href="/app.css">
      <link rel="icon" href="/favicon.ico">
    `
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([])
  })

  it('ignores tags with no href', () => {
    const html = `<link rel="alternate" type="application/rss+xml">`
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([])
  })
})

describe('commonPathCandidates', () => {
  it('probes the origin', () => {
    const candidates = commonPathCandidates(new URL('https://example.com/'))
    expect(candidates).toContain('https://example.com/feed')
    expect(candidates).toContain('https://example.com/rss.xml')
  })

  it('also probes the directory the URL points at', () => {
    // The old implementation used new URL('/feed', target), which always
    // resolves to the origin, so a feed under a sub-path was never found.
    const candidates = commonPathCandidates(new URL('https://openai.com/news/'))
    expect(candidates).toContain('https://openai.com/news/rss.xml')
    expect(candidates).toContain('https://openai.com/rss.xml')
  })

  it('treats a file-like path as its containing directory', () => {
    const candidates = commonPathCandidates(new URL('https://example.com/blog/post-1'))
    expect(candidates).toContain('https://example.com/blog/feed')
  })
})

describe('linkTagCandidates: media type matching', () => {
  it('ignores favicons, whose type merely contains "xml"', () => {
    // Regression: `image/svg+xml`.includes('xml') made the favicon candidate #1.
    const html = `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
    expect(linkTagCandidates(html, 'https://openai.com/')).toEqual([])
  })

  it('still accepts generic xml feed types', () => {
    const html = `<link rel="alternate" type="text/xml" href="/rss.xml">`
    expect(linkTagCandidates(html, 'https://example.com/')).toEqual([
      'https://example.com/rss.xml',
    ])
  })
})
