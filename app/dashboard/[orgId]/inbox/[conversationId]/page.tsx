import { ConversationThread } from "@/components/conversation-thread";
import { WaAvatar } from "@/components/wa-avatar";
import { requireOrgMember } from "@/lib/auth/org";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

function waPhoneFromChatId(waChatId: string) {
  return waChatId.split("@")[0] ?? waChatId;
}

function threadTitle(customerLabel: string | null, waChatId: string) {
  const phone = waPhoneFromChatId(waChatId);
  return customerLabel?.trim() || phone;
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ orgId: string; conversationId: string }>;
}) {
  const { orgId, conversationId } = await params;
  const { supabase } = await requireOrgMember(orgId);

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, customer_label, wa_chat_id, wa_avatar_path")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (convErr || !conv) notFound();

  await supabase
    .from("conversations")
    .update({ last_read_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  const phone = waPhoneFromChatId(conv.wa_chat_id);
  const title = threadTitle(conv.customer_label, conv.wa_chat_id);

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
      <header className="flex shrink-0 items-center gap-3 bg-[#fafbfc] px-3 py-3 sm:px-4">
        <Link
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-brand-primary hover:bg-brand-hover md:hidden"
          href={`/dashboard/${orgId}/inbox`}
          aria-label="Volver a la bandeja"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <WaAvatar label={title} size="sm" waAvatarPath={conv.wa_avatar_path} />
        <div className="min-w-0 flex-1 pl-0 md:pl-0">
          <h1 className="truncate text-lg font-bold text-brand-text">{title}</h1>
          <p className="truncate text-xs text-brand-muted">
            {title !== phone ? phone : conv.wa_chat_id}
          </p>
        </div>
      </header>

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
