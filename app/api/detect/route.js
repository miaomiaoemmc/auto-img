import path from "node:path";
import { NextResponse } from "next/server";

import { runPythonJson } from "lib/server/python";
import { saveUpload } from "lib/server/storage";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    const saved = await saveUpload(file);
    const payload = await runPythonJson([
      "detect",
      "--image",
      saved.path,
      "--model",
      path.join(process.cwd(), "face_yolov8s.pt"),
      "--conf",
      "0.25"
    ]);

    return NextResponse.json({
      imageId: saved.id,
      ...payload
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Detection failed." },
      { status: 500 }
    );
  }
}
