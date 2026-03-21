import { InboxShell } from "@/components/inbox-shell";
import { requireOrgMember } from "@/lib/auth/org";
import { sortInboxConversations } from "@/lib/inbox-sort";

export default async function InboxLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { supabase } = await requireOrgMember(orgId);

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, customer_label, wa_chat_id, last_message_at, wa_avatar_path, last_inbound_at, last_read_at")
    .eq("organization_id", orgId)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
        Error: {error.message}
      </p>
    );
  }

  const ordered = sortInboxConversations(conversations ?? []);

  return (
    <InboxShell initialConversations={ordered} orgId={orgId}>
      {children}
    </InboxShell>
  );
}
