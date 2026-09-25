import { NextResponse } from "next/server";
import { squarePublicConfig } from "@/lib/square";

export const dynamic = "force-dynamic";

/**
 * Tells the reservation form whether to collect a card and, if so, which
 * Square application and location to initialise the SDK with. Both values are
 * public by design — the access token never leaves the server.
 */
export async function GET() {
  return NextResponse.json(squarePublicConfig());
}
