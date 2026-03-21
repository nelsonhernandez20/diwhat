"use client";

import { publicMessageMediaUrl } from "@/lib/message-media-url";
import { useState } from "react";

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  sm: "h-10 w-10 min-h-10 min-w-10 text-base",
  md: "h-12 w-12 min-h-12 min-w-12 text-lg",
};

/** Foto de perfil o de grupo de WhatsApp (subida por el worker a `message_media`). */
export function WaAvatar({
  label,
  waAvatarPath,
  size = "md",
}: {
  label: string;
  waAvatarPath: string | null | undefined;
  size?: Size;
}) {
  const [failed, setFailed] = useState(false);
  const initial = label.trim().slice(0, 1).toUpperCase() || "?";
  const url = waAvatarPath && !failed ? publicMessageMediaUrl(waAvatarPath) : null;
  const dim = sizeClass[size];

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover`}
        src={url}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-brand-primary font-semibold text-white`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
