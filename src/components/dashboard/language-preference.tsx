"use client";

import { useState, useTransition } from "react";

import { Languages } from "lucide-react";
import { toast } from "sonner";

import { updatePreferredLanguageAction } from "@/app/(dashboard)/dashboard/profile/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGES, LANGUAGE_ORDER, languageLabel } from "@/lib/languages";
import type { Language } from "@prisma/client";

/**
 * Interface language for this account.
 *
 * Saves on change rather than behind a Save button — a single dropdown with
 * nothing else to confirm reads as a setting, not a form.
 *
 * The optimistic value is rolled back if the action fails, so what is on screen
 * always matches what is in the database.
 */
export function LanguagePreference({
  initialLanguage,
}: {
  initialLanguage: Language;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (!(next in LANGUAGES)) return;
    const value = next as Language;
    const previous = language;

    setLanguage(value);

    startTransition(async () => {
      const result = await updatePreferredLanguageAction(value);
      if (result.ok) {
        toast.success(`Language set to ${languageLabel(value)}.`);
      } else {
        setLanguage(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Languages className="size-4 text-muted-foreground" />
          Language
        </CardTitle>
        <CardDescription>
          Your preferred language. This applies to your account across every
          organization you belong to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="preferred-language">Preferred language</Label>
          <Select
            value={language}
            onValueChange={handleChange}
            disabled={pending}
          >
            <SelectTrigger id="preferred-language" className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_ORDER.map((code) => (
                <SelectItem key={code} value={code}>
                  {languageLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Said plainly rather than left for the user to discover: the
            preference is stored, but no screen reads from it yet. */}
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          Your choice is saved, but the interface is{" "}
          <strong className="font-medium">still English everywhere</strong> —
          nothing is translated yet. Setting it now means the app will already
          know your language when translations ship.
        </p>
      </CardContent>
    </Card>
  );
}
