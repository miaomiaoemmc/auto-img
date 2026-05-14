import { NextResponse } from "next/server";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.append("file", file);
    upstream.append("conf", String(formData.get("conf") ?? "0.25"));

    const response = await fetch(`${API_BASE}/detect`, {
      method: "POST",
      body: upstream,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Detection service error." }));
      return NextResponse.json(
        { error: error.detail || "Detection failed." },
        { status: response.status }
      );
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Detection failed." },
      { status: 500 }
    );
  }
}
