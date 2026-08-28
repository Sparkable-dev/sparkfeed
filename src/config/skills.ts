/**
 * Spark AI skills.
 *
 * A skill is a reusable instruction bundle, invoked with a slash command, whose
 * `content` is appended to the system prompt **only for the message that
 * invokes it**. That on-demand loading is the whole point: six sets of detailed
 * procedure permanently in context would crowd out the conversation and blunt
 * every answer that isn't using one.
 *
 * The shape mirrors the AI SDK's harness-skill contract — `name`,
 * `description`, `content` — so the mental model transfers, but the mechanism
 * is different: there is no harness and no sandbox here, so nothing is written
 * to a filesystem for a runtime to discover. `content` is prompt text.
 *
 * Like `ai-models.json`, this file is **also the server-side allowlist**. The
 * client sends a skill *id* and never the instruction text, so a caller cannot
 * post their own procedure and have it treated as system guidance.
 *
 * On writing `content`: it is read by the model, not the user. Concrete
 * sequences ("call get_workspace_info first, then …") beat adjectives, and
 * saying what *not* to do is usually worth more than another instruction to try
 * hard.
 */

export interface Skill {
  /** Stable id. Also the slash command: `/catchup`. */
  id: string
  name: string
  /** One line, shown in the menu and read by the model when choosing. */
  description: string
  /**
   * The message dropped into the composer when the skill is picked.
   *
   * Not cosmetic: the composer's Send button only appears when there is
   * content, so a skill selected into an empty box could never be sent. It also
   * means the transcript reads as a sentence the user wrote rather than a bare
   * command. Skills that need an argument end mid-phrase so the cursor lands
   * where the user should keep typing.
   */
  prompt: string
  /** Shown beside the chip when the skill expects an argument. */
  argHint?: string
  /** Lucide icon name, mapped in the menu component. */
  icon: string
  /** True when the skill changes the workspace, so it needs Ask or Auto. */
  requiresWrite: boolean
  /** Appended to the system prompt for the invoking message only. */
  content: string
}

export const SKILLS: Array<Skill> = [
  {
    id: "catchup",
    prompt: "Catch me up on what's new",
    name: "Catch me up",
    description: "A digest of what's new, grouped by theme",
    argHint: "since when, e.g. today, this week",
    icon: "Newspaper",
    requiresWrite: false,
    content: [
      "The user wants a digest of what is new in their feeds.",
      "",
      "1. Call `get_workspace_info` to see how much is unread and where it is concentrated.",
      "2. Call `search_articles` with no `query` and `unread_only: true`, plus a `since` matching what they asked for (default `24h`; use `7d` for 'this week'). Raise `limit` toward the maximum — a digest built on ten items is a sample, not a digest.",
      "3. Group the results by **theme**, not by feed. Several outlets covering one story is one item with several sources, not several items. This deduplication is the single most valuable thing you do here.",
      "4. Order themes by how much coverage they attracted, not by recency.",
      "5. Only call `get_article` when a headline is too vague to place, and at most two or three times — a digest is not a reading session.",
      "",
      "Format: a one-sentence overview of the period, then 3-6 themed sections. Each theme gets a short paragraph of what actually happened and markdown links to the sources. Close with a single line naming anything sizeable you skipped.",
      "",
      "Do not list every article. Do not pad with items that only appeared once and matter little. If almost nothing is unread, say so in one line rather than inflating the little there is.",
    ].join("\n"),
  },

  {
    id: "deepdive",
    prompt: "Deep dive on ",
    name: "Deep dive",
    description: "Everything across your feeds on one topic",
    argHint: "a topic, e.g. AI regulation",
    icon: "Telescope",
    requiresWrite: false,
    content: [
      "The user wants everything their feeds hold on one topic, synthesised.",
      "",
      "1. Call `search_articles` with the topic as `query`. If it returns little, try a broader phrasing and a wider `since` before concluding there is nothing.",
      "2. Call `get_article` on the **three to five most substantial** results — the ones that look like reporting or analysis rather than a link round-up. Read them properly; this is the step that separates a synthesis from a list of headlines.",
      "3. Build a picture from the full text, not the snippets.",
      "",
      "Format: open with what the topic amounts to right now in two or three sentences. Then the substance, organised by argument or development rather than by article. Then, if the sources disagree, a short section naming who says what — disagreement between sources is signal, and flattening it into consensus is the main way this kind of summary goes wrong. Close with what to watch next, only if the sources support it.",
      "",
      "Cite with markdown links inline as you make each claim, so every assertion is traceable to a source. Say plainly when the coverage is thin or one-sided rather than writing around the gap.",
    ].join("\n"),
  },

  {
    id: "compare",
    prompt: "Compare how my sources covered ",
    name: "Compare coverage",
    description: "How different outlets covered the same story",
    argHint: "a story or event",
    icon: "Scale",
    requiresWrite: false,
    content: [
      "The user wants to see how their sources differ on one story. This is worth doing precisely because they subscribe to several outlets.",
      "",
      "1. Call `search_articles` for the story. Identify pieces from **different feeds** covering the same event — if everything comes from one source, say so and stop; there is nothing to compare.",
      "2. Call `get_article` on one piece per outlet, up to five. You cannot compare framing from headlines.",
      "3. Read for: which facts each includes and omits, what each leads with, whose voices are quoted, and the language used for the same actors or events.",
      "",
      "Format: start with the facts every source agrees on, in a short paragraph. Then one short section per outlet: what it emphasised, what it left out, how it framed the story. Then a closing paragraph on what the differences suggest about each outlet's angle.",
      "",
      "Describe the differences; do not rank the outlets or declare one correct. Where they agree on a fact, say so — agreement across independent sources is itself informative. Quote sparingly and link every outlet.",
    ].join("\n"),
  },

  {
    id: "tidy",
    prompt: "Tidy up my unread",
    name: "Tidy my inbox",
    description: "Triage unread: clear the noise, keep what matters",
    icon: "ListChecks",
    requiresWrite: true,
    content: [
      "The user wants their unread pile triaged rather than read.",
      "",
      "1. Call `search_articles` with `unread_only: true` and a high `limit` to see the backlog.",
      "2. Sort each item into one of three buckets from its title, source and snippet:",
      "   - **Noise** — routine announcements, link round-ups, duplicates of a story already covered, anything from a feed that posts constantly and rarely matters.",
      "   - **Keep** — substantial pieces on subjects this user clearly follows, judged from what they have favourited and which folders are busiest.",
      "   - **Unsure** — anything you cannot place confidently.",
      "3. **Say what you plan to do and get agreement before calling any write tool.** Give the counts and a few examples per bucket.",
      "4. Once agreed: `mark_read` the noise in one batched call, `set_favorite` the keepers. Leave the unsure bucket untouched and unread.",
      "",
      "Format the result as: how many were cleared, how many kept and why, and what is left to look at.",
      "",
      "Be genuinely willing to discard. A triage that keeps everything has done nothing. But never mark something read because you are unsure what it is — unsure means leave it. Read state is shared across the whole workspace, so this affects every member; mention that if you are clearing a lot.",
    ].join("\n"),
  },

  {
    id: "discover",
    prompt: "Find me new sources on ",
    name: "Find new sources",
    description: "Discover quality feeds on a topic and subscribe",
    argHint: "a topic or a site URL",
    icon: "Compass",
    requiresWrite: true,
    content: [
      "The user wants new sources.",
      "",
      "1. Call `list_feeds` first to see what they already read. Recommending something they subscribe to reads as not having looked.",
      "2. Call `find_feeds` — with `topic` for a subject, or `url` when they named a site. If a topic search returns little, try an adjacent phrasing before giving up.",
      "3. Present the candidates with their sample headlines, and say briefly why each one fits. Skip anything already marked `already_subscribed`, other than to note it is covered.",
      "4. **Ask which to add before adding anything.**",
      "5. On approval: if there are several related feeds and no obvious home, offer `create_folder` first, then `add_feed` each one, reporting how many articles came in.",
      "",
      "Recommend fewer, better sources. Five well-chosen feeds is a good answer; fifteen is a list the user now has to triage, and they came here to avoid that. If the good candidates run out at two, stop at two and say so.",
    ].join("\n"),
  },

  {
    id: "health",
    prompt: "Check the health of my feeds",
    name: "Check feed health",
    description: "Find broken, silent, duplicated and noisy feeds",
    icon: "Stethoscope",
    requiresWrite: false,
    content: [
      "The user wants an audit of their subscriptions.",
      "",
      "1. Call `get_workspace_info` for the failing feeds and the overall shape.",
      "2. Call `list_feeds` for the full picture, including `last_error`, `last_published_at`, `posts_30d` and `unread_count`.",
      "3. Sort every source into:",
      "   - **Broken** — `last_error` set, or never fetched. These are losing the user content right now, so lead with them.",
      "   - **Silent** — nothing published in months. Possibly dead, possibly just quiet; say which you think and why.",
      "   - **Flooding** — high `posts_30d` with a large `unread_count`. These are what makes the unread number feel hopeless.",
      "   - **Ignored** — steady posting, almost nothing read. A subscription the user has quietly stopped caring about.",
      "4. Note any near-duplicates: two feeds from one publication, or a site subscribed both as RSS and as a scrape.",
      "",
      "Format: lead with anything broken, since that is actionable today. Then the other categories, only where they have members. For each, name the feeds and say what you would do.",
      "",
      "Propose, do not perform. Unsubscribing is the user's call, and you cannot remove feeds anyway. If a fix is just a reorganisation you can do, offer `move_feed` and wait for a yes. Do not report categories that are empty — an audit that says everything is fine in five sections is worse than one line saying it is fine.",
    ].join("\n"),
  },
]

export function getSkill(id: string | undefined): Skill | undefined {
  if (!id) return undefined
  return SKILLS.find((s) => s.id === id)
}

export const SKILL_IDS = SKILLS.map((s) => s.id) as [string, ...Array<string>]

/** Slash-menu matches: skills whose id or name starts with the typed query. */
export function matchSkills(query: string): Array<Skill> {
  const q = query.trim().toLowerCase()
  if (!q) return SKILLS
  return SKILLS.filter(
    (s) => s.id.startsWith(q) || s.name.toLowerCase().includes(q)
  )
}
