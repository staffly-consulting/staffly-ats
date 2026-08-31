"use client";

import { useState, useTransition } from "react";

import {
  Check,
  Copy,
  Forward,
  Mail,
  PlugZap,
  Power,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import {
  connectInboxAction,
  disconnectInboxAction,
} from "@/app/(dashboard)/dashboard/settings/email/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EmailInboxSummary } from "@/lib/email-inbox";
import { cn, formatDate } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Step cards                                                                  */
/* -------------------------------------------------------------------------- */

function StepCard({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-card p-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground tabular-nums">
        {step}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {children ? (
          <div className="text-xs leading-relaxed text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CopyAliasButton({ alias }: { alias: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(alias);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Address copied");
    } catch {
      // Clipboard access needs a secure context and can be denied outright.
      toast.error("Could not copy", {
        description: "Select and copy manually.",
      });
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Not yet connected                                                           */
/* -------------------------------------------------------------------------- */

function ConnectCard() {
  const [pending, startTransition] = useTransition();

  function connect() {
    startTransition(async () => {
      const result = await connectInboxAction();
      if (!result.ok) {
        toast.error("Could not connect", { description: result.error });
        return;
      }
      toast.success("Forwarding address created");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="size-4 text-brand" />
          Connect your HR inbox
        </CardTitle>
        <CardDescription>
          Staffly gives your organization a private forwarding address. Point a
          rule in your existing HR inbox at it, and every application that
          arrives is ingested automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-2">
          <StepCard step={1} title="Generate your forwarding address">
            A unique address on our mail domain, belonging only to this
            organization.
          </StepCard>
          <StepCard step={2} title="Add it as a forwarding rule">
            In Gmail or Outlook, forward mail from your careers address to it.
          </StepCard>
          <StepCard step={3} title="Resumes appear in your inbox view">
            Attachments are stored and turned into candidate records.
          </StepCard>
        </ol>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Forwarding only — Staffly never gets access to your mailbox, and can
            only see what you choose to forward. Treat the generated address as
            a secret: anyone who has it can submit applications to your
            organization.
          </span>
        </div>

        <Button onClick={connect} disabled={pending}>
          {pending ? "Generating…" : "Generate forwarding address"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Connected                                                                   */
/* -------------------------------------------------------------------------- */

function StatusRow({ inbox }: { inbox: EmailInboxSummary }) {
  const waiting = inbox.ingestedCount === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!inbox.isActive ? (
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          Disconnected
        </Badge>
      ) : waiting ? (
        <Badge
          variant="outline"
          className="border-warning/25 bg-warning/14 text-warning"
        >
          Waiting for first email…
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="border-success/25 bg-success/12 text-success"
        >
          Connected
        </Badge>
      )}

      {inbox.lastReceivedAt ? (
        <span className="text-xs text-muted-foreground">
          Last resume received {formatDate(inbox.lastReceivedAt)} ·{" "}
          <span className="tabular-nums">{inbox.ingestedCount}</span> total
        </span>
      ) : null}
    </div>
  );
}

function GmailSteps({ alias }: { alias: string }) {
  return (
    <ol className="space-y-2">
      <StepCard
        step={1}
        title="Settings → See all settings → Forwarding and POP/IMAP"
      />
      <StepCard step={2} title="Add a forwarding address">
        Paste <span className="font-mono text-[11px]">{alias}</span> and
        confirm.
      </StepCard>
      <StepCard step={3} title="Verify">
        Gmail emails a confirmation link to the address. It arrives here — check
        your Staffly inbox view, or ask us to surface it if it does not appear.
      </StepCard>
      <StepCard step={4} title="Create a filter, do not forward everything">
        Filters → Create a new filter → To:{" "}
        <span className="font-mono text-[11px]">hr@yourcompany.com</span> →
        Forward it to the address above. Forwarding the whole mailbox sends us
        mail you did not intend to share.
      </StepCard>
    </ol>
  );
}

function OutlookSteps({ alias }: { alias: string }) {
  return (
    <ol className="space-y-2">
      <StepCard step={1} title="Settings → Mail → Rules" />
      <StepCard step={2} title="Add new rule">
        Name it something like &ldquo;Forward applications to Staffly&rdquo;.
      </StepCard>
      <StepCard step={3} title="Add a condition">
        <em>To or Cc</em> contains{" "}
        <span className="font-mono text-[11px]">hr@yourcompany.com</span>, or{" "}
        <em>Subject includes</em> the word &ldquo;application&rdquo;.
      </StepCard>
      <StepCard step={4} title="Add the action">
        <em>Forward to</em>{" "}
        <span className="font-mono text-[11px]">{alias}</span>, then save. Keep
        &ldquo;Stop processing more rules&rdquo; unchecked if other rules
        matter.
      </StepCard>
    </ol>
  );
}

function ConnectedCard({ inbox }: { inbox: EmailInboxSummary }) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = inbox.isActive
        ? await disconnectInboxAction()
        : await connectInboxAction();

      if (!result.ok) {
        toast.error("Could not update", { description: result.error });
        return;
      }
      toast.success(
        inbox.isActive ? "Inbox disconnected" : "Inbox reconnected",
      );
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-brand" />
            Your forwarding address
          </CardTitle>
          <CardDescription>
            Forward applications here from your existing HR inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <code
              className={cn(
                "min-w-0 flex-1 font-mono text-sm break-all",
                !inbox.isActive && "text-muted-foreground line-through",
              )}
            >
              {inbox.forwardingAlias}
            </code>
            <CopyAliasButton alias={inbox.forwardingAlias} />
          </div>

          <StatusRow inbox={inbox} />

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {inbox.isActive
                ? "Disconnecting stops ingestion. Your address and every candidate already received are kept."
                : "Reconnecting reuses the same address, so your existing forwarding rule keeps working."}
            </p>
            <Button
              variant={inbox.isActive ? "outline" : "default"}
              size="sm"
              onClick={toggle}
              disabled={pending}
            >
              <Power className="size-3.5" />
              {inbox.isActive ? "Disconnect" : "Reconnect"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Forward className="size-4 text-muted-foreground" />
            Set up forwarding
          </CardTitle>
          <CardDescription>
            Forward only your careers address, not your whole mailbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="gmail">
            <TabsList>
              <TabsTrigger value="gmail">Gmail</TabsTrigger>
              <TabsTrigger value="outlook">Outlook / Microsoft 365</TabsTrigger>
            </TabsList>
            <TabsContent value="gmail" className="mt-3">
              <GmailSteps alias={inbox.forwardingAlias} />
            </TabsContent>
            <TabsContent value="outlook" className="mt-3">
              <OutlookSteps alias={inbox.forwardingAlias} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

export function EmailConnection({
  inbox,
}: {
  inbox: EmailInboxSummary | null;
}) {
  return inbox ? <ConnectedCard inbox={inbox} /> : <ConnectCard />;
}
