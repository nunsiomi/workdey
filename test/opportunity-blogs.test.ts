import { describe, expect, it } from 'vitest';

import {
    cleanTitle,
    companyFromTitle,
    isClosedApplyLink,
    isJobLike,
    isRoundupTitle,
    locationFromTitle,
    parseBlogFeed,
    parseDeadline,
    parsePostDetail,
    parseRoundupItems
} from '../src/sources/opportunity-blogs.js';

// Trimmed from the live sites' real markup.

const OD_FEED = `<rss><channel><item>
  <title>UN FAO Internship Programme for Africa (RAF) 2026</title>
  <link>https://opportunitydesk.org/2026/09/22/un-fao-internship-programme-for-africa-2026/</link>
  <pubDate>Tue, 22 Sep 2026 05:16:28 +0000</pubDate>
  <category><![CDATA[Africa]]></category>
  <category><![CDATA[Hot Jobs]]></category>
  <category><![CDATA[Internships]]></category>
  <description><![CDATA[Deadline: December 31, 2026 Applications are open for the UN FAO Internship Programme for Africa (RAF) 2026. [...]]]></description>
</item></channel></rss>`;

const OD_ROUNDUP = `<div class="entry-content">
  <p>&nbsp;</p>
  <p><strong>1. Aga Khan Foundation Goals for Tomorrow: Call for Youth Presenters&nbsp;</strong><br>The Aga Khan Foundation invites young leaders to present. <a href="https://opportunitydesk.org/2026/08/04/goals-for-tomorrow-call-for-youth-presenters/">Click here to apply</a></p>
  <p><strong>2. Data Analyst Intern at Acme Health</strong><br>Acme is hiring an intern. <a href="https://jobs.acme.example/apply/42">Click here to apply</a></p>
  <p>For more opportunities, visit Opportunity Desk.</p>
</div>`;

const OD_POST = `<div class="entry-content">
  <p>Deadline: August 26, 2026</p>
  <p>Are you a young leader? The Aga Khan Foundation invites you to present.</p>
  <p><a href="https://opportunitydesk.org/other-post/">Related post</a></p>
  <p><a href="https://twitter.com/share?u=x">Click here to apply on twitter</a></p>
  <p><a href="https://customervoice.microsoft.com/form/abc">Click here to apply</a></p>
</div>`;

const OC_POST = `<article><div class="td-post-content">
  <p>The applications are now open for the WHO Health Department Internship 2027 in Switzerland.</p>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  <p>Deadline: 28 September 2026</p>
  <p><a href="https://careers.who.int/careersection/intern/jobdetail.ftl?job=2603774">APPLY NOW FOR THE WHO HEALTH INTERNSHIP</a></p>
</div></article>`;

describe('feed parsing', () => {
    it('reads title, link, date, categories and excerpt', () => {
        const [post] = parseBlogFeed(OD_FEED);
        expect(post.title).toBe('UN FAO Internship Programme for Africa (RAF) 2026');
        expect(post.link).toContain('/2026/09/22/un-fao-internship');
        expect(post.categories).toEqual(['Africa', 'Hot Jobs', 'Internships']);
        expect(post.excerpt.startsWith('Deadline: December 31, 2026')).toBe(true);
    });
});

describe('job or not', () => {
    it.each([
        ['Data Analyst Intern at Acme Health', [], true],
        ['UN FAO Internship Programme for Africa (RAF) 2026', ['Hot Jobs'], true],
        ['Hot Remote Job: GYLDC Administrative Assistant', [], true],
        ['Silicon Valley Fellowship 2026 in San Francisco (Fully Funded)', ['Internships'], false],
        ['Indomie Scholarship Program 2026', [], false],
        ['Global Leadership Dialogue 2027 in Hungary', ['Conferences'], false],
        ['Some Programme 2026', ['Internships'], true]
    ])('"%s" -> %s', (title, categories, expected) => {
        expect(isJobLike(title, categories as string[])).toBe(expected);
    });

    it('recognises roundup titles by their leading count', () => {
        expect(isRoundupTitle('17 International Travel, Speaking, Fellowship and Other Opportunities Currently Open')).toBe(true);
        expect(isRoundupTitle('27 Hot Jobs This Week')).toBe(true);
        expect(isRoundupTitle('UN FAO Internship Programme 2026')).toBe(false);
    });
});

describe('field extraction', () => {
    it('reads both deadline formats and ignores text without one', () => {
        expect(parseDeadline('Deadline: August 26, 2026 Are you')?.toISOString().slice(0, 10)).toBe('2026-08-26');
        expect(parseDeadline('Deadline: 28 September 2026')?.toISOString().slice(0, 10)).toBe('2026-09-28');
        expect(parseDeadline('Application Deadline: October 1st, 2026')?.toISOString().slice(0, 10)).toBe('2026-10-01');
        expect(parseDeadline('Deadline: Ongoing')).toBeUndefined();
        expect(parseDeadline('Apply soon.')).toBeUndefined();
    });

    it('takes a place only when the title says "in <Place>"', () => {
        expect(locationFromTitle('WHO Health Department Internship 2027 in Switzerland (Funded)')).toBe('Switzerland');
        expect(locationFromTitle('Assessment of Programmes in Selangor, UNICEF Malaysia')).toBe('Selangor');
        expect(locationFromTitle('UN FAO Internship Programme for Africa (RAF) 2026')).toBe('Not stated');
    });

    it('takes a company only from "<role> at <short name>"', () => {
        expect(companyFromTitle('Data Intern at UNICEF')).toBe('UNICEF');
        // "Office at Geneva" is a place, not an employer.
        expect(companyFromTitle('United Nations Office at Geneva (UNOG) Travel Document Client Services Intern')).toBe('Not stated');
        expect(companyFromTitle('Silicon Valley Program')).toBe('Not stated');
    });

    it('spots an apply link that has already closed', () => {
        expect(isClosedApplyLink('https://docs.google.com/forms/d/e/1FAIpQLSf0yNy/closedform')).toBe(true);
        expect(isClosedApplyLink('https://docs.google.com/forms/d/e/1FAIpQLSf0yNy/viewform')).toBe(false);
    });

    it('strips the "Hot Remote Job:" prefix', () => {
        expect(cleanTitle('Hot Remote Job: GYLDC Administrative Assistant')).toBe('GYLDC Administrative Assistant');
        expect(cleanTitle('Hot Job - Data Intern')).toBe('Data Intern');
    });
});

describe('roundup posts', () => {
    it('parses numbered items with their title, description and apply link', () => {
        const items = parseRoundupItems(OD_ROUNDUP, ['.entry-content']);
        expect(items).toHaveLength(2);
        expect(items[0].title).toBe('Aga Khan Foundation Goals for Tomorrow: Call for Youth Presenters');
        expect(items[0].description).toBe('The Aga Khan Foundation invites young leaders to present.');
        expect(items[1].title).toBe('Data Analyst Intern at Acme Health');
        expect(items[1].link).toBe('https://jobs.acme.example/apply/42');
    });
});

describe('post pages', () => {
    it('finds the employer apply link and skips share links and same-site links', () => {
        const d = parsePostDetail(OD_POST, 'opportunitydesk.org', ['.entry-content']);
        expect(d.applyUrl).toBe('https://customervoice.microsoft.com/form/abc');
        expect(d.deadline?.toISOString().slice(0, 10)).toBe('2026-08-26');
    });

    it('works with the other site layout and ignores ad scripts', () => {
        const d = parsePostDetail(OC_POST, 'opportunitiescorners.com', ['.td-post-content', '.entry-content', 'article']);
        expect(d.applyUrl).toBe('https://careers.who.int/careersection/intern/jobdetail.ftl?job=2603774');
        expect(d.deadline?.toISOString().slice(0, 10)).toBe('2026-09-28');
        expect(d.text).not.toContain('adsbygoogle');
    });

    it('returns no apply link when the post has none', () => {
        expect(parsePostDetail('<div class="entry-content"><p>No links here.</p></div>', 'x.org', ['.entry-content']).applyUrl).toBeUndefined();
    });
});
