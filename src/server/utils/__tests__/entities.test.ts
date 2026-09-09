import { describe, expect, it } from 'vitest'
import { decodeEntities } from '../entities'

/**
 * The Verge ships `&amp;#8217;` in its XML. The feed parser decodes that once, to
 * `&#8217;`, and stops — so every headline with an apostrophe rendered as
 * "Elon Musk&#8217;s attempt at an AI Wikipedia", in the app and in Discover.
 */
describe('decodeEntities', () => {
  it('decodes the double-encoded apostrophe that started this', () => {
    expect(decodeEntities('Elon Musk&#8217;s attempt')).toBe('Elon Musk’s attempt')
  })

  it('handles decimal, hex and named forms', () => {
    expect(decodeEntities('&#8212;')).toBe('—')
    expect(decodeEntities('&#x2019;')).toBe('’')
    expect(decodeEntities('AT&amp;T')).toBe('AT&T')
    expect(decodeEntities('&hellip;')).toBe('…')
  })

  it('leaves ordinary text untouched', () => {
    expect(decodeEntities('A normal headline')).toBe('A normal headline')
    expect(decodeEntities('')).toBe('')
  })

  // Feeds contain plenty of stray ampersands; mangling them would be worse than
  // leaving an entity undecoded.
  it('leaves an unknown or malformed entity alone', () => {
    expect(decodeEntities('R&D spending')).toBe('R&D spending')
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;')
    expect(decodeEntities('100 & 200')).toBe('100 & 200')
  })

  it('refuses code points that String.fromCodePoint would throw on', () => {
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;')
  })
})
