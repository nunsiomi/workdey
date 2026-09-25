# WorkDey: Autonomous AI Career Scout & Match Agent

**WorkDey** is an AI-powered career agent that finds live jobs and internships, screens them for scam signals, scores how well each one fits your CV, and drafts a tailored reply and cover letter for your best matches.

You give it your CV and the roles you want. It does the searching across Nigerian job boards, employer career pages, remote-job boards and opportunity blogs, so you do not have to check each one yourself.


## What is WorkDey?

WorkDey automates the early stages of the job search process.

It:

1. **Discovers live jobs** from Nigerian job boards, employer career pages, remote-job boards and opportunity blogs.
2. **Screens listings for scam signals** before they are considered for matching.
3. **Evaluates CV-to-job fit** using AI and produces a compatibility score.
4. **Generates application packs** for your top matches. You choose how many with `maxPacks`.
5. **Creates an HTML dashboard** containing the results and application materials.
6. **Sends application packs by email** when an email address is provided.
7. **Remembers previously processed jobs** to avoid repeatedly processing the same listings.

### Where the jobs come from

Every job WorkDey shows you links back to its original posting, and every run reports which sources it reached.

* **Formal listings.** Nigerian job boards (HotNigerianJobs, MyJobMag, Jobberman), employer career pages on applicant tracking systems, and remote-job boards.
* **Opportunity blogs.** Sites such as [Opportunity Desk](https://opportunitydesk.org) and [Opportunities Corners](https://opportunitiescorners.com) collect jobs and internships and publish them as blog posts and numbered roundups ("17 Opportunities Currently Open"). WorkDey reads their public feeds and posts and pulls out the role, description, deadline and apply link, using the link to the original application page wherever the post gives one. These sites mostly gather openings from organisations' own career pages and job sites, so they widen the net beyond the big boards, with a lot of internships and NGO and UN roles.
* **Posts on X (optional).** Jobs that are only mentioned in a post, such as "we're hiring a data analyst, DM your CV", are not on any job board. WorkDey can search for these on X through the official X API, but only if you add your own X API bearer token. Without a token this is skipped. It reads public posts from verified accounts only, and every result is marked **verify manually**, because a post is not a structured job listing.

WorkDey does not scrape Instagram or LinkedIn.


## Key Features

### Live Job Discovery

Every run sweeps **all** of the source categories below and reports how many sources it actually reached. A run that only touched one or two sites is treated as a failed sweep.

**Nigerian job boards** (read through public RSS feeds and listing pages that their `robots.txt` allows)

* HotNigerianJobs (RSS)
* MyJobMag (title and category pages, with full-posting text for shortlisted jobs)
* Jobberman (default listing only: its search and paging URLs are disallowed by `robots.txt`)

**Employer career pages on applicant tracking systems** (the freshest roles, straight from the employer)

* Greenhouse, Lever, Ashby, Workable, SmartRecruiters and BambooHR boards for African fintech and tech employers (Moniepoint, Andela, Kuda, FairMoney, Carbon, Jumia, Grey, LemFi, Raenest, PalmPay, Chowdeck, Paga, Cellulant and more) plus remote-friendly global employers. Every board slug was checked against the live API. The lists are in `src/sources/ats.ts`; add a company by testing its careers page against the URL patterns documented at the top of that file.

**Remote-first boards** (filtered to roles a candidate in Nigeria can take: Remote, Africa, Worldwide, or a Nigeria-eligible country list)

* RemoteOK, Remotive, We Work Remotely, Himalayas (Nigeria filter), Jobicy, Working Nomads

**Opportunity blogs** (read through their public RSS feeds and a few post pages per run, one request at a time with a pause between requests)

* Opportunity Desk and Opportunities Corners. Single-opportunity posts and numbered roundups are both parsed. Each item keeps its title, short description, deadline and apply link, and points to the employer's own application page when the post links to one.
* Items past their stated deadline, or whose application form has already closed, are dropped. Scholarships, fellowships, conferences and grants are skipped because they are not jobs.
* Volume is modest: each site's feed holds only its most recent posts (about ten), and most are internships and NGO or UN roles, so expect a handful of matches per run, not hundreds. A run reads at most a few post pages per site to keep the request rate low; the rest use the feed excerpt.

**Social signals** (optional, read-only)

* Public posts from **verified X accounts** that say they are hiring, or that describe a need matching your skills, through the official X API. This needs your own X API bearer token (`xBearerToken`); without it the source is logged as skipped. Every social lead is marked `source: "X (social-signal)"`, `verified: true` and **verify manually**, because a post is not a structured job listing.

**Not covered, and reported as skipped in every run log**

* Instagram: it has no public, unauthenticated search, and scraping it would breach its terms.
* Upwork, Fiverr, Contra, Wellfound, YC Work at a Startup, TechCabal Jobs: no public feed or API, or login required.
* Indeed, LinkedIn Jobs, Glassdoor, Google Jobs: their terms forbid scraping. They are pointer-only sources and are not read.

**How results are kept honest**

* The same role on several sites is merged, keeping the employer or original-source link.
* Listings that say they are closed or filled, older than `maxJobAgeDays`, or restricted to regions that exclude Nigeria (for example "Remote (US)") are dropped.
* Teaching posts (lecturer, instructor and so on) are dropped unless your own target roles ask for them.
* Search terms are expanded with synonyms and Nigerian variants (Data Analyst also searches BI Analyst and Reporting Analyst; Virtual Assistant also searches Admin Assistant and Executive Assistant) and rotated per site, so identical queries are not fired everywhere.
* No single source can fill more than about 30% of the jobs sent for AI evaluation. Nigerian-based listings are boosted when you prefer Nigeria or a Nigerian city.
* A link already sent to you in an earlier run is never sent again.

After discovery, listings from every source go through the same scam screening and evaluation workflow. A per-source **run report** (`RUN_REPORT` in the run's key-value store) lists what was reached and what was skipped.

### Scam Screening

WorkDey checks job listings for signals commonly associated with employment scams.

Examples include:

* Requests for upfront payments
* Training or interview fees
* Suspicious recruitment requirements
* Other patterns identified by the scam-screening logic

Scam screening provides a risk signal. It does not guarantee that a listing is legitimate.

### CV-to-Job Matching

WorkDey compares a candidate's CV with the available job information and produces a compatibility score from **0 to 100**.

The evaluation can consider:

* Relevant skills
* Experience overlap
* Technical requirements
* Role alignment
* Information contained in the job description

Candidates can set their own minimum score threshold.

### Application Pack Generation

For qualifying matches, WorkDey generates a personalized application pack containing:

* Recruiter outreach message
* Tailored cover letter
* CV improvement suggestions
* Facts used from the candidate's CV

The generated materials are grounded in information provided in the candidate's CV rather than inventing credentials or experience.

### Persistent Job Memory

WorkDey maintains a persistent record of previously processed job IDs using an Apify Key-Value Store.

This allows later runs to focus on jobs that have not already been processed.

The `resetMemory` option allows previously seen jobs to be re-evaluated when needed.

### HTML Dashboard

Each run generates an `OUTPUT_DASHBOARD.html` containing the results.

The dashboard includes:

* Job information
* Match scores
* Scam status
* Fit information
* Direct job links
* Recruiter outreach messages
* Cover letters
* CV suggestions

### Email Delivery

Users can optionally provide an email address.

When application packs are generated, WorkDey sends a consolidated report using Apify's `send-mail` Actor.

The email contains the generated application materials and a link to the WorkDey dashboard.


## Input Parameters

| Field                | Type    | Required | Description                                                                   |
| -------------------- | ------- | -------: | ----------------------------------------------------------------------------- |
| `fullName`           | String  |      Yes | Candidate's name used to personalize application materials.                   |
| `cvText`             | String  |      Yes | Plain-text CV or resume content used for matching and application generation. |
| `targetRoles`        | Array   |      Yes | Job titles or keywords to search for.                                         |
| `email`              | String  |       No | Email address for receiving the application report.                           |
| `preferredLocations` | Array   |       No | Preferred locations or work modes such as `Remote`, `Lagos`, or `Worldwide`.  |
| `minScore`           | Integer |       No | Minimum compatibility score from 1 to 100. Default: `60`.                     |
| `maxPacks`           | Integer |       No | Maximum number of application packs generated per run. Default: `2`.          |
| `resetMemory`        | Boolean |       No | Re-evaluate previously processed jobs when set to `true`.                     |
| `maxJobAgeDays`      | Integer |       No | Ignore listings older than this many days. Default: `30`.                     |
| `includeSocialSignals` | Boolean |     No | Scan verified X accounts for hiring signals (needs `xBearerToken`). Default: `true`. |
| `xBearerToken`       | String  |       No | Your own X API v2 bearer token. Stored as a secret and never logged.          |

---

## Example Input

```json
{
  "fullName": "Olamide Lawal",
  "email": "candidate@example.com",
  "targetRoles": [
    "Machine Learning Engineer",
    "Data Scientist"
  ],
  "preferredLocations": [
    "Remote",
    "Lagos",
    "Worldwide"
  ],
  "cvText": "Electronic & Electrical Engineering undergraduate with experience in machine learning, Python, PyTorch, medical imaging, embedded systems, and edge ML deployments.",
  "minScore": 60,
  "maxPacks": 2,
  "resetMemory": true
}
```

## Outputs

### 1. Processed Dataset

Processed jobs are saved to the Actor's default dataset.

Results can include:

* Job title
* Company
* Location
* Job URL
* Source and source category (Nigerian board, career page, remote board, social signal)
* Match score
* Scam status
* Scam reason
* Fit reasons
* Application pack
* Processing timestamp

### 2. HTML Dashboard

WorkDey generates:

```text
OUTPUT_DASHBOARD.html
```

The dashboard provides a visual view of the processed jobs and generated application materials.

### 3. Source Run Report

`RUN_REPORT` in the run's key-value store lists every source, whether it was reached, how many boards answered, how many matching jobs it produced, and why others were skipped or dropped. Check it first if a run returns fewer results than you expect.

### 4. Email Application Report

When an email address is provided and application packs are generated, WorkDey sends an email containing:

* Matched roles
* Match scores
* Job links
* Recruiter outreach messages
* Cover letters
* CV suggestions
* Facts used from the candidate's CV
* Dashboard link

---

## How It Works

```text
Candidate CV + Target Roles
            │
            ▼
       Job Discovery
            │
            ▼
       Job Memory
            │
            ▼
      Scam Screening
            │
            ▼
      CV-Job Evaluation
            │
            ▼
       Match Scoring
            │
            ▼
   Application Pack Generation
            │
       ┌────┴────┐
       ▼         ▼
   Dashboard   Email
       │         │
       └────┬────┘
            ▼
        Final Results
```

## Monetization

WorkDey uses Apify's pay-per-event monetization model.

The current events are:

| Event                    |    Price |
| ------------------------ | -------: |
| Verified Match Found     |   $0.002 |
| Result                   |    $0.01 |
| Application Pack Drafted |    $0.50 |
| Actor Start              | $0.00005 |

Application packs are generated and charged through the Actor's application-pack billing flow.

---

## Important Notes

WorkDey is a career assistance tool, not a hiring platform.

A match score is an estimate based on the information available in the job listing and candidate CV. It does not guarantee that a candidate meets every requirement or that an employer will respond.

Scam screening identifies potential risk signals but cannot guarantee that a job posting is legitimate.

Candidates should review job descriptions and independently verify employers before submitting personal information or applying.


## Technology

WorkDey is built with:

* **TypeScript**
* **Apify Actors**
* **Apify Key-Value Stores**
* **Apify Datasets**
* **Groq**
* **HTML/CSS**


## Project Structure

```text
src/
├── main.ts             # orchestration, memory, billing, dashboard, email
├── scraper.ts          # sweeps every source, quality gates, dedupe, run report
├── selection.ts        # relevance scoring and the per-source diversity cap
├── sources/
│   ├── common.ts       # fetch helpers, role synonyms, location gate, quality gates
│   ├── nigerianBoards.ts
│   ├── ats.ts          # verified company boards on Greenhouse/Lever/Ashby/...
│   ├── remoteBoards.ts
│   ├── opportunity-blogs.ts  # Opportunity Desk / Opportunities Corners feeds and roundups
│   └── social.ts       # verified X accounts via the official API
├── ai.ts
├── scam.ts
├── dashboard.ts
├── email.ts
└── types.ts

.actor/
├── actor.json
├── input_schema.json
├── output_schema.json
└── dataset_schema.json

test/
├── sources.test.ts     # offline tests for parsers, gates and diversity
└── opportunity-blogs.test.ts  # feed, roundup and post-page parsing

package.json
README.md
tsconfig.json
```

## 🚀 Running Locally

Install dependencies:

```bash
npm install
```

Build the Actor:

```bash
npm run build
```

Run the Actor with Apify:

```bash
apify call
```

## Project Goal

WorkDey is designed to make the early stages of job searching more structured and less repetitive.

**Find relevant opportunities. Understand your fit. Prepare better applications.**
