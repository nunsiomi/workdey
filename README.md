# WorkDey: Autonomous AI Career Scout & Match Agent

**WorkDey** is an AI-powered career agent that discovers live job opportunities, evaluates candidate-job fit, screens listings for scam signals, and generates tailored application materials for relevant roles.

It helps candidates reduce the time spent searching through job listings, assessing opportunities, and preparing individual applications.


## What is WorkDey?

WorkDey automates the early stages of the job search process.

It:

1. **Discovers live jobs** from supported job feeds.
2. **Screens listings for scam signals** before they are considered for matching.
3. **Evaluates CV-to-job fit** using AI and produces a compatibility score.
4. **Generates application packs** for qualifying matches.
5. **Creates an HTML dashboard** containing the results and application materials.
6. **Sends application packs by email** when an email address is provided.
7. **Remembers previously processed jobs** to avoid repeatedly processing the same listings.


## Key Features

### Live Job Discovery

WorkDey currently retrieves job listings from:

* RemoteOK
* Remotive
* BambooHR

Listings from these sources are normalized and processed through the same evaluation workflow.

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
* Source
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

### 3. Email Application Report

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
├── main.ts
├── ai.ts
├── email.ts
└── types.ts

.actor/
└── actor.json

input_schema.json
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
