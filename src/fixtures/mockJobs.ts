import { JobPost } from '../types.js';

export const MOCK_JOBS: JobPost[] = [
  {
    id: "job-1",
    title: "Junior Data Analyst",
    company: "PayWave Africa",
    location: "Lagos (Hybrid)",
    url: "https://example.com/jobs/junior-data-analyst",
    postedAt: "2026-09-23",
    source: "Jobberman",
    rawText: "Looking for an entry-level Data Analyst in Lagos. Must know SQL, Python (Pandas), and Tableau or PowerBI. NYSC completion certificate required. Responsibilities include building reporting dashboards and cleaning customer transaction datasets."
  },
  {
    id: "job-2",
    title: "Executive Trainee - Recruitment Fee Required",
    company: "FastTrack Global Ventures",
    location: "Ikeja, Lagos",
    url: "https://example.com/jobs/fasttrack-trainee",
    postedAt: "2026-09-24",
    source: "Online Board",
    rawText: "Immediate opening for graduate trainees. Earn up to ₦350,000 monthly. Selected candidates must pay a refundable administrative and interview processing fee of ₦8,500 via bank transfer before screening date."
  },
  {
    id: "job-3",
    title: "Python / AI Engineer Intern",
    company: "Kuda Microfinance Bank",
    location: "Remote (Nigeria)",
    url: "https://example.com/jobs/python-ai-intern",
    postedAt: "2026-09-22",
    source: "RemoteOK",
    rawText: "We are seeking a motivated Python & ML Intern. Experience with Scikit-learn, Pandas, and building REST APIs. Must be based in Nigeria with reliable electricity and internet. NYSC candidates welcome."
  }
];