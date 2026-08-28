import { describe, expect, it } from 'vitest'
import { htmlToMarkdown, htmlToPlainText } from '../markdown'

describe('htmlToPlainText', () => {
  // The regression this file exists for: parsing a bare fragment leaves
  // document.body null in linkedom, so this returned "" for every input and
  // every search snippet came back empty without erroring.
  it('extracts text from a bare fragment', () => {
    expect(htmlToPlainText('See how it works.')).toBe('See how it works.')
    expect(htmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  it('collapses whitespace', () => {
    expect(htmlToPlainText('<p>a\n\n   b</p>')).toBe('a b')
  })

  it('returns empty for empty input rather than throwing', () => {
    expect(htmlToPlainText('')).toBe('')
    expect(htmlToPlainText('   ')).toBe('')
  })

  it('survives malformed markup', () => {
    expect(htmlToPlainText('<p>unclosed <b>bold')).toContain('unclosed')
  })
})

describe('htmlToMarkdown', () => {
  it('converts headings, links and paragraphs', () => {
    const md = htmlToMarkdown('<h2>Title</h2><p>See <a href="https://x.test">this</a>.</p>')
    expect(md).toContain('## Title')
    expect(md).toContain('[this](https://x.test)')
  })

  it('drops images, which cost tokens and carry nothing for a text model', () => {
    const md = htmlToMarkdown('<p>Before<img src="https://x.test/a.png" alt="pixel">After</p>')
    expect(md).not.toContain('x.test/a.png')
    expect(md).toContain('Before')
  })

  it('renders unordered and ordered lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
    expect(htmlToMarkdown('<ol><li>one</li><li>two</li></ol>')).toBe('1. one\n2. two')
  })

  it('indents nested lists', () => {
    const md = htmlToMarkdown('<ul><li>outer<ul><li>inner</li></ul></li></ul>')
    expect(md).toContain('- outer')
    expect(md).toMatch(/\n\s{2,}- inner/)
  })

  it('fences code blocks and keeps the language', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const a = 1</code></pre>')
    expect(md).toBe('```ts\nconst a = 1\n```')
  })

  it('preserves whitespace inside pre', () => {
    const md = htmlToMarkdown('<pre><code>a\n  indented</code></pre>')
    expect(md).toContain('\n  indented')
  })

  it('handles inline code containing a backtick', () => {
    expect(htmlToMarkdown('<p>Use <code>a`b</code></p>')).toContain('``a`b``')
  })

  it('converts emphasis', () => {
    expect(htmlToMarkdown('<p><strong>b</strong> and <em>i</em></p>')).toBe('**b** and *i*')
  })

  it('quotes blockquotes', () => {
    expect(htmlToMarkdown('<blockquote><p>quoted</p></blockquote>')).toBe('> quoted')
  })

  it('keeps link text but drops in-page anchors', () => {
    expect(htmlToMarkdown('<p><a href="#top">Top</a></p>')).toBe('Top')
    expect(htmlToMarkdown('<p><a>bare</a></p>')).toBe('bare')
  })

  it('renders a GFM table', () => {
    const md = htmlToMarkdown('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(md).toContain('| A | B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('collapses runs of blank lines', () => {
    expect(htmlToMarkdown('<p>a</p><div></div><div></div><p>b</p>')).toBe('a\n\nb')
  })

  it('strips scripts and styles', () => {
    const md = htmlToMarkdown('<p>keep</p><script>alert(1)</script><style>.x{}</style>')
    expect(md).toBe('keep')
    expect(md).not.toContain('alert')
  })

  it('returns empty for empty input', () => {
    expect(htmlToMarkdown('')).toBe('')
    expect(htmlToMarkdown('   ')).toBe('')
  })

  it('survives malformed markup rather than throwing', () => {
    expect(() => htmlToMarkdown('<p>unclosed <strong>bold')).not.toThrow()
    expect(htmlToMarkdown('<p>unclosed <strong>bold')).toContain('unclosed')
  })
})
