# Sparkfeed reader opportunities, research, and integration priorities

Date: 2026-09-15  
Status: Research synthesis and proposed priorities. Not an approved implementation plan.  
Scope: Consolidation of the recent product discussions about the reader's right-side actions, team workflows, AI workflows, positioning, and integrations.

## Executive recommendation

Build a connected workflow around reading, saving useful evidence, and using that evidence elsewhere:

**Read → highlight → collect → export to a person, team, or agent.**

The recommended first delivery is Copy as Markdown. Follow it with text highlights, personal notes, and attributed evidence saving. Validate shared team briefs before building a large collaboration system. Improve saved-content reliability alongside these features because every quotation, export, and agent answer depends on the source material being available and complete.

For integrations, prioritize Obsidian-friendly Markdown export and Notion. Research collections suitable for NotebookLM and AI agents come next. Slack is more useful once there is a brief or an annotated passage worth sharing. Zotero is compelling for academic users, but that audience choice needs validation.

Keep the reader quiet. A capability does not automatically need a permanent icon. The proposed initial right rail contains Copy Markdown, Save evidence, and either Add to brief or Send to, depending on which workflow ships first.

## How to read this document

This document preserves the substance of the research conversations, including proposals that were later refined. It distinguishes four kinds of information:

| Type | Meaning |
| --- | --- |
| User preference | A direction the user explicitly expressed in the discussion. |
| Research evidence | A request, complaint, workflow, or product capability found in a linked source. |
| Product hypothesis | Our interpretation of an opportunity, not a proven market gap. |
| Recommendation | A proposed priority, scope, or design decision. It still needs implementation planning and approval. |

Source IDs such as [R01](#r01) refer to the source register at the end. Every register entry includes its original URL and the specific finding used.

### Evidence limitations

- Research used public Reddit discussions, community forums, and official product documentation. It was qualitative discovery, not a representative survey or a systematic market census.
- RSS, Readwise, and Obsidian communities overrepresent enthusiastic readers, researchers, and note-taking users. Their preferences may differ from casual readers or small business teams.
- Some threads are older. Historical complaints establish that a problem existed, not that a competing product still has that problem today.
- Some evidence came from search-returned excerpts. Direct opening of the Notion team discussion and one Notion integration discussion timed out. These sources should be rechecked before quoting them publicly.
- Builder posts and product announcements can reveal workflows, but are weaker evidence of independent customer demand. They are identified where material.
- Several requests appear in the same monthly feature-request threads. They are not independent surveys and must not be counted as separate market samples.
- Scores are judgment calls. There are no verified market-wide request counts, adoption rates, revenue estimates, or willingness-to-pay estimates in this document.
- No claim that a feature is unique should be inferred from this research. The competitor checks already showed substantial overlap.
- Links and competitor behavior reflect research discussed on September 14–15, 2026. This consolidation did not repeat every live source check.

## User intent and product boundaries

The user likes the current clean reader appearance and wants the right side to be equally minimal. Copy as Markdown is the clearest immediate feature request. The user also wants useful capabilities for agents, teams, and a third audience, with at least one strong team feature.

The first four proposed directions were Copy Markdown, Save evidence, Discuss with team, and Follow this story. The user expressed interest in those and in some of the later proposals. That interest is not approval to implement every item.

The research stages were explicitly read-only. This document records opportunities rather than changing the application. New native integrations, automation events, team briefs, and research workflows must not be marketed as already available. Existing API and MCP functionality should be audited before extending it to avoid duplicate systems.

Earlier reliability discussions provide an important dependency: content can be incomplete, images can fail, and publishers can block extraction or embedding. A new export or AI feature must not silently present a partial article as a complete source. The detailed extraction and Live-mode implementation history is outside this document's scope.

## Proposed positioning

Recommended audience statement:

> An RSS reader for researchers, teams, and AI agents.

Proposed supporting promise:

> Read your sources. Build shared knowledge. Give your agents better context.

“Researchers” can include developers evaluating tools, founders tracking markets, writers gathering references, and academic researchers. It fits evidence, notes, source comparison, and briefs. It does not require positioning the whole product as academic software.

| Candidate third audience | Strength | Concern | Recommendation |
| --- | --- | --- | --- |
| Researchers | Concrete connection to sources, evidence, and ongoing questions | Could sound academic without examples | Preferred working term |
| Knowledge workers | Broad coverage of professional users | Vague and difficult to picture | Avoid as the main headline |
| Developers | Good fit for Markdown, code, open-source tools, and agents | Narrows the audience considerably | Useful segment to validate, not the only audience |
| Writers and creators | Clear need to collect and cite material | Less directly connected to all team workflows | Secondary use case |

These are positioning proposals. A final homepage claim should follow audience validation and a current capability audit.

## What the research suggests

### Moving content into another tool is an established need

Users describe multi-tool workflows involving a reader, Obsidian, Notion, reference managers, and writing tools. The pain is often missing full text, incomplete metadata, scattered highlights, or manual movement between tools. Copy Markdown addresses part of this problem quickly. A durable integration must preserve context and avoid duplicates. [R01](#r01), [R13](#r13), [R14](#r14), [R15](#r15)

### Saving is easier than retrieving or using

A reader described a collection of more than 500 saved items becoming difficult to use and built an MCP tool to retrieve it. This is a builder's account rather than independent market validation, but it gives a concrete example of the retrieval problem. Other users request library search and contextual access to notes. [R02](#r02), [R05](#r05), [R16](#r16)

### Teams need context around links

A business owner asked for a shared article pool for their team. A separate discussion describes links appearing in Slack without enough commentary. These support the problem of shared research, but do not prove demand for our exact brief workflow. The opportunity is to retain why a passage matters, who contributed it, and the conclusion it helped produce. [R03](#r03), [R06](#r06)

### Repeated coverage and unfinished stories create friction

Users ask how to follow a story through to its outcome. An RSS discussion preferred grouping overlapping articles to another summary feature. This suggests value in tracking developments and reducing repetition, but identifying meaningful new information is harder than matching keywords. [R07](#r07), [R08](#r08)

### Reliability can be a differentiator through execution

Repeated offline complaints concern unavailable articles, missing images, and uncertainty about whether downloading finished. Competitor responses acknowledge caching conditions and improvements. These historical reports support clear completion states and dependable saved content, not a blanket claim that other readers lack offline support. [R09](#r09), [R10](#r10), [R11](#r11), [R12](#r12)

### Generic AI access is no longer sufficient differentiation

Readwise's August 2026 update describes library-wide cited chat, MCP and CLI access, and agent actions on saved content. Feedly documents structured extraction and research questions across articles. Sparkfeed needs a specific useful workflow and reliable source handling, not merely an AI button. [W01](#w01), [W02](#w02)

## Feature scoring and priorities

All scores below are out of five. They preserve the assessments from the discussion.

- **Usefulness:** expected value to the proposed audience.
- **Demand:** directness and repetition of the observed problem in this research sample.
- **Opportunity:** room to deliver a meaningfully better experience, considering competitor overlap.
- **Overall:** usefulness × 0.4 + demand × 0.4 + opportunity × 0.2.
- **Effort:** relative product and engineering complexity, not a delivery estimate.

Priority also considers dependencies and speed of delivering value. It therefore differs from the score order.

| Priority | Feature | Usefulness | Demand | Opportunity | Overall | Effort | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Copy as Markdown | 5 | 4 | 2 | 4.0 | Low | First delivery. Portable content is the validated need; the exact button is our implementation choice. [R01](#r01) |
| 2 | Save evidence: highlights, notes, and source | 5 | 5 | 3 | 4.6 | Medium | Core capability and dependency for briefs. [R04](#r04), [R05](#r05) |
| 3 | Dependable saved copies and offline reading | 5 | 5 | 2 | 4.4 | High | Foundational work alongside new features. Separate full offline support from extraction reliability. [R09](#r09), [R10](#r10) |
| 4 | Shared team briefs | 5 | 3 | 4 | 4.0 | High | Strongest team hypothesis. Validate before broad implementation. [R03](#r03), [R06](#r06) |
| 5 | Passage-level team discussion | 4 | 4 | 2 | 3.6 | Medium–high | Include inside evidence and briefs rather than a separate chat product. [R03](#r03), [R04](#r04) |
| 6 | Relevant past reading | 5 | 4 | 2 | 4.0 | High | Valuable second phase. Reliable retrieval comes before automatic connections. [R02](#r02), [R16](#r16) |
| 7 | Clip charts, tables, and code | 4 | 3 | 3 | 3.4 | Medium–high | Expand evidence saving incrementally. Especially useful for technical and research users. [R11](#r11) |
| 8 | Follow this story | 4 | 3 | 4 | 3.6 | High | Later experiment with a bounded topic or source set. [R07](#r07), [R08](#r08) |
| 9 | Show article revisions | 3 | 3 | 3 | 3.0 | Medium–high | More specific to monitoring and evidence maintenance. [R17](#r17) |
| 10 | Find external discussions | 3 | 3 | 2 | 2.8 | Medium–high | Optional. Start with known discussion links. [R18](#r18) |

Demand scores are relative signals, not counts. A score of five does not mean most RSS users requested a feature.

## Feature concepts and boundaries

### Copy as Markdown

One click copies the available article with title, original URL, author and publication date when known, headings, links, and code blocks. A small menu can offer the whole article or highlights only once highlighting exists.

The first version should work without AI. It should avoid invented metadata, preserve useful formatting, and identify partial extraction. Article text and the user's notes must remain distinguishable. A Markdown download can reuse the same conversion work.

### Save evidence

Select a passage, add a short thought, and save it to a project or collection. Preserve the quotation, source URL, and enough context to find the passage again. Keep the user's interpretation separate from the author's words.

This addresses a different need from bookmarking an entire article. It creates material that can be retrieved, exported, cited in a brief, or supplied to an agent. Stable passage anchoring and behavior after article updates need design work.

### Team discussion

Example: highlight a competitor's pricing change and ask a teammate, “Does this affect our proposal?” The teammate can respond beside the passage, add another source, and record the conclusion.

Comments, mentions, and optional follow-ups should belong to the evidence or brief. A separate chat inbox risks duplicating tools teams already use. Shared boards and annotations are not new categories: Feedly already documents them. [W03](#w03)

### Team briefs

A brief starts with a question such as, “Should we change our pricing because of these competitor announcements?” People add selected evidence while reading. Each contribution can include why it matters. A reviewer turns the material into a short conclusion with sources and open questions.

The proposed distinction is carrying research through to a useful team output. The strongest evidence supports the underlying coordination problem, not this precise solution. A brief could eventually be exported, shared to Slack, or used as agent context.

Team briefs and team discussion should form one workflow rather than separate products.

### Follow this story

Follow the subject of an article across selected feeds. Group repeated coverage and show what changed since the user last read. Updates must link to supporting sources.

This differs from article revisions: a story can develop through new articles, while a revision changes an existing page. It also differs from a keyword alert. Relevant follow-ups, repeated reporting, and actual developments need to be distinguished.

### Relevant past reading

When reading an article, optionally show a few related passages the user previously saved, including their own notes. An example is a prior study with a different result.

Start with useful retrieval. Automatic suggestions that are merely topically similar may distract rather than help. Readwise already offers related-library chat, so this is an execution opportunity, not an uncontested feature. [W01](#w01), [W04](#w04)

### Rich clipping

Save a chart with its caption and source, export a table as Markdown or CSV, or copy code while preserving formatting. These should extend evidence saving rather than create a separate collection type for every medium.

Code copying can be simpler than chart capture. Tables, captions, images, attribution, and incomplete extraction need distinct handling. The research includes explicit requests for chart highlights, citation support, and research-tool integration. [R11](#r11)

### Article revisions

Show additions and removals since the saved or previously read version. Retain the earlier version. A later extension could flag a change to a passage already cited in a brief.

NewsBlur already documents inline differences. The stronger Sparkfeed hypothesis connects revisions to the user's saved evidence and team work. Storage, false changes from extraction differences, and notification noise need validation. [R17](#r17), [W05](#w05)

### External discussions

Find matching Hacker News threads and other supported discussions. Show the community, date, and link. Start with known or accurately matched URLs before considering comment ingestion or summaries.

This is particularly useful to technical readers. Access restrictions, matching accuracy, and maintenance make it lower priority than owned reading workflows. [R18](#r18)

### Dependable saved copies

An explicit Keep offline action should have an honest completion state for text and supported media. Saving a page through a browser capture option was also proposed for content the user can access but the server cannot extract.

Neither offline support nor browser capture is approved by this document. A saved excerpt must not be labeled a full article. Unsupported interactive media should retain an original-page link. Reliability remains important even if no offline feature is built yet.

## AI workflow opportunities

These usefulness scores are separate from the weighted feature scores above. They assess fit with the proposed audience, not measured demand.

| Workflow | Example | Usefulness | Proposed sequence |
| --- | --- | --- | --- |
| Prepare context for an agent | Select three articles and notes, add a task, and export an attributed package | 5/5 | First AI-oriented workflow, building on Markdown and collections |
| Answer from selected sources | Ask what the selected authors disagree on, with passage citations and evidence gaps | 5/5 | After source selection and retrieval are dependable |
| Extract a comparison table | Compare price, availability, limitations, and supporting quotations across announcements | 4/5 | Focused addition for teams and technical researchers |
| Reusable team instructions | Apply a saved pricing-analysis prompt to selected announcements and produce a draft | 4/5 | After observing repeated manual work |
| Keep a research question updated | Propose new evidence and revisions for an ongoing deployment or market question | 4/5 | Later, after deduplication and change detection |

### Principles for agent-ready content

- Keep source text, personal notes, and task instructions separate.
- Include original URLs and known publication metadata.
- Make extraction completeness visible. Missing evidence is not permission to invent an answer.
- Link generated claims to supporting passages where possible.
- Allow users to choose the source set for a question or export.
- Preserve workspace and collection access boundaries.
- Treat generated briefs and automated outputs as drafts until reviewed where sharing is involved.
- Prefer portable output and existing agent interfaces before adding a provider-specific button for every model vendor.

These are proposed product requirements. They are not a claim that current MCP tools implement all of them.

## Integration demand and priorities

“Highest demand” here means the strongest evidence in the sampled discussions. Exact market-wide rankings cannot be established from these sources.

| Order | Integration | Demand signal | Requested outcome | Recommended first scope |
| --- | --- | --- | --- | --- |
| 1 | Obsidian | Strong and repeated | Full articles, highlights, notes, and metadata in a vault | Markdown export with optional highlights and metadata, followed by a proper vault integration. A download is not sync. [R13](#r13), [R14](#r14), [R19](#r19) |
| 2 | Notion | Strong | Content and highlights in an existing knowledge database, with fewer disconnected copies | Add to Notion with a reusable destination and updates to the same item on repeated export. [R15](#r15), [R11](#r11) |
| 3 | NotebookLM and Google Docs | Clear interest in this sample | Batch selected sources by topic with full context | Export research collections. Investigate supported direct integration separately. [R19](#r19), [R20](#r20), [R21](#r21) |
| 4 | AI assistants through MCP | Clear interest and existing competitor adoption | Search and retrieve sources, use notes, and organize material without repeated copying | Audit and improve the existing interface, scopes, and workflow examples before adding another integration layer. [W01](#w01) |
| 5 | Slack | Clear team problem, weaker connector-specific evidence | Share a passage and why it matters | Send selected evidence and a note, then reviewed briefs. Basic RSS posting already exists. [R06](#r06), [W08](#w08) |
| 6 | Zotero | Strong within an academic niche | Citations, paper metadata, and annotation exchange | Consider citation export before full synchronization if academic users become a target audience. [R22](#r22), [R23](#r23), [R24](#r24) |
| 7 | n8n and webhooks | Useful niche, limited direct evidence here | Route saved content into monitoring and automation workflows | Later, a small set of reliable events such as article saved or brief approved. [R25](#r25) |

### What makes an integration useful

An Add to button alone does not address the full problem. A well-scoped integration needs decisions about:

| Concern | Expected behavior to investigate |
| --- | --- |
| Content choice | Whole article, highlights, notes, or a selected combination |
| Metadata | Source URL, title, author, date, and tags where available |
| Duplicates | Re-export updates the existing destination item when appropriate |
| User edits | Export does not silently overwrite edits made in the destination |
| Completeness | Partial source content remains clearly identified |
| Destination | Users can choose a vault, folder, database, or collection appropriate to the integration |
| Failure | Failed sends are visible and retryable without creating duplicate items |
| Synchronization | Clearly distinguish download, one-time export, one-way sync, and two-way sync |

Two-way note synchronization is explicitly requested in the research, particularly for Obsidian. It should be deferred until one-way export is reliable because conflict handling and preservation of user edits add substantial scope. [R19](#r19)

Readwise's documented NotebookLM integration uses Google Docs as a bridge. “Send directly to NotebookLM” should not be promised without verifying supported mechanisms and limitations for the intended account type. [W07](#w07)

## Competitor findings and implications

| Existing capability | Evidence | Implication for Sparkfeed |
| --- | --- | --- |
| Team boards, annotations, and follow-ups | Feedly team documentation [W03](#w03) | Shared folders or comments alone are insufficient differentiation |
| Duplicate filtering | Inoreader documentation [W06](#w06) | Story tracking must do more than hide matching headlines |
| Library-wide cited chat, agent actions, MCP, and CLI | Readwise August 2026 update [W01](#w01) | Generic chat or an MCP label is not a unique selling point |
| Structured AI extraction across articles | Feedly developer documentation [W02](#w02) | Comparison tables need an audience-specific workflow and reliable evidence |
| Article revision differences | NewsBlur documentation [W05](#w05) | Connect changes to saved evidence or a brief if pursuing this |
| Notion and Obsidian exports | Readwise export documentation and official plugin [W09](#w09), [W10](#w10) | Better completeness, metadata, and edit preservation matter |
| NotebookLM export through Google Docs | Readwise documentation [W07](#w07) | An export bridge is a useful staged approach, not necessarily native notebook synchronization |
| Basic RSS-to-Slack posting | Slack documentation [W08](#w08) | Share curated context rather than duplicating a feed firehose |

## Proposed right-side interface

The original concept had four actions: Copy Markdown, Save evidence, Discuss with team, and Follow this story. Later research suggested consolidating discussion into briefs and keeping specialist tools contextual.

Recommended initial structure:

| Surface | Behavior |
| --- | --- |
| Copy Markdown | Immediate action with a small confirmation |
| Save evidence | Saves selected material or opens the evidence panel |
| Add to brief | Appears when a team brief workflow exists |
| Send to menu | Groups connected destinations instead of adding a permanent icon per integration |
| Contextual actions | Revisions and discussions appear when relevant and available |

Add to brief and Send to are alternatives for an early third slot, not a settled final layout. Panels open on demand. The article remains the focus. The existing non-Zen contents rail should keep its established appearance.

## Recommended delivery sequence

| Stage | Scope | Reason |
| --- | --- | --- |
| First | Copy Markdown and optional Markdown download | Immediate value with limited scope and no AI dependency |
| Second | Text highlights, notes, evidence collections | Creates reusable material for users, teams, and agents |
| Alongside both | Saved-content completeness and honest status | All downstream workflows depend on reliable sources |
| First integrations | Obsidian-friendly output and Notion | Strong fit with observed portability workflows |
| Team validation | Briefs with passage comments and mentions | Test whether teams produce and revisit useful outcomes |
| AI and collection export | Agent context packages and NotebookLM-suitable collections | Reuses the evidence foundation |
| Later expansion | Retrieval, charts and tables, Slack delivery | Prioritize based on repeated use and destination demand |
| Deferred experiments | Ongoing story tracking, revisions, external discussions, automation events | Higher complexity, narrower use cases, or weaker evidence |

This sequence is a recommendation, not a commitment to dates. It does not authorize implementation, deployment, or external API setup.

## Questions to settle before implementation

1. Which initial audience is primary: individual researchers, developers, or small teams?
2. Should evidence belong to personal collections, team projects, or both?
3. Does a team brief solve a recurring task that teams already perform, and who reviews the result?
4. Should the first Notion export include the article, highlights, or both by default?
5. Is Markdown export enough for initial Obsidian users, or is ongoing vault synchronization necessary?
6. Which content and metadata should be retained when the publisher changes an article?
7. What current API and MCP capabilities can be reused rather than rebuilt?
8. Which AI actions run on demand, and which would justify future background automation?
9. How should private notes and team-visible evidence be separated?
10. Which integrations do actual Sparkfeed users already use, rather than merely expressing interest in?

### Proposed validation, not completed research

Interview a small set of readers and teams using their actual last few saved articles. Ask them to show where those articles went, what they copied, what failed, and whether another person used the result. Avoid asking only whether a feature sounds useful.

For team briefs, test one real recurring question with an existing team. Observe whether people contribute evidence, whether someone produces a conclusion, and whether that conclusion is reused. For integrations, distinguish a request for one-time export from a need for synchronization.

Possible success signals include repeated exports, repeated evidence saving, retrieval of prior evidence, briefs used by more than their author, and successful destination updates without duplicates. These are suggested measures, not existing analytics or targets.

## Source register

The register includes the substantive sources used across the discussions. It excludes unrelated search hits and promotional results that did not support a recommendation. Findings are paraphrases rather than reproduced articles or comment threads.

### Reddit and community evidence

<a id="r01"></a>
**R01. [I need help setting up my workflow](https://www.reddit.com/r/ObsidianMD/comments/19apdk3/).** A writer describes collecting sources through feeds and social platforms, using Readwise, and wanting notes and writing in Obsidian. Supports portability and reducing capture-to-writing friction.

<a id="r02"></a>
**R02. [Finally made my 500+ Readwise articles actually useful](https://www.reddit.com/r/readwise/comments/1lmeszm/).** A builder describes difficulty retrieving saved content and an MCP-based solution. Supports a concrete retrieval use case, with the caveat that this is a self-built-tool account.

<a id="r03"></a>
**R03. [January feature requests](https://www.reddit.com/r/readwise/comments/1q4g70c/january_feature_requests_share_here/).** Includes a business owner's request for a shared article pool and stated willingness to buy team subscriptions. One expression of willingness to pay is not a pricing study.

<a id="r04"></a>
**R04. [May feature requests, 2024](https://www.reddit.com/r/readwise/comments/1cimprn/may_feature_requests_post_here/).** Requests include sharing individual highlights, groups of highlights, and annotated material. Supports evidence portability and collaboration.

<a id="r05"></a>
**R05. [Some feature suggestions from a passionate user](https://www.reddit.com/r/readwise/comments/1hw485n/).** Includes a request for a notebook panel that follows the current reading position and describes processing highlights in Obsidian. Supports contextual notes and usable retrieval.

<a id="r06"></a>
**R06. [How does your team keep up with news and content?](https://www.reddit.com/r/Notion/comments/19edkl5/).** Describes links shared in Slack with little commentary. Supports the team-context problem. Search excerpt was available; a later direct fetch timed out.

<a id="r07"></a>
**R07. [How follow news to the end?](https://www.reddit.com/r/ask/comments/1brtsnx/).** Asks how to subscribe to an event and learn its eventual outcome. Direct evidence for story-following interest outside an RSS-specific community.

<a id="r08"></a>
**R08. [RSS reading with AI support: opinions?](https://www.reddit.com/r/rss/comments/1rqt6td/question_to_community_rss_reading_with_ai_support/).** A respondent prefers grouping related articles from overlapping feeds over article summaries. Supports optional, task-specific AI rather than assuming everyone wants summarization.

<a id="r09"></a>
**R09. [How have you still not solved offline?](https://www.reddit.com/r/readwise/comments/1l9ug2g/how_have_you_still_not_solved_offline/).** Complaints about offline reliability, with a product response explaining caching conditions. Historical evidence for availability and status clarity.

<a id="r10"></a>
**R10. [Update on offline use?](https://www.reddit.com/r/readwise/comments/1ko1pnx/).** Requests bulk downloading and describes missing media during travel. Supports explicit download actions and completeness indicators.

<a id="r11"></a>
**R11. [June feature requests, 2025](https://www.reddit.com/r/readwise/comments/1l2sy4c/june_feature_requests_ask_here/).** Includes requests involving offline images, charts, citation generation, Zotero, full content, and note-tool workflows. Multiple findings in one thread are not independent demand samples.

<a id="r12"></a>
**R12. [February feature requests, 2026](https://www.reddit.com/r/readwise/comments/1qtqis9/february_feature_requests_share_here/).** Includes offline-image and saved-login requests. Useful for ongoing reliability concerns. Does not establish today's competitor status.

<a id="r13"></a>
**R13. [RSS to Obsidian notes](https://www.reddit.com/r/ObsidianMD/comments/wripo5/).** Describes full text available in an RSS reader but reduced to an excerpt through an intermediate export workflow. Supports exporting available full content directly.

<a id="r14"></a>
**R14. [Bookmark to note fetched in Obsidian](https://www.reddit.com/r/ObsidianMD/comments/1u9vlkd/bookmark_to_note_fetched_in_obsidina/).** Requests stored source content that can be searched later across devices. Supports complete capture rather than URL-only saving.

<a id="r15"></a>
**R15. [A few questions about Notion integration](https://www.reddit.com/r/readwise/comments/1airg1d/).** Describes integrating reading into an existing Notion database associated with a research workflow. Search excerpt was available; direct opening failed during the research.

<a id="r16"></a>
**R16. [I want NLP-powered search for my Readwise library](https://www.reddit.com/r/readwise/comments/1nlxc75/).** Requests searching or chatting over the full saved collection. Later competitor releases address this category, so it should not be treated as an unfilled gap.

<a id="r17"></a>
**R17. [RSS reader alerts for updated content](https://www.reddit.com/r/rss/comments/u9ca37/does_an_rss_reader_exist_which_either_prominently/).** Direct request to follow updates to specific articles. Responses mention existing change-tracking readers.

<a id="r18"></a>
**R18. [Getting full articles from Hacker News RSS](https://www.reddit.com/r/rss/comments/1w36e3n/getting_full_articles_from_hacker_news_rss/).** Explores the linked article versus its discussion and existing reader behavior. Supports handling article and discussion links together, more strongly than it supports automated comment summaries.

<a id="r19"></a>
**R19. [November feature requests, 2025](https://www.reddit.com/r/readwise/comments/1olhpiv/november_feature_requests_share_here/).** Includes two-way Obsidian sync, Zotero integration, and selecting several articles for one NotebookLM notebook. Strong evidence of specific workflow requests, not their market prevalence.

<a id="r20"></a>
**R20. [Readwise and NotebookLM connection](https://www.reddit.com/r/readwise/comments/1ql20mq/readwise_notebookllm_connection_is_fantastic/).** A user describes value from using reading material in NotebookLM and related AI workflows. Positive workflow evidence rather than a missing-feature complaint.

<a id="r21"></a>
**R21. [Exporting tags to NotebookLM](https://www.reddit.com/r/readwise/comments/1hvsurd/).** Asks about collecting tagged material from several sources in one Google Doc for NotebookLM. Supports topic-based batch export.

<a id="r22"></a>
**R22. [Integration with Zotero?](https://www.reddit.com/r/readwise/comments/18e4fmc/).** Requests connection between reading and reference-management tools. Academic-specific demand.

<a id="r23"></a>
**R23. [Readwise discussion on the Zotero forum](https://forums.zotero.org/discussion/90421/readwise).** Community discussion of integration and workarounds. Corroborates demand outside Reddit.

<a id="r24"></a>
**R24. [Reader to Zotero](https://www.reddit.com/r/readwise/comments/11a6mzi/).** Requests source access and richer export metadata. Supports citation-aware workflows rather than assuming a plain link is sufficient.

<a id="r25"></a>
**R25. [Building a monitor in n8n through RSS](https://www.reddit.com/r/rss/comments/1sqk7ui/anyone_can_help_with_building_monitor_on_n8n/).** A user explores RSS for monitoring amid API access and cost constraints. Limited evidence for automation demand, not proof that a native n8n node should be prioritized.

<a id="r26"></a>
**R26. [Paying user frustrated by metadata improvements](https://www.reddit.com/r/readwise/comments/1r72fc4/paying_user_frustrated_by_lack_of_basic_metadata/).** Describes organizational pain alongside frustration about AI priorities. Supports avoiding feature expansion at the expense of source quality and metadata.

<a id="r27"></a>
**R27. [Saved articles not available offline](https://www.reddit.com/r/readwise/comments/1e2p59a/).** Includes a founder response distinguishing caching delays and image behavior. Useful context against overgeneralizing complaints into “offline does not exist.”

<a id="r28"></a>
**R28. [Let me hear your RSS workflows](https://www.reddit.com/r/rss/comments/1eehq6o/let_me_hear_your_rss_workflows/).** Illustrates varied consumption habits and organization by urgency and media type. Supports preserving user control rather than assuming a single AI-led workflow.

<a id="r29"></a>
**R29. [How do you use feeds in Reader?](https://www.reddit.com/r/readwise/comments/18kbzlp/).** Discusses information overload and the distinction between feed triage and a saved library. Relevant to avoiding a growing backlog of automatically collected material.

<a id="r30"></a>
**R30. [Read-it-later app that links with Obsidian](https://www.reddit.com/r/ObsidianMD/comments/12ifqaj/best_readitlater_app_that_links_with_obsidian/).** Discusses importing complete article content and images into notes. Additional portability evidence.

### Official product and technical sources

<a id="w01"></a>
**W01. [Readwise Reader update, August 2026](https://readwise.io/reader/update-aug2026).** Documents library-wide cited chat, agent operations, improved search, MCP, and CLI. Used to correct the idea that generic library AI access would be unique.

<a id="w02"></a>
**W02. [Feedly structured AI outputs](https://developers.feedly.com/reference/ai-actions-experimental).** Documents questions and structured outputs over sets of articles. Supports competitor overlap for extraction and comparison workflows.

<a id="w03"></a>
**W03. [Feedly team feeds and boards](https://docs.feedly.com/article/805-feeds-and-boards).** Documents shared research organization and collaboration. See also [sharing insights with a team](https://feedly.com/new-features/posts/share-insights-with-your-team).

<a id="w04"></a>
**W04. [Readwise Global Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/global).** Documents library tools and related-document context. Relevant to retrieval and contextual assistance competition.

<a id="w05"></a>
**W05. [Tracking story changes with NewsBlur](https://blog.newsblur.com/2016/03/03/tracking-story-changes-with-newsblur/).** Documents revision highlighting. Establishes that article differences are an existing feature category.

<a id="w06"></a>
**W06. [Inoreader duplicate filters](https://www.inoreader.com/uk/blog/2020/08/win-the-clone-wars-with-duplicate-filters.html).** Documents filtering duplicate content. Relevant to separating duplicate suppression from story development tracking.

<a id="w07"></a>
**W07. [Readwise to NotebookLM integration](https://docs.readwise.io/readwise/docs/exporting-highlights/notebooklm).** Describes the Google Docs bridge for highlights and notes. Does not establish that Sparkfeed can directly synchronize a consumer notebook.

<a id="w08"></a>
**W08. [Add RSS feeds to Slack](https://slack.com/help/articles/218688467-Add-RSS-feeds-to-Slack).** Confirms native feed-posting capability. The proposed Sparkfeed value is curated evidence and briefs.

<a id="w09"></a>
**W09. [Readwise to Notion export](https://docs.readwise.io/readwise/docs/exporting-highlights/notion).** Official integration documentation. Relevant to destination configuration and existing export competition.

<a id="w10"></a>
**W10. [Official Readwise Obsidian plugin](https://community.obsidian.md/plugins/readwise-official).** Documents automated highlight export. Confirms that basic note-tool integration is already expected by some users.

<a id="w11"></a>
**W11. [Readwise exporting FAQ](https://docs.readwise.io/reader/docs/faqs/exporting).** Describes export workflows for note-taking tools. Useful context for portability requirements.

<a id="w12"></a>
**W12. [Readwise December 2025 update](https://readwise.io/reader/update-dec2025).** Includes workflow and integration developments. Historical context for why some older feature requests may no longer describe a gap.

<a id="w13"></a>
**W13. [Notion MCP](https://www.notion.com/help/notion-mcp).** Documents agent access to Notion. Relevant to interoperability, not evidence of demand for a particular Sparkfeed integration.

## Decision summary

The research supports improving portability, useful evidence capture, and content reliability. It supports investigating team research workflows and selected-source AI assistance. It does not establish that every proposed feature is broadly demanded or absent from competitors.

The next planning discussion should choose a narrow first delivery and a team workflow to validate. Copy Markdown is the clearest immediate step. Evidence saving gives the later integration and agent work a common foundation.
