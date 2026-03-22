import { InboxShell } from "@/components/inbox-shell";
import { requireOrgMember } from "@/lib/auth/org";
import { INBOX_CONVERSATIONS_INITIAL } from "@/lib/inbox-conversations-query";
import { sortInboxConversations } from "@/lib/inbox-sort";
import { unstable_noStore as noStore } from "next/cache";

export default async function InboxLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  noStore();
  const { orgId } = await params;
  const { supabase } = await requireOrgMember(orgId);

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select(
      "id, customer_label, customer_display_name, wa_chat_id, last_message_at, wa_avatar_path, last_inbound_at, last_read_at",
    )
    .eq("organization_id", orgId)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(INBOX_CONVERSATIONS_INITIAL);

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
