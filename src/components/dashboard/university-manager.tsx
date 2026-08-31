"use client";

import { useState, useTransition } from "react";

import {
  Check,
  GraduationCap,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createUniversityAction,
  deleteUniversityAction,
  updateUniversityAction,
} from "@/app/(dashboard)/dashboard/settings/universities.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UniversityOption } from "@/lib/universities";
import { pluralize } from "@/lib/utils";

/**
 * Standalone list / edit / delete for the org's preferred universities.
 *
 * Additive: the quick-add inside the job post form still works and writes the
 * same rows. This is the screen for curating the list afterwards.
 *
 * Tier is a ranking, 1 = most preferred. It carries no scoring weight today —
 * the university bonus is flat (+5) for any match — so the UI says so rather
 * than implying the number does something it does not.
 */

const TIERS = [1, 2, 3, 4, 5];

function TierSelect({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (next: number) => void;
  id?: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="w-28" aria-label="Tier">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIERS.map((tier) => (
          <SelectItem key={tier} value={String(tier)}>
            Tier {tier}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UniversityManager({
  universities,
  locked = false,
}: {
  universities: UniversityOption[];
  /** True when the org's plan does not include university preferences. */
  locked?: boolean;
}) {
  const [transitionPending, startTransition] = useTransition();
  // Locked orgs get a read-only view. The server actions reject them anyway —
  // this only stops them discovering that by clicking.
  const pending = transitionPending || locked;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftTier, setDraftTier] = useState(1);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState(1);

  function beginEdit(option: UniversityOption) {
    setEditingId(option.id);
    setDraftName(option.name);
    setDraftTier(option.tier);
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const result = await updateUniversityAction(id, {
        name: draftName,
        tier: draftTier,
      });
      if (!result.ok) {
        toast.error("Could not save", { description: result.error });
        return;
      }
      setEditingId(null);
      toast.success("University updated");
    });
  }

  function remove(option: UniversityOption) {
    startTransition(async () => {
      const result = await deleteUniversityAction(option.id);
      if (!result.ok) {
        toast.error("Could not delete", { description: result.error });
        return;
      }
      toast.success(`Removed ${option.name}`, {
        description:
          "Job posts that referenced it keep working; the reference is ignored.",
      });
    });
  }

  function add() {
    if (newName.trim() === "") return;
    startTransition(async () => {
      const result = await createUniversityAction({
        name: newName,
        tier: newTier,
      });
      if (!result.ok) {
        toast.error("Could not add", { description: result.error });
        return;
      }
      setNewName("");
      setNewTier(1);
      toast.success("University added");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="size-4 text-brand" />
          Preferred universities
        </CardTitle>
        <CardDescription>
          Candidates from these schools receive a small flat bonus (+5) when a
          job post selects them. Tier is a label for your own ranking — it does
          not currently affect the score.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {locked ? (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              University preferences require the Pipeline plan or above. Your
              existing entries are kept and will work again after an upgrade.
            </span>
          </div>
        ) : null}

        {universities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No universities saved yet. Add one below, or quick-add from the job
            post form.
          </p>
        ) : (
          <ul className="space-y-2">
            {universities.map((option) => (
              <li
                key={option.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5"
              >
                {editingId === option.id ? (
                  <>
                    <Input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      className="min-w-0 flex-1"
                      aria-label="University name"
                    />
                    <TierSelect value={draftTier} onChange={setDraftTier} />
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => saveEdit(option.id)}
                    >
                      <Check className="size-4 text-success" />
                      <span className="sr-only">Save</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-4" />
                      <span className="sr-only">Cancel</span>
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {option.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-muted-foreground tabular-nums"
                    >
                      Tier {option.tier}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => beginEdit(option)}
                    >
                      <Pencil className="size-3.5" />
                      <span className="sr-only">Edit {option.name}</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-danger"
                      disabled={pending}
                      onClick={() => remove(option)}
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Delete {option.name}</span>
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border/70 pt-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="new-university" className="text-xs">
              Add a university
            </Label>
            <Input
              id="new-university"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              placeholder="Imperial College London"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-tier" className="text-xs">
              Tier
            </Label>
            <TierSelect id="new-tier" value={newTier} onChange={setNewTier} />
          </div>
          <Button
            variant="outline"
            disabled={pending || newName.trim() === ""}
            onClick={add}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        <p className="text-xs text-muted-foreground tabular-nums">
          {universities.length}{" "}
          {pluralize(universities.length, "university", "universities")} saved
        </p>
      </CardContent>
    </Card>
  );
}
