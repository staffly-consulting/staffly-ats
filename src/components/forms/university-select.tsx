"use client";

import { useState, useTransition } from "react";

import { Check, ChevronsUpDown, GraduationCap, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { createUniversityPreferenceAction } from "@/app/(dashboard)/dashboard/jobs/universities.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { UniversityOption } from "@/lib/universities";
import { cn } from "@/lib/utils";

/**
 * Multi-select over the org's `UniversityPreference` rows, with an inline
 * quick-add so a recruiter never has to abandon a half-filled form to go
 * create a school first.
 *
 * The selected ids are stored on the job post's criteria JSON rather than in a
 * join table — see `writeOptionalCriteria`. That keeps this a lightweight
 * association for the MVP.
 */
export function UniversitySelect({
  options,
  selectedIds,
  onChange,
}: {
  options: UniversityOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  // Locally appended rows, so a newly created school appears immediately
  // without a router refresh discarding the rest of the form.
  const [extraOptions, setExtraOptions] = useState<UniversityOption[]>([]);

  const allOptions = [...options, ...extraOptions];
  const selected = allOptions.filter((option) =>
    selectedIds.includes(option.id),
  );

  const trimmed = query.trim();
  const alreadyExists = allOptions.some(
    (option) => option.name.toLowerCase() === trimmed.toLowerCase(),
  );

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id],
    );
  }

  function quickAdd() {
    if (!trimmed || pending) return;

    startTransition(async () => {
      const result = await createUniversityPreferenceAction({
        name: trimmed,
        tier: 1,
      });

      if (!result.ok) {
        toast.error("Could not add university", { description: result.error });
        return;
      }

      const { university } = result;
      setExtraOptions((current) =>
        current.some((option) => option.id === university.id)
          ? current
          : [...current, university],
      );
      if (!selectedIds.includes(university.id)) {
        onChange([...selectedIds, university.id]);
      }
      setQuery("");
      toast.success(`Added ${university.name}`);
    });
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <GraduationCap className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {selected.length === 0
                  ? "Select preferred universities"
                  : `${selected.length} selected`}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command
            // Filtering is done by Command itself over the visible items.
            loop
          >
            <CommandInput
              placeholder="Search or type a new name…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty className="p-3 text-sm">
                {trimmed === "" ? (
                  <span className="text-muted-foreground">
                    No universities saved yet. Type a name to add one.
                  </span>
                ) : null}
              </CommandEmpty>

              {allOptions.length > 0 ? (
                <CommandGroup>
                  {allOptions.map((option) => {
                    const isSelected = selectedIds.includes(option.id);
                    return (
                      <CommandItem
                        key={option.id}
                        value={option.name}
                        onSelect={() => toggle(option.id)}
                      >
                        <Check
                          className={cn(
                            "size-4",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{option.name}</span>
                        <Badge
                          variant="outline"
                          className="ml-auto text-[10px] font-normal text-muted-foreground"
                        >
                          Tier {option.tier}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}

              {trimmed !== "" && !alreadyExists ? (
                <CommandGroup>
                  <CommandItem
                    // `forceMount`-style: give it a value that always matches
                    // the current query so Command never filters it away.
                    value={trimmed}
                    onSelect={quickAdd}
                    disabled={pending}
                  >
                    <Plus className="size-4" />
                    {pending ? "Adding…" : `Add “${trimmed}”`}
                  </CommandItem>
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <Badge
              key={option.id}
              variant="outline"
              className="gap-1 border-brand/25 bg-brand/10 py-1 text-brand"
            >
              {option.name}
              <button
                type="button"
                onClick={() => toggle(option.id)}
                className="rounded-full transition-opacity hover:opacity-70"
              >
                <X className="size-3" />
                <span className="sr-only">Remove {option.name}</span>
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
