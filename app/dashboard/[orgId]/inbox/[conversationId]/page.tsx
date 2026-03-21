import { ConversationDisplayNameHeader } from "@/components/conversation-display-name-header";
import { ConversationThread } from "@/components/conversation-thread";
import { requireOrgMember } from "@/lib/auth/org";
import { notFound } from "next/navigation";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ orgId: string; conversationId: string }>;
}) {
  const { orgId, conversationId } = await params;
  const { supabase } = await requireOrgMember(orgId);

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, customer_label, customer_display_name, wa_chat_id, wa_avatar_path")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (convErr || !conv) notFound();

  await supabase
    .from("conversations")
    .update({ last_read_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select(
      "id, body, direction, visibility, created_at, sender_user_id, content_type, media_path, reply_to_message_id",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (msgErr) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
        Error: {msgErr.message}
      </p>
    );
  }

  const senderIds = [
    ...new Set(
      (messages ?? [])
        .map((m) => m.sender_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: profiles } =
    senderIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", senderIds)
      : { data: [] as { id: string; display_name: string | null }[] };

  const nameById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.display_name ?? "Equipo"]),
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <ConversationDisplayNameHeader
        conversationId={conversationId}
        customerDisplayName={conv.customer_display_name}
        customerLabel={conv.customer_label}
        orgId={orgId}
        waAvatarPath={conv.wa_avatar_path}
        waChatId={conv.wa_chat_id}
      />

      <div className="flex min-h-0 flex-1 flex-col bg-brand-chat">
        <ConversationThread
          conversationId={conversationId}
          initialMessages={messages ?? []}
          initialNameById={nameById}
          orgId={orgId}
        />
      </div>
    </div>
  );
}
