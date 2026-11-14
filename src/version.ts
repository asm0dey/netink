declare const NETINK_VERSION: string | undefined; // set by `bun build --define`

export const VERSION = typeof NETINK_VERSION === "string" ? NETINK_VERSION : "0.0.0-dev";
