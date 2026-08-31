import Link from "next/link";

import { ArrowRight, Filter, Mail, ScanLine, ShieldCheck } from "lucide-react";

import { ScoreRing } from "@/components/dashboard/score-indicator";
import { StafflyLogo } from "@/components/staffly-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: Mail,
    title: "Applications arrive by email",
    body: "Every job post gets its own inbound address. Forward your careers inbox once and applications land in Staffly automatically.",
  },
  {
    icon: ScanLine,
    title: "Resumes are read and structured",
    body: "Contact details, education, experience and skills are extracted into fields you can filter on — no manual data entry.",
  },
  {
    icon: Filter,
    title: "Candidates are scored on your criteria",
    body: "Define what matters per role, weight it, and get a 0–100 score with a written rationale for every single criterion.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-svh bg-background">
      {/* TODO(marketing): this is a placeholder shell — real copy, pricing and
          auth entry points land alongside Supabase auth. */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <StafflyLogo href="/" />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard">Open dashboard</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 -z-10 bg-linear-to-b from-brand-subtle/70 via-background to-background" />
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="space-y-6">
                <Badge
                  variant="outline"
                  className="h-6 border-brand/25 bg-brand/10 text-brand"
                >
                  AI screening for lean recruiting teams
                </Badge>
                <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                  Read every application.
                  <span className="text-brand"> Shortlist in minutes.</span>
                </h1>
                <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
                  Staffly ATS+ ingests applications from your inbox, extracts
                  what matters from each resume, and scores candidates against
                  the criteria you set — with a rationale you can defend.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild size="lg">
                    <Link href="/dashboard">
                      Explore the dashboard
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/dashboard/jobs/new">Create a job post</Link>
                  </Button>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  Multi-tenant by design — each organisation&apos;s data stays
                  its own.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Senior Backend Engineer
                    </p>
                    <p className="text-xs text-muted-foreground">
                      10 applicants · 4 above threshold
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-success/25 bg-success/12 text-success"
                  >
                    Open
                  </Badge>
                </div>

                <ul className="mt-5 space-y-2.5">
                  {[
                    {
                      name: "Mariam Haddad",
                      detail: "8 yrs · Lisbon",
                      score: 92,
                    },
                    {
                      name: "Sofia Lindqvist",
                      detail: "9 yrs · Stockholm",
                      score: 88,
                    },
                    {
                      name: "Tomás Ferreira",
                      detail: "6 yrs · São Paulo",
                      score: 78,
                    },
                    {
                      name: "Jonas Weber",
                      detail: "4 yrs · Munich",
                      score: 34,
                    },
                  ].map((candidate) => (
                    <li
                      key={candidate.name}
                      className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
                    >
                      <ScoreRing score={candidate.score} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {candidate.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {candidate.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.title}
                className="rounded-xl border border-border bg-card p-5 shadow-xs"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <step.icon className="size-4.5" />
                </span>
                <h2 className="mt-4 text-sm font-semibold">{step.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <StafflyLogo href={null} className="text-xs" />
          <p>Scaffold build · not connected to a database yet.</p>
        </div>
      </footer>
    </div>
  );
}
