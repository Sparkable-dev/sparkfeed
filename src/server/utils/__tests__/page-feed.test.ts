import { describe, expect, it } from "vitest"
import { extractPageLinks, looksLikeListing, urlShape } from "../page-feed"

/**
 * Reading a blog index as a feed.
 *
 * Every case here is a real page shape that broke the previous extractor, kept
 * as the smallest markup that reproduces it. The old version matched
 * `article, .post, [class*="article"]` and took the first `<a>` in each hit,
 * which on the four sites checked returned 0, 2, 2 and 14 items against this
 * one's 9, 12, 13 and 9 — and where it did return something, the titles had the
 * category and the timestamp glued on.
 */

const page = (body: string, head = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

/** N cards of the shape most listing pages use: one anchor wrapping a heading. */
const cards = (slugs: Array<string>, section = "blog") =>
  slugs
    .map(
      (slug) =>
        `<div class="card"><a href="/${section}/${slug}"><h3>${slug.replace(/-/g, " ")}</h3></a></div>`,
    )
    .join("")

describe("urlShape", () => {
  it("reduces a post URL to its template", () => {
    expect(urlShape("/blog/top-10-payment-gateways")).toBe("/blog/*")
    expect(urlShape("/2026/05/hello-world")).toBe("/#/#/*")
    expect(urlShape("/")).toBe("/")
  })
})

describe("finding the post list", () => {
  it("reads a page of cards", () => {
    const links = extractPageLinks(
      page(cards(["first-post-here", "second-post-here", "third-post-here"])),
      "https://example.com/blog",
    )
    expect(links.map((l) => l.title)).toEqual([
      "first post here",
      "second post here",
      "third post here",
    ])
    expect(links[0].url).toBe("https://example.com/blog/first-post-here")
  })

  it("ignores the navigation, however tidy it is", () => {
    // The case that prompted this: emerline.com's header lists eight services
    // under a consistent `/services/<slug>` shape, out-numbering and
    // out-tidying the three posts below it.
    const nav = `<header><nav>${[
      "custom-software-development",
      "ai-development-company",
      "data-management-services",
      "startup-development-services",
      "microsoft-power-apps",
      "it-consulting-services",
    ]
      .map((s) => `<a href="/services/${s}">${s.replace(/-/g, " ")}</a>`)
      .join("")}</nav></header>`

    const links = extractPageLinks(
      page(nav + cards(["first-post-here", "second-post-here", "third-post-here"])),
      "https://example.com/blog",
    )
    expect(links).toHaveLength(3)
    expect(links.every((l) => l.url.includes("/blog/"))).toBe(true)
  })

  it("prefers the section the page itself is in", () => {
    // A sidebar of promos can outnumber the posts, and does.
    const promos = ["one-promo-here", "two-promo-here", "three-promo-here", "four-promo-here"]
      .map((s) => `<div><a href="/solutions/${s}"><h4>${s}</h4></a></div>`)
      .join("")

    const links = extractPageLinks(
      page(cards(["first-post-here", "second-post-here", "third-post-here"]) + promos),
      "https://example.com/blog",
    )
    expect(links.every((l) => l.url.includes("/blog/"))).toBe(true)
  })

  it("still finds posts kept somewhere other than the listing's own path", () => {
    // openai.com lists its posts at /index/<slug> from a page at /news/, so
    // matching the page's path cannot be a requirement.
    const links = extractPageLinks(
      page(cards(["first-post-here", "second-post-here", "third-post-here"], "index")),
      "https://example.com/news/",
    )
    expect(links).toHaveLength(3)
    expect(links[0].url).toContain("/index/")
  })

  it("leaves tag and author listings alone", () => {
    const tags = ["machine-learning", "web-development", "cloud-computing"]
      .map((s) => `<div><a href="/tag/${s}"><h4>${s}</h4></a></div>`)
      .join("")
    expect(extractPageLinks(page(tags), "https://example.com/blog")).toHaveLength(0)
  })

  it("does not mistake a pagination strip for posts", () => {
    const pages = [2, 3, 4, 5].map((n) => `<a href="/blog/${n}">${n}</a>`).join("")
    expect(extractPageLinks(page(pages), "https://example.com/blog")).toHaveLength(0)
  })
})

describe("what a page is allowed to become", () => {
  it("refuses a site's front page that only lists products", () => {
    // At the root there is no path to anchor to, so a tidy product menu is
    // indistinguishable from a post list except by section name.
    const products = [
      "custom-software-development",
      "ai-development-company",
      "data-management-services",
      "startup-development-services",
    ]
      .map((s) => `<div><a href="/services/${s}"><h3>${s}</h3></a></div>`)
      .join("")

    expect(extractPageLinks(page(products), "https://example.com/")).toHaveLength(0)
  })

  it("accepts a front page that lists actual writing", () => {
    const links = extractPageLinks(
      page(cards(["first-post-here", "second-post-here", "third-post-here"], "news")),
      "https://example.com/",
    )
    expect(links).toHaveLength(3)
  })

  it("says no to a single article", () => {
    expect(
      looksLikeListing(
        page("<article><h1>One post</h1><p>Some words.</p></article>"),
        "https://example.com/blog/one-post",
      ),
    ).toBe(false)
  })

  it("needs three posts before it is a listing", () => {
    expect(
      looksLikeListing(page(cards(["one-post-here", "two-post-here"])), "https://example.com/blog"),
    ).toBe(false)
  })
})

describe("titles", () => {
  it("takes the heading, not the whole card", () => {
    // Card layouts wrap the tile in one anchor, so the anchor's own text is the
    // headline with the category and the date glued to both ends.
    const html = page(
      `<div><a href="/blog/top-10-payment-gateways">
         <span>Fintech</span><span>Emerline Team</span><span>4 hours ago</span>
         <h3>Top 10 Payment Gateways for Businesses</h3>
       </a></div>` + cards(["second-post-here", "third-post-here"]),
    )
    const [first] = extractPageLinks(html, "https://example.com/blog")
    expect(first.title).toBe("Top 10 Payment Gateways for Businesses")
    expect(first.from).toBe("heading")
  })

  it("finds the headline in a card with no heading tag at all", () => {
    // OpenAI and Anthropic both mark headlines up as plain divs. The headline
    // is the longest standalone run of text; the others are a category and a
    // date.
    const tile = (slug: string, headline: string) =>
      `<div><a href="/blog/${slug}">
         <div>${headline}</div><div>Company</div><div>Aug 11, 2026</div>
       </a></div>`
    const html = page(
      tile("testing-ads-in-chatgpt", "Testing ads in ChatGPT") +
        tile("premium-seats-coming", "Premium seats are coming to Business") +
        tile("models-on-aws", "Daybreak models are now available on AWS"),
    )
    expect(extractPageLinks(html, "https://example.com/blog").map((l) => l.title)).toEqual([
      "Testing ads in ChatGPT",
      "Premium seats are coming to Business",
      "Daybreak models are now available on AWS",
    ])
  })

  it("picks the headline link over the thumbnail link to the same post", () => {
    // A card links its post two or three times. The old extractor took the
    // first, which is the image and carries no text.
    const html = page(
      ["first-post-here", "second-post-here", "third-post-here"]
        .map(
          (s) =>
            `<div><a href="/blog/${s}"><img alt=""></a><a href="/blog/${s}">A real headline for ${s}</a></div>`,
        )
        .join(""),
    )
    const links = extractPageLinks(html, "https://example.com/blog")
    expect(links).toHaveLength(3)
    expect(links[0].title).toContain("A real headline")
  })

  it("falls back to the slug rather than storing 'Read more'", () => {
    const html = page(
      ["top-10-payment-gateways", "second-post-here", "third-post-here"]
        .map((s) => `<div><a href="/blog/${s}">Read more</a></div>`)
        .join(""),
    )
    const [first] = extractPageLinks(html, "https://example.com/blog")
    expect(first.title).toBe("Top 10 payment gateways")
    expect(first.from).toBe("slug")
  })

  it("collapses whitespace so a headline is one line", () => {
    const html = page(
      `<div><a href="/blog/first-post-here"><h3>
          A headline
          split over lines
       </h3></a></div>` + cards(["second-post-here", "third-post-here"]),
    )
    expect(extractPageLinks(html, "https://example.com/blog")[0].title).toBe(
      "A headline split over lines",
    )
  })
})

describe("what the site declares about itself", () => {
  it("prefers JSON-LD, with its dates", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Blog",
      blogPost: [
        {
          "@type": "BlogPosting",
          url: "https://example.com/blog/one",
          headline: "Declared one",
          datePublished: "2026-05-11T00:00:00Z",
        },
        { "@type": "BlogPosting", url: "/blog/two", headline: "Declared two" },
        { "@type": "BlogPosting", url: "/blog/three", headline: "Declared three" },
      ],
    })
    const links = extractPageLinks(
      page(cards(["ignored-post-here"]), `<script type="application/ld+json">${ld}</script>`),
      "https://example.com/blog",
    )
    expect(links.map((l) => l.title)).toEqual(["Declared one", "Declared two", "Declared three"])
    expect(links[0].publishedAt).toBe("2026-05-11T00:00:00Z")
    // Relative URLs in JSON-LD resolve against the page.
    expect(links[1].url).toBe("https://example.com/blog/two")
  })

  it("does not turn the authors into articles", () => {
    // stripe.com/blog lists a Person node per author. Accepting "anything with
    // a url and a name" put "Christian DiCarlo" in the feed beside the posts.
    const ld = JSON.stringify([
      { "@type": "Person", url: "https://example.com/authors/ada", name: "Ada Lovelace" },
      { "@type": "Person", url: "https://example.com/authors/alan", name: "Alan Turing" },
      { "@type": "Organization", url: "https://example.com", name: "Example Inc" },
      { "@type": "BlogPosting", url: "/blog/one", headline: "A real post" },
    ])
    const links = extractPageLinks(
      page(cards(["first-post-here", "second-post-here", "third-post-here"]), `<script type="application/ld+json">${ld}</script>`),
      "https://example.com/blog",
    )
    expect(links.map((l) => l.title)).not.toContain("Ada Lovelace")
  })

  it("ignores unparseable JSON-LD instead of giving up on the page", () => {
    const links = extractPageLinks(
      page(
        cards(["first-post-here", "second-post-here", "third-post-here"]),
        `<script type="application/ld+json">{ not json </script>`,
      ),
      "https://example.com/blog",
    )
    expect(links).toHaveLength(3)
  })
})

describe("dates on the listing", () => {
  it("takes a machine-readable date from the card", () => {
    const html = page(
      ["first-post-here", "second-post-here", "third-post-here"]
        .map(
          (s) =>
            `<div><time datetime="2026-08-11T09:00:00Z">3 days ago</time><a href="/blog/${s}"><h3>${s}</h3></a></div>`,
        )
        .join(""),
    )
    expect(extractPageLinks(html, "https://example.com/blog")[0].publishedAt).toBe(
      "2026-08-11T09:00:00Z",
    )
  })

  it("reports no date rather than guessing at '3 days ago'", () => {
    const html = page(
      ["first-post-here", "second-post-here", "third-post-here"]
        .map((s) => `<div><span>3 days ago</span><a href="/blog/${s}"><h3>${s}</h3></a></div>`)
        .join(""),
    )
    expect(extractPageLinks(html, "https://example.com/blog")[0].publishedAt).toBeNull()
  })
})

describe("addresses", () => {
  it("keeps same-origin links only", () => {
    const html = page(
      cards(["first-post-here", "second-post-here", "third-post-here"]) +
        `<div><a href="https://other.example/blog/elsewhere-post"><h3>Elsewhere</h3></a></div>`,
    )
    const links = extractPageLinks(html, "https://example.com/blog")
    expect(links.every((l) => l.url.startsWith("https://example.com/"))).toBe(true)
  })

  it("collapses one post reached with different query strings", () => {
    const html = page(
      `<div><a href="/blog/first-post-here?ref=nav"><h3>First</h3></a></div>
       <div><a href="/blog/first-post-here"><h3>First</h3></a></div>` +
        cards(["second-post-here", "third-post-here"]),
    )
    const links = extractPageLinks(html, "https://example.com/blog")
    expect(links.filter((l) => l.url.includes("first-post-here"))).toHaveLength(1)
  })

  it("survives markup and addresses it cannot parse", () => {
    expect(extractPageLinks("<html", "not a url")).toEqual([])
    expect(extractPageLinks(page(`<a href="::::">x</a>`), "https://example.com/blog")).toEqual([])
  })
})
