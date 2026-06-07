import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  imageBase64: string;
  confidence?: number;
  imgsz?: number;
  augment?: boolean;
};

function stripBase64Prefix(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + "base64,".length) : b64;
}

const DEFAULT_VISION = "http://127.0.0.1:8787";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const imageBase64 = stripBase64Prefix(body.imageBase64?.trim() ?? "");
  if (!imageBase64) {
    return NextResponse.json({ error: "Missing imageBase64." }, { status: 400 });
  }

  const confidence =
    typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 1
      ? body.confidence
      : 0.25;

  const imgsz =
    typeof body.imgsz === "number" &&
    Number.isFinite(body.imgsz) &&
    body.imgsz >= 320 &&
    body.imgsz <= 2048
      ? Math.round(body.imgsz / 32) * 32
      : undefined;

  const augment = typeof body.augment === "boolean" ? body.augment : undefined;

  const base = (process.env.CARD_VISION_SERVER_URL || DEFAULT_VISION).replace(/\/+$/, "");
  const url = `${base}/infer`;

  const pyBody: Record<string, unknown> = {
    imageBase64,
    confidence,
  };
  if (imgsz !== undefined) pyBody.imgsz = imgsz;
  if (augment !== undefined) pyBody.augment = augment;

  let py: Response;
  try {
    py = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pyBody),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    return NextResponse.json(
      {
        error: `Cannot reach card-vision server at ${base}: ${msg}`,
        hint: "From csv-card-editor run npm run vision:deps once, then npm run dev (starts Next + vision) or npm run vision-server.",
      },
      { status: 503 },
    );
  }

  const text = await py.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json(
      {
        error: "Card-vision server returned non-JSON.",
        raw: text.slice(0, 500),
        status: py.status,
      },
      { status: 502 },
    );
  }

  if (!py.ok) {
    return NextResponse.json(
      {
        error:
          typeof (json as { detail?: string }).detail === "string"
            ? (json as { detail: string }).detail
            : `Card-vision server error (${py.status}).`,
        detail: json,
      },
      { status: py.status >= 400 && py.status < 500 ? py.status : 502 },
    );
  }

  return NextResponse.json(json);
}
