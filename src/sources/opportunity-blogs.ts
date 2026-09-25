import * as cheerio from 'cheerio';

import type { JobPost, SourceReport } from '../types.js';
import {
    fetchText,
    hostOf,
    htmlToText,
    makeId,
    parseDate,
    sleep,
    slugify,
    titleMatchesRoles
} from './common.js';
import type { SourceOutput } from './nigerianBoards.js';

/**
 * Opportunity blogs: sites that gather jobs and internships from employers and
 * publish them as blog posts, either one post per opportunity or as numbered
 * roundups ("17 Opportunities Currently Open"). Neither site offers an API, so
 * each is read through its public RSS feed, plus a handful of post pages for the
 * apply link and deadline that the feed leaves out.
 *
 * Checked before writing this file:
 *  - opportunitiescorners.com robots.txt only disallows /?s= and /search/.
 *  - opportunitydesk.org robots.txt has content-signal comments but no Disallow rule.
 *  - Both publish WordPress RSS feeds. Feeds carry the title, date, categories and
 *    an excerpt (Opportunity Desk puts "Deadline: ..." at the start of it).
 *
 * Courtesy limits: one request at a time per site, a pause between requests,
 * and a fixed cap on pages read per run (see MAX_* below).
 */

const CATEGORY = 'opportunity-blog' as const;
const PAUSE_MS = 500;
const MAX_ROUNDUPS_PER_BLOG = 2;
const MAX_DETAIL_PAGES_PER_BLOG = 6;

interface Blog {
    name: string;
    origin: string;
    feeds: string[];
    /** Where the post body lives in the page. First selector that matches wins. */
    contentSelectors: string[];
}

const BLOGS: Blog[] = [
    {
        name: 'Opportunity Desk',
        origin: 'https://opportunitydesk.org',
        feeds: ['/category/jobs-and-internships/feed/', '/feed/'],
        contentSelectors: ['.entry-content']
    },
    {
        name: 'Opportunities Corners',
        origin: 'https://opportunitiescorners.com',
        feeds: ['/category/internships/feed/', '/feed/'],
        contentSelectors: ['.td-post-content', '.entry-content', 'article']
    }
];

// ---------------------------------------------------------------------------
// Feed parsing
// ---------------------------------------------------------------------------

export interface FeedPost {
    title: string;
    link: string;
    pubDate: string;
    categories: string[];
    excerpt: string;
}

function tag(block: string, name: string): string {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? m[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim() : '';
}

export function parseBlogFeed(xml: string): FeedPost[] {
    const posts: FeedPost[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const block = m[1];
        const title = htmlToText(tag(block, 'title'));
        const link = tag(block, 'link');
        if (!title || !link) continue;
        posts.push({
            title,
            link,
            pubDate: tag(block, 'pubDate'),
            categories: [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((c) =>
                htmlToText(c[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''))
            ),
            excerpt: htmlToText(tag(block, 'description'))
        });
    }
    return posts;
}

// ---------------------------------------------------------------------------
// What counts as a job here, and small field extractors
// ---------------------------------------------------------------------------

const JOB_WORDS =
    /\b(jobs?|hiring|vacanc(?:y|ies)|interns?|internships?|traineeships?|apprentice(?:ship)?s?|volunteers?|assistant|associate|officer|manager|analyst|engineer|developer|designer|specialist|coordinator|consultant|writer|researcher|executive|administrator|director|advisor|adviser|technician|representative)\b/i;
/** Fellowships, scholarships, conferences and the like are not jobs, even when tagged loosely. */
const NOT_JOB_WORDS =
    /\b(scholarships?|fellowships?|conferences?|summit|grants?|prizes?|awards?|competitions?|contests?|challenge|workshop|festival|masters?|phd|postdoc(?:toral)?|bursary|call for (?:proposals|papers))\b/i;
const JOB_CATEGORIES = /^(hot jobs?|jobs?|internships?|jobs and internships|volunteering)$/i;

export function isJobLike(title: string, categories: string[] = []): boolean {
    if (NOT_JOB_WORDS.test(title)) return false;
    return JOB_WORDS.test(title) || categories.some((c) => JOB_CATEGORIES.test(c));
}

/** "Hot Remote Job: Acme Assistant" -> "Acme Assistant" */
export function cleanTitle(title: string): string {
    return title
        .replace(/^\s*hot\s+(?:remote\s+)?jobs?\s*[:\-–]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Both sites write deadlines as "Deadline: August 26, 2026" or "Deadline: 28 September 2026". */
export function parseDeadline(text: string): Date | undefined {
    const m = text.match(
        /(?:application\s+)?deadline\s*:?\s*(?:[A-Za-z]+day,?\s*)?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i
    );
    if (!m) return undefined;
    const cleaned = m[1].replace(/(\d)(?:st|nd|rd|th)/i, '$1').replace(/[.,]/g, '');
    const d = new Date(`${cleaned} 23:59:59 UTC`);
    return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "... Internship 2027 in Switzerland (Funded)" -> "Switzerland" */
export function locationFromTitle(title: string): string {
    const m = title.match(/\bin\s+([A-Z][A-Za-z.' ]+?)(?:\s*\(|\s+20\d\d|,|\s*$)/);
    return m ? m[1].trim() : 'Not stated';
}

/**
 * "Data Intern at UNICEF" -> "UNICEF". Only used when the words before " at " are a
 * role and the words after it are a short name; "United Nations Office at Geneva"
 * is a place, not a company, so it stays "Not stated" rather than guessing wrong.
 */
export function companyFromTitle(title: string): string {
    const i = title.lastIndexOf(' at ');
    if (i <= 0) return 'Not stated';
    const before = title.slice(0, i);
    const after = title.slice(i + 4).replace(/\s*\(.*?\)\s*$/, '').trim();
    const shortName = after.split(/\s+/).length <= 6 && !JOB_WORDS.test(after);
    return JOB_WORDS.test(before) && shortName ? after : 'Not stated';
}

/** A Google Form whose address ends in /closedform has stopped taking applications. */
export function isClosedApplyLink(url: string): boolean {
    return /\/closedform\b/i.test(url);
}

/** Opportunity Desk post URLs carry the publish date: /2026/08/05/slug/ */
function dateFromUrl(url: string): string {
    const m = url.match(/\/(20\d\d)\/(\d\d)\/(\d\d)\//);
    return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toISOString() : '';
}

// ---------------------------------------------------------------------------
// Post pages: apply link, deadline, description
// ---------------------------------------------------------------------------

export interface PostDetail {
    text: string;
    applyUrl?: string;
    deadline?: Date;
}

const APPLY_TEXT = /\b(apply|official (?:web)?site|application (?:portal|form|link|page))\b/i;
const NOT_APPLY_HOST = /(facebook|twitter|x\.com|linkedin|whatsapp|telegram|t\.me|instagram|pinterest|youtube|youtu\.be|tiktok)\./i;

function pickContent($: cheerio.CheerioAPI, selectors: string[]) {
    for (const selector of selectors) {
        const el = $(selector).first();
        if (el.length > 0) return el;
    }
    return $('body');
}

export function parsePostDetail(html: string, blogHost: string, selectors: string[]): PostDetail {
    const $ = cheerio.load(html);
    const content = pickContent($, selectors);
    content.find('script, style, ins, noscript, .adsbygoogle, form').remove();

    const text = content.text().replace(/\s+/g, ' ').trim();
    const links = content
        .find('a[href]')
        .map((_, a) => ({ text: $(a).text().trim(), href: $(a).attr('href') ?? '' }))
        .get()
        .filter((l) => /^https?:\/\//i.test(l.href) && hostOf(l.href) !== blogHost && !NOT_APPLY_HOST.test(l.href));

    // A link that says "apply" beats a generic "click here".
    const apply = links.find((l) => /\bapply\b/i.test(l.text)) ?? links.find((l) => APPLY_TEXT.test(l.text));
    return { text, applyUrl: apply?.href, deadline: parseDeadline(text) };
}

// ---------------------------------------------------------------------------
// Roundup posts: "17 Opportunities Currently Open" with numbered items
// ---------------------------------------------------------------------------

export interface RoundupItem {
    title: string;
    description: string;
    /** The "Click here to apply" link. On Opportunity Desk this is the item's own post. */
    link: string;
}

/** Roundup titles start with a count: "27 Hot Jobs This Week", "17 International ... Open". */
export function isRoundupTitle(title: string): boolean {
    return /^\d{1,3}\s+\S/.test(title);
}

export function parseRoundupItems(html: string, selectors: string[]): RoundupItem[] {
    const $ = cheerio.load(html);
    const content = pickContent($, selectors);
    const items: RoundupItem[] = [];

    content.find('p').each((_, p) => {
        const heading = $(p).find('strong, b').first().text().trim();
        const numbered = heading.match(/^(\d{1,3})[.)]\s*(.+)$/);
        if (!numbered) return;

        const link = $(p).find('a[href]').last();
        const href = link.attr('href') ?? '';
        if (!/^https?:\/\//i.test(href)) return;

        const description = $(p)
            .text()
            
            .replace(heading, '')
            .replace(link.text(), '')
            .replace(/\s+/g, ' ')
            .trim();

        items.push({ title: numbered[2].trim(), description, link: href });
    });
    return items;
}

// ---------------------------------------------------------------------------
// Turning posts into JobPosts
// ---------------------------------------------------------------------------

interface Candidate {
    title: string;
    /** The link the listing points to: the blog's own post, or straight to the employer. */
    postUrl: string;
    /** The blog page we found it on (the feed post, or the roundup). */
    listedOn: string;
    postedAt: string;
    summary: string;
}

function toJobPost(blog: Blog, c: Candidate, detail: PostDetail | undefined): JobPost {
    const title = cleanTitle(c.title);
    const deadline = detail?.deadline ?? parseDeadline(c.summary);
    const applyUrl = detail?.applyUrl;
    const body = detail?.text ? detail.text.slice(0, 1800) : c.summary;

    return {
        id: makeId(slugify(blog.name), slugify(new URL(c.postUrl).pathname).slice(-60)),
        title,
        company: companyFromTitle(title),
        location: locationFromTitle(title),
        // The employer's own apply page when the post links to it, else the blog post.
        url: applyUrl ?? c.postUrl,
        postedAt: c.postedAt,
        source: blog.name,
        sourceCategory: CATEGORY,
        postType: 'listing',
        rawText: [
            title,
            body,
            deadline ? `Deadline: ${deadline.toISOString().slice(0, 10)}` : '',
            `Listed on ${blog.name}: ${c.listedOn}`
        ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 2500)
    };
}

async function readBlog(blog: Blog, variants: string[]): Promise<SourceOutput> {
    const host = hostOf(blog.origin);
    const report: SourceReport = {
        source: blog.name,
        category: CATEGORY,
        reached: false,
        attempted: blog.feeds.length,
        reachedCount: 0,
        found: 0
    };

    // 1. Feeds
    const posts = new Map<string, FeedPost>();
    for (const path of blog.feeds) {
        try {
            const xml = await fetchText(blog.origin + path, 'application/rss+xml,text/xml');
            const parsed = parseBlogFeed(xml);
            if (parsed.length > 0) report.reachedCount!++;
            for (const p of parsed) if (!posts.has(p.link)) posts.set(p.link, p);
        } catch {
            // feed missing or blocked: reflected in reachedCount
        }
        await sleep(PAUSE_MS);
    }
    report.reached = report.reachedCount! > 0;

    const candidates: Candidate[] = [];
    const seenPost = new Set<string>();
    const add = (c: Candidate) => {
        if (seenPost.has(c.postUrl)) return;
        seenPost.add(c.postUrl);
        candidates.push(c);
    };

    // 2. Single-opportunity posts straight from the feed
    const roundups: FeedPost[] = [];
    for (const p of posts.values()) {
        if (isRoundupTitle(p.title)) {
            roundups.push(p);
        } else if (isJobLike(p.title, p.categories) && titleMatchesRoles(cleanTitle(p.title), variants)) {
            add({
                title: p.title,
                postUrl: p.link,
                listedOn: p.link,
                postedAt: parseDate(p.pubDate)?.toISOString() ?? '',
                summary: p.excerpt
            });
        }
    }

    // 3. Roundup posts: read a couple, keep only job-like items that match the roles
    let roundupsRead = 0;
    for (const r of roundups) {
        if (roundupsRead >= MAX_ROUNDUPS_PER_BLOG) break;
        try {
            roundupsRead++;
            const items = parseRoundupItems(await fetchText(r.link, 'text/html'), blog.contentSelectors);
            for (const item of items) {
                if (!isJobLike(item.title) || !titleMatchesRoles(cleanTitle(item.title), variants)) continue;
                add({
                    title: item.title,
                    postUrl: item.link,
                    listedOn: r.link,
                    postedAt: dateFromUrl(item.link) || parseDate(r.pubDate)?.toISOString() || '',
                    summary: item.description
                });
            }
        } catch {
            // roundup unreadable: skip it
        }
        await sleep(PAUSE_MS);
    }

    // 4. Read the post page of each match for its apply link and deadline (capped)
    const jobs: JobPost[] = [];
    let expired = 0;
    let detailPages = 0;
    let detailFailed = 0;
    for (const c of candidates) {
        let detail: PostDetail | undefined;
        if (detailPages < MAX_DETAIL_PAGES_PER_BLOG && hostOf(c.postUrl) === host) {
            detailPages++;
            try {
                detail = parsePostDetail(await fetchText(c.postUrl, 'text/html'), host, blog.contentSelectors);
            } catch {
                detailFailed++; // keep the feed excerpt, but say so in the run report
            }
            await sleep(PAUSE_MS);
        }
        const job = toJobPost(blog, c, detail);
        const deadline = detail?.deadline ?? parseDeadline(c.summary);
        if ((deadline && deadline.getTime() < Date.now()) || isClosedApplyLink(job.url)) {
            expired++;
            continue;
        }
        jobs.push(job);
    }

    report.found = jobs.length;
    const notes = [`${posts.size} posts in feeds`, `${roundupsRead} roundup(s) read`];
    if (expired > 0) notes.push(`${expired} past deadline or closed dropped`);
    if (detailFailed > 0) notes.push(`${detailFailed} post page(s) unreadable (excerpt used)`);
    report.note = notes.join(', ');
    return { jobs, reports: [report] };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchOpportunityBlogs(variants: string[]): Promise<SourceOutput> {
    // Different hosts, so the blogs run side by side; each is sequential inside.
    const results = await Promise.all(BLOGS.map(async (blog) => readBlog(blog, variants)));
    return {
        jobs: results.flatMap((r) => r.jobs),
        reports: results.flatMap((r) => r.reports)
    };
}
