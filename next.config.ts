import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Apple looks for the verification file at this exact path. The route
        // behind it serves Square's current copy — see the route for why it
        // is not a committed file.
        source: "/.well-known/apple-developer-merchantid-domain-association",
        destination: "/api/apple-pay-domain-association",
      },
    ];
  },
};

export default nextConfig;
