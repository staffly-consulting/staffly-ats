"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
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
 * nothing else to confirm reads as a setting, not a form. The page is then
 * refreshed so the new language takes effect immediately.
 *
 * The optimistic value is rolled back if the action fails, so what is on screen
 * always matches what is in the database.
 */
export function LanguagePreference({
  initialLanguage,
}: {
  initialLanguage: Language;
}) {
  const t = useTranslations("language");
  const router = useRouter();
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
        toast.success(t("saved", { language: languageLabel(value) }));
        // The messages for the whole app are resolved on the SERVER, per
        // request, from this preference. Without a refresh the page keeps the
        // bundle it was rendered with and nothing visibly changes — which is
        // exactly what "I picked Thai and nothing happened" looks like.
        router.refresh();
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
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="preferred-language">{t("label")}</Label>
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

      </CardContent>
    </Card>
  );
}
