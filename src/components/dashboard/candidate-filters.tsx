"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Flag, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCORE_FILTER_OPTIONS } from "@/lib/score";
import { cn, pluralize } from "@/lib/utils";

/**
 * The candidate filter bar, now backed by real data.
 *
 * State lives in the URL rather than in component state: the filtering happens
 * in SQL on the server, so the URL is what the query reads. That also makes a
 * filtered view shareable and survivable across a refresh.
 *
 * Search is the one exception — it filters names and emails client-side,
 * because a `LIKE` across two columns per keystroke is not worth a round trip
 * at this scale.
 */

/** Radix Select disallows an empty-string value. */
export const ANY = "all";

export function CandidateFilterBar({
  universities,
  nationalities,
  resultCount,
  totalCount,
  query,
  onQueryChange,
}: {
  universities: string[];
  nationalities: string[];
  resultCount: number;
  totalCount: number;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const minScore = searchParams.get("minScore") ?? "0";
  const university = searchParams.get("university") ?? ANY;
  const nationality = searchParams.get("nationality") ?? ANY;
  const referralOnly = searchParams.get("referral") === "1";
  const flaggedOnly = searchParams.get("flagged") === "1";
  const unreadOnly = searchParams.get("unread") === "1";
  const decision = searchParams.get("decision") ?? ANY;

  const hasServerFilter =
    minScore !== "0" ||
    university !== ANY ||
    nationality !== ANY ||
    referralOnly ||
    flaggedOnly ||
    unreadOnly ||
    decision !== ANY;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "" || value === "0" || value === ANY) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    startTransition(() => {
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    });
  }

  function clearAll() {
    onQueryChange("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3 shadow-xs transition-opacity",
        pending && "opacity-60",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search name or email"
            aria-label="Search candidates"
            className="pl-8"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
          <Select
            value={minScore}
            onValueChange={(value) => setParam("minScore", value)}
          >
            <SelectTrigger
              className="w-full lg:w-40"
              aria-label="Minimum score"
            >
              <SelectValue placeholder="Any score" />
            </SelectTrigger>
            <SelectContent>
              {SCORE_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* The human decision, kept next to the score filter because the two
              answer adjacent questions: what the model thought, and what a
              person concluded. "Not yet decided" is the working queue. */}
          <Select
            value={decision}
            onValueChange={(value) => setParam("decision", value)}
          >
            <SelectTrigger
              className="w-full lg:w-44"
              aria-label="Hiring decision"
            >
              <SelectValue placeholder="Any decision" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any decision</SelectItem>
              <SelectItem value="SHORTLISTED">Shortlisted</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="undecided">Not yet decided</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={university}
            onValueChange={(value) => setParam("university", value)}
          >
            <SelectTrigger className="w-full lg:w-52" aria-label="University">
              <SelectValue placeholder="Any university" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any university</SelectItem>
              {universities.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={nationality}
            onValueChange={(value) => setParam("nationality", value)}
          >
            <SelectTrigger className="w-full lg:w-44" aria-label="Nationality">
              <SelectValue placeholder="Any nationality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any nationality</SelectItem>
              {nationalities.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="referral-only"
              checked={referralOnly}
              onCheckedChange={(checked) =>
                setParam("referral", checked === true ? "1" : null)
              }
            />
            <Label htmlFor="referral-only" className="text-sm font-normal">
              Referrals only
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="flagged-only"
              checked={flaggedOnly}
              onCheckedChange={(checked) =>
                setParam("flagged", checked === true ? "1" : null)
              }
            />
            <Label
              htmlFor="flagged-only"
              className="flex items-center gap-1 text-sm font-normal"
            >
              <Flag className="size-3 text-warning" />
              Flagged
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="unread-only"
              checked={unreadOnly}
              onCheckedChange={(checked) =>
                setParam("unread", checked === true ? "1" : null)
              }
            />
            <Label
              htmlFor="unread-only"
              className="flex items-center gap-1 text-sm font-normal"
            >
              <span aria-hidden className="size-2 rounded-full bg-brand" />
              Unopened
            </Label>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <p className="text-xs text-muted-foreground tabular-nums">
          Showing {resultCount} of {totalCount}{" "}
          {pluralize(totalCount, "candidate")}
          {minScore !== "0" ? (
            <span className="ml-1">· unscored candidates are excluded</span>
          ) : null}
        </p>
        {hasServerFilter || query !== "" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={clearAll}
          >
            <X className="size-3.5" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}
