# Postalytics migration source reconciliation
Checked: 2026-10-22 (UTC). Source: authenticated, read-only WPVibe inspection of https://www.postalytics.com. This is an inventory checkpoint, NOT migration approval or a complete redirect export.

## Historical redirects
- Yoast SEO Premium: option `wpseo-premium-redirects-base` contains a PHP-serialized array declaring **673** records; `wpseo-premium-redirects-export-plain` also declares 673. Regex export option declares zero. Do not sum base and export versions: they represent the same rules in different forms. Yoast source-path deduplication found 673 unique normalised origins. Source: WPVibe WP-CLI `option list --search=*redirect*`.
- Rank Math: `wp_rank_math_redirections` has **81 rows** (all 81 currently have status=active; individual destinations and execution order still require verification). Source: WPVibe `db query "SELECT COUNT(*) n FROM {prefix}rank_math_redirections"`.
- `wp_sfm_redirects` has **1 row**, classified as RSS feed redirection to SpecificFeeds, rather than an ordinary URL redirect. Source: WPVibe database row inspection.
- Pretty Links has **2 enabled 301 tracking records**: `/jenni` and `/jennishow`, both currently configured to the homepage. Source: WPVibe `wp_prli_links` rows.
- Of 81 active Rank Math rules, **80 normalised source paths overlap** with Yoast and **one** is unmatched: `/5-ways-to-use-direct-mail-and-email-marketing`. This yields **674 candidate distinct source paths** across these CMS systems (673 + 1), not 754. Of the 80 overlaps, two have divergent configured destinations, listed below. The 80 Yoast rules whose destinations also appear as Yoast source paths are **possible chains** requiring a runtime check; this is not proof of actual multi-hop behaviour. Also inspect web server, CDN, plugins, legacy backups and historical exports.

## Redirect conflict queue
These are **configuration conflicts, not confirmed live behaviour**. Inspect actual HTTP response and decide intended support destination before retaining or retiring either rule.
1. `support/documentation/home/my-account/external-domain`: Yoast → `https://support.postalytics.com/support/solutions/articles/70000600607-vanity-domains-for-direct-mail`; Rank Math → `https://www.postalytics.com/support/documentation/home/my-account/external-domain-setup-for-purls`.
2. `support/documentation/home/my-account/external-domain-setup-for-purls`: Yoast → `https://support.postalytics.com/support/solutions/folders/70000477545`; Rank Math → `https://www.postalytics.com/support/documentation/home/purls-qrs-and-domains/external-domain-setup`.
Source: WPVibe Yoast option `wpseo-premium-redirects-base` and Rank Math table `wp_rank_math_redirections`. Both should remain **unapproved** until verified.

## WordPress content and inactive URLs
Authenticated `wp_posts` query grouped by post_type and post_status:
- Published posts **442**; drafts **62**; one auto-draft and one dp-rewrite-republish status.
- Published pages **349**; drafts **218**; private **5**.
- Captivate podcasts published **48**.
- Docs published **149**, draft **2**, private **3**.
- Attachments inherit **6,288**; `_wp_attached_file` recorded **6,288 distinct paths**.
- Published testimonials **8**; other plugin-owned system types exist and need visibility and URL exposure verification.
- These are database entity counts and **are not unique crawlable URL totals**.

## Taxonomies
WordPress `taxonomy list` exposes category, post_tag, post_format, captivate_category, captivate_tag, portfolio-type, doc_tag and several private/system taxonomies.
Stored term taxonomy counts from `wp_term_taxonomy`: category **26**, post_tag **717**, doc_tag **125**, portfolio-type **4**. Captivate taxonomy registrations may have zero matching term rows. Registration does not imply an indexable archive. Test canonical, noindex, pagination and last page behavior separately.

## Media catalogue
6,288 attachment records have 6,288 distinct `_wp_attached_file` values. MIME breakdown:
- PNG 3,973; JPEG 2,117; GIF 70; PDF 36; AVIF 34; WebP 26; MP4 20; SVG 6; DOCX 2; HEIC 2; ZIP 1; XLSX 1.
- Total 6,288. Source: `wp_posts` WHERE post_type='attachment' GROUP BY post_mime_type.
- **Not yet verified:** upload file existence, generated thumbnail variants, attachment URL redirects, usage references, hotlinked or CSS-based images, or orphan files without DB entries. Each final media-catalog entry should include attachment ID, source upload path, canonical URL, usage, HTTP status, proposed target, decision status and direct source reference.


## Ahrefs backlink-target checkpoint
Source: Ahrefs Site Explorer `site_explorer_pages_by_backlinks` target `postalytics.com`, scope `subdomains`, columns `url_to,refdomains_target,links_to_target,http_code_target,target_redirect`, requested 1,000 rows but API returned **500** records. This is a **capped inventory, not a full export**.
- 500 reported target URL entries, of which **51** directly target `/wp-content/uploads/` assets.
- The sum of the `links_to_target` column over these returned rows is **70,779**. It is a sample-row sum, not an independent total, as aliases and URL variants may overlap.
- Reported HTTP statuses: **44 200**, **33 301**, **1 302**, **2 404**, **231 429**, **189 null/unavailable**. A 429 signals throttling, not proof the destination is missing.
- Representative high-impact targets: homepage protocol/hostname variants; `/direct-mail-statistics/` (369 referring domains, 1,516 links); `/blog/usps-tracking-not-updating/` (195 referring domains, 2,478 links, HTTP 429 in Ahrefs); `/blog/statistics-on-direct-mail` (301 to `/direct-mail-statistics/`, 504 links); `/blog/direct-mail-vs-email/` (301 to `/blog/email-vs-direct-mail/`, 352 links); `/wp-content/uploads/2018/10/Postcard-Back-Design-Template.png` (114 referring domains, 213 links).
- The scope includes subdomains, including linked URLs on `app.postalytics.com` and `support.postalytics.com`; do not assume these are hosted in the primary WordPress instance.

Source: Ahrefs Site Explorer `site_explorer_broken_backlinks`, same target/scope, requested 1,000 rows, returned **63** records reaching **26 unique target URL strings**, all reported as HTTP **404** by Ahrefs.
- `https://support.postalytics.com/support/solutions/articles/70000679454--new-the-postalytics-canva-integration`: **29** sampled broken backlink rows.
- `https://support.postalytics.com/template-editor-overview-video`: **8** rows.
- Another **24** unique targets across the remaining **26** rows, predominantly old knowledge-base paths and integration guides.
- **These are backlink observations rather than independently verified current HTTP responses.** Review Freshdesk/support host ownership and current help content with the client before recommending destinations. Prioritise customer-impacting guides and high-authority links.
- A complete set of records and per-row backlink sources still needs to be persisted privately and reconciled with the existing protected decision register. Do not commit backlink-source row exports to this public repository.

## Taxonomy and archive reconciliation detail
Source: WPVibe `wp_term_taxonomy` grouped by taxonomy. Stored term counts and assignment counts:
- `category`: 26 terms, 713 recorded assignments.
- `post_tag`: 717 terms, 983 recorded assignments.
- `doc_tag`: 125 terms, 155 recorded assignments.
- `portfolio-type`: 4 terms, **zero** assignments, so do not infer active portfolio archive content from registration alone.
Term relationships may include records that are not published; per-term published post counts and canonical/noindex response checks remain required. Pagination, feeds, author archives, the blog archive and customer-facing routes need direct HTTP verification.

## Publication notes
The client-facing dashboard source audit and aggregate metrics have been committed to `m0veproperty/postalytics-migration`. This is a public repository, so it holds **summary findings only**, not whole client CMS exports or the protected workspace records.

## Remaining reconciliation gates (open, not approved)
1. Export and parse all **673** Yoast rules; enumerate 81 Rank Math rows and the single sfm row, including active flag, source, target, type, pattern, last changed; identify overlaps, loops, chains and redirects to retired URLs.
2. Obtain legacy CDN / host / .htaccess / backup / original site redirects and any outside-CMS redirect history.
3. Export *all* backlink destination URLs and referring source URLs from Ahrefs, grouped by live, redirected, 404/410 and unobserved. Match against candidate destination and redirects and distinguish unique linked targets from backlink count.
4. Create URL-level registers for published, private, draft, archived, service / conversion journeys, taxonomy and paginated archives, feeds and system routes. Probe canonical, robots directive, redirect chain and current response status.
5. Media file-level reconciliation, including physically present uploads vs registered attachments and derivative formats; source evidence for every resolved entry.
6. Final approval belongs to the migration workspace's designated approvers; these findings do not imply approval or launch readiness.

## Evidence rules
Each reviewed row must have an evidence_source, evidence_checked_at, current_url, suggested_action, target_url when relevant, HTTP status, owner or reviewer, and explicit verification state. Use `unverified` rather than deriving a redirect from title similarity. This document is an aggregate snapshot, not a substitute for the protected, per-URL source inventory.
