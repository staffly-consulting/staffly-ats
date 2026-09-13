"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Every toast previously resolved to `--normal-bg` / `--normal-text`,
          // so a failed payment and a saved draft were the same popover in the
          // same near-black text. The only thing distinguishing them was a
          // small monochrome icon in the corner.
          //
          // Each variant now carries a tinted surface, a matching border, and a
          // coloured icon. Colour is the fast signal, but it is never the ONLY
          // one: the icons set above still differ per type, so this reads
          // correctly for colour-blind users and in forced-colours mode.
          //
          // Tinted rather than saturated fills: a toast sits above real content
          // and a solid red panel bottom-right is louder than an error in a
          // recruiting tool warrants. Borders and icons carry the hue; body
          // text stays on `--foreground` so it keeps full contrast against the
          // tint in both themes.
          toast: "cn-toast",
          success:
            "!border-success/30 !bg-success/10 !text-foreground [&_[data-icon]]:!text-success",
          error:
            "!border-danger/35 !bg-danger/10 !text-foreground [&_[data-icon]]:!text-danger",
          warning:
            "!border-warning/35 !bg-warning/10 !text-foreground [&_[data-icon]]:!text-warning",
          info: "!border-brand/30 !bg-brand/10 !text-foreground [&_[data-icon]]:!text-brand",
          loading:
            "!border-border !bg-popover !text-foreground [&_[data-icon]]:!text-muted-foreground",
          description: "!text-muted-foreground",
          actionButton: "!bg-foreground !text-background",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
