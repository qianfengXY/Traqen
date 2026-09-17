// A dedicated loopback frontend lets fixture runs coexist with a local deployment.
export function browserOrigin(value = process.env.F001_TEST_WEB_ORIGIN ?? "http://127.0.0.1:3188") {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
      || !url.port || ["3003", "3004", "3100", "3197", "6398", "6399"].includes(url.port)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("F001 browser fixture requires a dedicated loopback Web origin");
  }
  return url.origin;
}
