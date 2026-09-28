import type { Metadata } from "next";
import { headers } from "next/headers";
import { BRAND } from "../lib/brand";
import { Workspace } from "./workspace-client";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = BRAND.name;
  const description = "将日程、任务、商单、饮食与健身收拢到每天可执行的生活里。";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${BRAND.name} · ${BRAND.tagline}` }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Home() {
  return <Workspace />;
}
