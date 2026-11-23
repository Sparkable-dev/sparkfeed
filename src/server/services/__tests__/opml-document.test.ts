import { parseOpml } from "feedsmith"
import { describe, expect, it } from "vitest"
import {
  opmlSubscriptionKey,
  parseOpmlDocument,
  serializeOpmlDocument,
} from "../opml-document"
import { MAX_OPML_BYTES } from "@/lib/opml"

describe("OPML portability", () => {
  it("only matches URL variants that identify the same feed endpoint", () => {
    const url = "https://example.org/News?source=UPPER"
    expect(
      opmlSubscriptionKey("HTTPS://EXAMPLE.ORG:443/News?source=UPPER#reader")
    ).toBe(url)
    for (const other of [
      "https://example.org/news?source=UPPER",
      "https://example.org/News?source=upper",
      "https://example.org/News/?source=UPPER",
      "http://example.org/News?source=UPPER",
    ])
      expect(opmlSubscriptionKey(other)).not.toBe(url)
  })
  it("reads Feeder-style subscriptions and prefers the user-editable text attribute", () => {
    const result = parseOpmlDocument(`<?xml version="1.0" encoding="UTF-8"?>
      <opml version="2.0">
        <head><title>My feeds</title></head>
        <body>
          <outline text="News &amp; weather" title="News">
            <outline type="rss" text="My paper" title="The paper" xmlUrl="https://example.org/rss?x=A&amp;y=B" htmlUrl="https://example.org/"/>
            <outline text="Local">
              <outline type="ATOM" title="City updates" xmlUrl="https://city.example.org/updates.xml"/>
            </outline>
          </outline>
          <outline text="Blank folder"/>
          <outline type="rss" text="Root feed" xmlUrl="https://example.net/rss.xml"/>
        </body>
      </opml>`)

    expect(result.feeds).toEqual([
      {
        name: "My paper",
        url: "https://example.org/rss?x=A&y=B",
        folder: "News & weather",
      },
      {
        name: "City updates",
        url: "https://city.example.org/updates.xml",
        folder: "News & weather / Local",
      },
      { name: "Root feed", url: "https://example.net/rss.xml", folder: null },
    ])
    expect(result.emptyFolders).toEqual(new Set(["Blank folder"]))
    expect(result.skipped).toEqual([])
  })

  it("reads legacy untyped outlines and reports bad entries alongside valid feeds", () => {
    const result = parseOpmlDocument(`<opml version="1.1"><head/><body>
        <outline xmlUrl="https://example.org/RSS"/>
        <outline type="rss" text="Missing URL" htmlUrl="https://example.org/"/>
        <outline type="rss" text="Invalid URL" xmlUrl="file:///somewhere"/>
        <outline type="rss" text="Credentialed" xmlUrl="https://user:pass@example.org/rss"/>
        <outline type="include" text="External list" url="https://example.org/feeds.opml"/>
        <outline text="Disabled" isComment="true">
          <outline type="rss" xmlUrl="https://example.org/inactive"/>
        </outline>
      </body></opml>`)

    expect(result.feeds).toEqual([
      { name: "example.org", url: "https://example.org/RSS", folder: null },
    ])
    expect(result.skipped).toEqual([
      { name: "Missing URL", reason: "Missing or invalid feed URL" },
      { name: "Invalid URL", reason: "Missing or invalid feed URL" },
      { name: "Credentialed", reason: "Missing or invalid feed URL" },
      { name: "External list", reason: "Linked outline" },
      { name: "Disabled", reason: "Commented outline" },
    ])
  })

  it.each([
    ["<opml><body><outline/></opml>", "malformed XML"],
    ["<html><body/></html>", "Choose an OPML subscription file"],
    ["<opml><head/></opml>", "missing its body"],
    ["<opml><body/><body/></opml>", "more than one body"],
    [
      '<!DOCTYPE opml [<!ENTITY feed SYSTEM "file:///example">]><opml><body/></opml>',
      "document type declaration",
    ],
    ['<opml><body><outline text="&unknown;"/></body></opml>', "malformed XML"],
  ])("rejects malformed or unsupported XML %#", (xml, message) => {
    expect(() => parseOpmlDocument(xml)).toThrow(message)
  })

  it("enforces the byte limit before parsing", () => {
    expect(() =>
      parseOpmlDocument("界".repeat(Math.floor(MAX_OPML_BYTES / 3) + 1))
    ).toThrow("up to 5 MB")
  })

  it("produces an interoperable OPML 2.0 export and round-trips escaped values", () => {
    const name = `Custom <News> "Å" & 雨\t\r\n`
    const url = "https://example.org/RSS?name=A%20B&extra=1"
    const folders = [
      { id: "one", name: "Tech & media / Local" },
      { id: "two", name: "Empty" },
    ]
    const xml = serializeOpmlDocument(folders, [
      { name, url, folderId: "one" },
      { name: "Unfiled", url: "https://example.net/feed", folderId: null },
    ])

    expect(xml).toContain('<opml version="2.0">')
    expect(parseOpml(xml).body?.outlines).toMatchObject([
      {
        text: "Tech & media / Local",
        outlines: [{ type: "rss", xmlUrl: url }],
      },
      { text: "Empty" },
      { text: "Unfiled", xmlUrl: "https://example.net/feed" },
    ])
    expect(parseOpmlDocument(xml)).toEqual({
      feeds: [
        { name, url, folder: "Tech & media / Local" },
        { name: "Unfiled", url: "https://example.net/feed", folder: null },
      ],
      emptyFolders: new Set(["Empty"]),
      hasFolders: true,
      skipped: [],
    })
  })
})
