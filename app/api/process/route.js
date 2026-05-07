import { NextResponse } from "next/server";

import { runPythonJson } from "lib/server/python";
import { resolveUploadPath } from "lib/server/storage";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const imagePath = await resolveUploadPath(body.imageId);

    if (!body.keepBox && !body.eraseBoxes?.length) {
      return NextResponse.json({ error: "Missing selected face action." }, { status: 400 });
    }

    const args = [
      "process",
      "--image",
      imagePath,
      "--face-ratio",
      String(body.faceRatio ?? 0.45)
    ];

    if (body.keepBox) {
      args.push("--keep-box-json", JSON.stringify(body.keepBox));
    }

    if (body.eraseBoxes?.length) {
      args.push("--erase-boxes-json", JSON.stringify(body.eraseBoxes));
    }

    const payload = await runPythonJson(args);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed." },
      { status: 500 }
    );
  }
}
