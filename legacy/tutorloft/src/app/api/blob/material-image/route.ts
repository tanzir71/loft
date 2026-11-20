import { NextResponse } from "next/server";

import { requireTutor } from "@/lib/authz";
import { hasBlob } from "@/lib/features";

type VercelBlobModule = {
  put: (
    pathname: string,
    body: File,
    options: { access: "public" },
  ) => Promise<{ url: string }>;
};

export async function POST(request: Request) {
  await requireTutor();

  if (!hasBlob()) {
    return NextResponse.json({ error: "Blob uploads are not enabled." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  try {
    const packageName = "@vercel/blob";
    const { put } = (await import(packageName)) as VercelBlobModule;
    const blob = await put(`materials/${Date.now()}-${file.name}`, file, { access: "public" });
    return NextResponse.json(blob);
  } catch {
    return NextResponse.json(
      { error: "@vercel/blob is not installed in this workspace." },
      { status: 501 },
    );
  }
}
