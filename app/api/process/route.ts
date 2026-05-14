import { NextResponse } from "next/server";

const API_BASE = process.env.API_BASE_URL || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const response = await fetch(`${API_BASE}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Processing service error." }));
      return NextResponse.json(
        { error: error.detail || "Processing failed." },
        { status: response.status }
      );
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed." },
      { status: 500 }
    );
  }
}
