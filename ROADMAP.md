# Sparkfeed public roadmap

## Product priorities

The order below is proposed, with OPML as the first delivery. Research on recommendations and team workflows can run alongside the smaller reader updates. Paid features and team concepts are still in planning.

### 1. Move RSS subscriptions with OPML

Import an OPML file into a workspace and export that workspace's subscriptions as OPML. Preserve feed URLs, names, and folder organization where Sparkfeed's folder model supports it. OPML carries subscriptions and folders. Article history, favorites, and reading state require separate export or backup.

- Check what the existing bulk-add flow supports. Decide where **Import OPML** and **Export OPML** belong.
- Decide how imports handle nested folders, repeated subscriptions, invalid entries, plan limits, and partial success. Show what was added or skipped.
- Verify a Sparkfeed export can be imported again without losing supported subscription data. Test representative files from other readers.
- After release, publish an SEO-focused Sparkfeed guide on what an OPML file is and how to move RSS feeds into and out of Sparkfeed. Use the shipped flow and screenshots. [Feeder’s OPML guide](https://feeder.co/knowledge-base/rss-basics/opml-file/)

### 2. Copy and download article images

Add **Copy image** and **Download image** controls to the top-right corner of each image rendered in the article body. Copy the image itself so it can be pasted into another app. Keep the controls usable by keyboard and on touch screens.

- Which reader views use the same image renderer?
- What should happen when the image host disallows browser access, the image fails to load, or the clipboard does not support its format?

### 3. Follow YouTube channels with video summaries

Let users add YouTube channels as sources in existing folders. Keep the existing feed-card layout. In the reader, use the playable video as the hero and show an article-style **Summary** and a **Transcript** tab below it. Explore adding a few important frames with links to their timestamps.

Treat video understanding as a potential reason to upgrade to Pro. First validate the YouTube Data API setup and quota requirements, what transcript and frame access is permitted for third-party uploads, and whether Gemini can produce accurate summaries grounded in the video.

- Should channel following be available separately from Pro video summaries and transcripts?
- What happens for a private, deleted, restricted, or captionless video?
- How should processing start, when should results be reused, and what usage limits and cost per video make sense?

### 4. Recommend relevant research inside a folder

Explore an optional, paid feature with a per-folder toggle. Place occasional recommendations between existing feed cards. Use the folder name, followed sources, and user preferences to find related topics, sources, and developments across the web and GitHub. For example, a folder following Railway could surface independently reported funding news, with a source link and a short explanation of why it appeared.

Review how SparkFrame's Explore discovers and ranks material. Use what fits Sparkfeed's ongoing research workflow. The recommendation feature is intended for paid plans. Exact tier and limits are open.

- How should Sparkfeed infer interests and let users correct them? In shared folders, should recommendations reflect the folder, the individual reader, or both?
- Which sources should the first version cover? How should it handle repeated coverage, stale results, and conflicting reports?
- How often should recommendations appear? What should users be able to save, dismiss, or use to tune future suggestions?
- What relevance, cost, and latency would justify shipping this as a paid feature?

### 5. Help teams work with what they read

Prioritize a workflow in which teammates can discuss a passage, follow up, and bring useful evidence into a shared document. The proposals below need validation and sequencing. [Reader research and integration priorities](specs/READER-OPPORTUNITIES-AND-INTEGRATIONS.md)

#### Highlights and comments

Start by exploring one highlighted passage per conversation. A teammate selects text, adds a comment, and can @mention someone in the workspace. An article can hold several conversations. A conversation card can match the highlight color. Teammates can reply and mark it resolved. Resolved conversations can drop out of the active view and remain available for reference.

- Is a Google Docs-style comment thread enough? When would a team need to group multiple highlights in one card?
- Should color be personal or shared? Who can resolve and reopen conversations, and which events should notify teammates?
- How should a highlight stay anchored when the article changes? Who can see conversations in personal and shared workspaces?

#### Shared working documents

Explore a team document that members can create for a topic or ongoing project. Open it in a right-side panel, like an artifact, so teammates can read an article and work on the document side by side. Documents can combine original text, lists, images, quotes, and saved highlights or conversation cards. Quotes should carry a linked source, with numbered references if that makes longer documents easier to read.

- What is the smallest document a team would use repeatedly? Which content types and citation formats belong in the first version?
- How should sharing, edit roles, concurrent edits, and source access work? What should someone see if they can open the document but lack access to the original article?
- What should we call these documents and conversation cards? Which other team workflows are worth testing, and which ideas can wait or be dropped?

## Public beta

- Verify first-user setup and invitation-only registration.
- Publish the one-file PostgreSQL Compose installation.
- Complete source, history, branch, dependency, and asset audits.
- Publish security, contribution, backup, trademark, and support policies.
- Tag `v0.1.0-beta.1` from a reviewed commit.

## Beta hardening

- Test upgrades and restoration across tagged releases.
- Stabilize REST and MCP contracts.
- Improve Spark AI and reader reliability while they remain beta.
- Expand Community deployment documentation from real installations.

## Hosted service

Sparkfeed Cloud is a separate workstream. Its billing, private operator control plane, and deployment schedule do not limit Community Edition capabilities.
